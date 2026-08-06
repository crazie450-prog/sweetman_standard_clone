import type { Prisma } from '../generated/prisma/client'

export const MAX_NESTING_DEPTH = 5

export interface CostIngredient {
  quantity: number
  costPerUnit: number
}
export interface CostComponentEdge {
  parentId: string
  componentId: string
  quantity: number
  unit: string
}
export interface CostRecipe {
  id: string
  portions: number
  yieldAmount: number | null
  yieldUnit: string | null
  ingredients: CostIngredient[]
}

export class RecipeCycleError extends Error {
  constructor(public readonly involved: string[]) {
    super(`Recipe graph contains a cycle: ${involved.join(' → ')}`)
  }
}

export function componentContribution(
  component: {
    totalCost: number
    portions: number
    yieldAmount: number | null
    yieldUnit: string | null
  },
  edge: { quantity: number; unit: string },
): number {
  if (
    component.yieldAmount !== null &&
    component.yieldAmount > 0 &&
    component.yieldUnit !== null &&
    component.yieldUnit === edge.unit
  ) {
    return component.totalCost * (edge.quantity / component.yieldAmount)
  }
  return (component.totalCost / Math.max(1, component.portions)) * edge.quantity
}

export function recipeFoodCostPct(
  recipe: { totalCost: number; portions: number },
  menuUsage: { portions: number; price: number }[],
): number | null {
  const perPortion = recipe.totalCost / Math.max(1, recipe.portions)
  const shares = menuUsage
    .filter((u) => u.price > 0)
    .map((u) => ((perPortion * u.portions) / u.price) * 100)
  if (shares.length === 0) return null
  return Math.round((shares.reduce((s, p) => s + p, 0) / shares.length) * 10) / 10
}

export function computeAllCosts(
  recipes: CostRecipe[],
  edges: CostComponentEdge[],
): Map<string, number> {
  const byId = new Map(recipes.map((r) => [r.id, r]))
  const indegree = new Map<string, number>(recipes.map((r) => [r.id, 0]))
  const dependents = new Map<string, CostComponentEdge[]>()
  const componentsOf = new Map<string, CostComponentEdge[]>()

  for (const e of edges) {
    if (!byId.has(e.parentId) || !byId.has(e.componentId)) continue
    indegree.set(e.parentId, (indegree.get(e.parentId) ?? 0) + 1)
    ;(dependents.get(e.componentId) ?? dependents.set(e.componentId, []).get(e.componentId)!).push(
      e,
    )
    ;(componentsOf.get(e.parentId) ?? componentsOf.set(e.parentId, []).get(e.parentId)!).push(e)
  }

  const queue = recipes.filter((r) => (indegree.get(r.id) ?? 0) === 0).map((r) => r.id)
  const costs = new Map<string, number>()
  let processed = 0

  while (queue.length > 0) {
    const id = queue.shift()!
    const recipe = byId.get(id)!
    processed++

    let total = recipe.ingredients.reduce((s, i) => s + i.quantity * i.costPerUnit, 0)
    for (const e of componentsOf.get(id) ?? []) {
      const comp = byId.get(e.componentId)!
      total += componentContribution(
        {
          totalCost: costs.get(e.componentId) ?? 0,
          portions: comp.portions,
          yieldAmount: comp.yieldAmount,
          yieldUnit: comp.yieldUnit,
        },
        e,
      )
    }
    costs.set(id, Math.round(total * 10000) / 10000)

    for (const e of dependents.get(id) ?? []) {
      const d = (indegree.get(e.parentId) ?? 0) - 1
      indegree.set(e.parentId, d)
      if (d === 0) queue.push(e.parentId)
    }
  }

  if (processed < recipes.length) {
    const stuck = recipes.filter((r) => !costs.has(r.id)).map((r) => r.id)
    throw new RecipeCycleError(stuck)
  }
  return costs
}

export function wouldCreateCycle(
  parentId: string,
  componentId: string,
  edges: CostComponentEdge[],
): boolean {
  if (parentId === componentId) return true
  const componentsOf = new Map<string, string[]>()
  for (const e of edges) {
    ;(componentsOf.get(e.parentId) ?? componentsOf.set(e.parentId, []).get(e.parentId)!).push(
      e.componentId,
    )
  }
  const stack = [componentId]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (cur === parentId) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const next of componentsOf.get(cur) ?? []) stack.push(next)
  }
  return false
}

export function depthAfterInsert(
  parentId: string,
  componentId: string,
  edges: CostComponentEdge[],
): number {
  const componentsOf = new Map<string, string[]>()
  for (const e of edges) {
    ;(componentsOf.get(e.parentId) ?? componentsOf.set(e.parentId, []).get(e.parentId)!).push(
      e.componentId,
    )
  }
  ;(componentsOf.get(parentId) ?? componentsOf.set(parentId, []).get(parentId)!).push(componentId)

  const memo = new Map<string, number>()
  const depth = (id: string, trail: Set<string>): number => {
    if (trail.has(id)) return Infinity
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    const kids = componentsOf.get(id) ?? []
    trail.add(id)
    const d = kids.length === 0 ? 0 : 1 + Math.max(...kids.map((k) => depth(k, trail)))
    trail.delete(id)
    memo.set(id, d)
    return d
  }
  const allIds = new Set<string>([...componentsOf.keys()])
  for (const kids of componentsOf.values()) for (const k of kids) allIds.add(k)
  let max = 0
  for (const id of allIds) max = Math.max(max, depth(id, new Set()))
  return max
}

export function toCostRecipes(
  rows: {
    id: string
    portions: number
    yieldAmount: Prisma.Decimal | null
    yieldUnit: string | null
    ingredients: { quantity: Prisma.Decimal; ingredient: { costPerUnit: Prisma.Decimal } }[]
  }[],
): CostRecipe[] {
  return rows.map((r) => ({
    id: r.id,
    portions: r.portions,
    yieldAmount: r.yieldAmount === null ? null : r.yieldAmount.toNumber(),
    yieldUnit: r.yieldUnit,
    ingredients: r.ingredients.map((i) => ({
      quantity: i.quantity.toNumber(),
      costPerUnit: i.ingredient.costPerUnit.toNumber(),
    })),
  }))
}
