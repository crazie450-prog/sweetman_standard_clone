import { money, percent } from '../common/utils/decimal'
import { componentShare } from './costing.core'
import { bridgedConversion, type IngredientConversion } from './units'

export interface VRecipe {
  id: string
  portions: number
  yieldAmount: number | null
  yieldUnit: string | null
  ingredients: { ingredientId: string; quantity: number; unit?: string }[]
  components: { componentId: string; quantity: number; unit: string }[]
}

export interface VMenuItem {
  id: string
  name: string
  recipes: { recipeId: string; portions: number }[]
}

export interface VIngredient {
  id: string
  costPerUnit: number
  category: string
  unit?: string
}

export type ConversionsFor = (ingredientId?: string, recipeId?: string) => IngredientConversion[]

export interface UsageGraph {
  recipes: VRecipe[]
  menuItems: VMenuItem[]
  sales: { menuItemId: string; quantity: number }[]
  units?: Map<string, string>
  conversions?: ConversionsFor
}

export interface VarianceInput {
  recipes: VRecipe[]
  menuItems: VMenuItem[]
  sales: { menuItemId: string; quantity: number }[]
  actual: { ingredientId: string; cost: number; waste?: boolean }[]
  ingredients: VIngredient[]
  conversions?: ConversionsFor
}

export interface CategoryVariance {
  category: string
  theoretical: number
  actual: number
  variance: number
}

export interface DishVariance {
  menuItemId: string
  name: string
  quantity: number
  standardCost: number
  actualCost: number
  wasteCost: number
  variance: number
}

export interface VarianceReport {
  theoreticalCost: number
  actualCost: number
  variance: number
  variancePct: number | null
  wasteCost: number
  byCategory: CategoryVariance[]
  byDish: DishVariance[]
}

function addInto(target: Map<string, number>, source: Map<string, number>, factor: number) {
  for (const [id, qty] of source) target.set(id, (target.get(id) ?? 0) + qty * factor)
}

function inStockUnit(
  line: { ingredientId: string; quantity: number; unit?: string },
  units: Map<string, string>,
  conversions: ConversionsFor,
  recipeId: string,
): number {
  const stockUnit = units.get(line.ingredientId)
  if (!line.unit || !stockUnit) return line.quantity
  const converted = bridgedConversion(
    line.quantity,
    line.unit,
    stockUnit,
    conversions(line.ingredientId, recipeId),
  )
  return converted ?? line.quantity
}

function expandRecipe(
  recipeId: string,
  byId: Map<string, VRecipe>,
  memo: Map<string, Map<string, number>>,
  path: Set<string>,
  units: Map<string, string>,
  conversions: ConversionsFor,
): Map<string, number> {
  const cached = memo.get(recipeId)
  if (cached) return cached
  const recipe = byId.get(recipeId)
  if (!recipe || path.has(recipeId)) return new Map()

  path.add(recipeId)
  const totals = new Map<string, number>()
  for (const i of recipe.ingredients) {
    const qty = inStockUnit(i, units, conversions, recipeId)
    totals.set(i.ingredientId, (totals.get(i.ingredientId) ?? 0) + qty)
  }
  for (const edge of recipe.components) {
    const comp = byId.get(edge.componentId)
    if (!comp) continue
    const childTotals = expandRecipe(edge.componentId, byId, memo, path, units, conversions)
    const rules = [...conversions(undefined, recipeId), ...conversions(undefined, edge.componentId)]
    addInto(totals, childTotals, componentShare(comp, edge, rules))
  }
  path.delete(recipeId)
  memo.set(recipeId, totals)
  return totals
}

const NO_RULES: ConversionsFor = () => []

