import type { IncomingMessage } from 'node:http'
import type { TenantContext } from '../tenancy/tenant-context'
import { appEnv, setting, type Source } from '../config/integrations'

export const LOG_REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["stripe-signature"]',
  'res.headers["set-cookie"]',
]

export function logBase(env: Source) {
  const version = setting(env, 'APP_VERSION') || undefined
  return { service: 'nexus-api', environment: appEnv(env), ...(version ? { version } : {}) }
}

export function logProps(req: IncomingMessage) {
  const tenant = (req as IncomingMessage & { tenant?: TenantContext }).tenant
  if (!tenant) return {}
  return {
    organizationId: tenant.organizationId,
    userId: tenant.userId,
    ...(tenant.locationId ? { locationId: tenant.locationId } : {}),
  }
}
