import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import { StrictBoolean } from '../../../common/validation/boolean'
import { TrimmedName } from '../../../common/validation/trimmed'

export class CreateLocationDto {
  @ApiProperty({ example: 'Golden Fork — Downtown' })
  @TrimmedName(120)
  name!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string
}
export class UpdateLocationDto extends PartialType(CreateLocationDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({ description: 'false = archive, true = restore to active' })
  @IsOptional()
  @StrictBoolean()
  isActive?: boolean
}
