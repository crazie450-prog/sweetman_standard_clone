import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { InvitationsService } from './invitations.service'
import { AcceptInvitationDto, CreateInvitationDto } from './invitations.dto'
import { Roles } from '../common/decorators/roles.decorator'
import { AttemptsPerMinute } from '../auth/rate-limit'
import { Public } from '../common/decorators/public.decorator'
import { AuthService } from '../auth/auth.service'
import { AuthCookies } from '../auth/cookies'

@ApiTags('invitations')
@Controller('api/invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
  ) {}

  @Get()
  @Roles('manager')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Pending invitations of the organization' })
  list() {
    return this.invitations.list()
  }

  @Post()
  @Roles('manager')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Invite a user (sends a tokenized email)' })
  create(@Body() dto: CreateInvitationDto) {
    return this.invitations.create(dto)
  }

  @Post(':id/resend')
  @Roles('manager')
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Resend an invitation (issues a new token and expiry)' })
  resend(@Param('id') id: string) {
    return this.invitations.resend(id)
  }

  @Delete(':id')
  @Roles('manager')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Revoke an invitation' })
  revoke(@Param('id') id: string) {
    return this.invitations.revoke(id)
  }

  @Public()
  @Get(':token')
  @ApiOperation({ summary: 'Invitation details for the acceptance screen' })
  preview(@Param('token') token: string) {
    return this.invitations.preview(token)
  }

  @Public()
  @Post(':token/accept')
  @AttemptsPerMinute(10)
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept an invitation: creates the account and signs the user in' })
  async accept(
    @Param('token') token: string,
    @Body() dto: AcceptInvitationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.invitations.accept(token, dto)
    const { tokens } = await this.auth.login(user.email, dto.password)
    this.cookies.set(res, tokens.accessToken, tokens.refreshToken)
    return this.auth.me(user.id)
  }
}
