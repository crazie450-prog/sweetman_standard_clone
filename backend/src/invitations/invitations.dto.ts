import { ApiProperty } from '@nestjs/swagger'
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'
import type { Role } from '../generated/prisma/client'

export const INVITABLE_ROLES: Role[] = ['viewer', 'staff', 'manager', 'admin']

export class CreateInvitationDto {
  @ApiProperty({ example: 'sofia@goldenfork.com' })
  @IsEmail()
  email!: string

  @ApiProperty({ enum: INVITABLE_ROLES, default: 'viewer' })
  @IsIn(INVITABLE_ROLES)
  role!: Role

  @ApiProperty({ type: [String], required: false, description: 'Empty = all locations' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  locationIds?: string[]
}

export class AcceptInvitationDto {
  @ApiProperty({ example: 'Sofia Ricci' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName!: string

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string
}
