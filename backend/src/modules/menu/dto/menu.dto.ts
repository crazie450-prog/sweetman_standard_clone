import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'
import { StrictBoolean } from '../../../common/validation/boolean'
import { RECORD_NAME_MAX, TrimmedName } from '../../../common/validation/trimmed'
import { Money, Portions } from '../../../common/validation/numeric'

export class MenuItemRecipeInput {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  recipeId!: string

  @ApiPropertyOptional({ default: 1, minimum: 0.001 })
  @IsOptional()
  @Portions()
  portions?: number
}

export class CreateMenuItemDto {
  @ApiProperty({ example: 'Beef Wellington (for two)' })
  @TrimmedName(RECORD_NAME_MAX)
  name!: string

  @ApiProperty({ minimum: 0 })
  @Money()
  price!: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string

  @ApiPropertyOptional({ description: 'Item location; empty = every location' })
  @IsOptional()
  @IsString()
  locationId?: string

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @StrictBoolean()
  isActive?: boolean

  @ApiPropertyOptional({ type: [MenuItemRecipeInput] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuItemRecipeInput)
  recipes?: MenuItemRecipeInput[]

  @ApiPropertyOptional({
    type: [String],
    description: 'The menus the item is on; replaces the list when given',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  menuIds?: string[]
}
export class UpdateMenuItemDto extends PartialType(CreateMenuItemDto, {
  skipNullProperties: false,
}) {}
