import type { Ingredient, MenuItem } from '../../generated/prisma/client'
import { serialized, type Serial } from '../../common/utils/serialize'
import type { TenantScopedClient } from '../../prisma/prisma.service'
import { catalogueLock, ingredientAliasLock, salesAliasLock } from '../../rules/names'
import { splitPrep } from './prep'

type Reader = Pick<
  Serial,
  'vendorProduct' | 'ingredient' | 'ingredientAlias' | 'menuItem' | 'menuItemAlias'
>

export const key = (text: string) => text.trim().toLowerCase()

export function spellings(text: string): string[] {
  const word = key(text)
  const out = [word]
  if (/[^aeiou]ies$/.test(word)) out.push(word.replace(/ies$/, 'y'))
  else if (/(ch|sh|x|ss|z|o)es$/.test(word)) out.push(word.slice(0, -2))
  else if (/[^s]s$/.test(word)) out.push(word.slice(0, -1))
  else if (/[^aeiou]y$/.test(word)) out.push(word.replace(/y$/, 'ies'))
  else if (/(ch|sh|x|ss|z|o)$/.test(word)) out.push(`${word}es`)
  else out.push(`${word}s`)
  return out
}

function spelledAs<T>(map: Map<string, T>, text: string): T | undefined {
  for (const spelling of spellings(text)) {
    const found = map.get(spelling)
    if (found) return found
  }
  return undefined
}

export const anyOf = (texts: Iterable<string>) => {
  const wanted = [...new Set([...texts].map((t) => t.trim()).filter(Boolean))]
  return { in: wanted, mode: 'insensitive' as const }
}

function keyed<T>(rows: T[], keyOf: (row: T) => string | null | undefined) {
  const out = new Map<string, T>()
  for (const row of rows) {
    const k = keyOf(row)
    if (k && !out.has(key(k))) out.set(key(k), row)
  }
  return out
}

export class IngredientBook {
  private constructor(
    private readonly byCode: Map<string, Ingredient>,
    private readonly byProduct: Map<string, Ingredient>,
    private readonly byName: Map<string, Ingredient>,
    private readonly byAlias: Map<string, Ingredient>,
  ) {}

  static async read(
    db: Reader,
    organizationId: string,
    lines: { rawName: string; sku?: string }[],
    vendorId: string | null = null,
  ) {
    const names = lines.flatMap((l) => [
      ...spellings(l.rawName),
      ...spellings(splitPrep(l.rawName).name),
    ])
    const codes = lines.flatMap((l) => (l.sku?.trim() ? [l.sku] : []))
    const sold = { organizationId, vendorId: vendorId ?? '', ingredientId: { not: null } }
    const [byCode, byProduct, byName, byAlias] = await Promise.all([
      vendorId && codes.length
        ? db.vendorProduct.findMany({
            where: { ...sold, sku: anyOf(codes) },
            include: { ingredient: true },
          })
        : [],
      vendorId
        ? db.vendorProduct.findMany({
            where: { ...sold, name: anyOf(names) },
            include: { ingredient: true },
          })
        : [],
      db.ingredient.findMany({ where: { organizationId, name: anyOf(names) } }),
      db.ingredientAlias.findMany({
        where: { organizationId, rawName: anyOf(names), ingredientId: { not: null } },
        include: { ingredient: true },
      }),
    ])
    const reached = <T extends { ingredient: Ingredient | null }>(
      rows: T[],
      keyOf: (row: T) => string | null,
    ) =>
      new Map(
        [...keyed(rows, keyOf)].flatMap(([k, row]) =>
          row.ingredient ? [[k, row.ingredient] as const] : [],
        ),
      )
    return new IngredientBook(
      reached(byCode, (p) => p.sku),
      reached(byProduct, (p) => p.name),
      keyed(byName, (i) => i.name),
      reached(byAlias, (a) => a.rawName),
    )
  }

  find(rawName: string, sku?: string): Ingredient | null {
    const code = sku?.trim()
    return (
      (code ? this.byCode.get(key(code)) : undefined) ??
      this.byProduct.get(key(rawName)) ??
      spelledAs(this.byName, rawName) ??
      spelledAs(this.byAlias, rawName) ??
      null
    )
  }

  prepared(rawName: string): { ingredient: Ingredient | null; prep: string | null } {
    const whole = spelledAs(this.byName, rawName) ?? spelledAs(this.byAlias, rawName)
    if (whole) return { ingredient: whole, prep: null }
    const { name, prep } = splitPrep(rawName)
    if (!prep) return { ingredient: null, prep: null }
    const product = spelledAs(this.byName, name) ?? spelledAs(this.byAlias, name)
    return product ? { ingredient: product, prep } : { ingredient: null, prep: null }
  }
}

export class DishBook {
  private constructor(
    private readonly here: Map<string, MenuItem>,
    private readonly boundHere: Map<string, MenuItem>,
    private readonly shared: Map<string, MenuItem>,
    private readonly boundEverywhere: Map<string, MenuItem>,
  ) {}

