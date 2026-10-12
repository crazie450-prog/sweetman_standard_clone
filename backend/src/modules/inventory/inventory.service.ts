import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { requireLocation, requireTenant, type TenantContext } from '../../tenancy/tenant-context'
import { money, num, rounded, percent } from '../../common/utils/decimal'
import { statedPeriod, weekStartKey } from '../../common/utils/calendar'
import { zoneHere } from '../../tenancy/organization-zone'
import { takeFromStock } from '../../rules/stock'
import { costHere, deliveryPrice, locationSelect, vendorHere } from '../ingredients/pricing'
import type { Prisma, TxType } from '../../generated/prisma/client'
import { pageOf, pageWindow, type PageQuery } from '../../common/dto/pagination.dto'
import { PeriodQuery } from '../../common/dto/period.dto'
import { TransactionsQuery, CreateTransactionDto, type TxKind } from './dto/inventory.dto'

const TX_FILTER: Record<TxKind, Prisma.InventoryTransactionWhereInput> = {
  received: { OR: [{ type: 'RECEIVE' }, { type: 'ADJUST', quantity: { gte: 0 } }] },
  used: { OR: [{ type: { in: ['USE', 'SALE'] } }, { type: 'ADJUST', quantity: { lt: 0 } }] },
  wasted: { type: 'WASTE' },
  counted: { type: 'COUNT' },
}

