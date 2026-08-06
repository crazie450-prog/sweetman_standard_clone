import { Controller, Get, Injectable, Module } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { PrismaService } from '../../prisma/prisma.service'
import { money, num } from '../../common/utils/decimal'
import { dayKey, daysBetween } from '../../common/utils/calendar'

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async kpis() {
    const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const [recipes, ingredients, waste, sales, lastRecipe] = await Promise.all([
      this.prisma.client.recipe.count({ where: { status: { not: 'archived' } } }),
      this.prisma.client.ingredient.findMany({
        select: { onHand: true, reorderLevel: true },
      }),
      this.prisma.client.wasteEntry.aggregate({
        where: { date: { gte: since30 } },
        _sum: { value: true },
      }),
      this.prisma.client.sale.findMany({
        where: { date: { gte: since30 } },
        include: { items: true },
      }),
      this.prisma.client.recipe.findFirst({
        where: { status: { not: 'archived' } },
        orderBy: { updatedAt: 'desc' },
        select: { name: true },
      }),
    ])

    let revenue = 0
    let cost = 0
    for (const s of sales)
      for (const it of s.items) {
        revenue += it.quantity * num(it.unitPrice)
        cost += it.quantity * num(it.unitCost)
      }
    const foodCostPct = revenue > 0 ? Math.round((cost / revenue) * 1000) / 10 : 0
    const marginPct = revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : 0

    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    let todayRevenue = 0
    let todayCost = 0
    for (const s of sales)
      if (s.date >= dayStart)
        for (const it of s.items) {
          todayRevenue += it.quantity * num(it.unitPrice)
          todayCost += it.quantity * num(it.unitCost)
        }

    return {
      recipes,
      foodCostPct,
      foodCostTarget: 30,
      wasteMonth: money(num(waste._sum.value)),
      marginPct,
      lowStockCount: ingredients.filter((i) => num(i.onHand) <= num(i.reorderLevel)).length,
      pendingDocuments: 0,
      todayRevenue: money(todayRevenue),
      todayProfit: money(todayRevenue - todayCost),
      recentRecipe: lastRecipe?.name ?? null,
    }
  }

  async activity() {
    const [waste, production, recipes, invites] = await Promise.all([
      this.prisma.client.wasteEntry.findMany({
        orderBy: { date: 'desc' },
        take: 4,
        include: { ingredient: { select: { name: true, unit: true } } },
      }),
      this.prisma.client.production.findMany({
        orderBy: { date: 'desc' },
        take: 4,
        include: { recipe: { select: { name: true } } },
      }),
      this.prisma.client.recipe.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 4,
        select: { name: true, totalCost: true, updatedAt: true },
      }),
      this.prisma.client.invitation.findMany({
        where: { acceptedAt: { not: null } },
        orderBy: { acceptedAt: 'desc' },
        take: 3,
        select: { email: true, role: true, acceptedAt: true },
      }),
    ])

    const REASONS: Record<string, string> = {
      spoilage: 'Spoilage',
      overproduction: 'Overproduction',
      trim: 'Trim waste',
      expired: 'Expired',
      other: 'Other',
    }

    const events = [
      ...waste.map((w) => ({
        id: `w-${w.id}`,
        type: 'waste' as const,
        text: `Waste recorded: ${num(w.quantity)} ${w.ingredient.unit} ${w.ingredient.name} (${REASONS[w.reason] ?? w.reason})`,
        at: w.date,
      })),
      ...production.map((p) => ({
        id: `p-${p.id}`,
        type: 'production' as const,
        text: `Produced ${num(p.quantity)} ${p.unit} of ${p.recipe.name}`,
        at: p.date,
      })),
      ...recipes.map((r) => ({
        id: `r-${r.name}`,
        type: 'recipe' as const,
        text: `Recipe “${r.name}” costed at ${money(num(r.totalCost)).toFixed(2)}`,
        at: r.updatedAt,
      })),
      ...invites.map((i) => ({
        id: `i-${i.email}`,
        type: 'team' as const,
        text: `${i.email} joined as ${i.role}`,
        at: i.acceptedAt as Date,
      })),
    ]

    return events
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 6)
      .map((e) => ({ id: e.id, type: e.type, text: e.text, at: e.at.toISOString() }))
  }

  async trends() {
    const days = 7
    const since = new Date(Date.now() - days * 24 * 3600 * 1000)
    const sales = await this.prisma.client.sale.findMany({
      where: { date: { gte: since } },
      include: { items: true },
    })
    const revenue = new Array<number>(days).fill(0)
    const profit = new Array<number>(days).fill(0)
    const cost = new Array<number>(days).fill(0)
    const todayKey = dayKey(new Date())
    for (const s of sales) {
      const idx = Math.min(
        days - 1,
        Math.max(0, days - 1 - daysBetween(dayKey(s.date), todayKey)),
      )
      for (const it of s.items) {
        const r = it.quantity * num(it.unitPrice)
        const c = it.quantity * num(it.unitCost)
        revenue[idx] += r
        cost[idx] += c
        profit[idx] += r - c
      }
    }
    const foodCost = revenue.map((r, i) => (r > 0 ? Math.round((cost[i] / r) * 1000) / 10 : 0))
    return {
      revenue: revenue.map(money),
      profit: profit.map(money),
      foodCost,
    }
  }

  // ------------------------------------------------------------- analytics
  async spendByCategory() {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const rows = await this.prisma.client.inventoryTransaction.findMany({
      where: { type: 'RECEIVE', createdAt: { gte: since } },
      include: { ingredient: { select: { category: { select: { name: true } } } } },
    })
    const acc = new Map<string, number>()
    for (const t of rows) {
      const cat = t.ingredient.category?.name ?? 'Uncategorized'
      acc.set(cat, (acc.get(cat) ?? 0) + num(t.cost))
    }
    return [...acc.entries()]
      .map(([category, amount]) => ({ category, amount: money(amount) }))
      .sort((a, b) => b.amount - a.amount)
  }

  async costByCategory() {
    const rows = await this.prisma.client.saleItem.findMany({
      include: { menuItem: { select: { category: { select: { name: true } } } } },
    })
    const acc = new Map<string, number>()
    let total = 0
    for (const it of rows) {
      const cat = it.menuItem.category?.name ?? 'Uncategorized'
      const c = it.quantity * num(it.unitCost)
      acc.set(cat, (acc.get(cat) ?? 0) + c)
      total += c
    }
    return [...acc.entries()]
      .map(([category, cost]) => ({
        category,
        cost: money(cost),
        pct: total > 0 ? Math.round((cost / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.cost - a.cost)
  }

  async wasteBreakdown() {
    const rows = await this.prisma.client.wasteEntry.groupBy({
      by: ['reason'],
      _sum: { value: true },
    })
    const label: Record<string, string> = {
      spoilage: 'Spoilage',
      overproduction: 'Overproduction',
      trim: 'Prep waste',
      expired: 'Expired',
      other: 'Other',
    }
    return rows
      .map((r) => ({ reason: label[r.reason] ?? r.reason, cost: money(num(r._sum.value)) }))
      .sort((a, b) => b.cost - a.cost)
  }

  async revenueTrend() {
    const days = 30
    const since = new Date(Date.now() - days * 24 * 3600 * 1000)
    const sales = await this.prisma.client.sale.findMany({
      where: { date: { gte: since } },
      include: { items: true },
      orderBy: { date: 'asc' },
    })
    const byDay = new Map<string, { revenue: number; cost: number }>()
    for (const s of sales) {
      const key = s.date.toISOString().slice(0, 10)
      const cur = byDay.get(key) ?? { revenue: 0, cost: 0 }
      for (const it of s.items) {
        cur.revenue += it.quantity * num(it.unitPrice)
        cur.cost += it.quantity * num(it.unitCost)
      }
      byDay.set(key, cur)
    }
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, v]) => ({
        date,
        revenue: money(v.revenue),
        cost: money(v.cost),
      }))
  }
}

