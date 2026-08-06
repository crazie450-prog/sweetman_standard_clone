import { BadRequestException } from '@nestjs/common'
import { AsyncLocalStorage } from 'node:async_hooks'

export interface TenantContext {
  organizationId: string
  locationId: string | null
  userId: string
  role: 'viewer' | 'staff' | 'manager' | 'admin' | 'owner'
  isPlatformAdmin: boolean
  assignedLocationIds?: string[]
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>()

export function currentTenant(): TenantContext | null {
  return tenantStorage.getStore() ?? null
}

export function requireTenant(): TenantContext {
  const ctx = tenantStorage.getStore()
  if (!ctx) {
    throw new Error(
      'Tenant context is missing — a route without TenantMiddleware is reading tenant data',
    )
  }
  return ctx
}

export function requireLocation(): string {
  const { locationId } = requireTenant()
  if (!locationId) {
    throw new BadRequestException(
      'Select a restaurant location first: "All locations" is a consolidated view, and a record that belongs to no location belongs to nobody',
    )
  }
  return locationId
}
