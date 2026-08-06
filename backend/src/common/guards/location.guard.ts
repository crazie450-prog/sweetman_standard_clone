import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { TenantContext } from '../../tenancy/tenant-context'

@Injectable()
export class LocationGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ tenant?: TenantContext }>()
    const tenant = req.tenant
    if (!tenant) return true
    if (tenant.isPlatformAdmin) return true

    if (tenant.locationId) {
      const location = await this.prisma.client.location.findFirst({
        where: { id: tenant.locationId },
        select: { id: true },
      })
      if (!location) throw new ForbiddenException('Unknown location')
    }

    if (tenant.role === 'owner' || tenant.role === 'admin') return true

    const assignments = await this.prisma.client.userLocation.findMany({
      where: { userId: tenant.userId },
      select: { locationId: true },
    })

    const restrictedToAssignedLocations = assignments.length > 0
    if (!restrictedToAssignedLocations) return true

    tenant.assignedLocationIds = assignments.map((a) => a.locationId)

    if (tenant.locationId && !tenant.assignedLocationIds.includes(tenant.locationId)) {
      throw new ForbiddenException('No access to this location')
    }
    return true
  }
}
