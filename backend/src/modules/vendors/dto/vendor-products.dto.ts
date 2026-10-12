import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator'
import { StrictBoolean } from '../../../common/validation/boolean'
import { TrimmedName } from '../../../common/validation/trimmed'

export class CreateVendorProductDto {
  @ApiProperty({ example: 'DD BUTTER UNSALTED 1LB' })
  @TrimmedName(160)
  name!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  vendorId!: string

  @ApiPropertyOptional({ description: 'The code this vendor prints on its paperwork' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  sku?: string

  @ApiPropertyOptional({ description: 'The ingredient this product is received as' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  ingredientId?: string | null

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @StrictBoolean()
  isActive?: boolean
}
export class UpdateVendorProductDto extends PartialType(CreateVendorProductDto, {
  skipNullProperties: false,
}) {}
