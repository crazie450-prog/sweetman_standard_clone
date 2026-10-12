import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq'
import IORedis from 'ioredis'
import { Prisma, type Document } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { StorageService } from '../../storage/storage.service'
import {
  DOCUMENT_EXTRACTOR,
  ExtractionRefused,
  prepareInput,
  type DocumentExtractor,
  type ExtractionResult,
  type RecipePayload,
} from './extraction'
import {
  PayloadError,
  namedMenu,
  nestSubRecipes,
  readExtracted,
  withUnitCodes,
} from './payload.schema'
import type { AppConfig } from '../../config/env.validation'

export const DOCUMENTS_QUEUE = 'documents'

interface DocumentJob {
  documentId: string
}

function connection(config: AppConfig) {
  return new IORedis(config.getOrThrow('REDIS_URL', { infer: true }), {
    maxRetriesPerRequest: null,
  })
}

const STALE_CONFIRM_MS = 5 * 60 * 1000
const SWEEP_EVERY_MS = 60 * 1000

const READ_WAIT_MS = 1500
const ENQUEUE_WAIT_MS = 3000
const CLOSE_WAIT_MS = 10_000
const UNREACHABLE_LOG_EVERY_MS = 60_000

function unreachableLog(log: Logger) {
  let last = 0
  return (error: Error) => {
    if (Date.now() - last < UNREACHABLE_LOG_EVERY_MS) return
    last = Date.now()
    log.warn(`the queue is unreachable: ${error.message}`)
  }
}

async function answered<T>(pending: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('the queue did not answer')), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 500 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
}

function withSubRecipesInside(results: ExtractionResult[]): ExtractionResult[] {
  const nested = nestSubRecipes(results.map((r) => r.payload as RecipePayload))
  return nested.map((payload) => ({
    payload,
    confidence: results.find((r) => r.payload === payload)?.confidence ?? null,
  }))
}

@Injectable()
export class DocumentsQueue implements OnModuleDestroy {
  private readonly conn: IORedis
  readonly queue: Queue<DocumentJob>

  constructor(@Inject(ConfigService) config: AppConfig) {
    this.conn = connection(config)
    this.queue = new Queue<DocumentJob>(DOCUMENTS_QUEUE, { connection: this.conn })
    this.queue.on('error', unreachableLog(new Logger('DocumentsQueue')))
  }

  async state() {
    try {
      const counts = await answered(
        this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
        READ_WAIT_MS,
      )
      return {
        reachable: true,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
      }
    } catch {
      return { reachable: false, waiting: 0, active: 0, delayed: 0, failed: 0 }
    }
  }

  async jobInfo(jobId: string) {
    try {
      const job = await answered(this.queue.getJob(jobId), READ_WAIT_MS)
      if (!job) return null
      return {
        attemptsMade: job.attemptsMade,
        attemptsAllowed: job.opts.attempts ?? 1,
        failedReason: job.failedReason || null,
        processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
        finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      }
    } catch {
      return null
    }
  }

  async enqueue(documentId: string): Promise<string> {
    const job = await answered(this.queue.add('extract', { documentId }, JOB_OPTS), ENQUEUE_WAIT_MS)
    return job.id as string
  }

  async onModuleDestroy() {
    await answered(this.queue.close(), CLOSE_WAIT_MS).catch(() => undefined)
    this.conn.disconnect()
  }
}

