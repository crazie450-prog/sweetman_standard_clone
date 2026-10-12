import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, Max, Min } from 'class-validator'
import { COUNT_MAX } from '../validation/numeric'

export const PAGE_LIMIT_DEFAULT = 50
export const PAGE_LIMIT_MAX = 200

export class PageQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: PAGE_LIMIT_MAX, default: PAGE_LIMIT_DEFAULT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_LIMIT_MAX)
  limit: number = PAGE_LIMIT_DEFAULT

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(COUNT_MAX)
  offset: number = 0
}

export interface Page<T> {
  data: T[]
  pagination: { limit: number; offset: number; total: number }
}

export function pageOf<T>(data: T[], total: number, query: PageQuery): Page<T> {
  return { data, pagination: { limit: query.limit, offset: query.offset, total } }
}

export function pageWindow(query: PageQuery): { skip: number; take: number } {
  return { skip: query.offset, take: query.limit }
}
