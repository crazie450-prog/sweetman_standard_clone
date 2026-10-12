import { BadRequestException } from '@nestjs/common'
import type { TenantScopedClient } from '../prisma/prisma.service'

type Lookup = (client: TenantScopedClient, ids: string[]) => Promise<{ id: string }[]>

const LOOKUPS = {
  categoryId: (client, ids) =>
    client.category.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  vendorId: (client, ids) =>
    client.vendor.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  ingredientId: (client, ids) =>
    client.ingredient.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  recipeId: (client, ids) =>
    client.recipe.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  menuItemId: (client, ids) =>
    client.menuItem.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  menuId: (client, ids) =>
    client.menu.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  locationId: (client, ids) =>
    client.location.findMany({ where: { id: { in: ids } }, select: { id: true } }),
} satisfies Record<string, Lookup>

export type ReferenceKey = keyof typeof LOOKUPS

export type References = Partial<Record<ReferenceKey, string | string[] | null | undefined>>

export async function assertReferencesOwned(
  client: TenantScopedClient,
  refs: References,
): Promise<void> {
  for (const [key, value] of Object.entries(refs) as [ReferenceKey, References[ReferenceKey]][]) {
    const ids = [...new Set((Array.isArray(value) ? value : [value]).filter(isId))]
    if (ids.length === 0) continue

    const found = await LOOKUPS[key](client, ids)
    if (found.length !== ids.length) {
      throw new BadRequestException({ code: 'UNKNOWN_REFERENCE', message: `Unknown ${key}` })
    }
  }
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

const KIND_WORDS = { ingredient: 'ingredients', recipe: 'recipes', menu: 'menu items' } as const

export async function assertCategoryKind(
  client: TenantScopedClient,
  categoryId: string | null | undefined,
  kind: keyof typeof KIND_WORDS,
): Promise<void> {
  if (!isId(categoryId)) return
  const category = await client.category.findUnique({
    where: { id: categoryId },
    select: { name: true, kind: true },
  })
  if (category && category.kind !== kind) {
    throw new BadRequestException({
      code: 'CATEGORY_KIND_MISMATCH',
      message: `${category.name} is a category of ${KIND_WORDS[category.kind]}, not of ${KIND_WORDS[kind]}`,
    })
  }
}
