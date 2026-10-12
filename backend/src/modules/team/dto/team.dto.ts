import { ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayUnique, IsArray, IsIn, IsOptional, IsString } from 'class-validator'
import { INVITABLE_ROLES } from '../../../invitations/invitations.dto'
import type { Role } from '../../../generated/prisma/client'

export class UpdateMemberDto {
  @ApiPropertyOptional({ enum: INVITABLE_ROLES })
  @IsOptional()
  @IsIn(INVITABLE_ROLES)
  role?: Role

  @ApiPropertyOptional({ type: [String], description: 'An empty array means every location' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  locationIds?: string[]
}
