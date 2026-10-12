import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { ArrayUnique, IsArray, IsOptional, IsString, MaxLength } from 'class-validator'
import { StrictBoolean } from '../../../common/validation/boolean'
import { RECORD_NAME_MAX, TrimmedName } from '../../../common/validation/trimmed'

export class CreateMenuDto {
  @ApiProperty({ example: 'Dinner' })
  @TrimmedName(RECORD_NAME_MAX)
  name!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @StrictBoolean()
  isActive?: boolean

  @ApiPropertyOptional({ type: [String], description: 'Locations that serve this menu' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  locationIds?: string[]

  @ApiPropertyOptional({ type: [String], description: 'Menu items included, in order' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  menuItemIds?: string[]
}
export class UpdateMenuDto extends PartialType(CreateMenuDto, { skipNullProperties: false }) {}
