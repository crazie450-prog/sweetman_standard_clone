import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { requireLocation, requireTenant } from '../../tenancy/tenant-context'
import { assertReferencesOwned } from '../../tenancy/references'
import { money, num } from '../../common/utils/decimal'
import type { Prisma } from '../../generated/prisma/client'
import { dayKey, recordedAt, statedInstant, UTC } from '../../common/utils/calendar'
import { zoneHere } from '../../tenancy/organization-zone'
import {
  InvoiceItemInput,
  CreateInvoiceDto,
  UpdateInvoiceDto,
  InvoicesQuery,
} from './dto/invoices.dto'
import { pageOf, pageWindow } from '../../common/dto/pagination.dto'

type InvoiceRow = Prisma.InvoiceGetPayload<{
  include: {
    vendor: { select: { name: true } }
    items: { include: { ingredient: { select: { name: true } } } }
  }
}>

function toContract(i: InvoiceRow, zone = UTC) {
  return {
    id: i.id,
    number: i.number ?? '',
    vendorId: i.vendorId,
    vendor: i.vendor?.name ?? i.vendorName ?? '',
    locationId: i.locationId,
    invoiceDate: dayKey(i.invoiceDate, zone),
    dueDate: i.dueDate ? dayKey(i.dueDate, zone) : null,
    status: i.status,
    subtotal: num(i.subtotal),
    tax: num(i.tax),
    total: num(i.total),
    documentKey: i.documentKey,
    notes: i.notes ?? '',
    items: i.items.map((line) => ({
      id: line.id,
      ingredientId: line.ingredientId,
      ingredient: line.ingredient?.name ?? '',
      description: line.description,
      quantity: num(line.quantity),
      unit: line.unit,
      unitPrice: num(line.unitPrice),
      lineTotal: num(line.lineTotal),
    })),
  }
}

const INVOICE_INCLUDE = {
  vendor: { select: { name: true } },
  items: { include: { ingredient: { select: { name: true } } } },
} as const

const APPLIED_BY_DOCUMENT = ['confirmed', 'partially_processed'] as const

const lineTotals = (items: InvoiceItemInput[]) =>
  items.map((line) => ({ ...line, lineTotal: money(line.quantity * line.unitPrice) }))

// ------------------------------------------------------------------ Service
@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: InvoicesQuery) {
    const where = query.vendorId ? { vendorId: query.vendorId } : {}
    const [rows, total, zone] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where,
        orderBy: [{ invoiceDate: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
        include: INVOICE_INCLUDE,
      }),
      this.prisma.client.invoice.count({ where }),
      zoneHere(this.prisma),
    ])
    return pageOf(
      rows.map((row) => toContract(row, zone)),
      total,
      query,
    )
  }

  async get(id: string) {
    const row = await this.prisma.client.invoice.findUnique({
      where: { id },
      include: INVOICE_INCLUDE,
    })
    if (!row)
      throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found' })
    return toContract(row, await zoneHere(this.prisma))
  }

  async create(dto: CreateInvoiceDto) {
    const ctx = requireTenant()
    const locationId = requireLocation()
    await assertReferencesOwned(this.prisma.client, {
      vendorId: dto.vendorId,
      ingredientId: dto.items.map((line) => line.ingredientId).filter(Boolean) as string[],
    })
    const lines = lineTotals(dto.items)
    const subtotal = money(lines.reduce((sum, line) => sum + line.lineTotal, 0))
    const tax = dto.tax ?? 0
    const zone = await zoneHere(this.prisma)
    const vendorName = await this.vendorName(dto.vendorId)

    const created = await this.prisma.client.invoice.create({
      data: {
        organizationId: ctx.organizationId,
        locationId,
        vendorId: dto.vendorId,
        vendorName,
        number: dto.number,
        invoiceDate: recordedAt(dto.invoiceDate, zone),
        dueDate: dto.dueDate ? statedInstant(dto.dueDate, zone) : null,
        status: dto.status ?? 'draft',
        subtotal,
        tax,
        total: money(subtotal + tax),
        documentKey: dto.documentKey,
        notes: dto.notes,
        items: { create: lines },
      },
      include: INVOICE_INCLUDE,
    })
    return toContract(created, zone)
  }

  private async vendorName(vendorId: string | null | undefined) {
    if (!vendorId) return null
    const vendor = await this.prisma.client.vendor.findUnique({
      where: { id: vendorId },
      select: { name: true },
    })
    return vendor?.name ?? null
  }

  private async leftByDocument(documentKey: string | null) {
    if (!documentKey) return false
    const applied = await this.prisma.client.document.findFirst({
      where: { fileKey: documentKey, status: { in: [...APPLIED_BY_DOCUMENT] } },
      select: { id: true },
    })
    return applied !== null
  }

  private async assertNotApplied(documentKey: string | null, verb: string) {
    if (await this.leftByDocument(documentKey)) {
      throw new ConflictException({
        code: 'INVOICE_FROM_DOCUMENT',
        message: `A confirmed document left this invoice as the record of what it moved, so it cannot be ${verb}`,
      })
    }
  }

  async update(id: string, dto: UpdateInvoiceDto) {
    const current = await this.prisma.client.invoice.findUnique({ where: { id } })
    if (!current)
      throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found' })
    await this.assertNotApplied(current.documentKey, 'changed')
    await assertReferencesOwned(this.prisma.client, {
      vendorId: dto.vendorId,
      ingredientId: (dto.items ?? []).map((line) => line.ingredientId).filter(Boolean) as string[],
    })

    const lines = dto.items ? lineTotals(dto.items) : null
    const subtotal = lines
      ? money(lines.reduce((sum, line) => sum + line.lineTotal, 0))
      : num(current.subtotal)
    const tax = dto.tax ?? num(current.tax)
    const zone = await zoneHere(this.prisma)

    const updated = await this.prisma.client.invoice.update({
      where: { id },
      data: {
        ...(dto.vendorId === undefined
          ? {}
          : { vendorId: dto.vendorId, vendorName: await this.vendorName(dto.vendorId) }),
        ...(dto.number === undefined ? {} : { number: dto.number }),
        ...(dto.invoiceDate === undefined
          ? {}
          : { invoiceDate: recordedAt(dto.invoiceDate, zone) }),
        ...(dto.dueDate === undefined ? {} : { dueDate: statedInstant(dto.dueDate, zone) }),
        ...(dto.status === undefined ? {} : { status: dto.status }),
        ...(dto.documentKey === undefined ? {} : { documentKey: dto.documentKey }),
        ...(dto.notes === undefined ? {} : { notes: dto.notes }),
        subtotal,
        tax,
        total: money(subtotal + tax),
        ...(lines ? { items: { deleteMany: {}, create: lines } } : {}),
      },
      include: INVOICE_INCLUDE,
    })
    return toContract(updated, zone)
  }

  async remove(id: string) {
    const current = await this.prisma.client.invoice.findUnique({ where: { id } })
    if (!current)
      throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found' })
    await this.assertNotApplied(current.documentKey, 'deleted')
    await this.prisma.client.invoice.delete({ where: { id } })
    return { ok: true }
  }
}
