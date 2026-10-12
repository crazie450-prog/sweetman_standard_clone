import { rounded } from '../common/utils/decimal'
import { theoreticalUsage, type UsageGraph } from './variance'

export interface StockedIngredient {
  id: string
  unit: string
  onHand: number
  reorderLevel: number
  reorderQty: number
}

export interface RecordedMovement {
  ingredientId: string
  quantity: number
  waste: boolean
  receipt?: boolean
}

export interface ConsumptionInput extends UsageGraph {
  days: number
  horizon: number
  ingredients: StockedIngredient[]
  movements: RecordedMovement[]
}

export type UsageBasis = 'sales' | 'usage' | 'waste' | 'receipts' | 'none'

export interface Recommendation {
  ingredientId: string
  unit: string
  onHand: number
  reorderLevel: number
  salesQty: number
  useQty: number
  wasteQty: number
  receivedQty: number
  basis: UsageBasis
  dailyRate: number
  coverDays: number | null
  suggested: number
}

export const DAYS_MIN = 7
export const DAYS_MAX = 90
export const HORIZON_MIN = 1
export const HORIZON_MAX = 60

const round3 = (n: number) => rounded(n, 3)
const round9 = (n: number) => Math.round(n * 1e9) / 1e9

export function recommendPurchases(input: ConsumptionInput): Recommendation[] {
  const units = new Map(input.ingredients.map((i) => [i.id, i.unit]))
  const { total: sales } = theoreticalUsage({ ...input, units })

  const used = new Map<string, number>()
  const wasted = new Map<string, number>()
  const received = new Map<string, number>()
  for (const m of input.movements) {
    const target = m.receipt ? received : m.waste ? wasted : used
    target.set(m.ingredientId, (target.get(m.ingredientId) ?? 0) + Math.abs(m.quantity))
  }

  const rows: Recommendation[] = []
  for (const ing of input.ingredients) {
    const salesQty = sales.get(ing.id) ?? 0
    const useQty = used.get(ing.id) ?? 0
    const wasteQty = wasted.get(ing.id) ?? 0
    const receivedQty = received.get(ing.id) ?? 0
    const consumed = Math.max(salesQty, useQty)
    const basis: UsageBasis =
      consumed > 0
        ? salesQty >= useQty
          ? 'sales'
          : 'usage'
        : receivedQty > wasteQty
          ? 'receipts'
          : wasteQty > 0
            ? 'waste'
            : 'none'
    const dailyRate =
      (consumed > 0 ? consumed + wasteQty : Math.max(wasteQty, receivedQty)) / input.days
    const coverDays = dailyRate > 0 ? ing.onHand / dailyRate : null

    let suggested = Math.ceil(
      Math.max(0, round9(dailyRate * input.horizon + ing.reorderLevel - ing.onHand)),
    )
    if (suggested > 0 && ing.reorderQty > 0) suggested = Math.max(suggested, ing.reorderQty)

    rows.push({
      ingredientId: ing.id,
      unit: ing.unit,
      onHand: round3(ing.onHand),
      reorderLevel: round3(ing.reorderLevel),
      salesQty: round3(salesQty),
      useQty: round3(useQty),
      wasteQty: round3(wasteQty),
      receivedQty: round3(receivedQty),
      basis,
      dailyRate: round3(dailyRate),
      coverDays: coverDays === null ? null : Math.round(coverDays * 10) / 10,
      suggested: round3(suggested),
    })
  }

  return rows
    .filter((r) => r.suggested > 0)
    .sort((a, b) => {
      const ca = a.coverDays ?? Number.POSITIVE_INFINITY
      const cb = b.coverDays ?? Number.POSITIVE_INFINITY
      return ca - cb || b.suggested - a.suggested
    })
}
