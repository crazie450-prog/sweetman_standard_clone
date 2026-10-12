import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { TeamService } from './team.service'
import { UpdateMemberDto } from './dto/team.dto'

@ApiTags('team')
@ApiCookieAuth()
@Controller('api/users')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @Roles('manager')
  @ApiOperation({
    summary:
      'Team members and pending invitations (locations={id,name}[]); an invitation past its expiry is listed as expired',
  })
  list() {
    return this.team.list()
  }

  @Patch(':id')
  @Roles('manager')
  @ApiOperation({ summary: 'Change a member role or their location access' })
  update(@Param('id') id: string, @Body() dto: UpdateMemberDto) {
    return this.team.update(id, dto)
  }

  @Post(':id/password-reset')
  @Roles('manager')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Issue a password reset for a member of this organization; the link is returned when no mail provider is connected',
  })
  resetPassword(@Param('id') id: string) {
    return this.team.resetPassword(id)
  }

  @Delete(':id')
  @Roles('manager')
  @ApiOperation({ summary: 'Deactivate a member; the account stays and can be re-enabled' })
  deactivate(@Param('id') id: string) {
    return this.team.deactivate(id)
  }

  @Post(':id/reactivate')
  @Roles('manager')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Re-enable a deactivated member with the role and locations they had',
  })
  reactivate(@Param('id') id: string) {
    return this.team.reactivate(id)
  }
}
