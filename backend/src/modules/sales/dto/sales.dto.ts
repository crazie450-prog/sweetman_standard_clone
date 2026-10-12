import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { Count, Money } from '../../../common/validation/numeric'
import { PagedPeriodQuery } from '../../../common/dto/period.dto'
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'

export class SaleItemInput {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  menuItemId!: string

  @ApiProperty({ minimum: 1 })
  @Count()
  quantity!: number
}

export class CreateSaleDto {
  @ApiPropertyOptional({ description: 'ISO date; empty = now' })
  @IsOptional()
  @IsISO8601()
  date?: string

  @ApiProperty({ type: [SaleItemInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleItemInput)
  items!: SaleItemInput[]
}

export class SaleLinesQuery extends PagedPeriodQuery {
  @ApiPropertyOptional({ enum: ['date', 'total'], default: 'date' })
  @IsOptional()
  @IsIn(['date', 'total'])
  sort: 'date' | 'total' = 'date'

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir: 'asc' | 'desc' = 'desc'

  @ApiPropertyOptional({ description: 'Lines worth at least this much' })
  @IsOptional()
  @Money()
  minTotal?: number

  @ApiPropertyOptional({ description: 'Lines worth at most this much' })
  @IsOptional()
  @Money()
  maxTotal?: number
}
