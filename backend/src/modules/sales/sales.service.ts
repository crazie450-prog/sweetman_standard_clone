import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { reachedLocations, requireLocation, requireTenant } from '../../tenancy/tenant-context'
import { money, num } from '../../common/utils/decimal'
import { dishCost } from '../../costing/costing.core'
import { takings } from './takings'
import { dayKey, recordedAt, statedPeriod } from '../../common/utils/calendar'
import { zoneHere } from '../../tenancy/organization-zone'
import { CreateSaleDto, SaleLinesQuery } from './dto/sales.dto'
import { pageOf } from '../../common/dto/pagination.dto'
import { Prisma } from '../../generated/prisma/client'

const RECENT_DAYS = 90

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  private async period(fromISO?: string, toISO?: string) {
    const zone = await zoneHere(this.prisma)
    const stated = statedPeriod(fromISO, toISO, zone)
    const whole = stated.gte !== undefined || stated.lte !== undefined
    return { zone, date: whole ? stated : { gte: new Date(Date.now() - RECENT_DAYS * 86400000) } }
  }

  async daily(fromISO?: string, toISO?: string) {
    const { zone, date } = await this.period(fromISO, toISO)
    const rows = await this.prisma.client.sale.findMany({
      where: { date },
      select: {
        date: true,
        items: { select: { quantity: true, unitPrice: true, unitCost: true } },
      },
    })
    const byDay = new Map<string, { sales: number; revenue: number; cost: number }>()
    for (const s of rows) {
      const key = dayKey(s.date, zone)
      const cur = byDay.get(key) ?? { sales: 0, revenue: 0, cost: 0 }
      const sold = takings(s.items)
      cur.sales += sold.sold
      cur.revenue += sold.revenue
      cur.cost += sold.cost
      byDay.set(key, cur)
    }
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, v]) => ({
        date,
        sales: v.sales,
        revenue: money(v.revenue),
        cost: money(v.cost),
        profit: money(v.revenue - v.cost),
      }))
  }

  async individual(query: SaleLinesQuery) {
    const { zone, date } = await this.period(query.from, query.to)
    const reached = reachedLocations()
    const since = date.gte?.toISOString() ?? null
    const until = date.lte?.toISOString() ?? null
    const total = Prisma.sql`(si."quantity" * si."unitPrice")`
    const bounds = Prisma.sql`s."organizationId" = ${requireTenant().organizationId}
      AND (${reached}::text[] IS NULL OR s."locationId" = ANY(${reached}::text[]))
      AND (${since}::timestamptz IS NULL OR s."date" >= (${since}::timestamptz AT TIME ZONE 'UTC'))
      AND (${until}::timestamptz IS NULL OR s."date" <= (${until}::timestamptz AT TIME ZONE 'UTC'))
      AND (${query.minTotal ?? null}::numeric IS NULL OR ${total} >= ${query.minTotal ?? null}::numeric)
      AND (${query.maxTotal ?? null}::numeric IS NULL OR ${total} <= ${query.maxTotal ?? null}::numeric)`
    const dir = query.dir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`
    const order =
      query.sort === 'total'
        ? Prisma.sql`${total} ${dir}, s."date" ${dir}, si."id" ASC`
        : Prisma.sql`s."date" ${dir}, si."saleId" ${dir}, si."id" ASC`
    const [ordered, counted] = await Promise.all([
      this.prisma.client.$queryRaw<{ id: string }[]>`
        SELECT si."id" FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId"
        WHERE ${bounds} ORDER BY ${order} LIMIT ${query.limit} OFFSET ${query.offset}`,
      this.prisma.client.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId"
        WHERE ${bounds}`,
    ])
    const ids = ordered.map((row) => row.id)
    const rows = await this.prisma.client.saleItem.findMany({
      where: { id: { in: ids } },
      include: { menuItem: { select: { name: true } }, sale: { select: { date: true } } },
    })
    const byId = new Map(rows.map((row) => [row.id, row]))
    return pageOf(
      ids
        .map((id) => byId.get(id))
        .filter((it) => it !== undefined)
        .map((it) => ({
          id: it.id,
          item: it.menuItem.name,
          qty: it.quantity,
          price: num(it.unitPrice),
          date: dayKey(it.sale.date, zone),
        })),
      Number(counted[0]?.count ?? 0),
      query,
    )
  }

  async menuItemNames() {
    const rows = await this.prisma.client.menuItem.findMany({
      where: { isActive: true },
      select: { name: true },
      orderBy: { name: 'asc' },
    })
    return rows.map((r) => r.name)
  }

  async create(dto: CreateSaleDto) {
    const ctx = requireTenant()
    const locationId = requireLocation()
    const ids = [...new Set(dto.items.map((i) => i.menuItemId))]
    const menuItems = await this.prisma.client.menuItem.findMany({
      where: { id: { in: ids } },
      include: {
        recipes: {
          include: { recipe: { select: { totalCost: true, portions: true } } },
        },
      },
    })
    if (menuItems.length !== ids.length)
      throw new BadRequestException({ code: 'UNKNOWN_MENU_ITEM', message: 'Unknown menuItemId' })
    const byId = new Map(menuItems.map((m) => [m.id, m]))

    return this.prisma.client.sale.create({
      data: {
        organizationId: ctx.organizationId,
        locationId,
        date: recordedAt(dto.date, await zoneHere(this.prisma)),
        items: {
          create: dto.items.map((i) => {
            const m = byId.get(i.menuItemId)!
            const unitCost = dishCost(m.recipes)
            return {
              menuItemId: i.menuItemId,
              quantity: i.quantity,
              unitPrice: num(m.price),
              unitCost,
            }
          }),
        },
      },
      include: { items: true },
    })
  }
}
