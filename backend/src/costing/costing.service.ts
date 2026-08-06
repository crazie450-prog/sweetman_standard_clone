import { BadRequestException, Injectable, Module } from '@nestjs/common'
import { PrismaService, TenantScopedClient } from '../prisma/prisma.service'
import {
  computeAllCosts,
  depthAfterInsert,
  MAX_NESTING_DEPTH,
  toCostRecipes,
  wouldCreateCycle,
} from './costing.core'

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
  ): Promise<void> {
    if (parentId === componentId) {
      throw new BadRequestException('A recipe cannot contain itself')
    }
    const edges = await this.prisma.client.recipeComponent.findMany({
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
      throw new BadRequestException(
        'Adding this component would create a circular recipe relationship',
      )
    }
    const depth = depthAfterInsert(parentId, componentId, plain)
    if (depth > MAX_NESTING_DEPTH) {
      throw new BadRequestException(
        `Nesting too deep: ${depth} levels (maximum ${MAX_NESTING_DEPTH})`,
      )
    }
  }
}

export async function recalcOrganizationWith(
  client: TenantScopedClient,
  organizationId: string,
): Promise<number> {
  const [recipes, edges] = await Promise.all([
    client.recipe.findMany({
      where: { organizationId },
      select: {
        id: true,
        portions: true,
        yieldAmount: true,
        yieldUnit: true,
        totalCost: true,
        ingredients: {
          select: { quantity: true, ingredient: { select: { costPerUnit: true } } },
        },
      },
    }),
    client.recipeComponent.findMany({
      where: { parent: { organizationId } },
      select: { parentId: true, componentId: true, quantity: true, unit: true },
    }),
  ])

  const costs = computeAllCosts(
    toCostRecipes(recipes),
    edges.map((e) => ({
      parentId: e.parentId,
      componentId: e.componentId,
      quantity: e.quantity.toNumber(),
      unit: e.unit,
    })),
  )

  const changed = recipes.filter((r) => {
    const next = costs.get(r.id)
    return next !== undefined && Math.abs(next - r.totalCost.toNumber()) > 1e-9
  })
  if (changed.length > 0) {
    await client.$transaction(
      changed.map((r) =>
        client.recipe.update({
          where: { id: r.id },
          data: { totalCost: costs.get(r.id)! },
        }),
      ),
    )
  }
  return changed.length
}

@Module({
  providers: [CostingService],
  exports: [CostingService],
})
export class CostingModule {}
