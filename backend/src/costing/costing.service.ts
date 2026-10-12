import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService, TenantScopedClient } from '../prisma/prisma.service'
import type { Prisma } from '../generated/prisma/client'
import {
  computeAllCosts,
  depthAfterInsert,
  MAX_NESTING_DEPTH,
  toCostRecipes,
  wouldCreateCycle,
} from './costing.core'
import type { IngredientConversion } from './units'
import { acrossLocations } from '../tenancy/tenant-context'
import { lockKey, serialized, type Serial } from '../common/utils/serialize'

const RECALC_TIMEOUT_MS = 30_000

@Injectable()
export class CostingService {
  constructor(private readonly prisma: PrismaService) {}

  async recalcOrganization(organizationId: string): Promise<number> {
    return recalcOrganizationWith(this.prisma.client, organizationId)
  }

  async assertEdgeAllowed(
    organizationId: string,
    parentId: string,
    componentId: string,
    db: Pick<TenantScopedClient, 'recipeComponent'> = this.prisma.client,
  ): Promise<void> {
    if (parentId === componentId) {
      throw new BadRequestException({
        code: 'RECIPE_CONTAINS_ITSELF',
        message: 'A recipe cannot contain itself',
      })
    }
    const edges = await db.recipeComponent.findMany({
      where: { parent: { organizationId } },
      select: { parentId: true, componentId: true, quantity: true, unit: true },
    })
    const plain = edges.map((e) => ({
      parentId: e.parentId,
      componentId: e.componentId,
      quantity: 0,
      unit: '',
    }))
    if (wouldCreateCycle(parentId, componentId, plain)) {
      throw new BadRequestException({
        code: 'RECIPE_CYCLE',
        message: 'Adding this component would create a circular recipe relationship',
      })
    }
    const depth = depthAfterInsert(parentId, componentId, plain)
    if (depth > MAX_NESTING_DEPTH) {
      throw new BadRequestException({
        code: 'RECIPE_NESTING_TOO_DEEP',
        message: `Nesting too deep: ${depth} levels (maximum ${MAX_NESTING_DEPTH})`,
      })
    }
  }
}

type ConversionRow = {
  ingredientId: string | null
  recipeId?: string | null
  fromUnit: string
  toUnit: string
  factor: Prisma.Decimal
}

export function conversionsFor(rows: ConversionRow[]) {
  const plain = rows.map((r) => ({
    ingredientId: r.ingredientId,
    recipeId: r.recipeId ?? null,
    rule: { fromUnit: r.fromUnit, toUnit: r.toUnit, factor: r.factor.toNumber() },
  }))
  const pick = (recipeId: string | null, ingredientId: string | null) =>
    plain
      .filter((r) => r.recipeId === recipeId && r.ingredientId === ingredientId)
      .map((r) => r.rule)
  return (ingredientId?: string, recipeId?: string): IngredientConversion[] => [
    ...(recipeId && ingredientId ? pick(recipeId, ingredientId) : []),
    ...(recipeId ? pick(recipeId, null) : []),
    ...(ingredientId ? pick(null, ingredientId) : []),
    ...pick(null, null),
  ]
}

export type RulesFor = ReturnType<typeof conversionsFor>

export function measuringRules(rulesFor: RulesFor, parentId: string, componentId: string) {
  return [...rulesFor(undefined, parentId), ...rulesFor(undefined, componentId)]
}

export async function conversionRules(
  db: Pick<TenantScopedClient, 'unitConversion'>,
  organizationId?: string,
): Promise<RulesFor> {
  return conversionsFor(
    await db.unitConversion.findMany({
      where: organizationId ? { organizationId } : undefined,
      select: { ingredientId: true, recipeId: true, fromUnit: true, toUnit: true, factor: true },
    }),
  )
}

export function recalcOrganizationWith(
  client: TenantScopedClient,
  organizationId: string,
): Promise<number> {
  return acrossLocations(() => recalcAll(client, organizationId))
}

async function recalcAll(client: TenantScopedClient, organizationId: string): Promise<number> {
  return serialized(
    client,
    lockKey('recalc', organizationId),
    (tx) => recalcWithin(tx, organizationId),
    {
      timeout: RECALC_TIMEOUT_MS,
      lockWait: RECALC_TIMEOUT_MS - 10_000,
    },
  )
}

async function recalcWithin(client: Serial, organizationId: string): Promise<number> {
  const [recipes, edges, rulesFor] = await Promise.all([
    client.recipe.findMany({
      where: { organizationId },
      select: {
        id: true,
        portions: true,
        yieldAmount: true,
        yieldUnit: true,
        totalCost: true,
        ingredients: {
          select: {
            quantity: true,
            unit: true,
            ingredientId: true,
            ingredient: { select: { costPerUnit: true, unit: true } },
          },
        },
      },
    }),
    client.recipeComponent.findMany({
      where: { parent: { organizationId } },
      select: { parentId: true, componentId: true, quantity: true, unit: true },
    }),
    conversionRules(client, organizationId),
  ])

  const costs = computeAllCosts(
    toCostRecipes(recipes, rulesFor),
    edges.map((e) => ({
      parentId: e.parentId,
      componentId: e.componentId,
      quantity: e.quantity.toNumber(),
      unit: e.unit,
    })),
    (parentId, componentId) => measuringRules(rulesFor, parentId, componentId),
  )

  const changed = recipes.filter((r) => {
    const next = costs.get(r.id)
    return next !== undefined && Math.abs(next - r.totalCost.toNumber()) > 1e-9
  })
  for (const r of changed) {
    await client.recipe.update({
      where: { id: r.id },
      data: { totalCost: costs.get(r.id)! },
    })
  }
  return changed.length
}
