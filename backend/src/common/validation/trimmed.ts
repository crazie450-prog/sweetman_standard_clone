import { applyDecorators } from '@nestjs/common'
import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

const asSent = ({ obj, key }: { obj: unknown; key: string }) =>
  (obj as Record<string, unknown>)[key]

/* ===== A name that identifies a record ===== */

export const RECORD_NAME_MAX = 120
export const CATEGORY_NAME_MAX = 80

export function TrimmedName(maxLength: number) {
  return applyDecorators(
    Transform((params) => {
      const value = asSent(params)
      return typeof value === 'string' ? value.trim() : value
    }),
    IsString(),
    IsNotEmpty(),
    MaxLength(maxLength),
  )
}

/* ===== The id of a record, exactly as sent ===== */

export function StrictId() {
  return applyDecorators(Transform(asSent), IsString(), MaxLength(64))
}
