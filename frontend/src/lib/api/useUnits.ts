'use client'

import { useQuery } from '@tanstack/react-query'
import type { UnitConversion, UnitDescriptor } from './types'
import { queries } from '@/lib/api/queries'

export function useUnits() {
  const { data } = useQuery({
    ...queries.units(),
    staleTime: Infinity,
  })
  return data ?? []
}

export function useUnitConversions() {
  const { data } = useQuery(queries.unitConversions())
  return data ?? []
}

export function unitsReachableFrom(
  catalogue: UnitDescriptor[],
  unit: string | undefined,
  rules: UnitConversion[] = [],
  ingredientId?: string,
  recipeIds: string[] = []
) {
  const anchor = catalogue.find((u) => u.value === unit)
  if (!anchor) return catalogue

  const applicable = rules.filter(
    (r) =>
      (r.ingredientId === null || r.ingredientId === ingredientId) &&
      (r.recipeId === null || recipeIds.includes(r.recipeId))
  )
  const dimensions = new Set([anchor.dimension])
  for (let widened = true; widened;) {
    widened = false
    for (const rule of applicable) {
      const from = catalogue.find((u) => u.value === rule.fromUnit)?.dimension
      const to = catalogue.find((u) => u.value === rule.toUnit)?.dimension
      if (!from || !to) continue
      if (dimensions.has(from) && !dimensions.has(to)) {
        dimensions.add(to)
        widened = true
      }
      if (dimensions.has(to) && !dimensions.has(from)) {
        dimensions.add(from)
        widened = true
      }
    }
  }
  return catalogue.filter((u) => dimensions.has(u.dimension))
}

export function convertWithin(
  catalogue: UnitDescriptor[],
  quantity: number,
  from: string,
  to: string
): number | null {
  if (from === to) return quantity
  const left = catalogue.find((u) => u.value === from)
  const right = catalogue.find((u) => u.value === to)
  if (!left || !right || left.dimension !== right.dimension) return null
  return (quantity * left.perBase) / right.perBase
}
