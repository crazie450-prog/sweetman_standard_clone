import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator'
import { Factor } from '../../../common/validation/numeric'

export class CreateUnitConversionDto {
  @ApiPropertyOptional({ description: 'Empty applies the rule to every ingredient' })
  @IsOptional()
  @IsString()
  ingredientId?: string

  @ApiPropertyOptional({
    description:
      'Applies the rule inside this recipe only, ahead of the ingredient rules and the shared ones',
  })
  @IsOptional()
  @IsString()
  recipeId?: string

  @ApiProperty({ example: 'ea' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  fromUnit!: string

  @ApiProperty({ example: 'kg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  toUnit!: string

  @ApiProperty({ example: 0.05, description: 'One fromUnit equals this many toUnit' })
  @Factor()
  @IsPositive()
  factor!: number
}

export class UpdateUnitConversionDto extends PartialType(CreateUnitConversionDto, {
  skipNullProperties: false,
}) {}
