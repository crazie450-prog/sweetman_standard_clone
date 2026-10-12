import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { StrictBoolean } from '../../../common/validation/boolean'
import { TrimmedName } from '../../../common/validation/trimmed'
import { Quantity, Rate } from '../../../common/validation/numeric'

export class CreateIngredientDto {
  @ApiProperty({ example: 'Beef Tenderloin' })
  @TrimmedName(120)
  name!: string

  @ApiProperty({ example: 'kg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  unit!: string

  @ApiProperty({ example: 38.5, minimum: 0 })
  @Rate()
  costPerUnit!: number

  @ApiPropertyOptional({
    minimum: 0,
    default: 0,
    description:
      'Opening balance at the location in the header, recorded as a count; refused with no location',
  })
  @IsOptional()
  @Quantity()
  onHand?: number

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Quantity()
  reorderLevel?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendorId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sku?: string

  @ApiPropertyOptional({ description: "The vendor's own code, held per location" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  vendorSku?: string
}
export class UpdateIngredientDto extends PartialType(OmitType(CreateIngredientDto, ['onHand']), {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({ description: 'false = archive, true = restore to active' })
  @IsOptional()
  @StrictBoolean()
  isActive?: boolean
}
