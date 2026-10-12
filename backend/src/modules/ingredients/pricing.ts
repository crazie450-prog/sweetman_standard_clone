import { num, rate, type Numeric } from '../../common/utils/decimal'

export type PricedAtLocation = {
  costPerUnit: Numeric
  perLocation?: { costPerUnit: Numeric }[]
}

export type SourcedAtLocation = {
  vendorId?: string | null
  perLocation?: { vendorId?: string | null }[]
}

export function locationSelect(locationId: string | null | undefined) {
  return {
    where: { locationId: locationId ?? '' },
    select: { costPerUnit: true, vendorId: true },
  }
}

export function costHere(ingredient: PricedAtLocation): number {
  const own = ingredient.perLocation?.[0]?.costPerUnit
  return num(own ?? ingredient.costPerUnit)
}

export function vendorHere(ingredient: SourcedAtLocation): string | null {
  return ingredient.perLocation?.[0]?.vendorId ?? ingredient.vendorId ?? null
}

export function settingsHere(locationId: string | null | undefined) {
  return {
    where: { locationId: locationId ?? '' },
    include: { vendor: { select: { name: true } } },
  }
}

export function deliveryPrice(cost: number, received: number, stated = 0): number | null {
  const unitPrice = received > 0 ? rate(cost / received) : rate(stated)
  return unitPrice > 0 ? unitPrice : null
}
