import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { AsyncLocalStorage } from 'node:async_hooks'

export interface TenantContext {
  organizationId: string
  locationId: string | null
  userId: string
  role: 'viewer' | 'staff' | 'manager' | 'admin' | 'owner'
  isPlatformAdmin: boolean
  assignedLocationIds?: string[]
  platformScope?: boolean
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>()

export function currentTenant(): TenantContext | null {
  return tenantStorage.getStore() ?? null
}

export function requireTenant(): TenantContext {
  const ctx = tenantStorage.getStore()
  if (!ctx) {
    throw new Error(
      'Tenant context is missing: a route without TenantMiddleware is reading tenant data',
    )
  }
  return ctx
}

export function withPlatformScope<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = requireTenant()
  if (!ctx.isPlatformAdmin) {
    throw new ForbiddenException({
      code: 'PLATFORM_ADMIN_ONLY',
      message: 'Only a platform administrator works across organizations',
    })
  }
  return tenantStorage.run({ ...ctx, platformScope: true }, fn)
}

export function outsideTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.exit(async () => await fn())
}

export function worksAt(locationId: string | null): boolean {
  const assigned = requireTenant().assignedLocationIds ?? []
  return assigned.length === 0 || locationId === null || assigned.includes(locationId)
}

export function changesHere(locationId: string | null): boolean {
  const assigned = requireTenant().assignedLocationIds ?? []
  return assigned.length === 0 || (locationId !== null && assigned.includes(locationId))
}

export function assertChangesHere(locationId: string | null | undefined, what: string) {
  if (changesHere(locationId ?? null)) return
  throw new ForbiddenException({
    code: 'LOCATION_ACCESS_REQUIRED',
    message: locationId
      ? `${what} can only be changed at a location you work at`
      : `${what} shared by every location is added and changed only by someone who works at all of them`,
  })
}

export function reachedLocations(): string[] | null {
  const ctx = requireTenant()
  if (ctx.locationId) return [ctx.locationId]
  return ctx.assignedLocationIds?.length ? ctx.assignedLocationIds : null
}

export function assertReaches(locationIds: string[]) {
  const assigned = requireTenant().assignedLocationIds ?? []
  if (assigned.length === 0) return
  if (locationIds.length === 0 || locationIds.some((id) => !assigned.includes(id))) {
    throw new ForbiddenException({
      code: 'LOCATION_ACCESS_REQUIRED',
      message: 'You manage people only at the locations you work at',
    })
  }
}

export function assertWorksAt(locationId: string | null | undefined, what: string) {
  if (!worksAt(locationId ?? null)) {
    throw new ForbiddenException({
      code: 'LOCATION_ACCESS_REQUIRED',
      message: `${what} can only be filed at a location you work at`,
    })
  }
}

export function withoutActiveLocation<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ ...requireTenant(), locationId: null }, async () => await fn())
}

export function acrossLocations<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = currentTenant()
  if (!ctx) return fn()
  return tenantStorage.run(
    { ...ctx, locationId: null, assignedLocationIds: [] },
    async () => await fn(),
  )
}

export function requireLocation(): string {
  const { locationId } = requireTenant()
  if (!locationId) {
    throw new BadRequestException({
      code: 'LOCATION_REQUIRED',
      message:
        'Select a restaurant location first: "All locations" is a consolidated view, and a record that belongs to no location belongs to nobody',
    })
  }
  return locationId
}
