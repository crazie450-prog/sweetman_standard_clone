import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { DocumentStatus } from '../../generated/prisma/client'
import { dayKey, endOfDay, recordedAt, startOfDay } from '../../common/utils/calendar'
import { zoneOf } from '../../tenancy/organization-zone'
import { PrismaService } from '../../prisma/prisma.service'
import { componentMeasure } from '../../rules/recipes'
import { assertLocationOpen, soleLocation } from '../../rules/locations'
import { menuNameFrom, reviewedPayload, storedPayload } from './payload.schema'
import { StorageService } from '../../storage/storage.service'
import {
  assertChangesHere,
  changesHere,
  reachedLocations,
  requireLocation,
  requireTenant,
  worksAt,
} from '../../tenancy/tenant-context'
import { lockKey, serialized, type Serial } from '../../common/utils/serialize'
import { assertReferencesOwned } from '../../tenancy/references'
import { money, num, numOrNull } from '../../common/utils/decimal'
import type {
  DocumentType,
  ExtractionPayload,
  InvoicePayload,
  MenuPayload,
  RecipeLine,
  RecipePayload,
  SalesPayload,
  SubRecipe,
} from './extraction'
import { DocumentsQueue } from './documents.queue'
import { splitPrep } from './prep'
import { readMeasure } from './measures'
import { UnitsService } from '../units/units.service'
import { conversionRules, CostingService, type RulesFor } from '../../costing/costing.service'
import { bridgedConversion, dimensionOf, isConvertible, normalizeUnit } from '../../costing/units'
import { dishCost } from '../../costing/costing.core'
import {
  catalogueLock,
  ingredientAliasLock,
  menuShapeLock,
  nameLock,
  recipeGraphLock,
  unitRulesLock,
  dishPlaceLock,
  salesAliasLock,
  sameName,
  sameKitchen,
  refuseTakenInKitchen,
} from '../../rules/names'
import { costHere, deliveryPrice } from '../ingredients/pricing'
import { anyOf, DishBook, IngredientBook, key, Parking } from './names'
import { Delivery } from './delivery'
import { ValidationFailed } from '../../common/filters/http-exception.filter'
import { pageOf, pageWindow } from '../../common/dto/pagination.dto'
import {
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  type DocumentsQuery,
  type DocumentsTypeQuery,
  type FileUnitsDto,
} from './dto/documents.dto'

/* ===== Constants ===== */

export const DOC_TYPES = DOCUMENT_TYPES
export const MAX_SIZE = 15 * 1024 * 1024

export const tooLarge = () =>
  new PayloadTooLargeException({ code: 'FILE_TOO_LARGE', message: 'File exceeds 15 MB' })
const MAX_NAME_BYTES = 200
const APPLY_TIMEOUT_MS = 30_000
const ACCEPTED = /\.(pdf|jpe?g|png|webp|avif|xlsx|docx?|csv|json)$/i
const APPLIED = new Set<string>(['confirmed', 'partially_processed'])

const EVERY_LOCATION_KINDS = new Set<string>(['recipe', 'menu'])

type ApplyTarget = {
  organizationId: string
  locationId: string | null
  fileKey: string
  fileName: string
}

type Settled = {
  unmapped?: number | string
  unconverted?: number | string
  credits?: number | string
}
type Seal = (tx: Serial, counts: Settled) => Promise<void>

function settledAs(counts: Settled): DocumentStatus {
  return Number(counts.unmapped ?? 0) > 0 ||
    Number(counts.unconverted ?? 0) > 0 ||
    Number(counts.credits ?? 0) > 0
    ? 'partially_processed'
    : 'confirmed'
}

const namesIn = (payload: ExtractionPayload | null): string[] => {
  if (!payload) return []
  if (payload.kind === 'invoice') {
    const received = payload.items.filter((i) => i.quantity >= 0 && lineMoney(i) >= 0)
    return [...new Set(received.map((i) => i.rawName.trim()).filter(Boolean))]
  }
  if (payload.kind === 'recipe') {
    return [
      ...new Set(
        ownLines(payload)
          .map((i) => i.rawName.trim())
          .filter(Boolean),
      ),
    ]
  }
  return []
}

const ownLines = (payload: RecipePayload): RecipeLine[] => {
  const recipes = [payload, ...(payload.subRecipes ?? [])]
  const inside = new Set(recipes.map((r) => key(r.name ?? '')))
  return recipes.flatMap((r) =>
    (r.items ?? []).filter((line) => {
      const named = key(line.rawName)
      return named === key(r.name ?? '') || !inside.has(named)
    }),
  )
}

const lineMoney = (line: InvoicePayload['items'][number]) => {
  const stated = line.lineTotal
  if (stated === undefined || !Number.isFinite(stated)) return money(line.quantity * line.unitPrice)
  return money(line.quantity < 0 ? -Math.abs(stated) : stated)
}

const invoiceTotal = (items: InvoicePayload['items']) =>
  money(items.reduce((sum, line) => sum + lineMoney(line), 0))

export interface UploadedMulterFile {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

/* ===== Service ===== */

export interface ConfirmOptions {
  createMissing?: boolean
  recipesInFile?: Set<string>
}

export type ReviewIssue = {
  severity: 'error' | 'warning'
  code: string
  message: string
  part?: number | null
  line?: number
  field?: string
}

const NEW_RECIPE = 'recipe-being-confirmed'
const PRICE_JUMP = 10

function stockUnitFor(unit: string): string {
  const written = normalizeUnit(unit)
  if (!written) return 'ea'
  const kind = dimensionOf(written)
  if (kind === 'mass') return 'kg'
  if (kind === 'volume') return 'l'
  if (kind === 'count') return 'ea'
  return written.slice(0, 20)
}

const addable = (line: { rawName: string; quantity: number; unit: string }) =>
  line.quantity > 0 && dimensionOf(line.unit) !== null && line.rawName.trim() !== ''

function newStockUnits(lines: RecipeLine[]) {
  const stated = new Map<string, string>()
  const sized = new Map<string, string>()
  for (const written of lines) {
    const { line, note, unmeasured } = readMeasure(written)
    if (unmeasured || !line.unit.trim()) continue
    const stock = splitPrep(line.rawName).name.toLowerCase()
    const into = note ? sized : stated
    if (!into.has(stock)) into.set(stock, stockUnitFor(line.unit))
  }
  for (const [stock, unit] of sized) if (!stated.has(stock)) stated.set(stock, unit)
  return stated
}

const partOf = (fileName: string) => Number(/\((\d+)\/\d+\)$/.exec(fileName)?.[1] ?? 0)

function issueOf(e: HttpException): Omit<ReviewIssue, 'severity'> {
  const body = e.getResponse()
  const { part, line, field } = (typeof body === 'object' ? body : {}) as {
    part?: number | null
    line?: number
    field?: string
  }
  const { code, error } = failureOf(e)
  return {
    code,
    message: error,
    ...(part !== undefined && { part }),
    ...(line !== undefined && { line }),
    ...(field && { field }),
  }
}

function failureOf(e: HttpException): { code: string; error: string } {
  const body = e.getResponse()
  if (typeof body === 'string') return { code: 'BAD_REQUEST', error: body }
  const { code, message } = body as { code?: unknown; message?: unknown }
  const error =
    e instanceof ValidationFailed
      ? e.details.map((d) => d.message).join('; ')
      : Array.isArray(message)
        ? message.join('; ')
        : String(message ?? e.message)
  return { code: typeof code === 'string' ? code : 'BAD_REQUEST', error }
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger('DocumentsService')

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: DocumentsQueue,
    private readonly costing: CostingService,
    private readonly units: UnitsService,
  ) {}