@Injectable()
export class DocumentsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('DocumentsWorker')
  private readonly conn: IORedis
  private worker?: Worker<DocumentJob>
  private sweep?: NodeJS.Timeout

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(DOCUMENT_EXTRACTOR) private readonly extractor: DocumentExtractor,
    @Inject(ConfigService) config: AppConfig,
  ) {
    this.conn = connection(config)
  }

  onModuleInit() {
    this.worker = new Worker<DocumentJob>(DOCUMENTS_QUEUE, (job) => this.process(job), {
      connection: this.conn,
    })
    this.worker.on('error', unreachableLog(this.log))
    this.worker.on('failed', (job, err) => {
      void this.onFailed(job, err)
    })
    this.sweep = setInterval(() => {
      this.releaseStaleConfirms().catch((error: Error) =>
        this.log.error(`stale confirms could not be released: ${error.message}`),
      )
    }, SWEEP_EVERY_MS)
    this.sweep.unref()
  }

  async releaseStaleConfirms() {
    const { count } = await this.prisma.client.document.updateMany({
      where: {
        status: 'processing',
        extractions: { some: {} },
        updatedAt: { lt: new Date(Date.now() - STALE_CONFIRM_MS) },
      },
      data: { status: 'requires_review' },
    })
    if (count > 0) this.log.warn(`${count} document(s) cut off mid-confirm returned to review`)
    return count
  }

  private async process(job: Job<DocumentJob>) {
    const { documentId } = job.data
    const doc = await this.prisma.client.document.findUnique({ where: { id: documentId } })
    if (!doc) return

    const claimed = await this.prisma.client.document.updateMany({
      where: {
        id: documentId,
        OR: [{ status: 'queued' }, { status: 'processing', extractions: { none: {} } }],
      },
      data: { status: 'processing', error: null },
    })
    if (claimed.count === 0) return
    try {
      await this.extractInto(doc)
    } catch (error) {
      await this.prisma.client.document.updateMany({
        where: { id: documentId, status: 'processing' },
        data: { status: 'queued' },
      })
      throw error instanceof ExtractionRefused ? new UnrecoverableError(error.message) : error
    }
  }

  private async extractInto(doc: Document) {
    const documentId = doc.id
    const buffer = await this.storage.get(doc.fileKey)
    const results = await this.extractor.extract(
      await prepareInput({
        type: doc.type,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        buffer,
      }),
    )
    if (results.length === 0) throw new ExtractionRefused('No document detected in the file')
    const readable: ExtractionResult[] = []
    const unreadable: string[] = []
    for (const result of results) {
      try {
        result.payload = withUnitCodes(
          namedMenu(readExtracted(result.payload, doc.type), doc.fileName),
        )
        readable.push(result)
      } catch (e) {
        if (!(e instanceof PayloadError)) throw e
        unreadable.push(`The extracted values could not be read: ${e.message}`)
      }
    }
    if (readable.length === 0) throw new ExtractionRefused(unreadable[0])

    const kept = doc.type === 'recipe' ? withSubRecipesInside(readable) : readable
    const total = kept.length + unreadable.length
    const label = (n: number) => (total > 1 ? `${doc.fileName} (${n}/${total})` : doc.fileName)
    const [first, ...rest] = kept

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.client.extraction.create({
        data: {
          organizationId: doc.organizationId,
          documentId: doc.id,
          payload: first.payload as object,
          confidence: first.confidence,
        },
      }),
      this.prisma.client.document.update({
        where: { id: documentId },
        data: { status: 'requires_review', fileName: label(1) },
      }),
    ]

    rest.forEach((r, i) => {
      ops.push(
        this.prisma.client.document.create({
          data: {
            organizationId: doc.organizationId,
            locationId: doc.locationId,
            type: doc.type,
            fileKey: doc.fileKey,
            fileName: label(i + 2),
            mimeType: doc.mimeType,
            size: doc.size,
            status: 'requires_review',
            uploadedById: doc.uploadedById,
            extractions: {
              create: {
                organizationId: doc.organizationId,
                payload: r.payload as object,
                confidence: r.confidence,
              },
            },
          },
        }),
      )
    })

    unreadable.forEach((error, i) => {
      ops.push(
        this.prisma.client.document.create({
          data: {
            organizationId: doc.organizationId,
            locationId: doc.locationId,
            type: doc.type,
            fileKey: doc.fileKey,
            fileName: label(kept.length + i + 1),
            mimeType: doc.mimeType,
            size: doc.size,
            status: 'failed',
            error: error.slice(0, 500),
            uploadedById: doc.uploadedById,
          },
        }),
      )
    })

    await this.prisma.client.$transaction(ops)
  }

  private async onFailed(job: Job<DocumentJob> | undefined, err: Error) {
    if (!job) return
    const attempts = job.opts.attempts ?? 1
    if (job.attemptsMade < attempts && !(err instanceof UnrecoverableError)) {
      this.log.warn(`extract retry ${job.attemptsMade}/${attempts}: ${err.message}`)
      return
    }
    this.log.error(`extract failed: ${err.message}`)
    try {
      await this.prisma.client.document.updateMany({
        where: { id: job.data.documentId },
        data: { status: 'failed', error: err.message.slice(0, 500) },
      })
    } catch (error) {
      this.log.error(
        `document ${job.data.documentId} could not be marked failed: ${(error as Error).message}`,
      )
    }
  }

  async onModuleDestroy() {
    clearInterval(this.sweep)
    await this.worker?.close(this.conn.status !== 'ready')
    this.conn.disconnect()
  }
}
