import { PrismaService } from '../prisma/prisma.service'
import { isZone, UTC } from '../common/utils/calendar'
import { requireTenant } from './tenant-context'

export async function zoneOf(prisma: PrismaService, organizationId: string): Promise<string> {
  const organization = await prisma.client.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  })
  return organization && isZone(organization.timezone) ? organization.timezone : UTC
}

export function zoneHere(prisma: PrismaService): Promise<string> {
  return zoneOf(prisma, requireTenant().organizationId)
}
