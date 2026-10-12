import { ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsTimeZone,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import { TrimmedName } from '../../../common/validation/trimmed'

const CURRENCIES = ['USD', 'EUR', 'GBP']
const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']

export class UpdateOrganizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @TrimmedName(120)
  name?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  state?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  zipCode?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(56)
  country?: string

  @ApiPropertyOptional({
    description: 'IANA timezone; days, weeks and months in reports are counted in it',
  })
  @IsOptional()
  @IsTimeZone()
  @MaxLength(64)
  timezone?: string

  @ApiPropertyOptional({ enum: CURRENCIES })
  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: string

  @ApiPropertyOptional({ enum: DATE_FORMATS })
  @IsOptional()
  @IsIn(DATE_FORMATS)
  dateFormat?: string
  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  foodCostTargetPct?: number
}
