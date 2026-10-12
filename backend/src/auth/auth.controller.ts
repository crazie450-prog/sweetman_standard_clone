import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response, Request } from 'express'
import { Req } from '@nestjs/common'
import { AuthService } from './auth.service'
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from './dto/auth.dto'
import { AttemptsPerMinute } from './rate-limit'
import { AuthCookies, REFRESH_COOKIE } from './cookies'
import { Public } from '../common/decorators/public.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { TenantContext } from '../tenancy/tenant-context'

@ApiTags('auth')
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
  ) {}

  @Public()
  @Post('register')
  @AttemptsPerMinute(5)
  @ApiOperation({
    summary: 'Onboarding: creates the organization, its owner and a default location',
  })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.auth.register(dto, req.get('user-agent'))
    this.cookies.set(res, tokens.accessToken, tokens.refreshToken)
    return this.auth.me(user.id)
  }

  @Public()
  @Post('login')
  @AttemptsPerMinute(20)
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in; sets the httpOnly cookies' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.auth.login(dto.email, dto.password, req.get('user-agent'))
    this.cookies.set(res, tokens.accessToken, tokens.refreshToken)
    return this.auth.me(user.id)
  }

  @Public()
  @Get('refresh')
  @ApiOperation({ summary: 'Silent refresh: rotates the access/refresh pair' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]
    if (!token)
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_MISSING',
        message: 'No refresh token',
      })
    const tokens = await this.auth.refresh(token, req.get('user-agent'))
    this.cookies.set(res, tokens.accessToken, tokens.refreshToken)
    return { ok: true }
  }

  @Post('logout')
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Sign out on this device; other devices stay signed in' })
  async logout(
    @CurrentUser() user: TenantContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]
    await this.auth.logout(user.userId, token)
    this.cookies.clear(res)
    return { ok: true }
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Current user: role and accessible locations' })
  me(@CurrentUser() user: TenantContext) {
    return this.auth.me(user.userId)
  }

  @Patch('me')
  @AttemptsPerMinute(10)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Own profile: name and email' })
  updateProfile(@CurrentUser() user: TenantContext, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user.userId, dto)
  }

  @Post('change-password')
  @AttemptsPerMinute(10)
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Change own password; this session stays signed in and every other one is ended',
  })
  changePassword(
    @CurrentUser() user: TenantContext,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]
    return this.auth.changePassword(user.userId, dto.currentPassword, dto.newPassword, token)
  }

  @Public()
  @Post('forgot-password')
  @AttemptsPerMinute(5)
  @HttpCode(200)
  @ApiOperation({ summary: 'Password reset email (the response is always identical)' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email)
    return { ok: true }
  }

  @Public()
  @Post('reset-password')
  @AttemptsPerMinute(10)
  @HttpCode(200)
  @ApiOperation({ summary: 'Reset the password using the emailed token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password)
    return { ok: true }
  }
}
