import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'
import { tenantExtension } from './tenant.extension'
import { tenantStorage, TenantContext } from './tenant-context'
import { configWith } from '../../test/config'

const raw = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: configWith().getOrThrow('DATABASE_URL', { infer: true }),
  }),
})
const db = raw.$extends(tenantExtension)

let orgA: string
let orgB: string

const ctx = (organizationId: string, over: Partial<TenantContext> = {}): TenantContext => ({
  organizationId,
  locationId: null,
  userId: 'test-user',
  role: 'owner',
  isPlatformAdmin: false,
  ...over,
})

const asOrg = <T>(org: string, fn: () => Promise<T>, over: Partial<TenantContext> = {}) =>
  tenantStorage.run(ctx(org, over), async () => await fn())

beforeAll(async () => {
  const a = await raw.organization.findUnique({ where: { slug: 'golden-fork' } })
  const b = await raw.organization.findUnique({ where: { slug: 'bella-cucina' } })
  if (!a || !b) throw new Error('Seed data is missing: run npm run seed')
  orgA = a.id
  orgB = b.id
})

afterAll(async () => {
  await raw.$disconnect()
})

describe('reads: lists are tenant-scoped, and both tenants carry the same names on purpose', () => {
  const LISTS: [string, () => Promise<unknown>][] = [
    ['vendor', () => db.vendor.findMany()],
    ['ingredient', () => db.ingredient.findMany()],
    ['recipe', () => db.recipe.findMany()],
    ['menuItem', () => db.menuItem.findMany()],
    ['location', () => db.location.findMany()],
    ['user', () => db.user.findMany()],
    ['sale', () => db.sale.findMany()],
    ['wasteEntry', () => db.wasteEntry.findMany()],
    ['inventoryTransaction', () => db.inventoryTransaction.findMany()],
  ]
  test.each(LISTS)('%s: A sees only its own rows', async (_name, list) => {
    const rows = (await asOrg(orgA, list)) as { organizationId: string }[]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.organizationId === orgA)).toBe(true)
  })

  test('overlapping names do not leak: vendor "Prime Meats Co." differs between A and B', async () => {
    const [a] = (await asOrg(orgA, () =>
      db.vendor.findMany({ where: { name: 'Prime Meats Co.' } }),
    )) as { id: string }[]
    const [b] = (await asOrg(orgB, () =>
      db.vendor.findMany({ where: { name: 'Prime Meats Co.' } }),
    )) as { id: string }[]
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    expect(a.id).not.toBe(b.id)
  })
})

describe('direct access: a foreign row is indistinguishable from a missing one', () => {
  let foreignRecipeId: string

  beforeAll(async () => {
    const r = await raw.recipe.findFirst({ where: { organizationId: orgB } })
    foreignRecipeId = r!.id
  })

  test('findUnique on a foreign row returns null', async () => {
    const found = await asOrg(orgA, () => db.recipe.findUnique({ where: { id: foreignRecipeId } }))
    expect(found).toBeNull()
  })

  test('update on a foreign row throws P2025 and leaves the row untouched', async () => {
    await expect(
      asOrg(orgA, () =>
        db.recipe.update({ where: { id: foreignRecipeId }, data: { name: 'HACKED' } }),
      ),
    ).rejects.toMatchObject({ code: 'P2025' })
    const intact = await raw.recipe.findUnique({ where: { id: foreignRecipeId } })
    expect(intact!.name).not.toBe('HACKED')
  })

  test('delete on a foreign row throws P2025 and the row survives', async () => {
    await expect(
      asOrg(orgA, () => db.recipe.delete({ where: { id: foreignRecipeId } })),
    ).rejects.toMatchObject({ code: 'P2025' })
    expect(await raw.recipe.findUnique({ where: { id: foreignRecipeId } })).not.toBeNull()
  })

  test('updateMany without a where clause does not touch foreign rows', async () => {
    const before = await raw.recipe.findMany({
      where: { organizationId: orgA },
      select: { id: true, notes: true },
    })
    try {
      await asOrg(orgA, () => db.recipe.updateMany({ data: { notes: 'bulk-touch' } }))
      const foreign = await raw.recipe.findMany({ where: { organizationId: orgB } })
      expect(foreign.every((r) => r.notes !== 'bulk-touch')).toBe(true)
    } finally {
      for (const r of before) {
        await raw.recipe.update({ where: { id: r.id }, data: { notes: r.notes } })
      }
    }
    const after = await raw.recipe.findMany({
      where: { organizationId: orgA },
      select: { id: true, notes: true },
    })
    expect(after.map((r) => [r.id, r.notes]).sort()).toEqual(
      before.map((r) => [r.id, r.notes]).sort(),
    )
  })
})

describe('writes: organizationId is taken from the context', () => {
  afterAll(async () => {
    await raw.vendor.deleteMany({ where: { name: { startsWith: 'Isolation Probe' } } })
  })

  test('create without organizationId assigns the context organization', async () => {
    const created = (await asOrg(orgA, () =>
      db.vendor.create({ data: { name: 'Isolation Probe Vendor' } as never }),
    )) as { organizationId: string }
    expect(created.organizationId).toBe(orgA)
  })

  test('a forged foreign organizationId is overridden by the context', async () => {
    const created = (await asOrg(orgA, () =>
      db.vendor.create({
        data: { name: 'Isolation Probe Spoof', organizationId: orgB } as never,
      }),
    )) as { organizationId: string }
    expect(created.organizationId).toBe(orgA)
  })
})

describe('outside a context and as a platform admin', () => {
  test('without a context (seed and tests) every row is visible', async () => {
    const all = await db.organization.findMany()
    expect(all.length).toBeGreaterThanOrEqual(2)
  })

  test('a platform admin is scoped like anyone else until they say otherwise', async () => {
    const rows = (await asOrg(orgA, () => db.recipe.findMany(), {
      isPlatformAdmin: true,
    })) as { organizationId: string }[]
    const orgs = new Set(rows.map((r) => r.organizationId))
    expect(orgs.has(orgA)).toBe(true)
    expect(orgs.has(orgB)).toBe(false)
  })

  test('a declared platform scope sees both organizations', async () => {
    const rows = (await asOrg(orgA, () => db.recipe.findMany(), {
      isPlatformAdmin: true,
      platformScope: true,
    })) as { organizationId: string }[]
    const orgs = new Set(rows.map((r) => r.organizationId))
    expect(orgs.has(orgA)).toBe(true)
    expect(orgs.has(orgB)).toBe(true)
  })
})