@ApiTags('dashboard')
@ApiCookieAuth()
@Controller('api')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard/kpis')
  @ApiOperation({ summary: 'Dashboard KPI tiles' })
  kpis() {
    return this.dashboard.kpis()
  }

  @Get('dashboard/trends')
  @ApiOperation({ summary: 'Seven-day sparkline series' })
  trends() {
    return this.dashboard.trends()
  }

  @Get('dashboard/activity')
  @ApiOperation({ summary: 'Recent activity: waste, production, recipes and team' })
  activity() {
    return this.dashboard.activity()
  }

  @Get('analytics/spend')
  @ApiOperation({ summary: 'Purchase spend by ingredient category, last 30 days' })
  spend() {
    return this.dashboard.spendByCategory()
  }

  @Get('analytics/cost-by-category')
  @ApiOperation({ summary: 'Recipe cost split by ingredient category' })
  costByCategory() {
    return this.dashboard.costByCategory()
  }

  @Get('analytics/waste-breakdown')
  @ApiOperation({ summary: 'Waste value grouped by reason' })
  wasteBreakdown() {
    return this.dashboard.wasteBreakdown()
  }

  @Get('analytics/revenue-trend')
  @ApiOperation({ summary: 'Daily revenue and cost, last 30 days' })
  revenueTrend() {
    return this.dashboard.revenueTrend()
  }
}

@Module({
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
