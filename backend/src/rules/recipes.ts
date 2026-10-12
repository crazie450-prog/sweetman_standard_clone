import { BadRequestException } from '@nestjs/common'
import { bridgedConversion, type IngredientConversion } from '../costing/units'

export type KitchenPart = { name: string; locationId: string | null }

export function assertBuiltHere(what: string, at: string | null, parts: KitchenPart[]) {
  const foreign = [
    ...new Set(
      parts.filter((p) => p.locationId !== null && p.locationId !== at).map((p) => p.name),
    ),
  ]
  if (foreign.length === 0) return
  throw new BadRequestException({
    code: 'RECIPE_OF_OTHER_LOCATION',
    message: `${foreign.join(', ')} ${foreign.length === 1 ? 'is a recipe' : 'are recipes'} of another location; ${what} can only be built on recipes for all locations or for its own location`,
  })
}

export function isPortionUnit(unit: string): boolean {
  const stated = unit.trim().toLowerCase()
  return stated === 'portion' || stated === 'portions'
}

export function componentMeasure(
  component: { name: string; yieldAmount: number | null; yieldUnit: string | null },
  unit: string,
  rules: IngredientConversion[],
): string | null {
  if (isPortionUnit(unit)) return null
  const { yieldAmount, yieldUnit } = component
  if (yieldAmount === null || yieldAmount <= 0 || !yieldUnit) {
    return `${component.name} states no yield in ${unit}; add it in portions, or state what one batch of ${component.name} makes first`
  }
  if (bridgedConversion(1, unit, yieldUnit, rules) !== null) return null
  return `${component.name} yields ${yieldAmount} ${yieldUnit}, and ${unit} does not convert to it; use a unit of the same kind or portions`
}
