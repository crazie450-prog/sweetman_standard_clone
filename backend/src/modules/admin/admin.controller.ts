import {
  Body,
  Controller,
  Inject,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { appEnv, integrations } from '../../config/integrations'
import type { AppConfig } from '../../config/env.validation'
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard'
import { NameMappingDto } from '../documents/dto/documents.dto'
import type { ExtractionPayload } from '../documents/extraction'
import { AdminService } from './admin.service'
import {
  UpdateAdminOrganizationDto,
  UpdateAdminUserDto,
  AdminOrganizationsQuery,
  AdminQueueQuery,
  AdminUsersQuery,
} from './dto/admin.dto'

@ApiTags('admin')
@ApiCookieAuth()
@UseGuards(PlatformAdminGuard)
@Controller('api/admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    @Inject(ConfigService) private readonly config: AppConfig,
  ) {}

  @Get('organizations')
  @ApiOperation({
    summary:
      'Platform organizations, newest first, a page at a time; status and q narrow them (platform admin)',
  })
  organizations(@Query() query: AdminOrganizationsQuery) {
    return this.admin.organizations(query)
  }

  @Get('organizations/:id')
  @ApiOperation({
    summary:
      'One organization with its subscription, locations, users and document counts (platform admin)',
  })
  organization(@Param('id') id: string) {
    return this.admin.organization(id)
  }

  @Patch('organizations/:id')
  @ApiOperation({
    summary:
      'Deactivate or reactivate an organization; deactivating signs every member out (platform admin)',
  })
  updateOrganization(@Param('id') id: string, @Body() dto: UpdateAdminOrganizationDto) {
    return this.admin.updateOrganization(id, dto)
  }

  @Get('users')
  @ApiOperation({
    summary: 'Find accounts across every organization, a page at a time (platform admin)',
  })
  users(@Query() query: AdminUsersQuery) {
    return this.admin.users(query)
  }

  @Patch('users/:id')
  @ApiOperation({
    summary: 'Deactivate, reactivate or unlock an account in any organization (platform admin)',
  })
  updateUser(@Param('id') id: string, @Body() dto: UpdateAdminUserDto) {
    return this.admin.updateUser(id, dto)
  }

  @Post('users/:id/password-reset')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Issue a password reset for an account in any organization; the link is returned when no mail provider is connected (platform admin)',
  })
  resetUserPassword(@Param('id') id: string) {
    return this.admin.resetUserPassword(id)
  }

  @Get('integrations')
  @ApiOperation({
    summary:
      'Which provider each outside service runs on, a stand-in or the real one, without any key (platform admin)',
  })
  integrations() {
    return { environment: appEnv(this.config), services: integrations(this.config) }
  }

  @Get('queue')
  @ApiOperation({
    summary:
      'Document processing queue across all organizations, latest first, a page at a time (platform admin)',
  })
  queue(@Query() query: AdminQueueQuery) {
    return this.admin.queue(query)
  }

  @Get('queue/summary')
  @ApiOperation({
    summary: 'How many jobs stand in each state across every organization (platform admin)',
  })
  queueSummary() {
    return this.admin.queueSummary()
  }

  @Get('queue/state')
  @ApiOperation({ summary: 'Background queue counters, delayed jobs included (platform admin)' })
  queueState() {
    return this.admin.queueState()
  }

  @Get('queue/:id')
  @ApiOperation({
    summary:
      'One job with the values extracted from it and its processing attempts (platform admin)',
  })
  job(@Param('id') id: string) {
    return this.admin.job(id)
  }

  @Post('queue/:id/retry')
  @ApiOperation({ summary: 'Re-queue a failed document (platform admin)' })
  retry(@Param('id') id: string) {
    return this.admin.retry(id)
  }

  @Patch('queue/:id/extraction')
  @ApiOperation({ summary: 'Correct the extracted values a tenant will review (platform admin)' })
  saveExtraction(@Param('id') id: string, @Body('payload') payload: ExtractionPayload) {
    return this.admin.saveExtraction(id, payload)
  }

  @Post('queue/:id/map')
  @ApiOperation({ summary: 'Map a name on this document to one of the tenant ingredients' })
  mapName(@Param('id') id: string, @Body() dto: NameMappingDto) {
    return this.admin.mapName(id, dto.rawName, dto.ingredientId)
  }
}
