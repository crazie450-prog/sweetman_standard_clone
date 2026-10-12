import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { dayKey } from '../../common/utils/calendar'
import { zoneHere } from '../../tenancy/organization-zone'
import { PrismaService } from '../../prisma/prisma.service'
import { pageOf, pageWindow } from '../../common/dto/pagination.dto'
import type { DraftsQuery } from './dto/purchasing.dto'
import { requireLocation, requireTenant } from '../../tenancy/tenant-context'
import { assertReferencesOwned } from '../../tenancy/references'
import { money, num, type Numeric } from '../../common/utils/decimal'
import { conversionRules } from '../../costing/costing.service'
import { recommendPurchases, type Recommendation } from '../../costing/consumption'
import { costHere } from '../ingredients/pricing'
import { assertLocationOpen } from '../../rules/locations'
import { RecommendationsQuery, CreateDraftDto, UpdateDraftDto } from './dto/purchasing.dto'

export const DAYS_DEFAULT = 28
export const HORIZON_DEFAULT = 7

/* ===== Contracts ===== */

const DRAFT_INCLUDE = {
  vendor: { select: { name: true } },
  lines: {
    orderBy: { ingredient: { name: 'asc' as const } },
    include: { ingredient: { select: { name: true } } },
  },
}

type DraftRow = {
  id: string
  status: 'draft' | 'approved'
  locationId: string
  vendorId: string | null
  vendor: { name: string } | null
  note: string | null
  days: number
  horizon: number
  createdAt: Date
  approvedAt: Date | null
  lines: {
    id: string
    ingredientId: string
    quantity: Numeric
    unit: string
    unitPrice: Numeric
    suggested: Numeric
    onHand: Numeric
    ingredient: { name: string }
  }[]
}

function lineContract(l: DraftRow['lines'][number]) {
  const quantity = num(l.quantity)
  const unitPrice = l.unitPrice === null ? null : num(l.unitPrice)
  return {
    id: l.id,
    ingredientId: l.ingredientId,
    name: l.ingredient.name,
    unit: l.unit,
    quantity,
    unitPrice,
    lineTotal: unitPrice === null ? null : money(quantity * unitPrice),
    suggested: num(l.suggested),
    onHand: num(l.onHand),
  }
}

function draftContract(d: DraftRow) {
  const lines = d.lines.map(lineContract)
  return {
    id: d.id,
    status: d.status,
    vendorId: d.vendorId,
    vendorName: d.vendor?.name ?? null,
    note: d.note ?? '',
    days: d.days,
    horizon: d.horizon,
    lines,
    total: money(lines.reduce((sum, l) => sum + (l.lineTotal ?? 0), 0)),
    created: d.createdAt.toISOString(),
    approvedAt: d.approvedAt?.toISOString() ?? null,
  }
}

type StockedRow = {
  id: string
  name: string
  unit: string
  costPerUnit: Numeric
  reorderLevel: Numeric
  reorderQty: Numeric
  vendorId: string | null
  vendor: { name: string; status: string } | null
  category: { name: string } | null
  stock: { onHand: Numeric }[]
  perLocation: {
    costPerUnit: Numeric
    reorderLevel: Numeric
    vendorId: string | null
    vendor: { name: string; status: string } | null
  }[]
}

function reorderHere(row: StockedRow): number {
  const own = row.perLocation[0]?.reorderLevel
  return num(own ?? row.reorderLevel)
}

function activeVendorHere(row: StockedRow) {
  const own = row.perLocation[0]
  const vendor = own?.vendorId
    ? { id: own.vendorId, ...own.vendor }
    : row.vendorId
      ? { id: row.vendorId, ...row.vendor }
      : null
  return vendor && vendor.status !== 'inactive'
    ? { id: vendor.id, name: vendor.name ?? null }
    : null
}

function vendorIdHere(row: StockedRow): string | null {
  return activeVendorHere(row)?.id ?? null
}

function vendorNameHere(row: StockedRow): string | null {
  return activeVendorHere(row)?.name ?? null
}

/* ===== Service ===== */

@Injectable()
export class PurchasingService {
  constructor(private readonly prisma: PrismaService) {}

