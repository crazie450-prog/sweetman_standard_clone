import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { requireLocation, requireTenant } from '../../tenancy/tenant-context'
import { money, num } from '../../common/utils/decimal'
import { assertBuiltHere, componentMeasure } from '../../rules/recipes'
import { recordedAt, statedPeriod } from '../../common/utils/calendar'
import { zoneHere } from '../../tenancy/organization-zone'
import { conversionRules } from '../../costing/costing.service'
import { componentShare } from '../../costing/costing.core'
import { CreateProductionDto } from './dto/production.dto'
import { pageOf, pageWindow } from '../../common/dto/pagination.dto'
import type { PagedPeriodQuery, PeriodQuery } from '../../common/dto/period.dto'

type BatchRecipe = {
  id: string
  name: string
  portions: number
  yieldAmount: Parameters<typeof num>[0] | null
  yieldUnit: string | null
}

@Injectable()
export class ProductionService {
  constructor(private readonly prisma: PrismaService) {}

  async batches(query: PagedPeriodQuery) {
    const where = { date: statedPeriod(query.from, query.to, await zoneHere(this.prisma)) }
    const [rows, total] = await Promise.all([
      this.prisma.client.production.findMany({
        where,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
        include: { recipe: { select: { name: true } } },
      }),
      this.prisma.client.production.count({ where }),
    ])
    return pageOf(
      rows.map((p) => ({
        id: p.id,
        recipe: p.recipe.name,
        qty: `${num(p.quantity)} ${p.unit}`,
        madeBy: p.madeBy ?? '',
        date: p.date.toISOString(),
        cost: num(p.cost),
      })),
      total,
      query,
    )
  }

  async summary(query: PeriodQuery) {
    const where = { date: statedPeriod(query.from, query.to, await zoneHere(this.prisma)) }
    const [totals, recipes] = await Promise.all([
      this.prisma.client.production.aggregate({ where, _sum: { cost: true }, _count: true }),
      this.prisma.client.production.groupBy({ by: ['recipeId'], where }),
    ])
    const cost = num(totals._sum.cost ?? 0)
    return {
      batches: totals._count,
      cost: money(cost),
      average: totals._count ? money(cost / totals._count) : 0,
      recipes: recipes.length,
    }
  }

  private async shareOf(recipe: BatchRecipe, quantity: number, unit: string): Promise<number> {
    const measured = {
      name: recipe.name,
      portions: recipe.portions,
      yieldAmount: recipe.yieldAmount === null ? null : num(recipe.yieldAmount),
      yieldUnit: recipe.yieldUnit,
    }
    const rules = (await conversionRules(this.prisma.client))(undefined, recipe.id)
    const refusal = componentMeasure(measured, unit.trim(), rules)
    if (refusal) throw new BadRequestException({ code: 'COMPONENT_UNIT_INVALID', message: refusal })
    return componentShare(measured, { quantity, unit: unit.trim() }, rules)
  }

  async create(dto: CreateProductionDto) {
    const ctx = requireTenant()
    const locationId = requireLocation()
    const recipe = await this.prisma.client.recipe.findUnique({ where: { id: dto.recipeId } })
    if (!recipe)
      throw new BadRequestException({ code: 'UNKNOWN_RECIPE', message: 'Unknown recipeId' })
    assertBuiltHere('a batch', locationId, [recipe])
    const cost = money(num(recipe.totalCost) * (await this.shareOf(recipe, dto.quantity, dto.unit)))
    const madeBy =
      dto.madeBy?.trim() ||
      (
        await this.prisma.client.user.findUnique({
          where: { id: ctx.userId },
          select: { fullName: true },
        })
      )?.fullName
    return this.prisma.client.production.create({
      data: {
        organizationId: ctx.organizationId,
        locationId,
        recipeId: dto.recipeId,
        quantity: dto.quantity,
        unit: dto.unit,
        cost,
        madeBy,
        date: recordedAt(dto.date, await zoneHere(this.prisma)),
      },
    })
  }
}
