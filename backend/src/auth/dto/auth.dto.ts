import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator'
import { TrimmedName } from '../../common/validation/trimmed'

export class RegisterDto {
  @ApiProperty({ example: 'The Golden Fork Group' })
  @TrimmedName(120)
  organizationName!: string

  @ApiProperty({ example: 'Alex Morgan' })
  @TrimmedName(120)
  fullName!: string

  @ApiProperty({ example: 'owner@goldenfork.com' })
  @IsEmail()
  email!: string

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string
}

export class LoginDto {
  @ApiProperty({ example: 'owner@goldenfork.com' })
  @IsEmail()
  email!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email!: string
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token!: string

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Alex Morgan' })
  @IsOptional()
  @TrimmedName(120)
  fullName?: string

  @ApiPropertyOptional({ example: 'alex@goldenfork.com' })
  @IsOptional()
  @IsEmail()
  email?: string

  @ApiPropertyOptional({ description: 'Required when the email changes' })
  @ValidateIf((dto: UpdateProfileDto) => dto.email !== undefined)
  @IsString()
  @IsNotEmpty({ message: 'currentPassword is required to change the sign-in email' })
  @MaxLength(128)
  currentPassword?: string
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'Current password: proof the request comes from the account owner' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword!: string

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string
}
