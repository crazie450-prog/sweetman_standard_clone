import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { requireTenant } from '../../tenancy/tenant-context'
import { money, num, percent } from '../../common/utils/decimal'
import { dayKey, daysBetween, lastDays, reportingPeriod } from '../../common/utils/calendar'
import { zoneHere } from '../../tenancy/organization-zone'
import { WASTE_REASON_LABEL } from '../waste/reasons'
import { foodCostVariance } from '../../costing/variance'
import { conversionRules } from '../../costing/costing.service'
import { bridgedConversion } from '../../costing/units'
import { IngredientsService } from '../ingredients/ingredients.service'
import { ROLE_NAMES } from '../../common/utils/role-names'
import { takings } from '../sales/takings'

const statedOrRecorded = (stated: Date, recorded: Date, zone: string) =>
  dayKey(stated, zone) === dayKey(recorded, zone) ? recorded : stated

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingredients: IngredientsService,
  ) {}

  async kpis() {
    const zone = await zoneHere(this.prisma)
    const since30 = lastDays(30, zone)
    const [recipes, ingredients, waste, sales, lastRecipe, pendingDocuments, organization] =
      await Promise.all([
        this.prisma.client.recipe.count({ where: { status: { not: 'archived' } } }),
        this.ingredients.list(),
        this.prisma.client.wasteEntry.aggregate({
          where: { date: { gte: since30 } },
          _sum: { value: true },
        }),
        this.prisma.client.sale.findMany({
          where: { date: { gte: since30 } },
          include: { items: true },
        }),
        this.prisma.client.recipe
          .findMany({
            where: { status: { not: 'archived' } },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { name: true },
          })
          .then((rows) => rows[0]),
        this.prisma.client.document.count({ where: { status: 'requires_review' } }),
        this.prisma.client.organization.findUniqueOrThrow({
          where: { id: requireTenant().organizationId },
          select: { foodCostTargetPct: true },
        }),
      ])

    const { revenue, cost } = takings(sales.flatMap((s) => s.items))
    const foodCostPct = percent(cost, revenue) ?? 0
    const marginPct = percent(revenue - cost, revenue) ?? 0

    const todayKey = dayKey(new Date(), zone)
    const today = takings(
      sales.filter((s) => dayKey(s.date, zone) === todayKey).flatMap((s) => s.items),
    )

    return {
      recipes,
      foodCostPct,
      foodCostTarget: num(organization.foodCostTargetPct),
      wasteMonth: money(num(waste._sum.value)),
      marginPct,
      lowStockCount: ingredients.filter((i) => i.status === 'low').length,
      pendingDocuments,
      todayRevenue: money(today.revenue),
      todayProfit: money(today.revenue - today.cost),
      recentRecipe: lastRecipe?.name ?? null,
    }
  }

  async activity() {
    const zone = await zoneHere(this.prisma)
    const [waste, production, recipes, invites, organization] = await Promise.all([
      this.prisma.client.wasteEntry.findMany({
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        take: 4,
        include: { ingredient: { select: { name: true, unit: true } } },
      }),
      this.prisma.client.production.findMany({
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        take: 4,
        include: { recipe: { select: { name: true } } },
      }),
      this.prisma.client.recipe.findMany({
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 4,
        select: { id: true, name: true, totalCost: true, updatedAt: true },
      }),
      this.prisma.client.invitation.findMany({
        where: { acceptedAt: { not: null } },
        orderBy: [{ acceptedAt: 'desc' }, { id: 'desc' }],
        take: 3,
        select: { email: true, role: true, acceptedAt: true },
      }),
      this.prisma.client.organization.findUniqueOrThrow({
        where: { id: requireTenant().organizationId },
        select: { currency: true },
      }),
    ])
    const price = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: organization.currency,
    })
    const members = await this.prisma.client.user.findMany({
      where: { email: { in: invites.map((i) => i.email) } },
      select: { email: true, fullName: true },
    })
    const nameOf = new Map(members.map((m) => [m.email, m.fullName]))

    const events = [
      ...waste.map((w) => ({
        id: `w-${w.id}`,
        type: 'waste' as const,
        text: `Waste recorded: ${num(w.quantity)} ${w.ingredient.unit} ${w.ingredient.name} (${WASTE_REASON_LABEL[w.reason] ?? w.reason})`,
        at: statedOrRecorded(w.date, w.createdAt, zone),
      })),
      ...production.map((p) => ({
        id: `p-${p.id}`,
        type: 'production' as const,
        text: `Produced ${num(p.quantity)} ${p.unit} of ${p.recipe.name}`,
        at: statedOrRecorded(p.date, p.createdAt, zone),
      })),
      ...recipes.map((r) => ({
        id: `r-${r.id}`,
        type: 'recipe' as const,
        text: `Recipe “${r.name}” costed at ${price.format(money(num(r.totalCost)))}`,
        at: r.updatedAt,
      })),
      ...invites.map((i) => ({
        id: `i-${i.email}`,
        type: 'team' as const,
        text: `${nameOf.get(i.email) || i.email} joined as ${ROLE_NAMES[i.role]}`,
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
    const zone = await zoneHere(this.prisma)
    const todayKey = dayKey(new Date(), zone)
    const sales = await this.prisma.client.sale.findMany({
      where: { date: { gte: lastDays(days, zone) } },
      include: { items: true },
    })
    const revenue = new Array<number>(days).fill(0)
    const profit = new Array<number>(days).fill(0)
    const cost = new Array<number>(days).fill(0)
    for (const s of sales) {
      const idx = Math.min(
        days - 1,
        Math.max(0, days - 1 - daysBetween(dayKey(s.date, zone), todayKey)),
      )
      const sold = takings(s.items)
      revenue[idx] += sold.revenue
      cost[idx] += sold.cost
      profit[idx] += sold.revenue - sold.cost
    }
    const foodCost = revenue.map((r, i) => percent(cost[i], r) ?? 0)
    return {
      revenue: revenue.map(money),
      profit: profit.map(money),
      foodCost,
    }
  }

  // ------------------------------------------------------------- analytics
  async spendByCategory() {
    const since = lastDays(30, await zoneHere(this.prisma))
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
    const sales = await this.prisma.client.sale.findMany({
      select: {
        items: {
          select: {
            quantity: true,
            unitPrice: true,
            unitCost: true,
            menuItem: { select: { category: { select: { name: true } } } },
          },
        },
      },
    })
    const acc = new Map<string, number>()
    let total = 0
    for (const it of sales.flatMap((s) => s.items)) {
      const cat = it.menuItem.category?.name ?? 'Uncategorized'
      const c = takings([it]).cost
      acc.set(cat, (acc.get(cat) ?? 0) + c)
      total += c
    }
    return [...acc.entries()]
      .map(([category, cost]) => ({
        category,
        cost: money(cost),
        pct: percent(cost, total) ?? 0,
      }))
      .sort((a, b) => b.cost - a.cost)
  }

  async wasteBreakdown(fromISO?: string, toISO?: string) {
    const { from, to } = reportingPeriod(fromISO, toISO, await zoneHere(this.prisma))
    const rows = await this.prisma.client.wasteEntry.groupBy({
      by: ['reason'],
      where: { date: { gte: from, lte: to } },
      _sum: { value: true },
    })
    return rows
      .map((r) => ({
        reason: WASTE_REASON_LABEL[r.reason] ?? r.reason,
        cost: money(num(r._sum.value)),
      }))
      .sort((a, b) => b.cost - a.cost)
  }

  async revenueTrend() {
    const zone = await zoneHere(this.prisma)
    const sales = await this.prisma.client.sale.findMany({
      where: { date: { gte: lastDays(30, zone) } },
      include: { items: true },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    })
    const byDay = new Map<string, { revenue: number; cost: number }>()
    for (const s of sales) {
      const key = dayKey(s.date, zone)
      const cur = byDay.get(key) ?? { revenue: 0, cost: 0 }
      const sold = takings(s.items)
      cur.revenue += sold.revenue
      cur.cost += sold.cost
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

  async foodCostVariance(fromISO?: string, toISO?: string) {
    const zone = await zoneHere(this.prisma)
    const { from, to } = reportingPeriod(fromISO, toISO, zone)

    const [recipes, menuItems, sales, transactions, ingredients, rulesFor] = await Promise.all([
      this.prisma.client.recipe.findMany({
        select: {
          id: true,
          portions: true,
          yieldAmount: true,
          yieldUnit: true,
          ingredients: { select: { ingredientId: true, quantity: true, unit: true } },
          components: { select: { componentId: true, quantity: true, unit: true } },
        },
      }),
      this.prisma.client.menuItem.findMany({
        select: { id: true, name: true, recipes: { select: { recipeId: true, portions: true } } },
      }),
      this.prisma.client.sale.findMany({
        where: { date: { gte: from, lte: to } },
        select: { items: { select: { menuItemId: true, quantity: true } } },
      }),
      this.prisma.client.inventoryTransaction.findMany({
        where: { type: { in: ['USE', 'WASTE'] }, createdAt: { gte: from, lte: to } },
        select: { ingredientId: true, quantity: true, unit: true, type: true },
      }),
      this.prisma.client.ingredient.findMany({
        select: { id: true, costPerUnit: true, unit: true, category: { select: { name: true } } },
      }),
      conversionRules(this.prisma.client),
    ])

    const priced = new Map(ingredients.map((i) => [i.id, i]))
    const atSharedPrice = (t: (typeof transactions)[number]) => {
      const ingredient = priced.get(t.ingredientId)
      if (!ingredient) return 0
      const moved = Math.abs(num(t.quantity))
      const inPriced =
        bridgedConversion(moved, t.unit, ingredient.unit, rulesFor(t.ingredientId)) ?? moved
      return inPriced * num(ingredient.costPerUnit)
    }

    const report = foodCostVariance({
      recipes: recipes.map((r) => ({
        id: r.id,
        portions: r.portions,
        yieldAmount: r.yieldAmount === null ? null : num(r.yieldAmount),
        yieldUnit: r.yieldUnit,
        ingredients: r.ingredients.map((i) => ({
          ingredientId: i.ingredientId,
          quantity: num(i.quantity),
          unit: i.unit,
        })),
        components: r.components.map((c) => ({
          componentId: c.componentId,
          quantity: num(c.quantity),
          unit: c.unit,
        })),
      })),
      menuItems: menuItems.map((m) => ({
        id: m.id,
        name: m.name,
        recipes: m.recipes.map((mr) => ({ recipeId: mr.recipeId, portions: num(mr.portions) })),
      })),
      sales: sales.flatMap((s) =>
        s.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
      ),
      actual: transactions.map((t) => ({
        ingredientId: t.ingredientId,
        cost: atSharedPrice(t),
        waste: t.type === 'WASTE',
      })),
      ingredients: ingredients.map((i) => ({
        id: i.id,
        costPerUnit: num(i.costPerUnit),
        unit: i.unit,
        category: i.category?.name ?? 'Uncategorized',
      })),
      conversions: rulesFor,
    })

    return { from: dayKey(from, zone), to: dayKey(to, zone), ...report }
  }
}
