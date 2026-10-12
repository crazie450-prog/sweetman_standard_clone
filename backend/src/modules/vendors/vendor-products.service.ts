import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { dayKey } from '../../common/utils/calendar'
import { zoneHere } from '../../tenancy/organization-zone'
import { PrismaService } from '../../prisma/prisma.service'
import { notFoundOr } from '../../common/utils/missing'
import { serialized, type Serial } from '../../common/utils/serialize'
import { requireTenant } from '../../tenancy/tenant-context'
import { assertReferencesOwned } from '../../tenancy/references'
import { num } from '../../common/utils/decimal'
import { catalogueLock, sameName, besides, sameKitchen, named } from '../../rules/names'
import { CreateVendorProductDto, UpdateVendorProductDto } from './dto/vendor-products.dto'

const PRODUCT_INCLUDE = {
  vendor: { select: { id: true, name: true } },
  ingredient: { select: { id: true, name: true, unit: true } },
} as const

type ProductRow = {
  id: string
  name: string
  sku: string | null
  isActive: boolean
  vendor: { id: string; name: string }
  ingredient: { id: string; name: string; unit: string } | null
}

function toContract(row: ProductRow, lastPrice: number | null, lastReceived: string | null) {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku ?? '',
    isActive: row.isActive,
    vendorId: row.vendor.id,
    vendorName: row.vendor.name,
    ingredientId: row.ingredient?.id ?? null,
    ingredientName: row.ingredient?.name ?? null,
    ingredientUnit: row.ingredient?.unit ?? null,
    lastPrice,
    lastReceived,
  }
}

/* ===== Service ===== */

@Injectable()
export class VendorProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private async prices(rows: ProductRow[]) {
    const pairs = rows.filter((r) => r.ingredient)
    if (pairs.length === 0) return new Map<string, { price: number; at: string }>()

    const { locationId } = requireTenant()
    const history = await this.prisma.client.ingredientPriceHistory.findMany({
      where: {
        vendorId: { in: [...new Set(pairs.map((r) => r.vendor.id))] },
        ingredientId: { in: [...new Set(pairs.map((r) => r.ingredient!.id))] },
        ...sameKitchen(locationId),
      },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      select: { vendorId: true, ingredientId: true, costPerUnit: true, recordedAt: true },
    })

    const zone = await zoneHere(this.prisma)
    const latest = new Map<string, { price: number; at: string }>()
    for (const record of history) {
      const key = `${record.vendorId}|${record.ingredientId}`
      if (latest.has(key)) continue
      latest.set(key, {
        price: num(record.costPerUnit),
        at: dayKey(record.recordedAt, zone),
      })
    }
    return latest
  }

  private async decorate(rows: ProductRow[]) {
    const latest = await this.prices(rows)
    return rows.map((row) => {
      const seen = row.ingredient ? latest.get(`${row.vendor.id}|${row.ingredient.id}`) : undefined
      return toContract(row, seen?.price ?? null, seen?.at ?? null)
    })
  }

  async list(vendorId?: string, unmappedOnly = false) {
    const rows = await this.prisma.client.vendorProduct.findMany({
      where: {
        ...(vendorId ? { vendorId } : {}),
        ...(unmappedOnly ? { ingredientId: null } : {}),
      },
      orderBy: [
        { ingredientId: { sort: 'asc', nulls: 'first' } },
        { vendor: { name: 'asc' } },
        { name: 'asc' },
      ],
      include: PRODUCT_INCLUDE,
    })
    return this.decorate(rows)
  }

  private async readOne(id: string) {
    const row = await this.prisma.client.vendorProduct.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    })
    if (!row)
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' })
    const [contract] = await this.decorate([row])
    return contract
  }

  private async assertNameFree(
    vendorId: string,
    name: string,
    except: string | undefined,
    db: Pick<Serial, 'vendorProduct'>,
  ) {
    const taken = await db.vendorProduct.findFirst({
      where: { vendorId, ...named(name, except) },
      select: { vendor: { select: { name: true } } },
    })
    if (taken) {
      throw new ConflictException({
        code: 'PRODUCT_NAME_TAKEN',
        message: `${taken.vendor.name} already sells a product called ${name.trim()}`,
      })
    }
  }

  private async assertSkuFree(
    vendorId: string,
    sku: string,
    exceptId: string | undefined,
    db: Pick<Serial, 'vendorProduct'>,
  ) {
    const stated = sku.trim()
    if (!stated) return
    const taken = await db.vendorProduct.findFirst({
      where: {
        vendorId,
        sku: sameName(stated),
        ...besides(exceptId),
      },
      select: { name: true },
    })
    if (taken) {
      throw new ConflictException({
        code: 'PRODUCT_CODE_TAKEN',
        message: `Code ${stated} already belongs to ${taken.name}`,
      })
    }
  }

  async create(dto: CreateVendorProductDto) {
    const ctx = requireTenant()
    await assertReferencesOwned(this.prisma.client, {
      vendorId: dto.vendorId,
      ingredientId: dto.ingredientId,
    })

    const created = await serialized(
      this.prisma.client,
      catalogueLock(ctx.organizationId, dto.vendorId),
      async (tx) => {
        await this.assertNameFree(dto.vendorId, dto.name, undefined, tx)
        await this.assertSkuFree(dto.vendorId, dto.sku ?? '', undefined, tx)
        return tx.vendorProduct.create({
          data: {
            organizationId: ctx.organizationId,
            vendorId: dto.vendorId,
            ingredientId: dto.ingredientId || null,
            name: dto.name.trim(),
            sku: dto.sku?.trim() || null,
            isActive: dto.isActive,
          },
          select: { id: true },
        })
      },
    )
    return this.readOne(created.id)
  }

  async update(id: string, dto: UpdateVendorProductDto) {
    const current = await this.prisma.client.vendorProduct.findUnique({ where: { id } })
    if (!current)
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' })

    await assertReferencesOwned(this.prisma.client, {
      vendorId: dto.vendorId,
      ingredientId: dto.ingredientId,
    })
    const vendorId = dto.vendorId ?? current.vendorId
    const sku = dto.sku === undefined ? current.sku : (dto.sku?.trim() ?? null) || null
    await serialized(
      this.prisma.client,
      catalogueLock(current.organizationId, vendorId),
      async (tx) => {
        if (dto.name !== undefined || dto.vendorId !== undefined) {
          await this.assertNameFree(vendorId, dto.name ?? current.name, id, tx)
        }
        if (dto.sku !== undefined || dto.vendorId !== undefined) {
          await this.assertSkuFree(vendorId, sku ?? '', id, tx)
        }
        await tx.vendorProduct.update({
          where: { id },
          data: {
            vendorId: dto.vendorId,
            name: dto.name?.trim(),
            sku: dto.sku === undefined ? undefined : sku,
            ingredientId: dto.ingredientId === undefined ? undefined : dto.ingredientId || null,
            isActive: dto.isActive,
          },
        })
      },
    )
    return this.readOne(id)
  }

  async remove(id: string) {
    try {
      await this.prisma.client.vendorProduct.delete({ where: { id } })
      return { ok: true }
    } catch (e) {
      throw notFoundOr(e, 'Product not found')
    }
  }
}
