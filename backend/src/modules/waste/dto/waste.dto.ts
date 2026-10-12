import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'
import { Quantity } from '../../../common/validation/numeric'
import { WASTE_REASONS } from '../reasons'

export class CreateWasteEntryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  ingredientId!: string

  @ApiProperty({ minimum: 0.001 })
  @Type(() => Number)
  @IsNumber()
  @Quantity(0.001)
  quantity!: number

  @ApiProperty({ enum: WASTE_REASONS.map((r) => r.value) })
  @IsIn(WASTE_REASONS.map((r) => r.value))
  reason!: string

  @ApiPropertyOptional({ description: 'Defaults to the unit the ingredient is counted in' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  unit?: string

  @ApiPropertyOptional({ description: 'ISO date; empty = now' })
  @IsOptional()
  @IsISO8601()
  date?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string
}
