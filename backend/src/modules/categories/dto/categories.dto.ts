import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional } from 'class-validator'
import { CATEGORY_NAME_MAX, TrimmedName } from '../../../common/validation/trimmed'
import type { CategoryKind } from '../../../generated/prisma/client'
import { KINDS } from '../categories.service'

export class CreateCategoryDto {
  @ApiProperty({ example: 'Meat & Poultry' })
  @TrimmedName(CATEGORY_NAME_MAX)
  name!: string

  @ApiPropertyOptional({ enum: KINDS, default: 'ingredient' })
  @IsOptional()
  @IsIn(KINDS as unknown as string[])
  kind?: CategoryKind
}

export class RenameCategoryDto {
  @ApiProperty({ example: 'Sauces & Dressings' })
  @TrimmedName(CATEGORY_NAME_MAX)
  name!: string
}

export class CategoriesQuery {
  @ApiPropertyOptional({ enum: KINDS })
  @IsOptional()
  @IsIn(KINDS as unknown as string[])
  kind?: CategoryKind
}
