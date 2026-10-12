import { Body, Controller, Get, Patch } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { OrganizationsService } from './organizations.service'
import { UpdateOrganizationDto } from './dto/organizations.dto'

@ApiTags('organization')
@ApiCookieAuth()
@Controller('api')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get('organizations/current')
  @ApiOperation({ summary: 'Organization profile (Settings)' })
  current() {
    return this.orgs.current()
  }

  @Patch('organizations/current')
  @Roles('admin')
  @ApiOperation({ summary: 'Save the organization settings' })
  update(@Body() dto: UpdateOrganizationDto) {
    return this.orgs.update(dto)
  }
}
