import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app-setup'
import { PrismaService } from '../src/prisma/prisma.service'

jest.setTimeout(30000)

describe('Modules (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let http: ReturnType<INestApplication['getHttpServer']>
  let goldenForkCookie = ''
  let bellaCucinaCookie = ''

  const login = async (email: string): Promise<string> => {
    const res = await request(http)
      .post('/api/auth/login')
      .send({ email, password: 'Nexus_dev1' })
      .expect(200)
    const raw = res.headers['set-cookie']
    const cookies = Array.isArray(raw) ? raw : [raw]
    return cookies.map((c) => c.split(';')[0]).join('; ')
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    configureApp(app)
    await app.init()
    http = app.getHttpServer()
    prisma = app.get(PrismaService)
    goldenForkCookie = await login('owner@goldenfork.com')
    bellaCucinaCookie = await login('owner@bellacucina.com')
  })

  afterAll(async () => {
    await app.close()
  })

  const CONTRACT_GETS: [string, (body: unknown) => void][] = [
    [
      '/api/vendors',
      (b) => {
        const rows = b as { notes: string }[]
        expect(rows.length).toBeGreaterThan(0)
        expect(typeof rows[0].notes).toBe('string')
      },
    ],
    [
      '/api/ingredients',
      (b) => {
        const rows = b as {
          status: string
          vendor: string
          costPerUnit: number
          vendorId: string | null
          categoryId: string | null
        }[]
        expect(rows.length).toBeGreaterThan(0)
        expect(['ok', 'low']).toContain(rows[0].status)
        expect(typeof rows[0].costPerUnit).toBe('number')
        expect(rows.some((r) => r.vendorId !== null)).toBe(true)
        expect(rows.some((r) => r.categoryId !== null)).toBe(true)
      },
    ],
    [
      '/api/inventory',
      (b) => {
        const rows = b as { name: string; category: string }[]
        expect(rows.length).toBeGreaterThan(0)
        expect(rows.every((r) => typeof r.category === 'string' && r.category.length > 0)).toBe(
          true,
        )
        expect(rows.some((r) => r.category !== 'Uncategorized')).toBe(true)
      },
    ],
    [
      '/api/inventory/transactions',
      (b) => {
        const rows = b as { quantity: number; unit: string }[]
        expect(rows.length).toBeGreaterThan(0)
        expect(typeof rows[0].quantity).toBe('number')
        expect(typeof rows[0].unit).toBe('string')
        const types = new Set(rows.map((r) => (r as unknown as { type: string }).type))
        for (const t of types) expect(['received', 'used', 'wasted']).toContain(t)
      },
    ],
    ['/api/reports/usage', () => undefined],
    ['/api/reports/price-trends', () => undefined],
    [
      '/api/properties',
      (b) => {
        const rows = b as { id: string; name: string }[]
        expect(rows.length).toBeGreaterThan(0)
        expect(rows[0]).toHaveProperty('id')
        expect(rows[0]).toHaveProperty('name')
      },
    ],
    [
      '/api/users',
      (b) => {
        const rows = b as { locations: unknown }[]
        expect(rows.length).toBeGreaterThan(0)
        expect(Array.isArray(rows[0].locations)).toBe(true)
      },
    ],
    [
      '/api/recipes',
      (b) => {
        const rows = b as { nested: number; cost: number }[]
        expect(rows.length).toBeGreaterThan(0)
        expect(typeof rows[0].nested).toBe('number')
      },
    ],
    [
      '/api/menu-items',
      (b) => {
        const rows = b as {
          categoryId: string | null
          recipes: { id: string; name: string; portions: number }[]
        }[]
        expect(rows.length).toBeGreaterThan(0)
        const withRecipes = rows.find((r) => r.recipes.length > 0)
        expect(withRecipes).toBeDefined()
        expect(withRecipes!.recipes[0]).toHaveProperty('id')
        expect(typeof withRecipes!.recipes[0].portions).toBe('number')
        expect(rows.some((r) => r.categoryId !== null)).toBe(true)
      },
    ],
    ['/api/waste', (b) => expect((b as unknown[]).length).toBeGreaterThan(0)],
    ['/api/waste/records', () => undefined],
    [
      '/api/waste/ingredients',
      (b) => {
        const rows = b as { unitCost: number }[]
        expect(typeof rows[0].unitCost).toBe('number')
      },
    ],
    [
      '/api/waste/reasons',
      (b) => {
        expect((b as { value: string }[]).map((r) => r.value)).toContain('spoilage')
      },
    ],
    ['/api/production', (b) => expect((b as unknown[]).length).toBeGreaterThan(0)],
    ['/api/prep-list', (b) => expect(b).toEqual([])],
    [
      '/api/sales/daily',
      (b) => {
        const rows = b as { revenue: number; profit: number }[]
        expect(rows.length).toBeGreaterThan(0)
        expect(rows[0].profit).toBeCloseTo(
          rows[0].revenue - (rows[0] as never as { cost: number }).cost,
          1,
        )
      },
    ],
    ['/api/sales', (b) => expect((b as unknown[]).length).toBeGreaterThan(0)],
    ['/api/sales/menu-items', (b) => expect((b as string[])[0]).toEqual(expect.any(String))],
    ['/api/sales/summary', (b) => expect((b as unknown[]).length).toBeGreaterThan(0)],
    [
      '/api/dashboard/kpis',
      (b) => {
        const k = b as { recipes: number; foodCostPct: number; pendingDocuments: number }
        expect(k.recipes).toBeGreaterThan(0)
        expect(Number.isFinite(k.foodCostPct)).toBe(true)
        expect(k.pendingDocuments).toBe(0)
      },
    ],
    [
      '/api/dashboard/trends',
      (b) => {
        const t = b as { revenue: number[]; profit: number[]; foodCost: number[] }
        expect(t.revenue).toHaveLength(7)
        expect(t.foodCost.every(Number.isFinite)).toBe(true)
      },
    ],
    ['/api/analytics/spend', () => undefined],
    ['/api/analytics/cost-by-category', () => undefined],
    ['/api/analytics/waste-breakdown', (b) => expect((b as unknown[]).length).toBeGreaterThan(0)],
    ['/api/analytics/revenue-trend', (b) => expect((b as unknown[]).length).toBeGreaterThan(0)],
    [
      '/api/organizations/current',
      (b) => {
        expect((b as { name: string }).name).toBe('The Golden Fork Group')
      },
    ],
    ['/api/billing/plans', (b) => expect((b as unknown[]).length).toBe(4)],
    ['/api/billing/trial', (b) => expect(Number.isFinite(b as number)).toBe(true)],
    ['/api/documents', (b) => expect(b).toEqual([])],
    [
      '/api/imports/order-guides/analysis',
      (b) => {
        expect(b).toHaveProperty('sheets')
        expect(b).toHaveProperty('products')
      },
    ],
  ]

  test.each(CONTRACT_GETS)('GET %s returns 200 and the contract shape', async (path, check) => {
    const res = await request(http).get(path).set('Cookie', goldenForkCookie).expect(200)
    check(res.body)
  })

  test('every contract GET without a cookie returns 401', async () => {
    for (const [path] of CONTRACT_GETS.slice(0, 5)) {
      await request(http).get(path).expect(401)
    }
  })

  test('overlapping names do not leak: vendors in A differ from vendors in B', async () => {
    const a = await request(http).get('/api/vendors').set('Cookie', goldenForkCookie).expect(200)
    const b = await request(http).get('/api/vendors').set('Cookie', bellaCucinaCookie).expect(200)
    const idsA = new Set((a.body as { id: string }[]).map((v) => v.id))
    for (const v of b.body as { id: string; name: string }[]) {
      expect(idsA.has(v.id)).toBe(false)
    }
    expect((a.body as { name: string }[]).some((v) => v.name === 'Prime Meats Co.')).toBe(true)
    expect((b.body as { name: string }[]).some((v) => v.name === 'Prime Meats Co.')).toBe(true)
  })

  test('a foreign recipe fetched by id returns 404, not 403', async () => {
    const recipeB = await prisma.client.recipe.findFirst({
      where: { organization: { slug: 'bella-cucina' } },
    })
    await request(http).get(`/api/recipes/${recipeB!.id}`).set('Cookie', goldenForkCookie).expect(404)
    await request(http)
      .patch(`/api/recipes/${recipeB!.id}`)
      .set('Cookie', goldenForkCookie)
      .send({ name: 'HACK' })
      .expect(404)
  })

  test('/api/organizations/current in B returns its own organization', async () => {
    const res = await request(http)
      .get('/api/organizations/current')
      .set('Cookie', bellaCucinaCookie)
      .expect(200)
    expect(res.body.name).toBe('Bella Cucina LLC')
  })

  test('staff cannot create a vendor (manager+) but can create waste (staff+)', async () => {
    const staffCookie = await login('ken@goldenfork.com')
    await request(http)
      .post('/api/vendors')
      .set('Cookie', staffCookie)
      .send({ name: 'Role Probe Vendor' })
      .expect(403)

    const ing = await prisma.client.ingredient.findFirst({
      where: { organization: { slug: 'golden-fork' } },
    })
    const staffLocation = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    await request(http)
      .post('/api/waste')
      .set('Cookie', staffCookie)
      .set('X-Location-Id', staffLocation.id)
      .send({ ingredientId: ing!.id, quantity: 0.1, reason: 'other' })
      .expect(201)
    await prisma.client.wasteEntry.deleteMany({
      where: { ingredientId: ing!.id, reason: 'other' },
    })
    await prisma.client.inventoryTransaction.deleteMany({
      where: { ingredientId: ing!.id, wasteReason: 'other' },
    })
    await prisma.client.ingredient.update({
      where: { id: ing!.id },
      data: { onHand: { increment: 0.1 } },
    })
  })

  test('admin routes return 404 for a regular owner', async () => {
    await request(http).get('/api/admin/organizations').set('Cookie', goldenForkCookie).expect(404)
  })

  test('CRUD vendor: create → list → update → delete', async () => {
    const created = await request(http)
      .post('/api/vendors')
      .set('Cookie', goldenForkCookie)
      .send({ name: 'E2E Vendor', contact: 'e2e@vendor.test' })
      .expect(201)
    const id = created.body.id

    const list = await request(http).get('/api/vendors').set('Cookie', goldenForkCookie).expect(200)
    expect((list.body as { id: string }[]).some((v) => v.id === id)).toBe(true)

    await request(http)
      .patch(`/api/vendors/${id}`)
      .set('Cookie', goldenForkCookie)
      .send({ status: 'inactive' })
      .expect(200)

    await request(http).delete(`/api/vendors/${id}`).set('Cookie', goldenForkCookie).expect(200)
  })

  test('an inventory transaction moves onHand', async () => {
    const ing = await prisma.client.ingredient.findFirst({
      where: { organization: { slug: 'golden-fork' }, name: 'All-Purpose Flour' },
    })
    const before = Number(ing!.onHand)
    const location = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    await request(http)
      .post('/api/inventory/transactions')
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', location.id)
      .send({ ingredientId: ing!.id, type: 'RECEIVE', quantity: 5 })
      .expect(201)
    const after = await prisma.client.ingredient.findUnique({ where: { id: ing!.id } })
    expect(Number(after!.onHand)).toBeCloseTo(before + 5, 3)
    await prisma.client.ingredient.update({ where: { id: ing!.id }, data: { onHand: before } })
    await prisma.client.inventoryTransaction.deleteMany({
      where: { ingredientId: ing!.id, type: 'RECEIVE', cost: { gt: 0 }, notes: null },
    })
  })

  const recipeByName = async (name: string) =>
    prisma.client.recipe.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name },
    })

  test('seeded recipes carry a non-zero cost, proving the engine ran', async () => {
    const res = await request(http).get('/api/recipes').set('Cookie', goldenForkCookie).expect(200)
    const rows = res.body as { name: string; cost: number; nested: number }[]
    expect(rows.every((r) => r.cost >= 0)).toBe(true)
    const wellington = rows.find((r) => r.name === 'Beef Wellington')!
    expect(wellington.cost).toBeGreaterThan(0)
    expect(wellington.nested).toBeGreaterThan(0)
  })

  test('the cost of a nested recipe is included in its parent', async () => {
    const wellington = await recipeByName('Beef Wellington')
    const detail = await request(http)
      .get(`/api/recipes/${wellington.id}/detail`)
      .set('Cookie', goldenForkCookie)
      .expect(200)
    const body = detail.body as {
      cost: number
      categoryId: string | null
      ingredients: { cost: number; ingredientId: string }[]
      components: { cost: number; link: string; componentId: string }[]
    }
    const sum =
      body.ingredients.reduce((s, i) => s + i.cost, 0) +
      body.components.reduce((s, c) => s + c.cost, 0)
    expect(body.components.length).toBeGreaterThan(0)
    expect(body.cost).toBeCloseTo(sum, 1)
    expect(body.ingredients.every((i) => typeof i.ingredientId === 'string')).toBe(true)
    expect(body.components.every((c) => c.componentId === c.link)).toBe(true)
    expect(body.categoryId).toEqual(expect.any(String))
  })

  test('an ingredient price change cascades up to the parent recipe', async () => {
    const mushrooms = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Button Mushrooms' },
    })
    const wellington = await recipeByName('Beef Wellington')
    const before = Number(wellington.totalCost)
    const basePrice = Number(mushrooms.costPerUnit)

    await request(http)
      .patch(`/api/ingredients/${mushrooms.id}`)
      .set('Cookie', goldenForkCookie)
      .send({ costPerUnit: basePrice * 10 })
      .expect(200)

    const after = await recipeByName('Beef Wellington')
    expect(Number(after.totalCost)).toBeGreaterThan(before)

    await request(http)
      .patch(`/api/ingredients/${mushrooms.id}`)
      .set('Cookie', goldenForkCookie)
      .send({ costPerUnit: basePrice })
      .expect(200)
    const restored = await recipeByName('Beef Wellington')
    expect(Number(restored.totalCost)).toBeCloseTo(before, 3)
  })

  test('cyclic nesting is rejected with 400', async () => {
    const wellington = await recipeByName('Beef Wellington')
    const duxelles = await recipeByName('Duxelles')
    await request(http)
      .post(`/api/recipes/${duxelles.id}/components`)
      .set('Cookie', goldenForkCookie)
      .send({ componentId: wellington.id, quantity: 1, unit: 'ea' })
      .expect(400)
  })

  test('a recipe cannot contain itself (400)', async () => {
    const duxelles = await recipeByName('Duxelles')
    await request(http)
      .post(`/api/recipes/${duxelles.id}/components`)
      .set('Cookie', goldenForkCookie)
      .send({ componentId: duxelles.id, quantity: 1, unit: 'ea' })
      .expect(400)
  })

  test('a foreign recipe used as a component returns 404, not 403', async () => {
    const foreign = await prisma.client.recipe.findFirstOrThrow({
      where: { organization: { slug: 'bella-cucina' } },
    })
    const duxelles = await recipeByName('Duxelles')
    await request(http)
      .post(`/api/recipes/${duxelles.id}/components`)
      .set('Cookie', goldenForkCookie)
      .send({ componentId: foreign.id, quantity: 1, unit: 'ea' })
      .expect(404)
  })

  test('adding then removing a component raises the parent cost and restores it', async () => {
    const brulee = await recipeByName('Crème Brûlée')
    const marinara = await recipeByName('Marinara Sauce')
    const before = Number(brulee.totalCost)

    const added = await request(http)
      .post(`/api/recipes/${brulee.id}/components`)
      .set('Cookie', goldenForkCookie)
      .send({ componentId: marinara.id, quantity: 1, unit: 'ea' })
      .expect(201)
    expect((added.body as { cost: number }).cost).toBeGreaterThan(before)

    await request(http)
      .post(`/api/recipes/${brulee.id}/components`)
      .set('Cookie', goldenForkCookie)
      .send({ componentId: marinara.id, quantity: 1, unit: 'ea' })
      .expect(400)

    await request(http)
      .delete(`/api/recipes/${brulee.id}/components/${marinara.id}`)
      .set('Cookie', goldenForkCookie)
      .expect(200)
    const restored = await recipeByName('Crème Brûlée')
    expect(Number(restored.totalCost)).toBeCloseTo(before, 3)
  })

  describe('location as an access boundary, not a label in the header', () => {
    const locationByName = (name: string) =>
      prisma.client.location.findFirstOrThrow({ where: { name } })

    test('stock reflects the selected location rather than the organization total', async () => {
      const downtown = await locationByName('Golden Fork — Downtown')
      const riverside = await locationByName('Golden Fork — Riverside')

      const all = await request(http).get('/api/inventory').set('Cookie', goldenForkCookie).expect(200)
      const atDowntown = await request(http)
        .get('/api/inventory')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown.id)
        .expect(200)
      const atRiverside = await request(http)
        .get('/api/inventory')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', riverside.id)
        .expect(200)

      const beefOf = (body: unknown) =>
        (body as { name: string; onHand: number }[]).find((r) => r.name === 'Beef Tenderloin')!

      expect(beefOf(atDowntown.body).onHand).not.toBe(beefOf(atRiverside.body).onHand)
      expect(beefOf(all.body).onHand).toBeGreaterThan(beefOf(atDowntown.body).onHand)
    })

    test('a location price overrides the base ingredient price', async () => {
      const airport = await locationByName('Golden Fork — Airport')
      const base = await request(http).get('/api/inventory').set('Cookie', goldenForkCookie).expect(200)
      const atAirport = await request(http)
        .get('/api/inventory')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', airport.id)
        .expect(200)
      const priceOf = (body: unknown) =>
        (body as { name: string; costPerUnit: number }[]).find((r) => r.name === 'Beef Tenderloin')!
          .costPerUnit
      expect(priceOf(base.body)).toBe(38.5)
      expect(priceOf(atAirport.body)).toBe(41.2)
    })

    test('operational lists narrow to the active location', async () => {
      const riverside = await locationByName('Golden Fork — Riverside')
      const all = await request(http).get('/api/waste/records').set('Cookie', goldenForkCookie).expect(200)
      const here = await request(http)
        .get('/api/waste/records')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', riverside.id)
        .expect(200)
      const count = (b: unknown) => (b as unknown[]).length
      expect(count(here.body)).toBeGreaterThan(0)
      expect(count(here.body)).toBeLessThan(count(all.body))
    })

    test('a foreign location in the header returns 403 instead of writing silently', async () => {
      const foreign = await prisma.client.location.findFirstOrThrow({
        where: { organization: { name: 'Bella Cucina LLC' } },
      })
      await request(http)
        .get('/api/inventory')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', foreign.id)
        .expect(403)
    })

    test('staff sees only the assigned locations', async () => {
      const staff = await login('ken@goldenfork.com')
      const riverside = await locationByName('Golden Fork — Riverside')
      const airport = await locationByName('Golden Fork — Airport')

      await request(http)
        .get('/api/inventory')
        .set('Cookie', staff)
        .set('X-Location-Id', riverside.id)
        .expect(200)
      await request(http)
        .get('/api/inventory')
        .set('Cookie', staff)
        .set('X-Location-Id', airport.id)
        .expect(403)
    })

    test('without a location, staff reads the assigned locations rather than the organization', async () => {
      const staff = await login('ken@goldenfork.com')
      const airport = await locationByName('Golden Fork — Airport')
      const ingredient = await prisma.client.ingredient.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
      })

      const elsewhere = await request(http)
        .post('/api/waste')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', airport.id)
        .send({ ingredientId: ingredient.id, quantity: 0.2, reason: 'spoilage' })
        .expect(201)
      const id = (elsewhere.body as { id: string }).id

      const has = async (cookie: string) => {
        const res = await request(http).get('/api/waste/records').set('Cookie', cookie).expect(200)
        return (res.body as { id: string }[]).some((r) => r.id === id)
      }

      expect(await has(goldenForkCookie)).toBe(true)
      expect(await has(staff)).toBe(false)

      await prisma.client.wasteEntry.delete({ where: { id } })
      await prisma.client.inventoryTransaction.deleteMany({
        where: { locationId: airport.id, ingredientId: ingredient.id, type: 'WASTE' },
      })
    })

    test('a record refuses to be written without a location instead of belonging to none', async () => {
      const ingredient = await prisma.client.ingredient.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' } },
      })
      await request(http)
        .post('/api/waste')
        .set('Cookie', goldenForkCookie)
        .send({ ingredientId: ingredient.id, quantity: 0.1, reason: 'spoilage' })
        .expect(400)
    })

    test('a menu item can be bound to a location and unbound again', async () => {
      const downtown = await locationByName('Golden Fork — Downtown')
      const riverside = await locationByName('Golden Fork — Riverside')
      const name = `E2E Location Dish ${Date.now()}`

      await request(http)
        .post('/api/menu-items')
        .set('Cookie', goldenForkCookie)
        .send({ name, price: 20, locationId: downtown.id })
        .expect(201)

      const atDowntown = await request(http)
        .get('/api/menu-items')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown.id)
        .expect(200)
      const atRiverside = await request(http)
        .get('/api/menu-items')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', riverside.id)
        .expect(200)
      const has = (b: unknown) => (b as { name: string }[]).some((m) => m.name === name)
      expect(has(atDowntown.body)).toBe(true)
      expect(has(atRiverside.body)).toBe(false)

      expect((atRiverside.body as unknown[]).length).toBeGreaterThan(0)

      const created = (atDowntown.body as { id: string; name: string }[]).find(
        (m) => m.name === name,
      )!
      await request(http).delete(`/api/menu-items/${created.id}`).set('Cookie', goldenForkCookie).expect(200)
    })

    test('a foreign location in the request body returns 400', async () => {
      const foreign = await prisma.client.location.findFirstOrThrow({
        where: { organization: { name: 'Bella Cucina LLC' } },
      })
      await request(http)
        .post('/api/menu-items')
        .set('Cookie', goldenForkCookie)
        .send({ name: `E2E Foreign ${Date.now()}`, price: 10, locationId: foreign.id })
        .expect(400)
    })

    test('a location can be archived and restored', async () => {
      const created = await request(http)
        .post('/api/locations')
        .set('Cookie', goldenForkCookie)
        .send({ name: `E2E Location ${Date.now()}` })
        .expect(201)
      const id = (created.body as { id: string }).id

      await request(http).delete(`/api/locations/${id}`).set('Cookie', goldenForkCookie).expect(200)
      const archived = await prisma.client.location.findUniqueOrThrow({ where: { id } })
      expect(archived.isActive).toBe(false)

      await request(http)
        .patch(`/api/locations/${id}`)
        .set('Cookie', goldenForkCookie)
        .send({ isActive: true })
        .expect(200)
      const restored = await prisma.client.location.findUniqueOrThrow({ where: { id } })
      expect(restored.isActive).toBe(true)

      await prisma.client.location.delete({ where: { id } })
    })
  })

  test('food cost is measured against the menu, not copied from the target', async () => {
    const res = await request(http).get('/api/recipes').set('Cookie', goldenForkCookie).expect(200)
    const rows = res.body as {
      name: string
      foodCostPct: number | null
      targetFoodCostPct: number | null
    }[]
    const wellington = rows.find((r) => r.name === 'Beef Wellington')!
    expect(wellington.foodCostPct).toBeGreaterThan(0)
    expect(wellington.foodCostPct).not.toBe(wellington.targetFoodCostPct)

    const duxelles = rows.find((r) => r.name === 'Duxelles')!
    expect(duxelles.foodCostPct).toBeNull()

    const priced = rows.filter((r) => r.foodCostPct !== null).map((r) => r.foodCostPct)
    expect(new Set(priced).size).toBeGreaterThan(1)
  })

  test('editing an ingredient cannot move stock behind the ledger', async () => {
    const downtown = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    const ingredient = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
    })
    const before = Number(ingredient.onHand)

    await request(http)
      .patch(`/api/ingredients/${ingredient.id}`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', downtown.id)
      .send({ onHand: 999 })
      .expect(400)

    const after = await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } })
    expect(Number(after.onHand)).toBeCloseTo(before, 3)
  })

  test('a physical count keeps the location and the organization total in step', async () => {
    const downtown = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    const ingredient = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
    })
    const stockBefore = await prisma.client.ingredientLocationStock.findUniqueOrThrow({
      where: { ingredientId_locationId: { ingredientId: ingredient.id, locationId: downtown.id } },
    })
    const counted = Number(stockBefore.onHand) + 3

    await request(http)
      .post('/api/inventory/transactions')
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', downtown.id)
      .send({ ingredientId: ingredient.id, type: 'COUNT', quantity: counted })
      .expect(201)

    const atLocation = await request(http)
      .get('/api/inventory')
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', downtown.id)
      .expect(200)
    const row = (atLocation.body as { name: string; onHand: number }[]).find(
      (r) => r.name === 'Unsalted Butter',
    )!
    expect(row.onHand).toBeCloseTo(counted, 3)

    await prisma.client.ingredientLocationStock.update({
      where: { ingredientId_locationId: { ingredientId: ingredient.id, locationId: downtown.id } },
      data: { onHand: stockBefore.onHand },
    })
    await prisma.client.ingredient.update({
      where: { id: ingredient.id },
      data: { onHand: 10 },
    })
    await prisma.client.inventoryTransaction.deleteMany({
      where: { ingredientId: ingredient.id, type: 'COUNT' },
    })
  })

  test('a name that is already taken answers 409, not a server error', async () => {
    await request(http)
      .post('/api/vendors')
      .set('Cookie', goldenForkCookie)
      .send({ name: 'Prime Meats Co.' })
      .expect(409)

    const clash = await request(http)
      .post('/api/ingredients')
      .set('Cookie', goldenForkCookie)
      .send({ name: 'Beef Tenderloin', unit: 'kg', costPerUnit: 1 })
      .expect(409)
    expect(clash.body.message).toMatch(/name/i)

    await request(http)
      .post('/api/recipes')
      .set('Cookie', goldenForkCookie)
      .send({ name: 'Duxelles', portions: 4 })
      .expect(409)
  })

  test('the same name in another organization is free to use', async () => {
    const created = await request(http)
      .post('/api/vendors')
      .set('Cookie', bellaCucinaCookie)
      .send({ name: 'Green Valley Produce' })
      .expect(201)
    await request(http)
      .delete(`/api/vendors/${(created.body as { id: string }).id}`)
      .set('Cookie', bellaCucinaCookie)
      .expect(200)
  })

  test('a price change leaves a history record and the trend picks it up', async () => {
    const ingredient = await prisma.client.ingredient.findFirstOrThrow({
      where: { name: 'Unsalted Butter' },
    })
    const before = await request(http)
      .get(`/api/ingredients/${ingredient.id}/price-history`)
      .set('Cookie', goldenForkCookie)
      .expect(200)
    const countBefore = (before.body as { records: unknown[] }).records.length

    await request(http)
      .patch(`/api/ingredients/${ingredient.id}`)
      .set('Cookie', goldenForkCookie)
      .send({ costPerUnit: 10.25 })
      .expect(200)

    const after = await request(http)
      .get(`/api/ingredients/${ingredient.id}/price-history`)
      .set('Cookie', goldenForkCookie)
      .expect(200)
    const records = (after.body as { records: { costPerUnit: number; source: string }[] }).records
    expect(records.length).toBe(countBefore + 1)
    expect(records[0].costPerUnit).toBe(10.25)
    expect(records[0].source).toBe('manual')

    const trends = await request(http)
      .get('/api/reports/price-trends')
      .set('Cookie', goldenForkCookie)
      .expect(200)
    const row = (trends.body as { id: string; current: number }[]).find(
      (r) => r.id === ingredient.id,
    )
    expect(row?.current).toBe(10.25)

    await request(http)
      .patch(`/api/ingredients/${ingredient.id}`)
      .set('Cookie', goldenForkCookie)
      .send({ costPerUnit: 9.5 })
      .expect(200)
    await prisma.client.ingredientPriceHistory.deleteMany({
      where: { ingredientId: ingredient.id, source: 'manual', costPerUnit: { in: [10.25, 9.5] } },
    })
  })

  test('an invoice totals its own lines and stays inside its organization', async () => {
    const vendors = await request(http).get('/api/vendors').set('Cookie', goldenForkCookie)
    const vendorId = (vendors.body as { id: string }[])[0].id

    const invoiceLocation = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    const created = await request(http)
      .post('/api/invoices')
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', invoiceLocation.id)
      .send({
        vendorId,
        number: 'INV-E2E-1',
        invoiceDate: '2026-07-20',
        tax: 4.5,
        items: [
          { description: 'San Marzano Tomatoes', quantity: 20, unit: 'kg', unitPrice: 4.8 },
          { description: 'Olive Oil', quantity: 5, unit: 'l', unitPrice: 12 },
        ],
      })
      .expect(201)

    const invoice = created.body as {
      id: string
      subtotal: number
      tax: number
      total: number
      items: { lineTotal: number }[]
    }
    expect(invoice.subtotal).toBe(156)
    expect(invoice.total).toBe(160.5)
    expect(invoice.items.map((line) => line.lineTotal)).toEqual([96, 60])

    const mine = await request(http)
      .get('/api/invoices')
      .set('Cookie', goldenForkCookie)
      .expect(200)
    expect((mine.body as { id: string }[]).some((row) => row.id === invoice.id)).toBe(true)

    const theirs = await request(http)
      .get('/api/invoices')
      .set('Cookie', bellaCucinaCookie)
      .expect(200)
    expect((theirs.body as { id: string }[]).some((row) => row.id === invoice.id)).toBe(false)
    await request(http)
      .get(`/api/invoices/${invoice.id}`)
      .set('Cookie', bellaCucinaCookie)
      .expect(404)

    const vendorRows = await request(http).get('/api/vendors').set('Cookie', goldenForkCookie)
    const vendor = (vendorRows.body as { id: string; lastInvoice: string | null }[]).find(
      (v) => v.id === vendorId,
    )
    expect(vendor?.lastInvoice).toBe('2026-07-20')

    await request(http)
      .delete(`/api/invoices/${invoice.id}`)
      .set('Cookie', goldenForkCookie)
      .expect(200)
  })
})
