import { Client } from 'pg'
import { configWith } from './config'

jest.setTimeout(30000)

const OWNER_URL = configWith().getOrThrow('DATABASE_URL', { infer: true })

const APP_URL = (() => {
  const url = new URL(OWNER_URL)
  url.username = 'nexus_app'
  url.password = 'nexus_app_dev'
  return url.toString()
})()

describe('RLS (layer 3)', () => {
  let db: Client
  let bellaCucina = ''
  let goldenFork = ''

  beforeAll(async () => {
    const owner = new Client({ connectionString: OWNER_URL })
    await owner.connect()
    const res = await owner.query<{ id: string; name: string }>(
      'SELECT id, name FROM "Organization" ORDER BY name',
    )
    bellaCucina = res.rows.find((r) => r.name.includes('Bella'))!.id
    goldenFork = res.rows.find((r) => r.name.includes('Golden'))!.id
    await owner.end()

    db = new Client({ connectionString: APP_URL })
    await db.connect()
  })

  afterAll(async () => {
    await db.end()
  })

  const setOrg = (id: string | null) =>
    db.query('SELECT set_config($1, $2, false)', ['app.current_org', id ?? ''])

  test('without an organization context no row is visible', async () => {
    await setOrg(null)
    for (const table of [
      'Vendor',
      'Ingredient',
      'Recipe',
      'Sale',
      'IngredientPriceHistory',
      'VendorProduct',
      'PurchaseDraft',
    ]) {
      const res = await db.query<{ count: string }>(`SELECT count(*) FROM "${table}"`)
      expect(Number(res.rows[0].count)).toBe(0)
    }
  })

  test('with a context exactly one organization is visible — its own', async () => {
    await setOrg(goldenFork)
    const res = await db.query<{ orgs: string; total: string }>(
      'SELECT count(DISTINCT "organizationId") AS orgs, count(*) AS total FROM "Vendor"',
    )
    expect(Number(res.rows[0].total)).toBeGreaterThan(0)
    expect(Number(res.rows[0].orgs)).toBe(1)

    const foreign = await db.query('SELECT id FROM "Vendor" WHERE "organizationId" = $1', [
      bellaCucina,
    ])
    expect(foreign.rowCount).toBe(0)
  })

  test('switching the context switches the visible set', async () => {
    await setOrg(bellaCucina)
    const a = await db.query<{ count: string }>('SELECT count(*) FROM "Vendor"')
    await setOrg(goldenFork)
    const b = await db.query<{ count: string }>('SELECT count(*) FROM "Vendor"')
    expect(Number(a.rows[0].count)).toBeGreaterThan(0)
    expect(Number(b.rows[0].count)).toBeGreaterThan(0)
    expect(a.rows[0].count).not.toBe(b.rows[0].count)
  })

  test('every table in the schema is under a policy, child tables included', async () => {
    const res = await db.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`,
    )
    const unprotected = res.rows.map((r) => r.relname).filter((t) => t !== '_prisma_migrations')
    expect(unprotected).toEqual([])
  })

  test('tables that reach their tenant through a parent are scoped too', async () => {
    await setOrg(null)
    for (const table of [
      'RecipeIngredient',
      'RecipeComponent',
      'Instruction',
      'MenuItemRecipe',
      'MenuItemOnMenu',
      'MenuOnLocation',
      'SaleItem',
      'IngredientLocationStock',
      'IngredientLocationSettings',
      'UserLocation',
      'UserSession',
      'InvoiceItem',
      'PurchaseDraftLine',
      'Organization',
    ]) {
      const res = await db.query<{ count: string }>(`SELECT count(*) FROM "${table}"`)
      expect(Number(res.rows[0].count)).toBe(0)
    }
  })

  test('a vendor product is visible only through its own organization', async () => {
    await setOrg(goldenFork)
    const own = await db.query<{ count: string }>('SELECT count(*) FROM "VendorProduct"')
    expect(Number(own.rows[0].count)).toBeGreaterThan(0)

    await setOrg(bellaCucina)
    const other = await db.query<{ count: string }>(
      'SELECT count(*) FROM "VendorProduct" WHERE "organizationId" = $1',
      [goldenFork],
    )
    expect(Number(other.rows[0].count)).toBe(0)
  })

  test('a sale line item is visible only through its own organization', async () => {
    await setOrg(goldenFork)
    const own = await db.query<{ count: string }>('SELECT count(*) FROM "SaleItem"')
    expect(Number(own.rows[0].count)).toBeGreaterThan(0)

    await setOrg(bellaCucina)
    const other = await db.query<{ count: string }>('SELECT count(*) FROM "SaleItem"')
    expect(Number(other.rows[0].count)).toBe(0)
  })

  test('WITH CHECK blocks writing a row into a foreign organization', async () => {
    await setOrg(goldenFork)
    await expect(
      db.query(
        `INSERT INTO "Vendor" (id, "organizationId", name, status, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'active', now(), now())`,
        ['rls-test-vendor', bellaCucina, 'Smuggled Vendor'],
      ),
    ).rejects.toThrow(/row-level security/i)
  })
})