  private async stocked(locationId: string): Promise<StockedRow[]> {
    return this.prisma.client.ingredient.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        unit: true,
        costPerUnit: true,
        reorderLevel: true,
        reorderQty: true,
        vendorId: true,
        vendor: { select: { name: true, status: true } },
        category: { select: { name: true } },
        stock: { where: { locationId }, select: { onHand: true } },
        perLocation: {
          where: { locationId },
          select: {
            costPerUnit: true,
            reorderLevel: true,
            vendorId: true,
            vendor: { select: { name: true, status: true } },
          },
        },
      },
    })
  }

  private async compute(locationId: string, days: number, horizon: number) {
    const to = new Date()
    const from = new Date(to.getTime() - days * 86400000)
    const [recipes, menuItems, sales, movements, ingredients, rulesFor] = await Promise.all([
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
        where: { type: { in: ['USE', 'WASTE', 'RECEIVE'] }, createdAt: { gte: from, lte: to } },
        select: { ingredientId: true, quantity: true, type: true },
      }),
      this.stocked(locationId),
      conversionRules(this.prisma.client),
    ])

    const rows = recommendPurchases({
      days,
      horizon,
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
      movements: movements.map((t) => ({
        ingredientId: t.ingredientId,
        quantity: num(t.quantity),
        waste: t.type === 'WASTE',
        receipt: t.type === 'RECEIVE',
      })),
      ingredients: ingredients.map((i) => ({
        id: i.id,
        unit: i.unit,
        onHand: num(i.stock[0]?.onHand ?? 0),
        reorderLevel: reorderHere(i),
        reorderQty: num(i.reorderQty),
      })),
      conversions: rulesFor,
    })

    return { from, to, ingredients, rows }
  }

  async recommendations(query: RecommendationsQuery) {
    const locationId = requireLocation()
    const days = query.days ?? DAYS_DEFAULT
    const horizon = query.horizon ?? HORIZON_DEFAULT
    const { from, to, ingredients, rows } = await this.compute(locationId, days, horizon)
    const zone = await zoneHere(this.prisma)
    const byId = new Map(ingredients.map((i) => [i.id, i]))

    return {
      days,
      horizon,
      from: dayKey(from, zone),
      to: dayKey(to, zone),
      examined: ingredients.length,
      rows: rows.map((r) => {
        const ing = byId.get(r.ingredientId)!
        const unitPrice = costHere(ing)
        return {
          ...r,
          name: ing.name,
          category: ing.category?.name ?? '',
          vendorId: vendorIdHere(ing),
          vendorName: vendorNameHere(ing),
          unitPrice,
          estimatedCost: money(r.suggested * unitPrice),
        }
      }),
    }
  }

  /* ===== Drafts ===== */

  async createDrafts(dto: CreateDraftDto) {
    const ctx = requireTenant()
    const locationId = requireLocation()
    const days = dto.days ?? DAYS_DEFAULT
    const horizon = dto.horizon ?? HORIZON_DEFAULT

    const wanted = new Map<string, number>()
    for (const line of dto.lines) {
      if (line.quantity <= 0) continue
      wanted.set(line.ingredientId, (wanted.get(line.ingredientId) ?? 0) + line.quantity)
    }
    if (wanted.size === 0)
      throw new BadRequestException({
        code: 'DRAFT_LINES_REQUIRED',
        message: 'A draft needs at least one line',
      })
    await assertReferencesOwned(this.prisma.client, { ingredientId: [...wanted.keys()] })

    const { ingredients, rows } = await this.compute(locationId, days, horizon)
    const byId = new Map(ingredients.map((i) => [i.id, i]))
    const suggestedFor = new Map(rows.map((r) => [r.ingredientId, r]))

    const byVendor = new Map<string | null, { ingredientId: string; quantity: number }[]>()
    for (const [ingredientId, quantity] of wanted) {
      const ing = byId.get(ingredientId)
      if (!ing)
        throw new BadRequestException({
          code: 'UNKNOWN_INGREDIENT',
          message: 'Unknown ingredientId',
        })
      const vendorId = vendorIdHere(ing)
      const group = byVendor.get(vendorId) ?? []
      group.push({ ingredientId, quantity })
      byVendor.set(vendorId, group)
    }

    const created = await this.prisma.client.$transaction(async (tx) => {
      const drafts = []
      for (const [vendorId, lines] of byVendor) {
        const draft = await tx.purchaseDraft.create({
          data: {
            organizationId: ctx.organizationId,
            locationId,
            vendorId,
            days,
            horizon,
            note: dto.note?.trim() || null,
            createdById: ctx.userId,
            lines: {
              create: lines.map((l) => {
                const ing = byId.get(l.ingredientId)!
                const rec: Recommendation | undefined = suggestedFor.get(l.ingredientId)
                return {
                  ingredientId: l.ingredientId,
                  quantity: l.quantity,
                  unit: ing.unit,
                  unitPrice: costHere(ing),
                  suggested: rec?.suggested ?? 0,
                  onHand: num(ing.stock[0]?.onHand ?? 0),
                }
              }),
            },
          },
          include: DRAFT_INCLUDE,
        })
        drafts.push(draft)
      }
      return drafts
    })

    return created.map((d) => draftContract(d as DraftRow))
  }

  async list(query: DraftsQuery) {
    const where = query.status ? { status: query.status } : {}
    const [rows, total] = await Promise.all([
      this.prisma.client.purchaseDraft.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
        include: DRAFT_INCLUDE,
      }),
      this.prisma.client.purchaseDraft.count({ where }),
    ])
    return pageOf(
      rows.map((d) => {
        const { lines, ...rest } = draftContract(d as DraftRow)
        return { ...rest, lines: lines.length }
      }),
      total,
      query,
    )
  }

  private async readOne(id: string) {
    const row = await this.prisma.client.purchaseDraft.findUnique({
      where: { id },
      include: DRAFT_INCLUDE,
    })
    if (!row)
      throw new NotFoundException({ code: 'DRAFT_NOT_FOUND', message: 'Draft order not found' })
    return row as DraftRow
  }

  async detail(id: string) {
    return draftContract(await this.readOne(id))
  }

  private async readOpen(id: string) {
    const row = await this.readOne(id)
    await assertLocationOpen(this.prisma.client, row.locationId)
    return row
  }

  private assertOpen(row: DraftRow) {
    if (row.status !== 'draft') {
      throw new ConflictException({
        code: 'DRAFT_APPROVED',
        message: 'An approved order is the record of a decision and can no longer be changed',
      })
    }
  }

  async update(id: string, dto: UpdateDraftDto) {
    const locationId = requireLocation()
    const row = await this.readOpen(id)
    this.assertOpen(row)

    if (dto.lines) {
      const current = new Map(row.lines.map((l) => [l.ingredientId, l]))
      const additions = dto.lines.filter((l) => l.quantity > 0 && !current.has(l.ingredientId))
      if (additions.length > 0) {
        await assertReferencesOwned(this.prisma.client, {
          ingredientId: additions.map((l) => l.ingredientId),
        })
      }
      const stocked = dto.lines.some((l) => l.quantity > 0) ? await this.stocked(locationId) : []
      const byId = new Map(stocked.map((i) => [i.id, i]))
      for (const line of additions) {
        const ing = byId.get(line.ingredientId)
        if (ing && vendorIdHere(ing) !== row.vendorId) {
          throw new BadRequestException({
            code: 'VENDOR_MISMATCH',
            message: `${ing.name} is bought from ${vendorNameHere(ing) ?? 'no vendor'} at this location, not from the vendor of this order; add it to that vendor's draft instead`,
          })
        }
      }

      await this.prisma.client.$transaction(async (tx) => {
        const held = await tx.purchaseDraft.updateMany({
          where: { id, status: 'draft' },
          data: { status: 'draft' },
        })
        if (held.count === 0) this.assertOpen({ status: 'approved' } as DraftRow)
        const lines = await tx.purchaseDraftLine.findMany({
          where: { draftId: id },
          select: { ingredientId: true },
        })
        const now = new Set(lines.map((l) => l.ingredientId))
        const remaining = new Set(now)
        for (const line of dto.lines!) if (line.quantity <= 0) remaining.delete(line.ingredientId)
        for (const line of dto.lines!) if (line.quantity > 0) remaining.add(line.ingredientId)
        if (remaining.size === 0) {
          throw new BadRequestException({
            code: 'DRAFT_LINES_REQUIRED',
            message: 'A draft needs at least one line; delete it instead',
          })
        }
        for (const line of dto.lines!) {
          if (line.quantity <= 0) {
            await tx.purchaseDraftLine.deleteMany({
              where: { draftId: id, ingredientId: line.ingredientId },
            })
          } else if (now.has(line.ingredientId)) {
            await tx.purchaseDraftLine.updateMany({
              where: { draftId: id, ingredientId: line.ingredientId },
              data: { quantity: line.quantity },
            })
          } else {
            const ing = byId.get(line.ingredientId)
            if (!ing)
              throw new BadRequestException({
                code: 'UNKNOWN_INGREDIENT',
                message: 'Unknown ingredientId',
              })
            await tx.purchaseDraftLine.create({
              data: {
                draftId: id,
                ingredientId: line.ingredientId,
                quantity: line.quantity,
                unit: ing.unit,
                unitPrice: costHere(ing),
                suggested: 0,
                onHand: num(ing.stock[0]?.onHand ?? 0),
              },
            })
          }
        }
        if (dto.note !== undefined) {
          await tx.purchaseDraft.update({ where: { id }, data: { note: dto.note?.trim() || null } })
        }
      })
    } else if (dto.note !== undefined) {
      const { count } = await this.prisma.client.purchaseDraft.updateMany({
        where: { id, status: 'draft' },
        data: { note: dto.note?.trim() || null },
      })
      if (count === 0) this.assertOpen({ status: 'approved' } as DraftRow)
    }

    return this.detail(id)
  }

  async approve(id: string) {
    const ctx = requireTenant()
    const row = await this.readOpen(id)
    if (row.status === 'approved') {
      throw new ConflictException({
        code: 'DRAFT_ALREADY_APPROVED',
        message: 'This order has already been approved',
      })
    }
    const approved = await this.prisma.client.purchaseDraft.updateMany({
      where: { id, status: 'draft' },
      data: { status: 'approved', approvedById: ctx.userId, approvedAt: new Date() },
    })
    if (approved.count === 0) {
      throw new ConflictException({
        code: 'DRAFT_ALREADY_APPROVED',
        message: 'This order has already been approved',
      })
    }
    return this.detail(id)
  }

  async remove(id: string) {
    const row = await this.readOne(id)
    this.assertOpen(row)
    const { count } = await this.prisma.client.purchaseDraft.deleteMany({
      where: { id, status: 'draft' },
    })
    if (count === 0) this.assertOpen({ status: 'approved' } as DraftRow)
    return { ok: true }
  }
}
