import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { storageChoice } from '../config/integrations'
import type { AppConfig } from '../config/env.validation'

export interface StoredFile {
  key: string
  size: number
}

export function safeStorageKey(key: string): string {
  const trimmed = key.trim()
  const invalid = new BadRequestException({
    code: 'STORAGE_KEY_INVALID',
    message: 'Invalid storage key',
  })
  if (!trimmed || trimmed.includes('\0') || isAbsolute(trimmed)) throw invalid
  const normalized = normalize(trimmed)
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw invalid
  }
  return normalized
}

const S3_CONNECT_TIMEOUT_MS = 5_000
const S3_REQUEST_TIMEOUT_MS = 60_000

@Injectable()
export class StorageService {
  private readonly log = new Logger('Storage')
  private readonly bucket: string | undefined
  private readonly localRoot: string
  private readonly s3: S3Client | null

  constructor(@Inject(ConfigService) config: AppConfig) {
    this.bucket = config.get('S3_BUCKET', { infer: true })
    this.localRoot = resolve(config.get('STORAGE_LOCAL_DIR', { infer: true }) ?? './.storage')
    this.s3 =
      storageChoice(config) === 's3' && this.bucket
        ? new S3Client({
            region: config.get('AWS_REGION', { infer: true }) ?? 'us-east-1',
            endpoint: config.get('S3_ENDPOINT', { infer: true }) || undefined,
            forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }) === 'true',
            requestHandler: {
              connectionTimeout: S3_CONNECT_TIMEOUT_MS,
              requestTimeout: S3_REQUEST_TIMEOUT_MS,
              throwOnRequestTimeout: true,
            },
          })
        : null
  }

  get driver(): 's3' | 'local' {
    return this.s3 ? 's3' : 'local'
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<StoredFile> {
    const safe = safeStorageKey(key)
    if (this.s3 && this.bucket) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: safe,
          Body: body,
          ContentType: contentType,
        }),
      )
    } else {
      const path = join(this.localRoot, safe)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body)
      this.log.debug(`local put ${safe} (${body.length} B)`)
    }
    return { key: safe, size: body.length }
  }

  async get(key: string): Promise<Buffer> {
    const safe = safeStorageKey(key)
    if (this.s3 && this.bucket) {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: safe }))
      return Buffer.from(await res.Body!.transformToByteArray())
    }
    return readFile(join(this.localRoot, safe))
  }

  async remove(key: string): Promise<void> {
    const safe = safeStorageKey(key)
    if (this.s3 && this.bucket) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safe }))
      return
    }
    await rm(join(this.localRoot, safe), { force: true })
    this.log.debug(`local remove ${safe}`)
  }

  async signedUrl(key: string, ttlSeconds = 900): Promise<string> {
    const safe = safeStorageKey(key)
    if (this.s3 && this.bucket) {
      return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: safe }), {
        expiresIn: ttlSeconds,
      })
    }
    return `file://${join(this.localRoot, safe)}`
  }
}