  async list(query: DocumentsQuery) {
    const where = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
    }
    const [docs, total] = await Promise.all([
      this.prisma.client.document.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
      }),
      this.prisma.client.document.count({ where }),
    ])
    const siblings = await this.siblingsOf(docs.map((d) => d.fileKey))
    return pageOf(
      docs.map((d) => {
        const parts = (siblings.get(d.fileKey) ?? []).map((p) => p.id)
        return {
          id: d.id,
          file: d.fileName,
          type: d.type,
          vendor: null as string | null,
          uploadedAt: d.createdAt.toISOString(),
          status: d.status,
          error: d.status === 'failed' ? d.error : null,
          part:
            parts.length > 1
              ? { index: parts.indexOf(d.id) + 1, of: parts.length, group: parts[0] }
              : null,
        }
      }),
      total,
      query,
    )
  }

  async summary(query: DocumentsTypeQuery) {
    const rows = await this.prisma.client.document.groupBy({
      by: ['status'],
      where: query.type ? { type: query.type } : {},
      _count: true,
    })
    const counts = Object.fromEntries(DOCUMENT_STATUSES.map((s) => [s, 0])) as Record<
      DocumentStatus,
      number
    >
    for (const row of rows) counts[row.status] = row._count
    return {
      ...counts,
      total: rows.reduce((sum, row) => sum + row._count, 0),
      reading: counts.queued + counts.processing,
    }
  }

  private async siblingsOf(fileKeys: string[]) {
    const related = await this.prisma.client.document.findMany({
      where: { fileKey: { in: [...new Set(fileKeys)] } },
      select: { id: true, fileKey: true, fileName: true, status: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    const siblings = new Map<string, typeof related>()
    for (const d of related) siblings.set(d.fileKey, [...(siblings.get(d.fileKey) ?? []), d])
    return siblings
  }

  async detail(id: string) {
    const doc = await this.prisma.client.document.findUnique({
      where: { id },
      include: { extractions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
    })
    if (!doc)
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' })
    const payload = storedPayload(doc.extractions[0]?.payload)
    return {
      id: doc.id,
      file: doc.fileName,
      type: doc.type,
      status: doc.status,
      error: doc.error,
      uploadedAt: doc.createdAt.toISOString(),
      extraction: payload,
      unresolved: await this.unresolvedNames(doc.organizationId, payload, doc.locationId),
      unconverted: await this.unconvertedLines(doc.organizationId, payload, doc.locationId),
      priceJumps: await this.priceJumps(doc.organizationId, payload, doc.locationId),
      siblings: ((await this.siblingsOf([doc.fileKey])).get(doc.fileKey) ?? [])
        .filter((d) => d.id !== doc.id)
        .map((d) => ({ id: d.id, file: d.fileName, status: d.status })),
    }
  }

  async mapName(id: string, rawName: string, ingredientId: string) {
    const doc = await this.prisma.client.document.findUnique({ where: { id } })
    if (!doc)
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' })
    await assertReferencesOwned(this.prisma.client, { ingredientId })
    await this.bindOn(doc.id, doc.organizationId, rawName, ingredientId)
    return this.detail(id)
  }

  async bindOn(documentId: string, organizationId: string, rawName: string, ingredientId: string) {
    const name = (rawName ?? '').trim()
    if (!name)
      throw new BadRequestException({ code: 'NAME_REQUIRED', message: 'A name is required' })

    const payload = await this.latestPayload(documentId)
    const vendorId = await this.statedVendor(organizationId, payload)
    if (!vendorId) return this.bindName(organizationId, name, ingredientId)

    const sku =
      payload?.kind === 'invoice'
        ? payload.items.find((i) => i.rawName.trim().toLowerCase() === name.toLowerCase())?.sku
        : undefined
    await serialized(this.prisma.client, catalogueLock(organizationId, vendorId), async (tx) => {
      const known = await tx.vendorProduct.findFirst({
        where: { organizationId, vendorId, name: sameName(name) },
        select: { id: true },
      })
      if (known) {
        await tx.vendorProduct.update({
          where: { id: known.id },
          data: { ingredientId },
        })
        return
      }
      await tx.vendorProduct.create({
        data: {
          organizationId,
          vendorId,
          ingredientId,
          name,
          sku: await this.freeCode(tx, organizationId, vendorId, sku),
        },
      })
    })
  }

  private async freeCode(tx: Serial, organizationId: string, vendorId: string, sku?: string) {
    const code = sku?.trim()
    if (!code) return null
    const claimed = await tx.vendorProduct.findFirst({
      where: { organizationId, vendorId, sku: sameName(code) },
      select: { id: true },
    })
    return claimed ? null : code
  }

  private async latestPayload(documentId: string) {
    const extraction = await this.prisma.client.extraction.findFirst({
      where: { documentId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    return storedPayload(extraction?.payload)
  }

  async bindName(organizationId: string, rawName: string, ingredientId: string) {
    const name = (rawName ?? '').trim()
    if (!name)
      throw new BadRequestException({ code: 'NAME_REQUIRED', message: 'A name is required' })
    await serialized(this.prisma.client, ingredientAliasLock(organizationId, name), async (tx) => {
      const known = await tx.ingredientAlias.findFirst({
        where: { organizationId, rawName: sameName(name) },
        select: { id: true },
      })
      if (known) {
        await tx.ingredientAlias.update({
          where: { id: known.id },
          data: { ingredientId },
        })
        return
      }
      await tx.ingredientAlias.create({
        data: { organizationId, rawName: name, ingredientId },
      })
    })
  }

  private async nestedRecipes(
    organizationId: string,
    locationId: string | null,
    rawNames: string[],
    own: string,
  ) {
    const found = await this.prisma.client.recipe.findMany({
      where: { organizationId, name: anyOf(rawNames), ...sameKitchen(locationId) },
      orderBy: { locationId: { sort: 'asc', nulls: 'last' } },
      select: { id: true, name: true, yieldAmount: true, yieldUnit: true },
    })
    const byName = new Map<string, (typeof found)[number]>()
    for (const recipe of found) {
      if (key(recipe.name) !== key(own) && !byName.has(key(recipe.name))) {
        byName.set(key(recipe.name), recipe)
      }
    }
    return (rawName: string) => byName.get(key(rawName)) ?? null
  }

  async unresolvedNames(
    organizationId: string,
    payload: ExtractionPayload | null,
    locationId: string | null = null,
  ) {
    const names = namesIn(payload)
    if (names.length === 0) return []
    const vendorId = await this.statedVendor(organizationId, payload)
    const codes = new Map(
      payload?.kind === 'invoice'
        ? payload.items.map((i) => [i.rawName.trim(), i.sku] as const)
        : [],
    )
    const waiting = await this.prisma.client.invoiceItem.groupBy({
      by: ['description'],
      where: { ingredientId: null, invoice: { organizationId } },
      _count: { _all: true },
    })
    const lines = new Map(waiting.map((w) => [w.description.trim().toLowerCase(), w._count._all]))

    const book = await IngredientBook.read(
      this.prisma.client,
      organizationId,
      names.map((rawName) => ({ rawName, sku: codes.get(rawName) })),
      vendorId,
    )
    const nested =
      payload?.kind === 'recipe'
        ? await this.nestedRecipes(organizationId, locationId, names, payload.name ?? '')
        : () => null
    const out: { rawName: string; lines: number }[] = []
    for (const rawName of names) {
      if (book.find(rawName, codes.get(rawName))) continue
      if (payload?.kind === 'recipe' && book.prepared(rawName).ingredient) continue
      if (nested(rawName)) continue
      out.push({ rawName, lines: lines.get(rawName.toLowerCase()) ?? 0 })
    }
    return out
  }

  async unconvertedLines(
    organizationId: string,
    payload: ExtractionPayload | null,
    locationId: string | null = null,
  ) {
    if (payload?.kind === 'invoice') return this.unconvertedOnInvoice(organizationId, payload)
    if (payload?.kind !== 'recipe') return []
    const lines = ownLines(payload)
    if (lines.length === 0) return []
    const names = lines.map((line) => line.rawName)
    const [book, conversions, nested] = await Promise.all([
      IngredientBook.read(this.prisma.client, organizationId, lines),
      conversionRules(this.prisma.client, organizationId),
      this.nestedRecipes(organizationId, locationId, names, payload.name ?? ''),
    ])
    const out: {
      rawName: string
      ingredientId: string
      ingredient: string
      from: string
      to: string
    }[] = []
    for (const line of lines) {
      const { ingredient } = book.prepared(line.rawName)
      const from = line.unit.trim()
      if (!ingredient || !from || dimensionOf(from) === null || nested(line.rawName)) continue
      if (isConvertible(from, ingredient.unit, conversions(ingredient.id))) continue
      if (out.some((o) => o.ingredientId === ingredient.id && o.from === normalizeUnit(from)))
        continue
      out.push({
        rawName: line.rawName.trim(),
        ingredientId: ingredient.id,
        ingredient: ingredient.name,
        from: normalizeUnit(from),
        to: ingredient.unit,
      })
    }
    return out
  }

  private async invoiceLines(organizationId: string, payload: InvoicePayload) {
    const vendorId = await this.statedVendor(organizationId, payload)
    const [book, conversions] = await Promise.all([
      IngredientBook.read(this.prisma.client, organizationId, payload.items, vendorId),
      conversionRules(this.prisma.client, organizationId),
    ])
    return payload.items.map((line, index) => {
      const ingredient = book.find(line.rawName, line.sku)
      const credit = line.quantity < 0 || lineMoney(line) < 0
      const received =
        ingredient && !credit && line.unit
          ? bridgedConversion(line.quantity, line.unit, ingredient.unit, conversions(ingredient.id))
          : null
      return { line, index, ingredient, credit, reaches: !line.unit || received !== null }
    })
  }

  private async unconvertedOnInvoice(organizationId: string, payload: InvoicePayload) {
    const out: {
      rawName: string
      ingredientId: string
      ingredient: string
      from: string
      to: string
    }[] = []
    for (const { line, ingredient, credit, reaches } of await this.invoiceLines(
      organizationId,
      payload,
    )) {
      if (!ingredient || credit || reaches || dimensionOf(line.unit) === null) continue
      const from = normalizeUnit(line.unit)
      if (out.some((o) => o.ingredientId === ingredient.id && o.from === from)) continue
      out.push({
        rawName: line.rawName.trim(),
        ingredientId: ingredient.id,
        ingredient: ingredient.name,
        from,
        to: ingredient.unit,
      })
    }
    return out
  }

  async priceJumps(
    organizationId: string,
    payload: ExtractionPayload | null,
    locationId: string | null,
  ) {
    if (payload?.kind !== 'invoice' || payload.items.length === 0) return []
    const vendorId = await this.statedVendor(organizationId, payload)
    const [book, conversions] = await Promise.all([
      IngredientBook.read(this.prisma.client, organizationId, payload.items, vendorId),
      conversionRules(this.prisma.client, organizationId),
    ])
    const found = payload.items.flatMap((line, index) => {
      const ingredient = book.find(line.rawName, line.sku)
      return ingredient ? [{ line, index, ingredient }] : []
    })
    if (found.length === 0) return []
    const settings = locationId
      ? await this.prisma.client.ingredientLocationSettings.findMany({
          where: { locationId, ingredientId: { in: found.map((f) => f.ingredient.id) } },
          select: { ingredientId: true, costPerUnit: true },
        })
      : []
    const out: {
      line: number
      rawName: string
      ingredient: string
      stated: number
      now: number
      unit: string
    }[] = []
    for (const { line, index, ingredient } of found) {
      const received = bridgedConversion(
        line.quantity,
        line.unit,
        ingredient.unit,
        conversions(ingredient.id),
      )
      if (received === null || received <= 0) continue
      const paid = line.lineTotal ?? line.quantity * line.unitPrice
      if (!(paid > 0)) continue
      const stated = paid / received
      const now = costHere({
        costPerUnit: ingredient.costPerUnit,
        perLocation: settings.flatMap((s) =>
          s.ingredientId === ingredient.id && s.costPerUnit !== null
            ? [{ costPerUnit: s.costPerUnit }]
            : [],
        ),
      })
      if (!(now > 0)) continue
      if (stated / now < PRICE_JUMP && now / stated < PRICE_JUMP) continue
      out.push({
        line: index,
        rawName: line.rawName.trim(),
        ingredient: ingredient.name,
        stated: money(stated),
        now: money(now),
        unit: ingredient.unit,
      })
    }
    return out
  }

  private async statedVendor(organizationId: string, payload: ExtractionPayload | null) {
    const stated = payload?.kind === 'invoice' ? payload.vendorName?.trim() : ''
    if (!stated) return null
    const vendor = await this.prisma.client.vendor.findFirst({
      where: { organizationId, name: sameName(stated) },
      select: { id: true },
    })
    return vendor?.id ?? null
  }

  async create(file: UploadedMulterFile, type: string) {
    if (!DOC_TYPES.includes(type as DocumentType)) {
      throw new BadRequestException({
        code: 'DOCUMENT_TYPE_INVALID',
        message: `type must be one of ${DOC_TYPES.join(', ')}`,
      })
    }
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'file is required' })
    if (!ACCEPTED.test(file.originalname)) {
      throw new BadRequestException({
        code: 'FILE_TYPE_UNSUPPORTED',
        message:
          'Unsupported file type: PDF, JPG, PNG, WEBP, AVIF, XLSX, DOC, DOCX, CSV and JSON can be read',
      })
    }
    if (Buffer.byteLength(file.originalname) > MAX_NAME_BYTES) {
      throw new BadRequestException({
        code: 'FILE_NAME_TOO_LONG',
        message: 'The file name is too long; shorten it and upload again',
      })
    }

    const ctx = requireTenant()
    const locationId =
      EVERY_LOCATION_KINDS.has(type) && !ctx.locationId && changesHere(null)
        ? null
        : requireLocation()
    const fileKey = `documents/${ctx.organizationId}/${Date.now()}-${file.originalname}`
    await this.storage.put(fileKey, file.buffer, file.mimetype)

    const doc = await this.prisma.client.document.create({
      data: {
        organizationId: ctx.organizationId,
        locationId,
        type: type as DocumentType,
        fileKey,
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        status: 'queued',
        uploadedById: ctx.userId,
      },
    })
    await this.queued(doc.id)
    return { id: doc.id, status: doc.status }
  }

  private async queued(id: string) {
    let jobId: string
    try {
      jobId = await this.queue.enqueue(id)
    } catch (error) {
      this.logger.error(`document ${id} could not be queued: ${(error as Error).message}`)
      await this.prisma.client.document.update({
        where: { id },
        data: {
          status: 'failed',
          error: 'The processing queue could not be reached; retry the document in a moment',
        },
      })
      throw new ServiceUnavailableException(
        'The document is saved, but the processing queue could not be reached; retry it in a moment',
      )
    }
    await this.prisma.client.document.update({ where: { id }, data: { jobId } })
  }

  async retry(id: string) {
    const doc = await this.prisma.client.document.findUnique({ where: { id } })
    if (!doc)
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' })
    if (doc.status !== 'failed') {
      throw new ConflictException({
        code: 'DOCUMENT_NOT_FAILED',
        message: 'Only a failed document can be retried',
      })
    }
    const siblings = await this.prisma.client.document.count({
      where: { fileKey: doc.fileKey, NOT: { id } },
    })
    if (siblings > 0) {
      throw new ConflictException({
        code: 'DOCUMENT_PART_NOT_RETRIED',
        message:
          'This part was read together with the rest of its file; reading it again would read the whole file a second time. Upload the file again, or enter this part by hand',
      })
    }
    const claimed = await this.prisma.client.document.updateMany({
      where: { id, status: 'failed' },
      data: { status: 'queued', error: null },
    })
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'DOCUMENT_NOT_FAILED',
        message: 'Only a failed document can be retried',
      })
    }
    await this.queued(id)
    return { id, status: 'queued' }
  }

  async remove(id: string) {
    const doc = await this.prisma.client.document.findUnique({ where: { id } })
    if (!doc)
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' })
    if (APPLIED.has(doc.status)) {
      throw new ConflictException({
        code: 'DOCUMENT_CONFIRMED_KEPT',
        message: 'A confirmed document is the record of what it moved, so it cannot be deleted',
      })
    }
    const removed = await this.prisma.client.document.deleteMany({
      where: { id, status: { notIn: ['confirmed', 'partially_processed', 'processing'] } },
    })
    if (removed.count === 0) {
      throw new ConflictException({
        code: 'DOCUMENT_PROCESSING',
        message: 'This document is being processed; delete it once that is done',
      })
    }
    const shared = await this.prisma.client.document.count({ where: { fileKey: doc.fileKey } })
    if (shared === 0) await this.storage.remove(doc.fileKey)
    return { id, deleted: true }
  }

  async confirm(id: string, override?: ExtractionPayload, options: ConfirmOptions = {}) {
    const doc = await this.prisma.client.document.findUnique({
      where: { id },
      include: { extractions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
    })
    if (!doc)
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' })
    if (APPLIED.has(doc.status)) {
      throw new ConflictException({
        code: 'DOCUMENT_ALREADY_CONFIRMED',
        message: 'Document is already confirmed',
      })
    }
    if (doc.status !== 'requires_review') {
      throw new ConflictException({
        code: 'DOCUMENT_NOT_READY',
        message: 'Document is not ready for review',
      })
    }
    await assertLocationOpen(this.prisma.client, doc.locationId)
    const stored = storedPayload(doc.extractions[0]?.payload) ?? undefined
    if (!override && !stored)
      throw new BadRequestException({
        code: 'EXTRACTION_MISSING',
        message: 'No extracted data to apply',
      })
    const payload = reviewedPayload(override ?? stored, doc.type)
    if (payload.kind !== 'recipe' && payload.items.length === 0) {
      throw new BadRequestException({
        code: 'DOCUMENT_EMPTY',
        message:
          'Nothing was read on this document, so there is nothing to apply; add its lines in the review, or delete it',
      })
    }
    const recipesInFile =
      options.recipesInFile ??
      (payload.kind === 'recipe' ? await this.recipesWaitingBeside(doc) : undefined)

    const claimed = await this.prisma.client.document.updateMany({
      where: { id, status: 'requires_review' },
      data: { status: 'processing' },
    })
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'DOCUMENT_CONFIRMING',
        message: 'Document is already being confirmed',
      })
    }
    let sealed: DocumentStatus | null = null
    const seal: Seal = async (tx, counts) => {
      const status = settledAs(counts)
      const done = await tx.document.updateMany({
        where: { id, status: 'processing' },
        data: { status },
      })
      if (done.count === 0)
        throw new ConflictException({
          code: 'DOCUMENT_CONFIRMING',
          message: 'Document is already being confirmed',
        })
      if (override)
        await tx.extraction.create({
          data: { organizationId: doc.organizationId, documentId: id, payload: payload as object },
        })
      sealed = status
    }
    let summary: Awaited<ReturnType<DocumentsService['apply']>>
    try {
      summary = await this.apply(doc, payload, { ...options, recipesInFile }, seal)
    } catch (error) {
      await this.prisma.client.document.updateMany({
        where: { id, status: 'processing' },
        data: { status: 'requires_review' },
      })
      throw error
    }
    const status = sealed ?? settledAs(summary)
    if (sealed === null)
      await this.prisma.client.document.update({ where: { id }, data: { status } })
    return { id, status, ...summary }
  }

  private async recipesWaitingBeside(doc: { id: string; fileKey: string }) {
    const waiting = await this.prisma.client.document.findMany({
      where: {
        fileKey: doc.fileKey,
        type: 'recipe',
        status: 'requires_review',
        NOT: { id: doc.id },
      },
      include: { extractions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
    })
    const names = new Set<string>()
    for (const d of waiting) {
      const read = storedPayload(d.extractions[0]?.payload)
      if (read?.kind === 'recipe' && read.name.trim()) names.add(key(read.name))
    }
    return names
  }

  async check(id: string, override?: unknown, options: ConfirmOptions = {}) {
    const doc = await this.prisma.client.document.findUnique({
      where: { id },
      include: { extractions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
    })
    if (!doc)
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' })
    const stated = override ?? storedPayload(doc.extractions[0]?.payload)
    if (!stated) return { issues: [] as ReviewIssue[] }
    let payload: ExtractionPayload
    try {
      payload = reviewedPayload(stated, doc.type)
    } catch (e) {
      if (!(e instanceof HttpException)) throw e
      return { issues: [{ severity: 'error', ...issueOf(e) }] as ReviewIssue[] }
    }
    const issues: ReviewIssue[] = []
    if (payload.kind !== 'recipe' && payload.items.length === 0) {
      issues.push({
        severity: 'error',
        code: 'DOCUMENT_EMPTY',
        message:
          payload.kind === 'sales'
            ? 'No dish was read on this report. Sales are recorded by dish sold, and a report of totals by category (food, beverages, tax) names no dish to record; add the dishes sold, or delete it'
            : 'Nothing was read on this document; add its lines, or delete it',
      })
      return { issues }
    }
    const zone = await zoneOf(this.prisma, doc.organizationId)
    const dated = (stated: string | undefined, field: string, paper: string) => {
      if (!stated) {
        issues.push({
          severity: 'warning',
          code: 'DATE_MISSING',
          message: `No date was read: the ${paper} will be recorded on today's date; enter the date printed on it`,
          field,
        })
        return
      }
      try {
        recordedAt(stated, zone)
      } catch (e) {
        if (!(e instanceof HttpException)) throw e
        issues.push({ severity: 'error', field, ...issueOf(e) })
      }
    }
    if (payload.kind === 'recipe') {
      issues.push(
        ...(await this.recipeIssues(doc.organizationId, doc.locationId, payload, {
          ...options,
          recipesInFile: await this.recipesWaitingBeside(doc),
        })),
      )
    }
    if (payload.kind === 'invoice') {
      const vendorName = payload.vendorName?.trim() || null
      const vendor = vendorName
        ? await this.prisma.client.vendor.findFirst({
            where: { organizationId: doc.organizationId, name: sameName(vendorName) },
            select: { id: true },
          })
        : null
      try {
        await this.assertPaperNew(this.prisma.client, doc.organizationId, {
          number: payload.number,
          vendorId: vendor?.id ?? null,
          vendorName,
        })
      } catch (e) {
        if (!(e instanceof HttpException)) throw e
        issues.push({ severity: 'error', field: 'number', ...issueOf(e) })
      }
      dated(payload.invoiceDate, 'invoiceDate', 'invoice')
      if (!vendorName)
        issues.push({
          severity: 'warning',
          code: 'VENDOR_MISSING',
          message:
            'No vendor was read: the invoice is recorded with no vendor, its lines are not read in a vendor catalogue, and its number is not checked against earlier papers; enter the vendor',
          field: 'vendorName',
        })
      else if (!vendor)
        issues.push({
          severity: 'warning',
          code: 'VENDOR_UNKNOWN',
          message: `${vendorName} is not one of your vendors: the invoice is recorded under that name with no vendor, so its lines are not read in a vendor catalogue and their prices name no vendor; add the vendor, or correct the name to one you have`,
          field: 'vendorName',
        })
      for (const { line, index, ingredient, credit, reaches } of await this.invoiceLines(
        doc.organizationId,
        payload,
      )) {
        if (!ingredient && !credit && options.createMissing && addable(line))
          issues.push({
            severity: 'warning',
            code: 'INGREDIENT_ADDED',
            message: `${line.rawName.trim()} is not in the catalogue and will be added, counted in ${stockUnitFor(line.unit)}, at the price this line states`,
            line: index,
            field: 'rawName',
          })
        else if (!ingredient && !credit)
          issues.push({
            severity: 'warning',
            code: 'INVOICE_LINE_UNMAPPED',
            message: options.createMissing
              ? `${line.rawName.trim()} is not in the catalogue, and with no unit of measure it is not added: the line is recorded on the invoice but receives no stock; give it a unit, or map it below`
              : `${line.rawName.trim()} is not in the catalogue: the line is recorded on the invoice but receives no stock; map it below to receive it`,
            line: index,
            field: 'rawName',
          })
        else if (ingredient && !credit && !reaches)
          issues.push({
            severity: 'error',
            code: 'UNIT_NOT_CONVERTIBLE',
            message:
              dimensionOf(line.unit) === null
                ? `"${line.unit}" is not a unit of measure, and ${ingredient.name} is counted in ${ingredient.unit}; write the quantity in a unit of measure`
                : `${ingredient.name} is counted in ${ingredient.unit}, and ${line.unit} does not convert to it; record a conversion below, or write the quantity in a unit of the same kind`,
            line: index,
            field: 'unit',
          })
      }
      for (const jump of await this.priceJumps(doc.organizationId, payload, doc.locationId)) {
        issues.push({
          severity: 'warning',
          code: 'PRICE_FAR_FROM_USUAL',
          message: `${jump.rawName} at ${jump.stated} per ${jump.unit}, where this location pays ${jump.now}; check the quantity, unit and price`,
          line: jump.line,
          field: 'unitPrice',
        })
      }
    }
    if (payload.kind === 'sales') {
      const dishes = await DishBook.read(
        this.prisma.client,
        doc.organizationId,
        payload.items.map((line) => line.menuItemName),
        doc.locationId,
      )
      const sold: { menuItemId: string; quantity: number; unitPrice: number }[] = []
      for (const line of payload.items) {
        const dish = line.quantity < 0 || line.unitPrice < 0 ? null : dishes.find(line.menuItemName)
        if (dish)
          sold.push({
            menuItemId: dish.id,
            quantity: Math.round(line.quantity),
            unitPrice: money(line.unitPrice),
          })
      }
      dated(payload.date, 'date', 'report')
      try {
        const date = recordedAt(payload.date, zone)
        if (sold.length > 0)
          await this.assertNotRecorded(
            this.prisma.client,
            doc.organizationId,
            doc.locationId,
            date,
            zone,
            sold,
          )
      } catch (e) {
        if (!(e instanceof HttpException)) throw e
        if (!issues.some((i) => i.field === 'date' && i.severity === 'error'))
          issues.push({ severity: 'error', field: 'date', ...issueOf(e) })
      }
      payload.items.forEach((sold, line) => {
        if (
          sold.quantity >= 0 &&
          sold.unitPrice >= 0 &&
          dishes.find(sold.menuItemName) &&
          sold.quantity !== Math.round(sold.quantity)
        )
          issues.push({
            severity: 'warning',
            code: 'QUANTITY_ROUNDED',
            message: `${sold.quantity} sold is recorded as ${Math.round(sold.quantity)}: sales are counted in whole portions; correct the quantity if the paper means something else`,
            line,
            field: 'quantity',
          })
        if (sold.quantity < 0 || sold.unitPrice < 0 || dishes.find(sold.menuItemName)) return
        issues.push({
          severity: 'warning',
          code: 'DISH_UNMAPPED',
          message: `${sold.menuItemName.trim()} is no dish on this location's menu: the line is not recorded as a sale; map it in Sales Mapping, or correct the name`,
          line,
          field: 'menuItemName',
        })
      })
    }
    if (payload.kind === 'menu') {
      const menuName = payload.name?.trim() || menuNameFrom(doc.fileName)
      const named = await this.prisma.client.menu.findFirst({
        where: { organizationId: doc.organizationId, name: sameName(menuName) },
        select: { locations: { select: { locationId: true } } },
      })
      if (
        named &&
        ((named.locations.length > 0 && !named.locations.some((l) => worksAt(l.locationId))) ||
          (named.locations.length === 0 && !changesHere(null)))
      )
        issues.push({
          severity: 'error',
          code: 'MENU_NAME_TAKEN',
          message: `A menu named ${menuName} already exists where you cannot change it; give this menu another name`,
          field: 'name',
        })
      const onBooks = new Map<string, { price: unknown; locationId: string | null }>()
      for (const m of await this.prisma.client.menuItem.findMany({
        where: {
          organizationId: doc.organizationId,
          name: anyOf(payload.items.map((d) => d.name ?? '').filter((n) => n.trim())),
          ...sameKitchen(doc.locationId),
        },
        select: { name: true, price: true, locationId: true },
      })) {
        if (!onBooks.has(key(m.name)) || m.locationId === doc.locationId)
          onBooks.set(key(m.name), m)
      }
      const listed = new Set<string>()
      payload.items.forEach((dish, line) => {
        if (!dish.name?.trim()) {
          issues.push({
            severity: 'error',
            code: 'DISH_NAME_REQUIRED',
            message: 'Give this dish a name, or remove it',
            line,
            field: 'name',
          })
          return
        }
        const named = key(dish.name)
        if (listed.has(named)) {
          issues.push({
            severity: 'warning',
            code: 'DISH_REPEATED',
            message: `${dish.name.trim()} is listed above already: only the first one is put on the menu`,
            line,
            field: 'name',
          })
          return
        }
        listed.add(named)
        const kept = onBooks.get(named)
        if (kept && money(Number(kept.price)) !== money(dish.price))
          issues.push({
            severity: 'warning',
            code: 'DISH_PRICE_KEPT',
            message: `${dish.name.trim()} is already on the books at ${money(Number(kept.price)).toFixed(2)}: the dish keeps that price; change it under Menu Items if the paper is right`,
            line,
            field: 'price',
          })
        else if (!kept && !(dish.price > 0))
          issues.push({
            severity: 'warning',
            code: 'PRICE_MISSING',
            message:
              'No price: the dish is added at 0, so its margin cannot be read; enter its price',
            line,
            field: 'price',
          })
      })
    }
    return { issues }
  }

  private async recipeIssues(
    organizationId: string,
    locationId: string | null,
    payload: RecipePayload,
    options: ConfirmOptions,
  ): Promise<ReviewIssue[]> {
    let plan: Awaited<ReturnType<DocumentsService['planRecipe']>>
    try {
      plan = await this.planRecipe(organizationId, locationId, payload, options)
    } catch (e) {
      if (!(e instanceof HttpException)) throw e
      return [{ severity: 'error', ...issueOf(e) }]
    }
    const issues: ReviewIssue[] = []
    const error = (
      at: { part: number | null; line: number },
      code: string,
      field: string,
      message: string,
    ) => issues.push({ severity: 'error', code, message, part: at.part, line: at.line, field })

    for (const n of plan.notYetConfirmed)
      error(
        n.at,
        'RECIPE_COMPONENTS_UNCONFIRMED',
        'rawName',
        `${n.rawName} is a recipe of this file still waiting for review; confirm the whole file with Confirm all, or confirm ${n.rawName} first`,
      )
    for (const u of plan.unmapped)
      error(
        u.at,
        'INGREDIENT_UNMAPPED',
        'rawName',
        `${u.rawName.trim()} is not in the catalogue; map it to an ingredient, or let the names that reach no ingredient be added`,
      )
    const phrased = new Set<string>()
    for (const p of plan.phrases) {
      phrased.add(`${p.at.part}:${p.at.line}`)
      error(
        p.at,
        'UNIT_NOT_A_UNIT',
        'unit',
        `"${p.written}" is not a unit of measure; choose a unit from the list`,
      )
    }
    const { unconverted, unmeasured } = plan.unreached(plan.conversions)
    for (const u of unconverted) {
      if (phrased.has(`${u.at.part}:${u.at.line}`)) continue
      const written = u.line.unit.trim()
      error(
        u.at,
        'UNIT_NOT_CONVERTIBLE',
        'unit',
        !written
          ? `${u.name} is counted in ${u.unit}; give this line a unit`
          : u.isNew
            ? `${u.name} is new and will be counted in ${u.unit}, as another line states it, and ${written} does not convert to ${u.unit}; state its lines in units of one kind`
            : `${u.name} is counted in ${u.unit}, and ${written} does not convert to it; record a conversion, or choose a unit of the same kind`,
      )
    }
    for (const u of unmeasured) error(u.at, 'COMPONENT_UNIT_INVALID', 'unit', u.message)

    for (const draft of plan.drafts) {
      const clash = await this.prisma.client.recipe.findFirst({
        where: { organizationId, name: sameName(draft.name), ...sameKitchen(locationId) },
        select: { location: { select: { name: true } } },
      })
      if (clash)
        issues.push({
          severity: 'error',
          code: 'NAME_TAKEN',
          message: `${draft.name} is already a recipe ${clash.location ? `at ${clash.location.name}` : 'of the whole organization'}; rename it, or delete this document`,
          part: draft.part,
          field: 'name',
        })
    }
    for (const l of plan.leftOut)
      issues.push({
        severity: 'warning',
        code: 'LINE_LEFT_OUT',
        message: `"${l.phrase}" with no quantity, and ${l.rawName} is not in the catalogue yet: the line is left out of the recipe; add the ingredient, or give the line a quantity and a unit, to keep it`,
        part: l.at.part,
        line: l.at.line,
        field: 'rawName',
      })
    for (const p of plan.allLines)
      if (p.unmeasured)
        issues.push({
          severity: 'warning',
          code: 'QUANTITY_UNMEASURED',
          message: `"${p.unmeasured}": kept with no quantity, so it adds nothing to the cost; give it a quantity and a unit to cost it`,
          part: p.at.part,
          line: p.at.line,
          field: 'quantity',
        })
      else if (!(p.line.quantity > 0))
        issues.push({
          severity: 'warning',
          code: 'QUANTITY_MISSING',
          message: 'No quantity; this line adds nothing to the cost',
          part: p.at.part,
          line: p.at.line,
          field: 'quantity',
        })
    for (const draft of plan.drafts)
      draft.items.forEach((written, line) => {
        const text = written.quantityText?.trim()
        if (text && text !== String(written.quantity))
          issues.push({
            severity: 'warning',
            code: 'QUANTITY_AS_WRITTEN',
            message: `The paper writes "${text}"; ${written.quantity} is taken, correct it if another is meant`,
            part: draft.part,
            line,
            field: 'quantity',
          })
      })
    return issues
  }

  async fileUnits(id: string) {
    const doc = await this.prisma.client.document.findUnique({ where: { id } })
    if (!doc)
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' })
    const waiting = await this.prisma.client.document.findMany({
      where: {
        fileKey: doc.fileKey,
        type: 'recipe',
        OR: [{ id }, { status: 'requires_review' }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { extractions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
    })
    waiting.sort((a, b) => partOf(a.fileName) - partOf(b.fileName))
    const recipes = waiting.flatMap((d) => {
      const read = storedPayload(d.extractions[0]?.payload)
      return read?.kind === 'recipe' ? [read] : []
    })
    const inFile = new Set(
      recipes.flatMap((r) => [r.name, ...(r.subRecipes ?? []).map((sub) => sub.name)]).map(key),
    )
    const lines = recipes.flatMap((r) => [
      ...r.items,
      ...(r.subRecipes ?? []).flatMap((sub) => sub.items ?? []),
    ])
    const { organizationId, locationId } = doc
    const [book, conversions, nestedOf] = await Promise.all([
      IngredientBook.read(this.prisma.client, organizationId, lines),
      conversionRules(this.prisma.client, organizationId),
      this.nestedRecipes(
        organizationId,
        locationId,
        lines.map((l) => l.rawName),
        '',
      ),
    ])
    type Row = {
      key: string
      name: string
      ingredientId: string | null
      unit: string
      written: Map<string, number>
    }
    const newUnit = newStockUnits(lines)
    const rows = new Map<string, Row>()
    for (const written of lines) {
      const { line, unmeasured } = readMeasure(written)
      const unit = normalizeUnit(line.unit)
      if (unmeasured || !unit || dimensionOf(unit) === null || inFile.has(key(line.rawName)))
        continue
      const { ingredient } = book.prepared(line.rawName)
      const nested = nestedOf(line.rawName)
      if (
        nested &&
        !(ingredient && isConvertible(unit, ingredient.unit, conversions(ingredient.id)))
      )
        continue
      const product = splitPrep(line.rawName).name
      const rowKey = ingredient ? ingredient.id : product.toLowerCase()
      const row = rows.get(rowKey) ?? {
        key: rowKey,
        name: ingredient?.name ?? product,
        ingredientId: ingredient?.id ?? null,
        unit: ingredient?.unit ?? newUnit.get(product.toLowerCase()) ?? stockUnitFor(unit),
        written: new Map<string, number>(),
      }
      row.written.set(unit, (row.written.get(unit) ?? 0) + 1)
      rows.set(rowKey, row)
    }
    const ingredients = [...rows.values()].flatMap((row) => {
      const rules = conversions(row.ingredientId ?? undefined)
      const units = [...row.written.entries()].map(([unit, count]) => ({
        unit,
        dimension: dimensionOf(unit),
        lines: count,
        reaches: isConvertible(unit, row.unit, rules),
      }))
      if (units.every((u) => u.reaches)) return []
      return [
        {
          key: row.key,
          name: row.name,
          ingredientId: row.ingredientId,
          unit: row.unit,
          unitDimension: dimensionOf(row.unit),
          choices: row.ingredientId ? [] : [...new Set(units.map((u) => stockUnitFor(u.unit)))],
          units,
        },
      ]
    })
    return { ingredients: ingredients.sort((a, b) => a.name.localeCompare(b.name)) }
  }

  async saveFileUnits(id: string, dto: FileUnitsDto) {
    const doc = await this.prisma.client.document.findUnique({ where: { id } })
    if (!doc)
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' })
    const { organizationId } = doc
    for (const added of dto.ingredients ?? []) {
      const unit = normalizeUnit(added.unit)
      if (!unit || dimensionOf(unit) === null)
        throw new BadRequestException({
          code: 'UNIT_NOT_A_UNIT',
          message: `${added.unit} is not a unit of measure; choose one from the list for ${added.name}`,
        })
    }
    const made = await serialized(
      this.prisma.client,
      (dto.ingredients ?? []).flatMap((added) =>
        nameLock('ingredient', organizationId, added.name),
      ),
      async (tx) => {
        const ids = new Map<string, string>()
        for (const added of dto.ingredients ?? []) {
          const name = added.name.trim()
          const taken = await tx.ingredient.findFirst({
            where: { organizationId, name: sameName(name) },
            select: { id: true },
          })
          const ingredient =
            taken ??
            (await tx.ingredient.create({
              data: { organizationId, name, unit: normalizeUnit(added.unit) },
              select: { id: true },
            }))
          if (!taken)
            await tx.ingredientAlias.updateMany({
              where: { organizationId, rawName: sameName(name), ingredientId: null },
              data: { ingredientId: ingredient.id },
            })
          ids.set(key(name), ingredient.id)
        }
        return ids
      },
    )
    let recorded = 0
    for (const rule of dto.conversions ?? []) {
      const ingredientId = rule.ingredientId ?? (rule.name ? made.get(key(rule.name)) : undefined)
      if (!ingredientId)
        throw new BadRequestException({
          code: 'INGREDIENT_REQUIRED',
          message: `Say which ingredient the conversion from ${rule.fromUnit} is for`,
        })
      const ingredient = await this.prisma.client.ingredient.findUnique({
        where: { id: ingredientId },
        select: { unit: true },
      })
      if (!ingredient)
        throw new NotFoundException({
          code: 'INGREDIENT_NOT_FOUND',
          message: 'Ingredient not found',
        })
      await this.units.create({
        ingredientId,
        fromUnit: rule.fromUnit,
        toUnit: ingredient.unit,
        factor: rule.factor,
      })
      recorded += 1
    }
    return { added: made.size, recorded }
  }

  async confirmMany(
    ids: string[],
    options: ConfirmOptions = {},
    edited?: { id: string; payload: unknown },
  ) {
    const docs = await this.prisma.client.document.findMany({
      where: { id: { in: ids } },
      include: { extractions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
    })
    const recipeOf = new Map<string, RecipePayload>()
    for (const d of docs) {
      const stated = d.id === edited?.id ? edited.payload : d.extractions[0]?.payload
      const read = storedPayload(stated)
      if (read?.kind === 'recipe') recipeOf.set(d.id, read)
    }
    const nameKey = (text: string | undefined) => key(text ?? '')
    const byName = new Map<string, RecipePayload>()
    for (const r of recipeOf.values()) if (nameKey(r.name)) byName.set(nameKey(r.name), r)
    const depth = new Map<string, number>()
    const depthOf = (name: string, path: Set<string> = new Set()): number => {
      const known = depth.get(name)
      if (known !== undefined) return known
      if (path.has(name)) return 0
      path.add(name)
      const below = (byName.get(name)?.items ?? [])
        .map((line) => nameKey(line.rawName))
        .filter((line) => line !== name && byName.has(line))
        .map((line) => depthOf(line, path) + 1)
      path.delete(name)
      const found = Math.max(0, ...below)
      depth.set(name, found)
      return found
    }
    const levelOf = (id: string) => depthOf(nameKey(recipeOf.get(id)?.name))
    const order = ids
      .map((id, at) => ({ id, at, level: levelOf(id) }))
      .sort((a, b) => a.level - b.level || a.at - b.at)

    const recipesInFile = new Set(byName.keys())
    const results: { id: string; status?: string; code?: string; error?: string }[] = new Array(
      ids.length,
    )
    for (const { id, at } of order) {
      try {
        const override = id === edited?.id ? (edited.payload as ExtractionPayload) : undefined
        const done = await this.confirm(id, override, { ...options, recipesInFile })
        results[at] = { id, status: done.status }
      } catch (e) {
        results[at] =
          e instanceof HttpException
            ? { id, ...failureOf(e) }
            : { id, code: 'INTERNAL_SERVER_ERROR', error: 'Could not be confirmed' }
        if (!(e instanceof HttpException))
          this.logger.error(`confirm ${id} failed: ${(e as Error).message}`)
      }
    }
    return { results }
  }

  private apply(
    doc: ApplyTarget,
    payload: ExtractionPayload,
    options: ConfirmOptions,
    seal: Seal,
  ): Promise<Record<string, number | string>> {
    switch (payload.kind) {
      case 'invoice':
        return this.applyInvoice(doc, payload, options, seal)
      case 'sales':
        return this.applySales(doc.organizationId, doc.locationId, payload, seal)
      case 'recipe':
        return this.applyRecipe(doc.organizationId, doc.locationId, payload, options, seal)
      case 'menu':
        return this.applyMenu(doc, payload, seal)
    }
  }

  private async assertPaperNew(
    db: Serial,
    organizationId: string,
    paper: { number?: string; vendorId: string | null; vendorName: string | null },
  ) {
    if (!paper.number) return
    const from = [
      ...(paper.vendorId ? [{ vendorId: paper.vendorId }] : []),
      ...(paper.vendorName ? [{ vendorName: sameName(paper.vendorName) }] : []),
    ]
    if (from.length === 0) return
    const seen = await db.invoice.findFirst({
      where: { organizationId, number: paper.number, OR: from },
      select: { id: true },
    })
    if (seen) {
      throw new ConflictException({
        code: 'INVOICE_ALREADY_RECORDED',
        message: `Invoice ${paper.number} from ${paper.vendorName ?? 'this vendor'} is already recorded`,
      })
    }
  }

  private async applyInvoice(
    doc: ApplyTarget,
    payload: InvoicePayload,
    options: ConfirmOptions,
    seal: Seal,
  ) {
    const { organizationId, fileKey } = doc
    const locationId = doc.locationId
    if (!locationId)
      throw new BadRequestException({
        code: 'LOCATION_REQUIRED',
        message: 'Confirming an invoice needs a location',
      })

    const stated = payload.vendorName?.trim()
    const vendor = stated
      ? await this.prisma.client.vendor.findFirst({
          where: { organizationId, name: sameName(stated) },
          select: { id: true },
        })
      : null

    const paper = {
      number: payload.number,
      vendorId: vendor?.id ?? null,
      vendorName: stated || null,
    }
    await this.assertPaperNew(this.prisma.client, organizationId, paper)

    const conversions = await conversionRules(this.prisma.client, organizationId)

    const prepared: {
      line: InvoicePayload['items'][number]
      ingredient: { id: string; unit: string; vendorId: string | null } | null
      received: number | null
      credit: boolean
      adds?: string
    }[] = []
    const adding = new Map<string, { name: string; unit: string }>()

    const book = await IngredientBook.read(
      this.prisma.client,
      organizationId,
      payload.items,
      vendor?.id ?? null,
    )
    const unknown: InvoicePayload['items'] = []
    for (const line of payload.items) {
      const credit = line.quantity < 0 || lineMoney(line) < 0
      const ingredient = book.find(line.rawName, line.sku)
      if (!ingredient) {
        if (!credit && options.createMissing && addable(line)) {
          const adds = key(line.rawName)
          if (!adding.has(adds))
            adding.set(adds, { name: line.rawName.trim(), unit: stockUnitFor(line.unit) })
          prepared.push({ line, ingredient: null, received: null, credit, adds })
          continue
        }
        if (!credit) unknown.push(line)
        prepared.push({ line, ingredient: null, received: null, credit })
        continue
      }
      if (credit) {
        prepared.push({ line, ingredient, received: null, credit })
        continue
      }
      const received = line.unit
        ? bridgedConversion(line.quantity, line.unit, ingredient.unit, conversions(ingredient.id))
        : line.quantity
      prepared.push({ line, ingredient, received, credit })
    }
    await new Parking(this.prisma.client, organizationId).ingredients(unknown, vendor?.id ?? null)

    const alone = (await soleLocation(this.prisma.client, organizationId)) !== null
    const zone = await zoneOf(this.prisma, organizationId)

    const moved = await serialized(
      this.prisma.client,
      [
        ...(paper.number ? [lockKey('invoice-number', organizationId, paper.number)] : []),
        ...[...adding.values()].flatMap((stock) =>
          nameLock('ingredient', organizationId, stock.name),
        ),
      ],
      async (tx) => {
        if (paper.number) await this.assertPaperNew(tx, organizationId, paper)
        for (const [adds, stock] of adding) {
          const taken = await tx.ingredient.findFirst({
            where: { organizationId, name: sameName(stock.name) },
            select: { name: true },
          })
          if (taken) {
            throw new ConflictException({
              code: 'INGREDIENT_JUST_ADDED',
              message: `${taken.name} was just added to the ingredients; confirm the invoice again to receive it`,
            })
          }
          const ingredient = await tx.ingredient.create({
            data: { organizationId, name: stock.name, unit: stock.unit },
            select: { id: true, unit: true, vendorId: true },
          })
          await tx.ingredientAlias.updateMany({
            where: { organizationId, rawName: sameName(stock.name), ingredientId: null },
            data: { ingredientId: ingredient.id },
          })
          for (const p of prepared)
            if (p.adds === adds) {
              p.ingredient = ingredient
              p.received = bridgedConversion(p.line.quantity, p.line.unit, ingredient.unit, [])
            }
        }
        await tx.invoice.create({
          data: {
            organizationId,
            locationId,
            vendorId: vendor?.id ?? null,
            vendorName: paper.vendorName,
            number: payload.number,
            invoiceDate: recordedAt(payload.invoiceDate, zone),
            status: 'confirmed',
            subtotal: invoiceTotal(payload.items),
            total: invoiceTotal(payload.items),
            documentKey: fileKey,
            items: {
              createMany: {
                data: prepared.map(({ line, ingredient }) => ({
                  ingredientId: ingredient?.id ?? null,
                  description: line.rawName,
                  quantity: line.quantity,
                  unit: line.unit,
                  unitPrice: line.unitPrice,
                  lineTotal: lineMoney(line),
                })),
              },
            },
          },
        })

        const delivery = new Delivery(
          organizationId,
          locationId,
          `Invoice ${payload.number ?? ''}`.trim(),
          vendor?.id ?? null,
          alone,
        )
        let unmapped = 0
        let unconverted = 0
        let credits = 0
        for (const { line, ingredient, received, credit } of prepared) {
          if (credit) credits += 1
          else if (!ingredient) unmapped += 1
          else if (received === null) unconverted += 1
          else {
            const cost = lineMoney(line)
            delivery.receive(
              ingredient,
              received,
              cost,
              deliveryPrice(cost, received, line.unitPrice),
            )
          }
        }
        await delivery.write(tx)
        await seal(tx, { unmapped, unconverted, credits })

        return {
          applied: delivery.count,
          unmapped,
          unconverted,
          credits,
          baseMoved: delivery.baseMoved,
          added: adding.size,
        }
      },
      { timeout: APPLY_TIMEOUT_MS },
    )

    if (moved.baseMoved) await this.costing.recalcOrganization(organizationId)

    return {
      applied: moved.applied,
      unmapped: moved.unmapped,
      unconverted: moved.unconverted,
      credits: moved.credits,
      added: moved.added,
      vendorUnmatched: stated && !vendor ? 1 : 0,
    }
  }

  private async applySales(
    organizationId: string,
    locationId: string | null,
    payload: SalesPayload,
    seal: Seal,
  ) {
    const zone = await zoneOf(this.prisma, organizationId)
    const date = recordedAt(payload.date, zone)
    const items: { menuItemId: string; quantity: number; unitPrice: number; unitCost: number }[] =
      []
    let unmapped = 0
    let credits = 0

    const dishes = await DishBook.read(
      this.prisma.client,
      organizationId,
      payload.items.map((line) => line.menuItemName),
      locationId,
    )
    const unparked: string[] = []
    for (const line of payload.items) {
      if (line.quantity < 0 || line.unitPrice < 0) {
        credits += 1
        continue
      }
      const menuItem = dishes.find(line.menuItemName)
      if (!menuItem) {
        unparked.push(line.menuItemName)
        unmapped += 1
        continue
      }
      items.push({
        menuItemId: menuItem.id,
        quantity: Math.round(line.quantity),
        unitPrice: money(line.unitPrice),
        unitCost: 0,
      })
    }
    await new Parking(this.prisma.client, organizationId).dishes(unparked, locationId)
    if (items.length === 0) return { applied: 0, unmapped, credits }

    const links = await this.prisma.client.menuItemRecipe.findMany({
      where: {
        menuItemId: { in: [...new Set(items.map((i) => i.menuItemId))] },
        menuItem: { organizationId },
      },
      select: {
        menuItemId: true,
        portions: true,
        recipe: { select: { totalCost: true, portions: true } },
      },
    })
    for (const item of items) {
      item.unitCost = dishCost(links.filter((l) => l.menuItemId === item.menuItemId))
    }

    await serialized(
      this.prisma.client,
      lockKey('sales-report', organizationId, locationId ?? '', dayKey(date, zone)),
      async (tx) => {
        await this.assertNotRecorded(tx, organizationId, locationId, date, zone, items)
        await tx.sale.create({
          data: {
            organizationId,
            locationId,
            date,
            items: { create: items },
          },
        })
        await seal(tx, { unmapped, credits })
      },
    )
    return { applied: items.length, unmapped, credits }
  }

  private async assertNotRecorded(
    db: Serial,
    organizationId: string,
    locationId: string | null,
    date: Date,
    zone: string,
    items: { menuItemId: string; quantity: number; unitPrice: number }[],
  ) {
    const day = dayKey(date, zone)
    const fingerprint = (lines: { menuItemId: string; quantity: number; unitPrice: number }[]) =>
      lines
        .map((l) => `${l.menuItemId}|${l.quantity}|${money(l.unitPrice)}`)
        .sort()
        .join(';')
    const recorded = await db.sale.findMany({
      where: {
        organizationId,
        locationId,
        date: { gte: startOfDay(day, zone), lte: endOfDay(day, zone) },
      },
      select: { items: { select: { menuItemId: true, quantity: true, unitPrice: true } } },
    })
    const wanted = fingerprint(items)
    const twin = recorded.some(
      (sale) =>
        fingerprint(sale.items.map((l) => ({ ...l, unitPrice: num(l.unitPrice) }))) === wanted,
    )
    if (twin) {
      throw new ConflictException({
        code: 'SALES_ALREADY_RECORDED',
        message: `These sales are already recorded for ${day} at this location; a sales report is confirmed once`,
      })
    }
  }

  private recipeDrafts(payload: RecipePayload) {
    const read = (recipe: SubRecipe, part: number | null) => {
      const sub = part !== null
      const name = recipe.name?.trim()
      const whose = (sentence: string) => (sub ? `${name}: ${sentence}` : sentence)
      if (!name)
        throw new BadRequestException({
          code: 'RECIPE_NAME_REQUIRED',
          message: sub
            ? 'Give every sub-recipe a name before confirming the recipe'
            : 'Give the recipe a name before confirming it',
          part,
          field: 'name',
        })
      if ((recipe.items ?? []).length === 0) {
        throw new BadRequestException({
          code: 'RECIPE_INGREDIENTS_REQUIRED',
          message: sub
            ? `${name} lists no ingredients; add at least one, or remove the sub-recipe`
            : 'The recipe lists no ingredients; add at least one before confirming it',
          part,
          field: 'items',
        })
      }
      const yieldAmount = recipe.yieldQty && recipe.yieldQty > 0 ? recipe.yieldQty : null
      const yieldUnit = yieldAmount === null ? null : recipe.yieldUnit?.trim() || null
      if (yieldAmount !== null && !yieldUnit) {
        throw new BadRequestException({
          code: 'YIELD_INCOMPLETE',
          message: whose('A yield needs both an amount and a unit, or neither'),
          part,
          field: 'yield',
        })
      }
      return {
        name,
        key: key(name),
        sub,
        part,
        portions: Math.max(1, Math.round(recipe.portions ?? 1)),
        yieldAmount,
        yieldUnit,
        items: recipe.items ?? [],
      }
    }
    const drafts = [read(payload, null), ...(payload.subRecipes ?? []).map((s, i) => read(s, i))]
    const seen = new Set<string>()
    for (const draft of drafts) {
      if (seen.has(draft.key))
        throw new BadRequestException({
          code: 'SUB_RECIPE_REPEATED',
          message: `${draft.name} is listed twice in this recipe; keep one`,
          part: draft.part,
          field: 'name',
        })
      seen.add(draft.key)
    }

    const uses = (draft: (typeof drafts)[number]) =>
      draft.items.map((line) => key(line.rawName)).filter((k) => k !== draft.key && seen.has(k))
    const byKey = new Map(drafts.map((d) => [d.key, d]))
    const ordered: typeof drafts = []
    const state = new Map<string, 'open' | 'done'>()
    const visit = (draft: (typeof drafts)[number], path: string[]) => {
      if (state.get(draft.key) === 'done') return
      if (state.get(draft.key) === 'open') {
        const loop = path.slice(path.indexOf(draft.key)).map((k) => byKey.get(k)!.name)
        throw new BadRequestException({
          code: 'RECIPE_CYCLE',
          message: `${loop.join(', ')} use one another; a recipe cannot contain itself`,
        })
      }
      state.set(draft.key, 'open')
      for (const k of uses(draft)) visit(byKey.get(k)!, [...path, draft.key])
      state.set(draft.key, 'done')
      ordered.push(draft)
    }
    for (const draft of [...drafts.slice(1), drafts[0]]) visit(draft, [])
    return ordered
  }

  private async planRecipe(
    organizationId: string,
    locationId: string | null,
    payload: RecipePayload,
    { createMissing = false, recipesInFile }: ConfirmOptions,
  ) {
    const drafts = this.recipeDrafts(payload)
    const own = drafts[drafts.length - 1]
    const siblings = new Map(drafts.map((d) => [d.key, d]))

    type Stock = { id: string; name: string; unit: string }
    type Measured = { name: string; yieldAmount: number | null; yieldUnit: string | null }
    type At = { part: number | null; line: number }
    type Line = { at: At; unmeasured: string | null } & (
      | { kind: 'ingredient'; line: RecipeLine; ingredient: Stock; prep: string | null }
      | { kind: 'recipe'; line: RecipeLine; recipeId: string; recipe: Measured }
      | { kind: 'sibling'; line: RecipeLine; key: string; recipe: Measured }
      | { kind: 'new'; line: RecipeLine; key: string; prep: string | null }
    )
    const unmapped: { at: At; rawName: string; line: RecipeLine }[] = []
    const notYetConfirmed: { at: At; rawName: string }[] = []
    const missing = new Map<string, { name: string; unit: string }>()

    const conversions = await conversionRules(this.prisma.client, organizationId)
    const everyLine = drafts.flatMap((d) => d.items)
    const noted = (prep: string | null, note: string | null) =>
      [prep, note].filter(Boolean).join(', ') || null
    const newUnit = newStockUnits(everyLine)
    const leftOut: { at: At; rawName: string; phrase: string }[] = []
    const book = await IngredientBook.read(this.prisma.client, organizationId, everyLine)
    const nestedOf = await this.nestedRecipes(
      organizationId,
      locationId,
      everyLine.map((line) => line.rawName),
      own.name,
    )
    const plans = drafts.map((draft) => {
      const lines: Line[] = []
      draft.items.forEach((written, index) => {
        const at = { part: draft.part, line: index }
        const measured = readMeasure(written)
        const line = measured.line
        const unmeasured = measured.unmeasured ? measured.note : null
        const spelled = key(line.rawName)
        const sibling = spelled !== draft.key ? siblings.get(spelled) : undefined
        if (sibling) {
          lines.push({ at, unmeasured, kind: 'sibling', line, key: sibling.key, recipe: sibling })
          return
        }
        const found = book.prepared(line.rawName)
        const ingredient = found.ingredient
        const prep = noted(found.prep, measured.note)
        const nested = spelled !== draft.key ? nestedOf(line.rawName) : null
        if (ingredient) {
          const counted =
            !line.unit.trim() && (unmeasured || dimensionOf(ingredient.unit) === 'count')
          const stated = counted ? { ...line, unit: ingredient.unit } : line
          if (!nested || isConvertible(stated.unit, ingredient.unit, conversions(ingredient.id))) {
            lines.push({ at, unmeasured, kind: 'ingredient', line: stated, ingredient, prep })
            return
          }
        }
        if (nested) {
          lines.push({
            at,
            unmeasured,
            kind: 'recipe',
            line,
            recipeId: nested.id,
            recipe: {
              name: nested.name,
              yieldAmount: numOrNull(nested.yieldAmount),
              yieldUnit: nested.yieldUnit,
            },
          })
          return
        }
        if (spelled !== draft.key && spelled !== own.key && recipesInFile?.has(spelled)) {
          notYetConfirmed.push({ at, rawName: line.rawName.trim() })
          return
        }
        if (createMissing) {
          const product = splitPrep(line.rawName)
          const stockKey = product.name.toLowerCase()
          const unit = newUnit.get(stockKey) ?? (unmeasured ? null : stockUnitFor(line.unit))
          if (unit === null) {
            leftOut.push({ at, rawName: line.rawName.trim(), phrase: unmeasured! })
            return
          }
          if (!missing.has(stockKey)) missing.set(stockKey, { name: product.name, unit })
          lines.push({
            at,
            unmeasured,
            kind: 'new',
            line,
            key: stockKey,
            prep: noted(product.prep, measured.note),
          })
          return
        }
        unmapped.push({ at, rawName: line.rawName, line })
      })
      return { draft, lines }
    })
    const allLines = plans.flatMap((p) => p.lines)

    const phrases = [
      ...allLines,
      ...unmapped.map((u) => ({ ...u, kind: 'unmapped' as const })),
    ].flatMap((p) => {
      if (p.kind === 'recipe' || p.kind === 'sibling') return []
      const written = p.line.unit.trim()
      if (!written || dimensionOf(written) !== null) return []
      const unit = normalizeUnit(written)
      const rules = conversions(p.kind === 'ingredient' ? p.ingredient.id : undefined)
      const named = rules.some(
        (r) => normalizeUnit(r.fromUnit) === unit || normalizeUnit(r.toUnit) === unit,
      )
      return named ? [] : [{ at: p.at, written, rawName: p.line.rawName.trim() }]
    })

    const unreached = (rules: RulesFor) => ({
      unconverted: allLines.flatMap((p) => {
        if (p.kind === 'ingredient') {
          return isConvertible(p.line.unit, p.ingredient.unit, rules(p.ingredient.id))
            ? []
            : [
                {
                  at: p.at,
                  line: p.line,
                  name: p.ingredient.name,
                  unit: p.ingredient.unit,
                  isNew: false,
                },
              ]
        }
        if (p.kind === 'new') {
          const stock = missing.get(p.key)!
          const unit = p.line.unit.trim() || stock.unit
          return isConvertible(unit, stock.unit, rules())
            ? []
            : [{ at: p.at, line: p.line, name: stock.name, unit: stock.unit, isNew: true }]
        }
        return []
      }),
      unmeasured: allLines.flatMap((p) => {
        if (p.kind !== 'recipe' && p.kind !== 'sibling') return []
        const problem = componentMeasure(p.recipe, p.line.unit.trim() || 'portion', rules())
        return problem ? [{ at: p.at, message: problem }] : []
      }),
    })

    return {
      drafts,
      plans,
      allLines,
      missing,
      conversions,
      notYetConfirmed,
      unmapped,
      phrases,
      leftOut,
      unreached,
    }
  }

  private async applyRecipe(
    organizationId: string,
    locationId: string | null,
    payload: RecipePayload,
    options: ConfirmOptions,
    seal: Seal,
  ) {
    const plan = await this.planRecipe(organizationId, locationId, payload, options)
    const { drafts, plans, allLines, missing, conversions, notYetConfirmed, unmapped, phrases } =
      plan
    type Stock = { id: string; name: string; unit: string }
    await new Parking(this.prisma.client, organizationId).ingredients(
      [...new Set(unmapped.map((u) => u.rawName))].map((rawName) => ({ rawName })),
      null,
    )

    if (notYetConfirmed.length > 0) {
      const names = notYetConfirmed.map((n) => n.rawName)
      const one = names.length === 1
      throw new BadRequestException({
        code: 'RECIPE_COMPONENTS_UNCONFIRMED',
        message: `${names.join(', ')} ${one ? 'is a recipe' : 'are recipes'} of this file that ${one ? 'was' : 'were'} not confirmed; confirm ${one ? 'it' : 'them'} first`,
      })
    }
    if (unmapped.length > 0) {
      throw new BadRequestException({
        code: 'INGREDIENT_UNMAPPED',
        message: `Map ${[...new Set(unmapped.map((u) => u.rawName))].join(', ')} to an ingredient before confirming this recipe`,
      })
    }
    if (phrases.length > 0) {
      const named = phrases.map((p) => `"${p.written}" for ${p.rawName}`)
      throw new BadRequestException({
        code: 'UNIT_NOT_A_UNIT',
        message: `${named.join(', ')} ${named.length === 1 ? 'is' : 'are'} not a unit of measure; choose a unit for ${named.length === 1 ? 'that line' : 'those lines'}, or remove ${named.length === 1 ? 'it' : 'them'}`,
      })
    }

    const refuseUnreached = (rules: RulesFor) => {
      const { unconverted, unmeasured } = plan.unreached(rules)
      if (unconverted.length > 0) {
        const named = unconverted
          .map((p) =>
            p.line.unit.trim()
              ? `${p.name} in ${p.line.unit} rather than ${p.unit}`
              : `${p.name} has no unit (it is counted in ${p.unit})`,
          )
          .join('; ')
        throw new BadRequestException({
          code: 'UNIT_NOT_CONVERTIBLE',
          message: `${named}. Record a unit conversion first, or state the quantity in a unit of the same kind.`,
        })
      }
      if (unmeasured.length > 0)
        throw new BadRequestException({
          code: 'COMPONENT_UNIT_INVALID',
          message: unmeasured.map((u) => u.message).join('; '),
        })
    }
    refuseUnreached(conversions)

    const locks = [
      ...drafts.flatMap((d) => nameLock('recipe', organizationId, d.name)),
      ...[...missing.values()].flatMap((stock) =>
        nameLock('ingredient', organizationId, stock.name),
      ),
      ...(allLines.some((p) => p.kind === 'recipe' || p.kind === 'sibling')
        ? [recipeGraphLock(organizationId)]
        : []),
      unitRulesLock(organizationId),
    ]
    const recipe = await serialized(
      this.prisma.client,
      locks,
      async (tx) => {
        refuseUnreached(await conversionRules(tx, organizationId))
        for (const { name } of drafts) {
          const clash = await tx.recipe.findFirst({
            where: { organizationId, name: sameName(name), ...sameKitchen(locationId) },
            select: { location: { select: { name: true } } },
          })
          if (clash) refuseTakenInKitchen('a recipe', name, clash.location)
        }

        const added = new Map<string, Stock>()
        for (const [key, stock] of missing) {
          const taken = await tx.ingredient.findFirst({
            where: { organizationId, name: sameName(stock.name) },
            select: { name: true },
          })
          if (taken) {
            throw new ConflictException({
              code: 'INGREDIENT_JUST_ADDED',
              message: `${taken.name} was just added to the ingredients; confirm the recipe again to use it`,
            })
          }
          const ingredient = await tx.ingredient.create({
            data: { organizationId, name: stock.name, unit: stock.unit },
            select: { id: true, name: true, unit: true },
          })
          await tx.ingredientAlias.updateMany({
            where: { organizationId, rawName: sameName(stock.name), ingredientId: null },
            data: { ingredientId: ingredient.id },
          })
          added.set(key, ingredient)
        }
        await seal(tx, {})

        const made = new Map<string, string>()
        let last: { id: string } | null = null
        for (const { draft, lines } of plans) {
          const components = lines.flatMap((p) =>
            p.kind === 'recipe'
              ? [{ componentId: p.recipeId, line: p.line }]
              : p.kind === 'sibling'
                ? [{ componentId: made.get(p.key)!, line: p.line }]
                : [],
          )
          for (const { componentId } of components)
            await this.costing.assertEdgeAllowed(organizationId, NEW_RECIPE, componentId, tx)
          const stocked = lines.flatMap((p) =>
            p.kind === 'ingredient'
              ? [{ ingredientId: p.ingredient.id, line: p.line, unit: p.line.unit, prep: p.prep }]
              : p.kind === 'new'
                ? [
                    {
                      ingredientId: added.get(p.key)!.id,
                      line: p.line,
                      unit: p.line.unit.trim() || added.get(p.key)!.unit,
                      prep: p.prep,
                    },
                  ]
                : [],
          )
          last = await tx.recipe.create({
            data: {
              organizationId,
              locationId,
              name: draft.name,
              status: 'published',
              portions: draft.portions,
              yieldAmount: draft.yieldAmount,
              yieldUnit: draft.yieldUnit,
              ingredients: {
                create: stocked.map(({ ingredientId, line, unit, prep }, order) => ({
                  ingredientId,
                  quantity: Math.abs(line.quantity),
                  unit,
                  prepNote: prep,
                  order,
                })),
              },
              components: {
                create: components.map(({ componentId, line }, order) => ({
                  componentId,
                  quantity: Math.abs(line.quantity),
                  unit: line.unit.trim() || 'portion',
                  order,
                })),
              },
            },
            select: { id: true },
          })
          made.set(draft.key, last.id)
        }
        return last!
      },
      { timeout: APPLY_TIMEOUT_MS },
    )
    await this.costing.recalcOrganization(organizationId)
    const applied = plans[plans.length - 1].lines.length
    return { created: recipe.id, applied, added: missing.size, subRecipes: drafts.length - 1 }
  }

  private async applyMenu(doc: ApplyTarget, payload: MenuPayload, seal: Seal) {
    const { organizationId, locationId } = doc
    if (payload.items.length === 0) {
      throw new BadRequestException({
        code: 'MENU_DISHES_REQUIRED',
        message: 'The menu lists no dishes; add at least one before confirming it',
      })
    }
    const blank = payload.items.findIndex((item) => !item.name?.trim())
    if (blank !== -1) {
      throw new BadRequestException({
        code: 'DISH_NAME_REQUIRED',
        message: `Give every dish a name before confirming the menu: dish ${blank + 1} has none`,
      })
    }
    const menuName = payload.name?.trim() || menuNameFrom(doc.fileName)
    const seen = new Set<string>()
    const dishes = payload.items.filter((item) => {
      if (seen.has(key(item.name))) return false
      seen.add(key(item.name))
      return true
    })
    const sectionNames = dishes.flatMap((d) => (d.section?.trim() ? [d.section] : []))
    const locks = [
      menuShapeLock(organizationId),
      ...nameLock('menu', organizationId, menuName),
      ...dishes.flatMap((d) => nameLock('menu-item', organizationId, d.name)),
      ...sectionNames.flatMap((section) => nameLock('category:menu', organizationId, section)),
    ]

    return serialized(
      this.prisma.client,
      locks,
      async (tx) => {
        const named = await tx.menu.findFirst({
          where: { organizationId, name: sameName(menuName) },
          select: {
            id: true,
            items: { select: { menuItemId: true, sortOrder: true } },
            locations: { select: { locationId: true } },
          },
        })
        if (
          named &&
          named.locations.length > 0 &&
          !named.locations.some((l) => worksAt(l.locationId))
        ) {
          throw new ConflictException({
            code: 'MENU_NAME_TAKEN',
            message: `A menu named ${menuName} is served only at locations you do not work at; give this menu another name before confirming it`,
          })
        }
        if (named && named.locations.length === 0 && !changesHere(null)) {
          throw new ConflictException({
            code: 'MENU_NAME_TAKEN',
            message: `A menu named ${menuName} is assigned to no location and is changed only by someone who works at every location; give this menu another name before confirming it`,
          })
        }
        const menu =
          named ??
          (await tx.menu.create({
            data: { organizationId, name: menuName },
            select: { id: true, items: { select: { menuItemId: true, sortOrder: true } } },
          }))
        const onMenu = new Set(menu.items.map((i) => i.menuItemId))
        let order = menu.items.reduce((max, i) => Math.max(max, i.sortOrder + 1), 0)

        const dishIds = new Map<string, string>()
        for (const m of await tx.menuItem.findMany({
          where: {
            organizationId,
            name: anyOf(dishes.map((d) => d.name)),
            ...sameKitchen(locationId),
          },
          select: { id: true, name: true, locationId: true },
        })) {
          if (!dishIds.has(key(m.name)) || m.locationId === locationId)
            dishIds.set(key(m.name), m.id)
        }
        const fresh = dishes.filter((d) => !dishIds.has(key(d.name)))
        const stated = [
          ...new Set(fresh.flatMap((d) => (d.section?.trim() ? [d.section.trim()] : []))),
        ]
        const sections = new Map(
          (stated.length
            ? await tx.category.findMany({
                where: { organizationId, kind: 'menu', name: anyOf(stated) },
                select: { id: true, name: true },
              })
            : []
          ).map((c) => [key(c.name), c.id]),
        )
        const unfiled = stated.filter((name) => !sections.has(key(name)))
        if (unfiled.length > 0) {
          const filed = await tx.category.createManyAndReturn({
            data: unfiled.map((name) => ({ organizationId, kind: 'menu' as const, name })),
            select: { id: true, name: true },
          })
          for (const c of filed) sections.set(key(c.name), c.id)
        }

        if (fresh.length > 0) {
          const made = await tx.menuItem.createManyAndReturn({
            data: fresh.map((d) => ({
              organizationId,
              locationId,
              name: d.name.trim(),
              price: money(d.price),
              categoryId: d.section?.trim() ? (sections.get(key(d.section)) ?? null) : null,
            })),
            select: { id: true, name: true },
          })
          for (const m of made) dishIds.set(key(m.name), m.id)
        }

        const added: { menuItemId: string; sortOrder: number }[] = []
        for (const dish of dishes) {
          const id = dishIds.get(key(dish.name))!
          if (!onMenu.has(id)) {
            onMenu.add(id)
            added.push({ menuItemId: id, sortOrder: order++ })
          }
        }
        const created = fresh.length
        const existing = dishes.length - fresh.length

        const everywhere = named !== null && named.locations.length === 0
        const served =
          locationId && !everywhere
            ? await tx.menuOnLocation.findFirst({
                where: { menuId: menu.id, locationId },
                select: { id: true },
              })
            : null
        await tx.menu.update({
          where: { id: menu.id },
          data: {
            items: { create: added },
            ...(locationId && !everywhere && !served
              ? { locations: { create: [{ locationId }] } }
              : {}),
          },
        })
        await seal(tx, {})
        return { menu: menu.id, created, existing }
      },
      { timeout: APPLY_TIMEOUT_MS },
    )
  }

  /* ===== Ingredient mapping (manual corrections) ===== */

  async aliases() {
    const { organizationId } = requireTenant()
    const rows = await this.prisma.client.ingredientAlias.findMany({
      orderBy: [{ ingredientId: { sort: 'asc', nulls: 'first' } }, { rawName: 'asc' }],
      include: { ingredient: { select: { id: true, name: true } } },
    })
    const waiting = await this.prisma.client.invoiceItem.groupBy({
      by: ['description'],
      where: { ingredientId: null, invoice: { organizationId } },
      _count: { _all: true },
    })
    const lines = new Map(waiting.map((w) => [w.description.trim().toLowerCase(), w._count._all]))
    return rows.map((a) => ({
      id: a.id,
      rawName: a.rawName,
      ingredientId: a.ingredientId,
      ingredientName: a.ingredient?.name ?? null,
      lines: lines.get(a.rawName.trim().toLowerCase()) ?? 0,
    }))
  }

  async createAlias(rawName: string, ingredientId?: string | null) {
    const { organizationId } = requireTenant()
    const name = (rawName ?? '').trim()
    if (!name)
      throw new BadRequestException({ code: 'NAME_REQUIRED', message: 'A name is required' })
    await assertReferencesOwned(this.prisma.client, { ingredientId })
    const named = await this.prisma.client.ingredient.findFirst({
      where: { name: sameName(name) },
      select: { name: true },
    })
    if (named) {
      throw new ConflictException({
        code: 'NAME_IS_INGREDIENT',
        message: `${named.name} is already the name of an ingredient, and a document naming it reads as that ingredient`,
      })
    }
    const alias = await serialized(
      this.prisma.client,
      ingredientAliasLock(organizationId, name),
      async (tx) => {
        const taken = await tx.ingredientAlias.findFirst({
          where: { rawName: sameName(name) },
        })
        if (taken)
          throw new ConflictException({
            code: 'ALIAS_TAKEN',
            message: 'That name is already on the list',
          })
        return tx.ingredientAlias.create({
          data: { organizationId, rawName: name, ingredientId: ingredientId || null },
        })
      },
    )
    return { id: alias.id, rawName: alias.rawName, ingredientId: alias.ingredientId }
  }

  async mapAlias(id: string, ingredientId: string | null) {
    const target = ingredientId || null
    await assertReferencesOwned(this.prisma.client, { ingredientId: target })
    const alias = await this.prisma.client.ingredientAlias.findUnique({ where: { id } })
    if (!alias) throw new NotFoundException({ code: 'ALIAS_NOT_FOUND', message: 'Alias not found' })
    await this.prisma.client.ingredientAlias.update({
      where: { id },
      data: { ingredientId: target },
    })
    return { id, ingredientId: target }
  }

  async menuAliases() {
    const reached = reachedLocations()
    const rows = await this.prisma.client.menuItemAlias.findMany({
      where: reached ? { OR: [{ locationId: { in: reached } }, { locationId: null }] } : {},
      orderBy: [{ menuItemId: { sort: 'asc', nulls: 'first' } }, { rawName: 'asc' }, { id: 'asc' }],
      include: {
        menuItem: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
    })
    return rows.map((a) => ({
      id: a.id,
      rawName: a.rawName,
      menuItemId: a.menuItemId,
      menuItemName: a.menuItem?.name ?? null,
      locationId: a.locationId,
      locationName: a.location?.name ?? null,
    }))
  }

  async createMenuAlias(rawName: string, menuItemId?: string | null) {
    const { organizationId, locationId } = requireTenant()
    const name = (rawName ?? '').trim()
    if (!name)
      throw new BadRequestException({ code: 'NAME_REQUIRED', message: 'A name is required' })
    assertChangesHere(locationId, 'A sales name')
    await assertReferencesOwned(this.prisma.client, { menuItemId })
    const dish = await this.prisma.client.menuItem.findFirst({
      where: { name: sameName(name), locationId },
      select: { name: true },
    })
    if (dish) {
      throw new ConflictException({
        code: 'NAME_IS_DISH',
        message: `${dish.name} is already the name of a dish ${locationId ? 'here' : 'served everywhere'}, and a sales file naming it reads as that dish`,
      })
    }
    const alias = await serialized(
      this.prisma.client,
      [
        salesAliasLock(organizationId, name),
        ...(menuItemId ? [dishPlaceLock(organizationId, menuItemId)] : []),
      ],
      async (tx) => {
        await this.assertSoldWhereParked(locationId, menuItemId || null, tx)
        await this.assertMenuNameFree(organizationId, locationId, name, tx)
        return tx.menuItemAlias.create({
          data: { organizationId, locationId, rawName: name, menuItemId: menuItemId || null },
        })
      },
    )
    return {
      id: alias.id,
      rawName: alias.rawName,
      menuItemId: alias.menuItemId,
      locationId: alias.locationId,
    }
  }

  private async assertMenuNameFree(
    organizationId: string,
    locationId: string | null,
    name: string,
    db: Pick<Serial, 'menuItemAlias'>,
  ) {
    const taken = await db.menuItemAlias.findFirst({
      where: {
        organizationId,
        rawName: sameName(name),
        ...sameKitchen(locationId),
      },
      include: { location: { select: { name: true } } },
    })
    if (!taken) return
    throw new ConflictException({
      code: 'ALIAS_TAKEN',
      message: taken.location
        ? `${name} is already on the list at ${taken.location.name}`
        : `${name} is already on the list for every location`,
    })
  }

  async mapMenuAlias(id: string, menuItemId: string | null) {
    const target = menuItemId || null
    await assertReferencesOwned(this.prisma.client, { menuItemId: target })
    const alias = await this.prisma.client.menuItemAlias.findUnique({ where: { id } })
    if (!alias || !worksAt(alias.locationId))
      throw new NotFoundException({ code: 'ALIAS_NOT_FOUND', message: 'Alias not found' })
    assertChangesHere(alias.locationId, 'A sales name')
    await serialized(
      this.prisma.client,
      target ? [dishPlaceLock(requireTenant().organizationId, target)] : [],
      async (tx) => {
        await this.assertSoldWhereParked(alias.locationId, target, tx)
        await tx.menuItemAlias.update({ where: { id }, data: { menuItemId: target } })
      },
    )
    return { id, menuItemId: target }
  }

  private async assertSoldWhereParked(
    locationId: string | null,
    menuItemId: string | null,
    db: Pick<Serial, 'menuItem'>,
  ) {
    if (!menuItemId) return
    const dish = await db.menuItem.findUnique({
      where: { id: menuItemId },
      select: { name: true, locationId: true, location: { select: { name: true } } },
    })
    if (!dish || dish.locationId === null || dish.locationId === locationId) return
    throw new BadRequestException({
      code: 'DISH_NOT_SERVED_HERE',
      message: `${dish.name} is sold only at ${dish.location?.name ?? 'one location'}; a name parked ${locationId ? 'at another location' : 'for every location'} cannot read as it`,
    })
  }

  async removeMenuAlias(id: string) {
    const alias = await this.prisma.client.menuItemAlias.findUnique({ where: { id } })
    if (!alias || !worksAt(alias.locationId))
      throw new NotFoundException({ code: 'ALIAS_NOT_FOUND', message: 'Alias not found' })
    assertChangesHere(alias.locationId, 'A sales name')
    await this.prisma.client.menuItemAlias.delete({ where: { id } })
    return { id, deleted: true }
  }

  async removeAlias(id: string) {
    const alias = await this.prisma.client.ingredientAlias.findUnique({ where: { id } })
    if (!alias) throw new NotFoundException({ code: 'ALIAS_NOT_FOUND', message: 'Alias not found' })
    await this.prisma.client.ingredientAlias.delete({ where: { id } })
    return { id, deleted: true }
  }
}
