import { Prisma } from '../generated/prisma/client'
import { currentTenant } from './tenant-context'

export const TENANT_MODELS = new Set<string>([
  'Location',
  'User',
  'Invitation',
  'Vendor',
  'Category',
  'Ingredient',
  'InventoryTransaction',
  'Recipe',
  'MenuItem',
  'Menu',
  'Sale',
  'Production',
  'WasteEntry',
  'IngredientPriceHistory',
  'Invoice',
  'Document',
  'Extraction',
  'IngredientAlias',
  'MenuItemAlias',
  'UnitConversion',
  'VendorProduct',
  'PurchaseDraft',
  'BillingEvent',
])

/* ===== Models that carry no organizationId of their own ===== */

export const CHILD_MODELS = new Map<string, string>([
  ['IngredientLocationSettings', 'ingredient'],
  ['IngredientLocationStock', 'ingredient'],
  ['Instruction', 'recipe'],
  ['InvoiceItem', 'invoice'],
  ['MenuItemOnMenu', 'menu'],
  ['MenuItemRecipe', 'menuItem'],
  ['MenuOnLocation', 'menu'],
  ['PurchaseDraftLine', 'draft'],
  ['RecipeComponent', 'parent'],
  ['RecipeIngredient', 'recipe'],
  ['RecipeSection', 'recipe'],
  ['SaleItem', 'sale'],
  ['UserLocation', 'user'],
  ['UserSession', 'user'],
])

export const TENANT_ROOT = 'Organization'

export const LOCATION_STRICT = new Set<string>([
  'InventoryTransaction',
  'Sale',
  'Production',
  'WasteEntry',
  'Invoice',
  'Document',
  'PurchaseDraft',
])
const LOCATION_SHARED = new Set<string>(['Recipe', 'MenuItem'])

const LIST_OPS = new Set(['findMany', 'count', 'aggregate', 'groupBy'])

/* ===== Reaching one row by id, or changing rows in bulk ===== */

const REACH_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
])

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
        if (!ctx || ctx.platformScope || !TENANT_MODELS.has(model)) {
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

        const reachable = LIST_OPS.has(operation) || REACH_OPS.has(operation)
        if (locationScope) {
          if (LOCATION_STRICT.has(model) && reachable) {
            a.where = { ...(a.where ?? {}), locationId: locationScope }
          } else if (LOCATION_SHARED.has(model) && LIST_OPS.has(operation)) {
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
