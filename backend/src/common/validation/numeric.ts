import { applyDecorators } from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsInt, IsNumber, Max, Min } from 'class-validator'

/* ===== Ceilings the columns themselves impose ===== */

export const MONEY_MAX = 9_999_999_999.99
export const RATE_MAX = 99_999_999.9999
export const QUANTITY_MAX = 999_999_999.999
export const FACTOR_MAX = 9_999_999_999
export const PORTIONS_MAX = 99_999.999
export const COUNT_MAX = 2_147_483_647

function bounded(max: number, min: number) {
  return applyDecorators(
    Type(() => Number),
    IsNumber(),
    Min(min),
    Max(max),
  )
}

export function Money(min = 0) {
  return bounded(MONEY_MAX, min)
}

export function Rate(min = 0) {
  return bounded(RATE_MAX, min)
}

export function Quantity(min = 0) {
  return bounded(QUANTITY_MAX, min)
}

export function Factor() {
  return bounded(FACTOR_MAX, 0.00000001)
}

export function Portions() {
  return bounded(PORTIONS_MAX, 0.001)
}

export function Count(min = 1) {
  return applyDecorators(
    Type(() => Number),
    IsInt(),
    Min(min),
    Max(COUNT_MAX),
  )
}
