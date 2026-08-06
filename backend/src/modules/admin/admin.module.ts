import { Controller, Get, Injectable, Module, UseGuards } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { PrismaService } from '../../prisma/prisma.service'
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard'

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async organizations() {
    const orgs = await this.prisma.client.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { locations: true, users: true } } },
    })
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      locations: o._count.locations,
      users: o._count.users,
      status: o.subscriptionStatus,
      trialEndsAt: o.trialEndsAt?.toISOString() ?? null,
      created: o.createdAt.toISOString(),
    }))
  }
}

@ApiTags('admin')
@ApiCookieAuth()
@UseGuards(PlatformAdminGuard)
@Controller('api/admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('organizations')
  @ApiOperation({ summary: 'All platform organizations (platform admin)' })
  organizations() {
    return this.admin.organizations()
  }

  @Get('queue')
  @ApiOperation({ summary: 'Document processing queue (AI ingestion lands in Sprint 3)' })
  queue() {
    return []
  }
}

@Module({
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
