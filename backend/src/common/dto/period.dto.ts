import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'
import { PageQuery } from './pagination.dto'

export class PeriodQuery {
  @ApiPropertyOptional({ example: '2026-08-01', description: 'First day of the period' })
  @IsOptional()
  @IsString()
  from?: string

  @ApiPropertyOptional({ example: '2026-08-31', description: 'Last day of the period' })
  @IsOptional()
  @IsString()
  to?: string
}

export class PagedPeriodQuery extends PageQuery {
  @ApiPropertyOptional({ example: '2026-08-01', description: 'First day of the period' })
  @IsOptional()
  @IsString()
  from?: string

  @ApiPropertyOptional({ example: '2026-08-31', description: 'Last day of the period' })
  @IsOptional()
  @IsString()
  to?: string
}
