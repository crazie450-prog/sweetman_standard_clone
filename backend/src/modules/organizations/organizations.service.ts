import { ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { changesHere, requireTenant } from '../../tenancy/tenant-context'
import { UpdateOrganizationDto } from './dto/organizations.dto'

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async current() {
    const ctx = requireTenant()
    const [org, owner] = await Promise.all([
      this.prisma.client.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } }),
      this.prisma.client.user.findFirst({
        where: { organizationId: ctx.organizationId, role: 'owner' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { fullName: true, email: true },
      }),
    ])
    return {
      id: org.id,
      name: org.name,
      ownerName: owner?.fullName ?? org.ownerName ?? '',
      ownerEmail: owner?.email ?? org.ownerEmail,
      phone: org.phone ?? '',
      address: org.address ?? '',
      city: org.city ?? '',
      state: org.state ?? '',
      zipCode: org.zipCode ?? '',
      country: org.country,
      timezone: org.timezone,
      currency: org.currency,
      dateFormat: org.dateFormat,
      foodCostTargetPct: Number(org.foodCostTargetPct),
      subscriptionStatus: org.subscriptionStatus,
      trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
    }
  }

  async update(dto: UpdateOrganizationDto) {
    const ctx = requireTenant()
    if (!changesHere(null)) {
      throw new ForbiddenException({
        code: 'LOCATION_ACCESS_REQUIRED',
        message: 'Organization settings are changed by someone who works at every location',
      })
    }
    await this.prisma.client.organization.update({
      where: { id: ctx.organizationId },
      data: dto,
    })
    return this.current()
  }
}