export function theoreticalUsage(graph: UsageGraph): {
  total: Map<string, number>
  byDish: Map<string, Map<string, number>>
  soldPerDish: Map<string, number>
} {
  const byId = new Map(graph.recipes.map((r) => [r.id, r]))
  const memo = new Map<string, Map<string, number>>()
  const menuById = new Map(graph.menuItems.map((m) => [m.id, m]))
  const units = graph.units ?? new Map<string, string>()
  const conversions = graph.conversions ?? NO_RULES

  const total = new Map<string, number>()
  const byDish = new Map<string, Map<string, number>>()
  const soldPerDish = new Map<string, number>()
  for (const line of graph.sales) {
    const menu = menuById.get(line.menuItemId)
    if (!menu) continue
    soldPerDish.set(menu.id, (soldPerDish.get(menu.id) ?? 0) + line.quantity)
    const mine = byDish.get(menu.id) ?? new Map<string, number>()
    byDish.set(menu.id, mine)
    for (const mir of menu.recipes) {
      const recipe = byId.get(mir.recipeId)
      if (!recipe) continue
      const batch = expandRecipe(recipe.id, byId, memo, new Set(), units, conversions)
      const perPortionFactor = (mir.portions * line.quantity) / Math.max(1, recipe.portions)
      addInto(total, batch, perPortionFactor)
      addInto(mine, batch, perPortionFactor)
    }
  }
  return { total, byDish, soldPerDish }
}

export function foodCostVariance(input: VarianceInput): VarianceReport {
  const menuById = new Map(input.menuItems.map((m) => [m.id, m]))
  const ingById = new Map(input.ingredients.map((i) => [i.id, i]))
  const units = new Map(
    input.ingredients.filter((i) => i.unit).map((i) => [i.id, i.unit as string]),
  )

  const {
    total: theoreticalQty,
    byDish: dishQty,
    soldPerDish,
  } = theoreticalUsage({
    recipes: input.recipes,
    menuItems: input.menuItems,
    sales: input.sales,
    units,
    conversions: input.conversions,
  })

  const theoreticalByCat = new Map<string, number>()
  let theoreticalCost = 0
  for (const [ingredientId, qty] of theoreticalQty) {
    const ing = ingById.get(ingredientId)
    if (!ing) continue
    const cost = qty * ing.costPerUnit
    theoreticalCost += cost
    theoreticalByCat.set(ing.category, (theoreticalByCat.get(ing.category) ?? 0) + cost)
  }

  const actualByCat = new Map<string, number>()
  const actualByIngredient = new Map<string, number>()
  const wasteByIngredient = new Map<string, number>()
  let actualCost = 0
  let wasteCost = 0
  for (const row of input.actual) {
    const ing = ingById.get(row.ingredientId)
    const category = ing?.category ?? 'Uncategorized'
    actualCost += row.cost
    actualByCat.set(category, (actualByCat.get(category) ?? 0) + row.cost)
    actualByIngredient.set(
      row.ingredientId,
      (actualByIngredient.get(row.ingredientId) ?? 0) + row.cost,
    )
    if (row.waste) {
      wasteCost += row.cost
      wasteByIngredient.set(
        row.ingredientId,
        (wasteByIngredient.get(row.ingredientId) ?? 0) + row.cost,
      )
    }
  }

  const byDish: DishVariance[] = [...dishQty]
    .map(([menuItemId, usage]) => {
      let standardCost = 0
      let dishActual = 0
      let dishWaste = 0
      for (const [ingredientId, qty] of usage) {
        const ing = ingById.get(ingredientId)
        if (ing) standardCost += qty * ing.costPerUnit
        const across = theoreticalQty.get(ingredientId) ?? 0
        if (across <= 0) continue
        const share = qty / across
        dishActual += share * (actualByIngredient.get(ingredientId) ?? 0)
        dishWaste += share * (wasteByIngredient.get(ingredientId) ?? 0)
      }
      const standard = money(standardCost)
      const actual = money(dishActual)
      return {
        menuItemId,
        name: menuById.get(menuItemId)?.name ?? '',
        quantity: soldPerDish.get(menuItemId) ?? 0,
        standardCost: standard,
        actualCost: actual,
        wasteCost: money(dishWaste),
        variance: money(actual - standard),
      }
    })
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))

  const categories = new Set<string>([...theoreticalByCat.keys(), ...actualByCat.keys()])
  const byCategory: CategoryVariance[] = [...categories]
    .map((category) => {
      const theoretical = money(theoreticalByCat.get(category) ?? 0)
      const actual = money(actualByCat.get(category) ?? 0)
      return { category, theoretical, actual, variance: money(actual - theoretical) }
    })
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))

  theoreticalCost = money(theoreticalCost)
  actualCost = money(actualCost)
  const variance = money(actualCost - theoreticalCost)
  return {
    theoreticalCost,
    actualCost,
    variance,
    variancePct: percent(variance, theoreticalCost),
    wasteCost: money(wasteCost),
    byCategory,
    byDish,
  }
}
