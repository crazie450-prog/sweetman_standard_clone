import { Prisma } from '../generated/prisma/client'
import { currentTenant } from './tenant-context'

const TENANT_MODELS = new Set<string>([
  'Location',
  'User',
  'Invitation',
  'Vendor',
  'Category',
  'Ingredient',
  'InventoryTransaction',
  'Recipe',
  'MenuItem',
  'Sale',
  'Production',
  'WasteEntry',
  'IngredientPriceHistory',
  'Invoice',
])

const LOCATION_STRICT = new Set<string>([
  'InventoryTransaction',
  'Sale',
  'Production',
  'WasteEntry',
  'Invoice',
])
const LOCATION_SHARED = new Set<string>(['Recipe', 'MenuItem'])

const LIST_OPS = new Set(['findMany', 'count', 'aggregate', 'groupBy'])

const WHERE_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
])

const DATA_OPS = new Set(['create', 'createMany'])

type AnyArgs = {
  where?: Record<string, unknown>
  data?: unknown
  create?: Record<string, unknown>
} & Record<string, unknown>

function stampData(data: unknown, organizationId: string): unknown {
  if (Array.isArray(data)) return data.map((d) => ({ ...(d as object), organizationId }))
  if (data && typeof data === 'object') return { ...(data as object), organizationId }
  return data
}

export const tenantExtension = Prisma.defineExtension({
  name: 'tenant-isolation',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const ctx = currentTenant()
        if (!ctx || ctx.isPlatformAdmin || !TENANT_MODELS.has(model)) {
          return query(args)
        }

        const a = (args ?? {}) as AnyArgs
        const orgId = ctx.organizationId

        if (WHERE_OPS.has(operation)) {
          a.where = { ...(a.where ?? {}), organizationId: orgId }
        }
        if (DATA_OPS.has(operation)) {
          a.data = stampData(a.data, orgId)
        }

        const locationScope = ctx.locationId
          ? { equals: ctx.locationId }
          : ctx.assignedLocationIds?.length
            ? { in: ctx.assignedLocationIds }
            : null

        if (locationScope && LIST_OPS.has(operation)) {
          if (LOCATION_STRICT.has(model)) {
            a.where = { ...(a.where ?? {}), locationId: locationScope }
          } else if (LOCATION_SHARED.has(model)) {
            const existing = a.where ?? {}
            a.where = {
              ...existing,
              AND: [
                ...(Array.isArray(existing.AND) ? (existing.AND as unknown[]) : []),
                { OR: [{ locationId: locationScope }, { locationId: null }] },
              ],
            }
          }
        }
        if (operation === 'upsert') {
          a.where = { ...(a.where ?? {}), organizationId: orgId }
          if (a.create) a.create = { ...a.create, organizationId: orgId }
        }

        return query(a)
      },
    },
  },
})