const priceRecordsReached = (ctx: TenantContext) => {
  const reached = ctx.locationId ? [ctx.locationId] : (ctx.assignedLocationIds ?? [])
  return reached.length === 0 ? {} : { OR: [{ locationId: { in: reached } }, { locationId: null }] }
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  private txType = (type: TxType, quantity: number): 'received' | 'used' | 'wasted' | 'counted' => {
    if (type === 'COUNT') return 'counted'
    if (type === 'RECEIVE') return 'received'
    if (type === 'WASTE') return 'wasted'
    if (type === 'USE' || type === 'SALE') return 'used'
    return quantity >= 0 ? 'received' : 'used'
  }

  async transactions(query: TransactionsQuery) {
    const where = await this.transactionsWhere(query)
    const [rows, total] = await Promise.all([
      this.prisma.client.inventoryTransaction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
        include: {
          ingredient: { select: { name: true, category: { select: { name: true } } } },
        },
      }),
      this.prisma.client.inventoryTransaction.count({ where }),
    ])
    return pageOf(
      rows.map((t) => ({
        id: t.id,
        date: t.createdAt.toISOString(),
        type: this.txType(t.type, num(t.quantity)),
        ingredient: t.ingredient.name,
        category: t.ingredient.category?.name ?? '',
        quantity: t.type === 'COUNT' ? num(t.quantity) : Math.abs(num(t.quantity)),
        unit: t.unit,
        cost: t.type === 'COUNT' && num(t.quantity) < 0 ? -num(t.cost) : num(t.cost),
        notes: t.notes ?? '',
      })),
      total,
      query,
    )
  }

  async transactionsSummary(query: PeriodQuery) {
    const createdAt = statedPeriod(query.from, query.to, await zoneHere(this.prisma))
    const sum = async (where: Prisma.InventoryTransactionWhereInput) => {
      const found = await this.prisma.client.inventoryTransaction.aggregate({
        where: { createdAt, ...where },
        _sum: { cost: true },
        _count: true,
      })
      return { cost: num(found._sum.cost ?? 0), count: found._count }
    }
    const [received, used, wasted, countedUp, countedDown] = await Promise.all([
      sum(TX_FILTER.received),
      sum(TX_FILTER.used),
      sum(TX_FILTER.wasted),
      sum({ type: 'COUNT', quantity: { gte: 0 } }),
      sum({ type: 'COUNT', quantity: { lt: 0 } }),
    ])
    const counted = money(countedUp.cost - countedDown.cost)
    return {
      received: money(received.cost),
      used: money(used.cost),
      wasted: money(wasted.cost),
      counted,
      net: money(received.cost - used.cost - wasted.cost + counted),
      movements: received.count + used.count + wasted.count + countedUp.count + countedDown.count,
    }
  }

  private async transactionsWhere(
    query: TransactionsQuery,
  ): Promise<Prisma.InventoryTransactionWhereInput> {
    const createdAt = statedPeriod(query.from, query.to, await zoneHere(this.prisma))
    return { createdAt, ...(query.type ? TX_FILTER[query.type] : {}) }
  }

  async createTransaction(dto: CreateTransactionDto) {
    const ctx = requireTenant()
    const locationId = requireLocation()
    if (dto.type === 'WASTE') {
      throw new BadRequestException({
        code: 'WASTE_ON_WASTE_LOG',
        message:
          'Waste is recorded on the waste log, which keeps its reason and value for every report; use POST /api/waste',
      })
    }
    if (dto.type === 'RECEIVE' && dto.cost !== undefined && dto.cost < 0) {
      throw new BadRequestException({
        code: 'COST_NEGATIVE',
        message: 'The cost of a delivery cannot be negative',
      })
    }
    if (dto.type === 'COUNT' && dto.quantity < 0) {
      throw new BadRequestException({
        code: 'QUANTITY_NEGATIVE',
        message: 'A counted quantity cannot be negative',
      })
    }
    const ingredient = await this.prisma.client.ingredient.findUnique({
      where: { id: dto.ingredientId },
      include: { perLocation: locationSelect(locationId) },
    })
    if (!ingredient)
      throw new BadRequestException({ code: 'UNKNOWN_INGREDIENT', message: 'Unknown ingredientId' })

    const signed =
      dto.type === 'RECEIVE'
        ? Math.abs(dto.quantity)
        : dto.type === 'USE'
          ? -Math.abs(dto.quantity)
          : dto.quantity

    return this.prisma.client.$transaction(async (tx) => {
      if (dto.type === 'COUNT') {
        await tx.ingredientLocationStock.updateMany({
          where: { ingredientId: dto.ingredientId, locationId },
          data: { onHand: { increment: 0 } },
        })
      }
      const held =
        dto.type === 'COUNT'
          ? await tx.ingredientLocationStock.findUnique({
              where: { ingredientId_locationId: { ingredientId: dto.ingredientId, locationId } },
              select: { onHand: true },
            })
          : null
      const moved = dto.type === 'COUNT' ? dto.quantity - num(held?.onHand ?? 0) : signed
      const movement = await tx.inventoryTransaction.create({
        data: {
          organizationId: ctx.organizationId,
          locationId,
          ingredientId: dto.ingredientId,
          type: dto.type,
          quantity: moved,
          unit: ingredient.unit,
          cost: dto.cost ?? money(Math.abs(moved) * costHere(ingredient)),
          notes: dto.notes,
        },
      })

      if (dto.type === 'COUNT') {
        await tx.ingredientLocationStock.upsert({
          where: { ingredientId_locationId: { ingredientId: dto.ingredientId, locationId } },
          create: { ingredientId: dto.ingredientId, locationId, onHand: dto.quantity },
          update: { onHand: dto.quantity },
        })
        await tx.$executeRaw`
          UPDATE "Ingredient"
          SET "onHand" = (
            SELECT COALESCE(SUM(s."onHand"), 0)
            FROM "IngredientLocationStock" s
            WHERE s."ingredientId" = ${dto.ingredientId}
          )
          WHERE "id" = ${dto.ingredientId}
        `
      } else if (signed < 0) {
        await takeFromStock(tx, {
          organizationId: ctx.organizationId,
          ingredientId: dto.ingredientId,
          locationId,
          quantity: signed,
          name: ingredient.name,
          unit: ingredient.unit,
        })
      } else {
        await tx.ingredient.update({
          where: { id: dto.ingredientId },
          data: { onHand: { increment: signed } },
        })
        await tx.ingredientLocationStock.upsert({
          where: { ingredientId_locationId: { ingredientId: dto.ingredientId, locationId } },
          create: { ingredientId: dto.ingredientId, locationId, onHand: signed },
          update: { onHand: { increment: signed } },
        })
      }

      const paid =
        dto.type === 'RECEIVE' && dto.cost !== undefined
          ? deliveryPrice(dto.cost, Math.abs(dto.quantity))
          : null
      if (paid !== null) {
        await tx.ingredientPriceHistory.create({
          data: {
            organizationId: ctx.organizationId,
            ingredientId: dto.ingredientId,
            vendorId: vendorHere(ingredient),
            locationId,
            costPerUnit: paid,
            source: 'receipt',
          },
        })
      }

      return movement
    })
  }

  async usage(fromISO?: string, toISO?: string) {
    const zone = await zoneHere(this.prisma)
    const period = statedPeriod(fromISO, toISO, zone)
    const whole = period.gte !== undefined || period.lte !== undefined
    const rows = await this.prisma.client.inventoryTransaction.findMany({
      where: { type: 'USE', ...(whole ? { createdAt: period } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(whole ? {} : { take: 500 }),
      include: {
        ingredient: { select: { name: true, category: { select: { name: true } } } },
      },
    })
    const acc = new Map<
      string,
      {
        period: string
        ingredient: string
        category: string
        used: number
        unit: string
        cost: number
      }
    >()
    for (const t of rows) {
      const period = weekStartKey(t.createdAt, zone)
      const key = `${period}|${t.ingredient.name}`
      const cur = acc.get(key) ?? {
        period,
        ingredient: t.ingredient.name,
        category: t.ingredient.category?.name ?? '',
        used: 0,
        unit: t.unit,
        cost: 0,
      }
      cur.used += Math.abs(num(t.quantity))
      cur.cost += num(t.cost)
      acc.set(key, cur)
    }
    return [...acc.entries()].map(([key, r]) => ({
      id: key,
      period: r.period,
      ingredient: r.ingredient,
      category: r.category,
      used: rounded(r.used, 2),
      unit: r.unit,
      cost: money(r.cost),
    }))
  }

  async priceTrends() {
    const ctx = requireTenant()
    const ingredients = await this.prisma.client.ingredient.findMany({
      include: {
        vendor: { select: { name: true } },
        perLocation: {
          where: { locationId: ctx.locationId ?? '' },
          select: { vendor: { select: { name: true } } },
        },
        priceHistory: {
          where: priceRecordsReached(ctx),
          orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
          take: 50,
        },
      },
    })
    return ingredients
      .filter((i) => i.priceHistory.length > 0)
      .map((i) => {
        const [latest, ...earlier] = i.priceHistory
        const before = earlier.find((r) => r.locationId === latest.locationId) ?? latest
        const current = num(latest.costPerUnit)
        const previous = num(before.costPerUnit)
        const change = percent(current - previous, previous) ?? 0
        return {
          id: i.id,
          ingredient: i.name,
          vendor: i.perLocation[0]?.vendor?.name ?? i.vendor?.name ?? '',
          previous,
          current,
          change,
        }
      })
  }

  async priceHistory(ingredientId: string, query: PageQuery) {
    const ctx = requireTenant()
    const ingredient = await this.prisma.client.ingredient.findFirst({
      where: { id: ingredientId },
      select: { id: true, name: true, unit: true },
    })
    if (!ingredient)
      throw new NotFoundException({ code: 'INGREDIENT_NOT_FOUND', message: 'Ingredient not found' })

    const where = { ingredientId, ...priceRecordsReached(ctx) }
    const [rows, total] = await Promise.all([
      this.prisma.client.ingredientPriceHistory.findMany({
        where,
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
        include: {
          vendor: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
        },
      }),
      this.prisma.client.ingredientPriceHistory.count({ where }),
    ])
    return {
      ingredient,
      ...pageOf(
        rows.map((r) => ({
          id: r.id,
          costPerUnit: num(r.costPerUnit),
          source: r.source,
          recordedAt: r.recordedAt.toISOString(),
          vendor: r.vendor?.name ?? '',
          vendorId: r.vendorId,
          location: r.location?.name ?? '',
          locationId: r.locationId,
        })),
        total,
        query,
      ),
    }
  }
}
