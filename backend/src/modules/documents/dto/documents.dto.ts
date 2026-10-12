import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'
import { StrictBoolean } from '../../../common/validation/boolean'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { StrictId, TrimmedName } from '../../../common/validation/trimmed'
import { PageQuery } from '../../../common/dto/pagination.dto'
import { Factor } from '../../../common/validation/numeric'

export const DOCUMENT_TYPES = ['invoice', 'recipe', 'menu', 'sales'] as const
export const DOCUMENT_STATUSES = [
  'queued',
  'processing',
  'requires_review',
  'confirmed',
  'partially_processed',
  'failed',
] as const

export class DocumentsTypeQuery {
  @ApiPropertyOptional({ enum: DOCUMENT_TYPES, description: 'Only documents of this type' })
  @IsOptional()
  @IsIn(DOCUMENT_TYPES as unknown as string[])
  type?: (typeof DOCUMENT_TYPES)[number]
}

export class DocumentsQuery extends PageQuery {
  @ApiPropertyOptional({ enum: DOCUMENT_TYPES, description: 'Only documents of this type' })
  @IsOptional()
  @IsIn(DOCUMENT_TYPES as unknown as string[])
  type?: (typeof DOCUMENT_TYPES)[number]

  @ApiPropertyOptional({ enum: DOCUMENT_STATUSES, description: 'Only documents in this state' })
  @IsOptional()
  @IsIn(DOCUMENT_STATUSES as unknown as string[])
  status?: (typeof DOCUMENT_STATUSES)[number]
}

export class IngredientAliasDto {
  @ApiProperty({ example: 'AP FLOUR 25LB' })
  @TrimmedName(200)
  rawName!: string

  @ApiPropertyOptional({ description: 'The ingredient the name reads as' })
  @IsOptional()
  @StrictId()
  ingredientId?: string
}

export class IngredientAliasTargetDto {
  @ApiPropertyOptional({ nullable: true, description: 'Empty or null unbinds the name' })
  @IsOptional()
  @StrictId()
  ingredientId?: string | null
}

export class MenuItemAliasDto {
  @ApiProperty({ example: 'POS BURGER LG' })
  @TrimmedName(200)
  rawName!: string

  @ApiPropertyOptional({ description: 'The menu item the name reads as' })
  @IsOptional()
  @StrictId()
  menuItemId?: string
}

export class MenuItemAliasTargetDto {
  @ApiPropertyOptional({ nullable: true, description: 'Empty or null unbinds the name' })
  @IsOptional()
  @StrictId()
  menuItemId?: string | null
}

export class NameMappingDto {
  @ApiProperty()
  @TrimmedName(200)
  rawName!: string

  @ApiProperty()
  @StrictId()
  @IsNotEmpty()
  ingredientId!: string
}

class EditedDocumentDto {
  @IsString()
  @MaxLength(40)
  id!: string

  @IsObject()
  payload!: Record<string, unknown>
}

export class ConfirmManyDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  ids!: string[]

  @IsOptional()
  @StrictBoolean()
  createMissing?: boolean

  @IsOptional()
  @ValidateNested()
  @Type(() => EditedDocumentDto)
  edited?: EditedDocumentDto
}

class AddedIngredientDto {
  @ApiProperty()
  @TrimmedName(200)
  name!: string

  @ApiProperty({ example: 'kg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit!: string
}

class FileConversionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @StrictId()
  ingredientId?: string

  @ApiPropertyOptional({ description: 'An ingredient added in the same request, by name' })
  @IsOptional()
  @TrimmedName(200)
  name?: string

  @ApiProperty({ example: 'cup' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  fromUnit!: string

  @ApiProperty({
    example: 0.15,
    description: 'One fromUnit equals this many of the ingredient unit',
  })
  @Factor()
  @IsPositive()
  factor!: number
}

export class FileUnitsDto {
  @ApiPropertyOptional({ type: [AddedIngredientDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AddedIngredientDto)
  ingredients?: AddedIngredientDto[]

  @ApiPropertyOptional({ type: [FileConversionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => FileConversionDto)
  conversions?: FileConversionDto[]
}
