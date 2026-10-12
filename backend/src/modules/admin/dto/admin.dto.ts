import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import { StrictBoolean } from '../../../common/validation/boolean'
import type { SubscriptionStatus } from '../../../generated/prisma/client'
import { PageQuery } from '../../../common/dto/pagination.dto'
import { DOCUMENT_STATUSES } from '../../documents/dto/documents.dto'

const SUBSCRIPTION_STATUSES = ['trial', 'active', 'past_due', 'canceled'] as const

export class UpdateAdminOrganizationDto {
  @ApiProperty({ description: 'false signs every member out and refuses their next sign-in' })
  @StrictBoolean()
  isActive!: boolean
}

export class UpdateAdminUserDto {
  @ApiPropertyOptional({ description: 'false signs the account out everywhere' })
  @IsOptional()
  @StrictBoolean()
  isActive?: boolean

  @ApiPropertyOptional({ description: 'true clears a lockout left by failed sign-ins' })
  @IsOptional()
  @StrictBoolean()
  unlock?: boolean
}

export class AdminOrganizationsQuery extends PageQuery {
  @ApiPropertyOptional({ enum: SUBSCRIPTION_STATUSES })
  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUSES)
  status?: SubscriptionStatus

  @ApiPropertyOptional({ description: 'Matches the organization name or the owner email' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string
}

export class AdminUsersQuery extends PageQuery {
  @ApiPropertyOptional({ description: 'Part of an email or a name' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string
}

export class AdminQueueQuery extends PageQuery {
  @ApiPropertyOptional({ enum: DOCUMENT_STATUSES, description: 'Only jobs in this state' })
  @IsOptional()
  @IsIn(DOCUMENT_STATUSES as unknown as string[])
  status?: (typeof DOCUMENT_STATUSES)[number]
}
