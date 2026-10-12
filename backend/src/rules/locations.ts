import { BadRequestException, ForbiddenException } from '@nestjs/common'
import type { TenantScopedClient } from '../prisma/prisma.service'

export const ARCHIVED_LOCATION =
  'This location is archived; restore it under Settings, Property Management before recording anything there'

type Locations = Pick<TenantScopedClient, 'location'>

export function locationOrder() {
  return [{ isDefault: 'desc' as const }, { name: 'asc' as const }]
}

export function throughLocationOrder() {
  return locationOrder().map((location) => ({ location }))
}

async function archived(client: Locations, value: string | string[] | null | undefined) {
  const ids = [...new Set((Array.isArray(value) ? value : [value]).filter((v): v is string => !!v))]
  if (ids.length === 0) return false
  const active = await client.location.count({ where: { id: { in: ids }, isActive: true } })
  return active !== ids.length
}

export async function assertLocationsActive(
  client: Locations,
  value: string | string[] | null | undefined,
): Promise<void> {
  if (await archived(client, value))
    throw new BadRequestException({ code: 'LOCATION_ARCHIVED', message: ARCHIVED_LOCATION })
}

export async function assertLocationOpen(
  client: Locations,
  locationId: string | null,
): Promise<void> {
  if (await archived(client, locationId))
    throw new ForbiddenException({ code: 'LOCATION_ARCHIVED', message: ARCHIVED_LOCATION })
}

export async function soleLocation(
  client: Locations,
  organizationId?: string,
): Promise<string | null> {
  const open = await client.location.findMany({
    where: { isActive: true, ...(organizationId ? { organizationId } : {}) },
    select: { id: true },
    take: 2,
  })
  return open.length === 1 ? open[0].id : null
}