  static async read(
    db: Reader,
    organizationId: string,
    names: string[],
    locationId: string | null,
  ) {
    const stated = anyOf(names)
    const at = locationId ? [{ locationId }, { locationId: null }] : [{ locationId: null }]
    const [dishes, aliases] = await Promise.all([
      db.menuItem.findMany({ where: { organizationId, name: stated, OR: at } }),
      db.menuItemAlias.findMany({
        where: { organizationId, rawName: stated, menuItemId: { not: null }, OR: at },
        include: { menuItem: true },
      }),
    ])
    const bound = (scope: string | null) =>
      new Map(
        [
          ...keyed(
            aliases.filter((a) => a.locationId === scope),
            (a) => a.rawName,
          ),
        ].flatMap(([k, a]) => (a.menuItem ? [[k, a.menuItem] as const] : [])),
      )
    return new DishBook(
      locationId
        ? keyed(
            dishes.filter((d) => d.locationId === locationId),
            (d) => d.name,
          )
        : new Map(),
      locationId ? bound(locationId) : new Map(),
      keyed(
        dishes.filter((d) => d.locationId === null),
        (d) => d.name,
      ),
      bound(null),
    )
  }

  find(rawName: string): MenuItem | null {
    const k = key(rawName)
    return (
      this.here.get(k) ??
      this.boundHere.get(k) ??
      this.shared.get(k) ??
      this.boundEverywhere.get(k) ??
      null
    )
  }
}

function firstOfEach<T>(rows: T[], textOf: (row: T) => string) {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const k = key(textOf(row))
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export class Parking {
  constructor(
    private readonly client: TenantScopedClient,
    private readonly organizationId: string,
  ) {}

  async ingredients(lines: { rawName: string; sku?: string }[], vendorId: string | null) {
    const wanted = firstOfEach(lines, (l) => l.rawName)
    if (wanted.length === 0) return
    const locks = vendorId
      ? [catalogueLock(this.organizationId, vendorId)]
      : wanted.map((l) => ingredientAliasLock(this.organizationId, l.rawName))
    await serialized(this.client, locks, (db) => this.parkIngredients(db, wanted, vendorId))
  }

  async dishes(names: string[], locationId: string | null) {
    const wanted = firstOfEach(names, (n) => n)
    if (wanted.length === 0) return
    const locks = wanted.map((n) => salesAliasLock(this.organizationId, n))
    await serialized(this.client, locks, (db) => this.parkDishes(db, wanted, locationId))
  }

  private async parkIngredients(
    db: Serial,
    wanted: { rawName: string; sku?: string }[],
    vendorId: string | null,
  ) {
    const { organizationId } = this
    const names = wanted.map((l) => l.rawName)
    if (!vendorId) {
      const known = await db.ingredientAlias.findMany({
        where: { organizationId, rawName: anyOf(names) },
        select: { rawName: true },
      })
      const parked = new Set(known.map((a) => key(a.rawName)))
      await db.ingredientAlias.createMany({
        data: wanted
          .filter((l) => !parked.has(key(l.rawName)))
          .map((l) => ({ organizationId, rawName: l.rawName.trim() })),
        skipDuplicates: true,
      })
      return
    }
    const codes = wanted.flatMap((l) => (l.sku?.trim() ? [l.sku] : []))
    const [known, claimed] = await Promise.all([
      db.vendorProduct.findMany({
        where: { organizationId, vendorId, name: anyOf(names) },
        select: { name: true },
      }),
      codes.length
        ? db.vendorProduct.findMany({
            where: { organizationId, vendorId, sku: anyOf(codes) },
            select: { sku: true },
          })
        : [],
    ])
    const parked = new Set(known.map((p) => key(p.name)))
    const taken = new Set(claimed.flatMap((p) => (p.sku ? [key(p.sku)] : [])))
    const data = wanted
      .filter((l) => !parked.has(key(l.rawName)))
      .map((l) => {
        const code = l.sku?.trim()
        const free = code && !taken.has(key(code)) ? code : null
        if (free) taken.add(key(free))
        return { organizationId, vendorId, name: l.rawName.trim(), sku: free }
      })
    await db.vendorProduct.createMany({ data, skipDuplicates: true })
  }

  private async parkDishes(db: Serial, wanted: string[], locationId: string | null) {
    const { organizationId } = this
    const known = await db.menuItemAlias.findMany({
      where: {
        organizationId,
        rawName: anyOf(wanted),
        ...(locationId ? { OR: [{ locationId }, { locationId: null }] } : { locationId: null }),
      },
      select: { rawName: true },
    })
    const parked = new Set(known.map((a) => key(a.rawName)))
    await db.menuItemAlias.createMany({
      data: wanted
        .filter((n) => !parked.has(key(n)))
        .map((n) => ({ organizationId, locationId, rawName: n.trim() })),
      skipDuplicates: true,
    })
  }
}
