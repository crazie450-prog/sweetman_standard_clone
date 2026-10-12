import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import { TrimmedName } from '../../../common/validation/trimmed'

export class CreateVendorDto {
  @ApiProperty({ example: 'Prime Meats Co.' })
  @TrimmedName(120)
  name!: string

  @ApiPropertyOptional({ example: 'orders@primemeats.com' })
  @IsOptional()
  @IsEmail()
  contact?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string

  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive'

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}
export class UpdateVendorDto extends PartialType(CreateVendorDto, { skipNullProperties: false }) {}
