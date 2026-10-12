import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { RECORD_NAME_MAX, TrimmedName } from '../../../common/validation/trimmed'
import { Count, Quantity } from '../../../common/validation/numeric'

export class RecipeIngredientInput {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  ingredientId!: string

  @ApiProperty({ minimum: 0.001 })
  @Quantity(0.001)
  quantity!: number

  @ApiProperty({ example: 'kg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  unit!: string

  @ApiPropertyOptional({ example: 'diced' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  prepNote?: string
}

export class CreateRecipeDto {
  @ApiProperty({ example: 'Beef Wellington' })
  @TrimmedName(RECORD_NAME_MAX)
  name!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Count()
  portions?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string

  @ApiPropertyOptional({ description: 'Recipe location; empty = every location' })
  @IsOptional()
  @IsString()
  locationId?: string

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999.99)
  targetFoodCostPct?: number

  @ApiPropertyOptional({
    description:
      'What one batch makes, with yieldUnit; lets a parent take a share by weight or volume',
    minimum: 0,
  })
  @IsOptional()
  @Quantity()
  yieldAmount?: number | null

  @ApiPropertyOptional({ example: 'l' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  yieldUnit?: string | null

  @ApiPropertyOptional({ type: [RecipeIngredientInput] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientInput)
  ingredients?: RecipeIngredientInput[]
}
export class UpdateRecipeDto extends PartialType(CreateRecipeDto, { skipNullProperties: false }) {}

export class AddComponentDto {
  @ApiProperty({ description: 'Id of the component recipe' })
  @IsString()
  @IsNotEmpty()
  componentId!: string

  @ApiProperty({ minimum: 0.001 })
  @Quantity(0.001)
  quantity!: number

  @ApiProperty({
    example: 'kg',
    description: 'portion, or a unit that converts to the yield the component recipe states',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  unit!: string

  @ApiPropertyOptional({ example: 'cooled to room temp' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  prepNote?: string
}

export class UpdateComponentDto extends PartialType(
  PickType(AddComponentDto, ['quantity', 'unit', 'prepNote'] as const),
  { skipNullProperties: false },
) {}
