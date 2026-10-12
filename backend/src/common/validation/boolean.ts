import { applyDecorators } from '@nestjs/common'
import { Transform } from 'class-transformer'
import { IsBoolean } from 'class-validator'

/* ===== A switch that is on or off ===== */

export function StrictBoolean() {
  return applyDecorators(
    Transform(({ obj, key }) => (obj as Record<string, unknown>)[key]),
    IsBoolean(),
  )
}
