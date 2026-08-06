import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class RegisterDto {
  @ApiProperty({ example: 'The Golden Fork Group' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  organizationName!: string

  @ApiProperty({ example: 'Alex Morgan' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
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
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName?: string

  @ApiPropertyOptional({ example: 'alex@goldenfork.com' })
  @IsOptional()
  @IsEmail()
  email?: string
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'Current password — proof the request comes from the account owner' })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string
}
