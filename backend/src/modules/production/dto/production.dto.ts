import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { Quantity } from '../../../common/validation/numeric'

export class CreateProductionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  recipeId!: string

  @ApiProperty({ minimum: 0.001 })
  @Quantity(0.001)
  quantity!: number

  @ApiProperty({
    example: 'portion',
    description: 'portion, or a unit that converts to the yield the recipe states',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  unit!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  madeBy?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  date?: string
}
