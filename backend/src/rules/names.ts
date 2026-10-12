import { ConflictException } from '@nestjs/common'
import { lockKey } from '../common/utils/serialize'

export function sameName(name: string) {
  return { equals: name.trim(), mode: 'insensitive' as const }
}

export function besides(id: string | undefined) {
  return id ? { id: { not: id } } : {}
}

export function named(name: string, except?: string) {
  return { name: sameName(name), ...besides(except) }
}

export function refuseTaken(noun: string, name: string): never {
  throw new ConflictException({
    code: 'NAME_TAKEN',
    message: `${/^[aeiou]/i.test(noun) ? 'An' : 'A'} ${noun} named ${name} already exists`,
  })
}

export function refuseTakenInKitchen(
  what: string,
  name: string,
  location: { name: string } | null,
): never {
  throw new ConflictException({
    code: 'NAME_TAKEN',
    message: `${name.trim()} is already ${what} ${location ? `at ${location.name}` : 'of the whole organization'}`,
  })
}

export function sameKitchen(locationId: string | null) {
  return locationId ? { OR: [{ locationId }, { locationId: null }] } : {}
}

export const catalogueLock = (organizationId: string, vendorId: string) =>
  lockKey('vendor-catalogue', organizationId, vendorId)

export const ingredientAliasLock = (organizationId: string, name: string) =>
  lockKey('ingredient-alias', organizationId, name)

export const nameLock = (kind: string, organizationId: string, name: string | undefined) =>
  name === undefined ? [] : [lockKey(kind, organizationId, name)]

export const salesAliasLock = (organizationId: string, name: string) =>
  lockKey('sales-alias', organizationId, name)

export const recipeGraphLock = (organizationId: string) => lockKey('recipe-graph', organizationId)

export const unitRulesLock = (organizationId: string) => lockKey('unit-rules', organizationId)

export const dishPlaceLock = (organizationId: string, menuItemId: string) =>
  lockKey('dish-place', organizationId, menuItemId)

export const menuShapeLock = (organizationId: string) => lockKey('menu-shape', organizationId)
