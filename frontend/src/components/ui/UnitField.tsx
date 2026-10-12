'use client'

import { SelectField, type SelectFieldProps } from './Field'
import { unitsReachableFrom, useUnitConversions, useUnits } from '@/lib/api/useUnits'

export interface UnitFieldProps extends Omit<SelectFieldProps, 'options'> {
  pricedIn?: string
  ingredientId?: string
  recipeIds?: string[]
  extraOptions?: { value: string; label: string }[]
}

export function UnitField({
  pricedIn,
  ingredientId,
  recipeIds,
  extraOptions = [],
  ...rest
}: UnitFieldProps) {
  const catalogue = useUnits()
  const conversions = useUnitConversions()
  const options = unitsReachableFrom(catalogue, pricedIn, conversions, ingredientId, recipeIds).map(
    (u) => ({
      value: u.value,
      label: `${u.label} (${u.value})`,
    })
  )
  const offered = [...options, ...extraOptions]

  const current = typeof rest.value === 'string' ? rest.value : ''
  if (current && !offered.some((o) => o.value === current)) {
    offered.unshift({ value: current, label: current })
  }

  return <SelectField {...rest} options={offered} />
}
