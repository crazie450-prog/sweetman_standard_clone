import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { Prisma } from '../../generated/prisma/client'
import { notFoundOr } from '../../common/utils/missing'
import { money } from '../../common/utils/decimal'
import { dayKey, lastDays, monthKey, startOfDay } from '../../common/utils/calendar'
import { zoneHere } from '../../tenancy/organization-zone'
import { acrossLocations, requireTenant } from '../../tenancy/tenant-context'
import { nameLock, named, refuseTaken } from '../../rules/names'
import { serialized, type Serial } from '../../common/utils/serialize'
import { CreateVendorDto, UpdateVendorDto } from './dto/vendors.dto'

const VENDOR_INCLUDE = {
  _count: { select: { ingredients: true, products: true } },
} satisfies Prisma.VendorInclude

function toContract(
  v: {
    id: string
    name: string
    contact: string | null
    phone: string | null
    notes: string | null
    status: string
    _count: { ingredients: number; products: number }
  },
  spend30: number,
  lastInvoice: Date | null,
  zone: string,
) {
  return {
    id: v.id,
    name: v.name,
    contact: v.contact ?? '',
    phone: v.phone ?? '',
    notes: v.notes ?? '',
    products: v._count.products,
    ingredients: v._count.ingredients,
    lastInvoice: lastInvoice ? dayKey(lastInvoice, zone) : null,
    spend30,
    status: v.status,
  }
}

// ------------------------------------------------------------------ Service
@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.presented(
      await this.prisma.client.vendor.findMany({
        orderBy: { name: 'asc' },
        include: VENDOR_INCLUDE,
      }),
    )
  }

  private async readOne(id: string) {
    const vendor = await this.prisma.client.vendor.findUniqueOrThrow({
      where: { id },
      include: VENDOR_INCLUDE,
    })
    return (await this.presented([vendor]))[0]
  }

  private async presented(vendors: Prisma.VendorGetPayload<{ include: typeof VENDOR_INCLUDE }>[]) {
    const zone = await zoneHere(this.prisma)
    const since = lastDays(30, zone)
    const vendorId = { in: vendors.map((v) => v.id) }
    const [received, spend] = await Promise.all([
      this.prisma.client.invoice.groupBy({
        by: ['vendorId'],
        where: { vendorId },
        _max: { invoiceDate: true },
      }),
      this.prisma.client.invoice.groupBy({
        by: ['vendorId'],
        where: { vendorId, status: 'confirmed', invoiceDate: { gte: since } },
        _sum: { total: true },
      }),
    ])
    const lastByVendor = new Map(received.map((row) => [row.vendorId, row._max.invoiceDate]))
    const byVendor = new Map(spend.map((row) => [row.vendorId, Number(row._sum.total ?? 0)]))
    return vendors.map((v) =>
      toContract(v, byVendor.get(v.id) ?? 0, lastByVendor.get(v.id) ?? null, zone),
    )
  }

  async spend() {
    const months = 6
    const zone = await zoneHere(this.prisma)
    const [year, month] = monthKey(new Date(), zone).split('-').map(Number)
    const monthsBack = (i: number) =>
      new Date(Date.UTC(year, month - 1 - (months - 1) + i, 1)).toISOString().slice(0, 7)
    const first = startOfDay(`${monthsBack(0)}-01`, zone)
    const invoices = await this.prisma.client.invoice.findMany({
      where: { status: 'confirmed', invoiceDate: { gte: first } },
      select: { invoiceDate: true, total: true },
    })

    const buckets = new Map<string, number>()
    for (let i = 0; i < months; i++) {
      buckets.set(monthsBack(i), 0)
    }
    for (const invoice of invoices) {
      const key = monthKey(invoice.invoiceDate, zone)
      const running = buckets.get(key)
      if (running !== undefined) buckets.set(key, running + Number(invoice.total))
    }
    return [...buckets].map(([period, total]) => ({ period, total: money(total) }))
  }

  private async assertNameFree(
    name: string | undefined,
    except: string | undefined,
    db: Pick<Serial, 'vendor'>,
  ) {
    if (name === undefined) return
    const taken = await db.vendor.findFirst({ where: named(name, except), select: { name: true } })
    if (taken) refuseTaken('vendor', taken.name)
  }

  async create(dto: CreateVendorDto) {
    const ctx = requireTenant()
    const created = await serialized(
      this.prisma.client,
      nameLock('vendor', ctx.organizationId, dto.name),
      async (tx) => {
        await this.assertNameFree(dto.name, undefined, tx)
        return tx.vendor.create({
          data: { ...dto, organizationId: ctx.organizationId },
          select: { id: true },
        })
      },
    )
    return this.readOne(created.id)
  }

  async update(id: string, dto: UpdateVendorDto) {
    await serialized(
      this.prisma.client,
      nameLock('vendor', requireTenant().organizationId, dto.name),
      async (tx) => {
        await this.assertNameFree(dto.name, id, tx)
        try {
          await tx.vendor.update({ where: { id }, data: dto, select: { id: true } })
        } catch (e) {
          throw notFoundOr(e, 'Vendor not found')
        }
      },
    )
    return this.readOne(id)
  }

  async remove(id: string) {
    const vendor = await this.prisma.client.vendor.findUnique({
      where: { id },
      select: { name: true },
    })
    const invoices = vendor
      ? await acrossLocations(() => this.prisma.client.invoice.count({ where: { vendorId: id } }))
      : 0
    if (vendor && invoices > 0) {
      throw new BadRequestException({
        code: 'VENDOR_IN_USE',
        message: `${vendor.name} is named on ${invoices} ${invoices === 1 ? 'invoice' : 'invoices'}, which keep the record of what was received; mark the vendor inactive instead`,
      })
    }
    try {
      await this.prisma.client.vendor.delete({ where: { id } })
    } catch (e) {
      throw notFoundOr(e, 'Vendor not found')
    }
    return { ok: true }
  }
}
