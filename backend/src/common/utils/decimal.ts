import type { Prisma } from '../../generated/prisma/client'

export type Numeric = Prisma.Decimal | number | null | undefined

export function num(value: Numeric): number {
  if (value === null || value === undefined) return 0
  return typeof value === 'number' ? value : value.toNumber()
}

export function numOrNull(value: Numeric): number | null {
  if (value === null || value === undefined) return null
  return typeof value === 'number' ? value : value.toNumber()
}

export function rounded(value: number, places: number): number {
  if (!Number.isFinite(value)) return value
  const [digits, exponent = '0'] = Math.abs(value).toPrecision(15).split('e')
  const scaled = Math.round(Number(`${digits}e${Number(exponent) + places}`))
  return scaled === 0 ? 0 : Math.sign(value) * Number(`${scaled}e-${places}`)
}

export function money(value: number): number {
  return rounded(value, 2)
}

export function rate(value: number): number {
  return rounded(value, 4)
}

export function percent(part: number, whole: number): number | null {
  return whole > 0 ? rounded((part / whole) * 100, 1) : null
}
