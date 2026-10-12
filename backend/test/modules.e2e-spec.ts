import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app-setup'
import { PrismaService } from '../src/prisma/prisma.service'
import { dayKey, endOfDay } from '../src/common/utils/calendar'

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
        const rows = (b as { data: { quantity: number; unit: string }[] }).data
        expect(rows.length).toBeGreaterThan(0)
        expect(typeof rows[0].quantity).toBe('number')
        expect(typeof rows[0].unit).toBe('string')
        const types = new Set(rows.map((r) => (r as unknown as { type: string }).type))
        for (const t of types) expect(['received', 'used', 'wasted', 'counted']).toContain(t)
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
    ['/api/waste', (b) => expect((b as { data: unknown[] }).data.length).toBeGreaterThan(0)],
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
    ['/api/production', (b) => expect((b as { data: unknown[] }).data.length).toBeGreaterThan(0)],
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
    ['/api/sales', (b) => expect((b as { data: unknown[] }).data.length).toBeGreaterThan(0)],
    ['/api/sales/menu-items', (b) => expect((b as string[])[0]).toEqual(expect.any(String))],
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
    [
      '/api/analytics/spend',
      (b) => {
        const rows = b as { category: string; amount: number }[]
        expect(rows.length).toBeGreaterThan(0)
        expect(rows.every((r) => typeof r.category === 'string')).toBe(true)
      },
    ],
    [
      '/api/analytics/cost-by-category',
      (b) => {
        const rows = b as { category: string; cost: number; pct: number }[]
        expect(rows.length).toBeGreaterThan(0)
        expect(rows.every((r) => Number.isFinite(r.cost) && Number.isFinite(r.pct))).toBe(true)
      },
    ],
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
    [
      '/api/documents',
      (b) => {
        const rows = (b as { data: { id: string; file: string; type: string; status: string }[] })
          .data
        expect(Array.isArray(rows)).toBe(true)
        expect(
          rows.every(
            (r) => Boolean(r.id) && Boolean(r.file) && Boolean(r.type) && Boolean(r.status),
          ),
        ).toBe(true)
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

  describe('analytics answers for the organization that asks, and no other', () => {
    const ANALYTICS_GETS = [
      '/api/dashboard/kpis',
      '/api/dashboard/trends',
      '/api/dashboard/activity',
      '/api/analytics/spend',
      '/api/analytics/cost-by-category',
      '/api/analytics/waste-breakdown',
      '/api/analytics/revenue-trend',
      '/api/analytics/food-cost-variance',
    ]

    test.each(ANALYTICS_GETS)('GET %s is refused without a cookie', async (path) => {
      await request(http).get(path).expect(401)
    })

    test('B records no sales, so its cost split is empty while A has one', async () => {
      const salesB = await prisma.client.sale.count({
        where: { organization: { slug: 'bella-cucina' } },
      })
      expect(salesB).toBe(0)

      const a = await request(http)
        .get('/api/analytics/cost-by-category')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const b = await request(http)
        .get('/api/analytics/cost-by-category')
        .set('Cookie', bellaCucinaCookie)
        .expect(200)

      expect((a.body as unknown[]).length).toBeGreaterThan(0)
      expect(b.body).toEqual([])
    })

    test('B carries none of the categories A spends on', async () => {
      const a = await request(http)
        .get('/api/analytics/spend')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const b = await request(http)
        .get('/api/analytics/spend')
        .set('Cookie', bellaCucinaCookie)
        .expect(200)

      const categoriesA = new Set((a.body as { category: string }[]).map((r) => r.category))
      expect(categoriesA.size).toBeGreaterThan(0)
      for (const row of b.body as { category: string }[]) {
        expect(categoriesA.has(row.category)).toBe(false)
      }
    })

    test('the revenue A reports never reaches B', async () => {
      const a = await request(http)
        .get('/api/dashboard/kpis')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const b = await request(http)
        .get('/api/dashboard/kpis')
        .set('Cookie', bellaCucinaCookie)
        .expect(200)

      const kpisA = a.body as { recipes: number; revenue30d?: number }
      const kpisB = b.body as { recipes: number; revenue30d?: number }
      expect(kpisA.recipes).toBeGreaterThan(0)
      expect(kpisB.recipes).not.toBe(kpisA.recipes)
    })

    test('waste and revenue series in B stay empty while A reports figures', async () => {
      for (const path of ['/api/analytics/waste-breakdown', '/api/analytics/revenue-trend']) {
        const a = await request(http).get(path).set('Cookie', goldenForkCookie).expect(200)
        const b = await request(http).get(path).set('Cookie', bellaCucinaCookie).expect(200)
        expect((a.body as unknown[]).length).toBeGreaterThan(0)
        expect(b.body).toEqual([])
      }
    })
  })

  describe('rows embedded from child tables belong to the organization that asked', () => {
    const idsOf = async (slug: 'golden-fork' | 'bella-cucina') => ({
      ingredients: new Set(
        (
          await prisma.client.ingredient.findMany({
            where: { organization: { slug } },
            select: { id: true },
          })
        ).map((r) => r.id),
      ),
      recipes: new Set(
        (
          await prisma.client.recipe.findMany({
            where: { organization: { slug } },
            select: { id: true },
          })
        ).map((r) => r.id),
      ),
    })

    test.each([
      ['golden-fork', () => goldenForkCookie],
      ['bella-cucina', () => bellaCucinaCookie],
    ] as const)('recipe cards in %s embed only its own ingredients', async (slug, cookie) => {
      const own = await idsOf(slug)
      const list = await request(http).get('/api/recipes').set('Cookie', cookie()).expect(200)
      const recipes = list.body as { id: string }[]
      expect(recipes.length).toBeGreaterThan(0)

      for (const recipe of recipes) {
        const detail = await request(http)
          .get(`/api/recipes/${recipe.id}/detail`)
          .set('Cookie', cookie())
          .expect(200)
        const card = detail.body as {
          ingredients: { ingredientId: string }[]
          components: { componentId: string }[]
        }
        for (const line of card.ingredients) {
          expect([slug, line.ingredientId, own.ingredients.has(line.ingredientId)]).toEqual([
            slug,
            line.ingredientId,
            true,
          ])
        }
        for (const part of card.components) {
          expect([slug, part.componentId, own.recipes.has(part.componentId)]).toEqual([
            slug,
            part.componentId,
            true,
          ])
        }
      }
    })

    test.each([
      ['golden-fork', () => goldenForkCookie],
      ['bella-cucina', () => bellaCucinaCookie],
    ] as const)('menu items in %s embed only its own recipes', async (slug, cookie) => {
      const own = await idsOf(slug)
      const list = await request(http).get('/api/menu-items').set('Cookie', cookie()).expect(200)
      for (const item of list.body as { recipes: { id: string }[] }[]) {
        for (const recipe of item.recipes) {
          expect([slug, recipe.id, own.recipes.has(recipe.id)]).toEqual([slug, recipe.id, true])
        }
      }
    })
  })

  describe('a reference may not reach into another organization', () => {
    const FOREIGN_CATEGORY = 'Borrowable Category'

    beforeAll(async () => {
      const orgB = await prisma.client.organization.findUnique({ where: { slug: 'bella-cucina' } })
      await prisma.client.category.create({
        data: { organizationId: orgB!.id, name: FOREIGN_CATEGORY },
      })
    })

    afterAll(async () => {
      await prisma.client.category.deleteMany({ where: { name: FOREIGN_CATEGORY } })
    })

    const foreign = async (model: 'vendor' | 'category' | 'ingredient' | 'recipe') => {
      const where = { organization: { slug: 'bella-cucina' } }
      const select = { id: true }
      const row =
        model === 'vendor'
          ? await prisma.client.vendor.findFirst({ where, select })
          : model === 'category'
            ? await prisma.client.category.findFirst({ where, select })
            : model === 'ingredient'
              ? await prisma.client.ingredient.findFirst({ where, select })
              : await prisma.client.recipe.findFirst({ where, select })
      expect(row).toBeTruthy()
      return row!.id
    }

    test('an ingredient cannot borrow a foreign category or vendor', async () => {
      for (const [key, id] of [
        ['categoryId', await foreign('category')],
        ['vendorId', await foreign('vendor')],
      ] as const) {
        await request(http)
          .post('/api/ingredients')
          .set('Cookie', goldenForkCookie)
          .send({ name: `Borrowed ${key}`, unit: 'kg', costPerUnit: 1, [key]: id })
          .expect(400)
      }
    })

    test('a recipe cannot borrow a foreign category', async () => {
      await request(http)
        .post('/api/recipes')
        .set('Cookie', goldenForkCookie)
        .send({
          name: 'Borrowed category recipe',
          portions: 1,
          categoryId: await foreign('category'),
        })
        .expect(400)
    })

    test('a menu item cannot borrow a foreign category or recipe', async () => {
      await request(http)
        .post('/api/menu-items')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Borrowed category item', price: 10, categoryId: await foreign('category') })
        .expect(400)

      await request(http)
        .post('/api/menu-items')
        .set('Cookie', goldenForkCookie)
        .send({
          name: 'Borrowed recipe item',
          price: 10,
          recipes: [{ recipeId: await foreign('recipe'), portions: 1 }],
        })
        .expect(400)
    })

    test('a menu item is placed on menus of its own organization only, and the list it is given replaces the last', async () => {
      const own = await prisma.client.menu.findMany({
        where: { organization: { slug: 'golden-fork' } },
        orderBy: { name: 'asc' },
        take: 2,
      })
      expect(own).toHaveLength(2)
      const foreignMenu = await prisma.client.menu.findFirstOrThrow({
        where: { organization: { slug: 'bella-cucina' } },
      })
      await request(http)
        .post('/api/menu-items')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Borrowed menu item', price: 10, menuIds: [foreignMenu.id] })
        .expect(400)

      const created = await request(http)
        .post('/api/menu-items')
        .set('Cookie', goldenForkCookie)
        .send({ name: `Placed item ${Date.now()}`, price: 10, menuIds: [own[0].id] })
        .expect(201)
      const item = created.body as { id: string; menus: { id: string; name: string }[] }
      try {
        expect(item.menus).toEqual([{ id: own[0].id, name: own[0].name }])
        const last = await prisma.client.menuItemOnMenu.findMany({
          where: { menuId: own[0].id },
          orderBy: { sortOrder: 'desc' },
          take: 1,
        })
        expect(last[0].menuItemId).toBe(item.id)

        const moved = await request(http)
          .patch(`/api/menu-items/${item.id}`)
          .set('Cookie', goldenForkCookie)
          .send({ menuIds: [own[1].id] })
          .expect(200)
        expect((moved.body as typeof item).menus.map((m) => m.id)).toEqual([own[1].id])

        const untouched = await request(http)
          .patch(`/api/menu-items/${item.id}`)
          .set('Cookie', goldenForkCookie)
          .send({ price: 11 })
          .expect(200)
        expect((untouched.body as typeof item).menus.map((m) => m.id)).toEqual([own[1].id])

        const staff = await login('ken@goldenfork.com')
        await request(http)
          .patch(`/api/menu-items/${item.id}`)
          .set('Cookie', staff)
          .send({ menuIds: [own[0].id] })
          .expect(403)
        await request(http)
          .patch(`/api/menu-items/${item.id}`)
          .set('Cookie', staff)
          .send({ price: 12 })
          .expect(403)

        const off = await request(http)
          .patch(`/api/menu-items/${item.id}`)
          .set('Cookie', goldenForkCookie)
          .send({ menuIds: [] })
          .expect(200)
        expect((off.body as typeof item).menus).toEqual([])
      } finally {
        await prisma.client.menuItem.delete({ where: { id: item.id } })
      }
    })

    test('an invoice cannot borrow a foreign vendor or ingredient', async () => {
      const line = { description: 'Line', quantity: 1, unit: 'kg', unitPrice: 5 }
      const home = await prisma.client.location.findFirst({
        where: { organization: { slug: 'golden-fork' } },
        select: { id: true },
      })

      const ownVendor = await prisma.client.vendor.findFirst({
        where: { organization: { slug: 'golden-fork' } },
        select: { id: true },
      })
      const accepted = await request(http)
        .post('/api/invoices')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', home!.id)
        .send({ vendorId: ownVendor!.id, invoiceDate: '2026-08-01', items: [line] })
        .expect(201)
      await prisma.client.invoice.delete({ where: { id: (accepted.body as { id: string }).id } })

      await request(http)
        .post('/api/invoices')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', home!.id)
        .send({ vendorId: await foreign('vendor'), invoiceDate: '2026-08-01', items: [line] })
        .expect(400)

      await request(http)
        .post('/api/invoices')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', home!.id)
        .send({
          invoiceDate: '2026-08-01',
          items: [{ ...line, ingredientId: await foreign('ingredient') }],
        })
        .expect(400)
    })

    test('the same reference is accepted when the organization owns it', async () => {
      const own = await prisma.client.category.findFirst({
        where: { organization: { slug: 'golden-fork' } },
        select: { id: true },
      })
      await request(http)
        .post('/api/ingredients')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Own category ingredient', unit: 'kg', costPerUnit: 1, categoryId: own!.id })
        .expect(201)
      await prisma.client.ingredient.deleteMany({ where: { name: 'Own category ingredient' } })
    })
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
    await request(http)
      .get(`/api/recipes/${recipeB!.id}`)
      .set('Cookie', goldenForkCookie)
      .expect(404)
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
    await prisma.client.ingredientLocationStock.update({
      where: { ingredientId_locationId: { ingredientId: ing!.id, locationId: staffLocation.id } },
      data: { onHand: { increment: 0.1 } },
    })
  })

  test('no endpoint answers with a list that is always empty', async () => {
    await request(http).get('/api/prep-list').set('Cookie', goldenForkCookie).expect(404)
  })

  test('admin routes return 404 for a regular owner', async () => {
    await request(http).get('/api/admin/organizations').set('Cookie', goldenForkCookie).expect(404)
    await request(http).get('/api/admin/queue/anything').set('Cookie', goldenForkCookie).expect(404)
    await request(http)
      .patch('/api/admin/queue/anything/extraction')
      .set('Cookie', goldenForkCookie)
      .send({ payload: { kind: 'menu', name: 'x', price: 1 } })
      .expect(404)
    await request(http)
      .post('/api/admin/queue/anything/map')
      .set('Cookie', goldenForkCookie)
      .send({ rawName: 'x', ingredientId: 'y' })
      .expect(404)
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
    await prisma.client.ingredientLocationStock.update({
      where: { ingredientId_locationId: { ingredientId: ing!.id, locationId: location.id } },
      data: { onHand: { decrement: 5 } },
    })
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

  test('the seeded group sells at more than one location and every delivery note names an invoice on file', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const selling = await prisma.client.sale.groupBy({
      by: ['locationId'],
      where: { organizationId: org.id },
    })
    expect(selling.length).toBeGreaterThan(1)

    const noted = await prisma.client.inventoryTransaction.findMany({
      where: { organizationId: org.id, notes: { contains: 'Invoice #' } },
      select: { notes: true },
    })
    expect(noted.length).toBeGreaterThan(0)
    for (const { notes } of noted) {
      const number = /Invoice #(\S+)/.exec(notes!)![1]
      const invoice = await prisma.client.invoice.findFirst({
        where: { organizationId: org.id, number },
      })
      expect({ number, onFile: invoice !== null }).toEqual({ number, onFile: true })
    }
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

  describe('a count belongs to the location it was taken in', () => {
    test('counting at one location leaves the other locations standing', async () => {
      const beef = await prisma.client.ingredient.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, name: 'Beef Tenderloin' },
      })
      const stocks = await prisma.client.ingredientLocationStock.findMany({
        where: { ingredientId: beef.id },
        orderBy: { locationId: 'asc' },
      })
      expect(stocks.length).toBeGreaterThan(1)

      const [counted, ...untouched] = stocks
      const elsewhere = untouched.reduce((sum, s) => sum + Number(s.onHand), 0)
      const countedTo = 4

      const movement = await request(http)
        .post('/api/inventory/transactions')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', counted.locationId)
        .send({ ingredientId: beef.id, type: 'COUNT', quantity: countedTo })
        .expect(201)

      try {
        const after = await prisma.client.ingredient.findUniqueOrThrow({ where: { id: beef.id } })
        expect(Number(after.onHand)).toBeCloseTo(countedTo + elsewhere, 3)

        for (const stock of untouched) {
          const still = await prisma.client.ingredientLocationStock.findUniqueOrThrow({
            where: {
              ingredientId_locationId: { ingredientId: beef.id, locationId: stock.locationId },
            },
          })
          expect(Number(still.onHand)).toBeCloseTo(Number(stock.onHand), 3)
        }

        const countedNow = await prisma.client.ingredientLocationStock.findUniqueOrThrow({
          where: {
            ingredientId_locationId: { ingredientId: beef.id, locationId: counted.locationId },
          },
        })
        expect(Number(countedNow.onHand)).toBeCloseTo(countedTo, 3)
      } finally {
        await prisma.client.inventoryTransaction.delete({
          where: { id: (movement.body as { id: string }).id },
        })
        await prisma.client.ingredientLocationStock.update({
          where: {
            ingredientId_locationId: { ingredientId: beef.id, locationId: counted.locationId },
          },
          data: { onHand: counted.onHand },
        })
        await prisma.client.ingredient.update({
          where: { id: beef.id },
          data: { onHand: beef.onHand },
        })
      }
    })
  })

  describe('a recipe line is costed in the unit the ingredient is priced in', () => {
    let recipeId = ''
    let ingredientId = ''

    beforeAll(async () => {
      const ctx = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const ingredient = await prisma.client.ingredient.create({
        data: {
          organizationId: ctx.id,
          name: 'Conversion Probe Flour',
          unit: 'kg',
          costPerUnit: 10,
        },
      })
      ingredientId = ingredient.id
      const recipe = await prisma.client.recipe.create({
        data: {
          organizationId: ctx.id,
          name: 'Conversion Probe Recipe',
          portions: 1,
          ingredients: { create: [{ ingredientId: ingredient.id, quantity: 200, unit: 'g' }] },
        },
      })
      recipeId = recipe.id
    })

    afterAll(async () => {
      await prisma.client.unitConversion.deleteMany({ where: { ingredientId } })
      await prisma.client.recipeIngredient.deleteMany({ where: { recipeId } })
      await prisma.client.recipe.delete({ where: { id: recipeId } })
      await prisma.client.ingredient.delete({ where: { id: ingredientId } })
    })

    test('200 g of an ingredient priced per kg costs two dollars, not two thousand', async () => {
      const detail = await request(http)
        .get(`/api/recipes/${recipeId}/detail`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const card = detail.body as { cost: number; ingredients: { cost: number }[] }
      expect(card.ingredients[0].cost).toBeCloseTo(2, 2)
    })

    test('a rule carries a countable unit into the priced one, and the cost follows', async () => {
      const lineCost = async () => {
        const detail = await request(http)
          .get(`/api/recipes/${recipeId}/detail`)
          .set('Cookie', goldenForkCookie)
          .expect(200)
        return (detail.body as { ingredients: { cost: number }[] }).ingredients[0].cost
      }

      await prisma.client.recipeIngredient.updateMany({
        where: { recipeId },
        data: { quantity: 3, unit: 'ea' },
      })
      expect(await lineCost()).toBeCloseTo(30, 2)

      const created = await request(http)
        .post('/api/unit-conversions')
        .set('Cookie', goldenForkCookie)
        .send({ ingredientId, fromUnit: 'ea', toUnit: 'kg', factor: 0.2 })
        .expect(201)

      const list = await request(http)
        .get('/api/unit-conversions')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      expect((list.body as { fromUnit: string }[]).some((r) => r.fromUnit === 'ea')).toBe(true)

      expect(await lineCost()).toBeCloseTo(6, 2)

      await request(http)
        .delete(`/api/unit-conversions/${(created.body as { id: string }).id}`)
        .set('Cookie', goldenForkCookie)
        .expect(400)
      expect(await lineCost()).toBeCloseTo(6, 2)

      await prisma.client.recipeIngredient.updateMany({
        where: { recipeId },
        data: { quantity: 200, unit: 'g' },
      })
      await request(http)
        .delete(`/api/unit-conversions/${(created.body as { id: string }).id}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      expect(await lineCost()).toBeCloseTo(2, 2)
    })

    test('a conversion between units that already convert is refused', async () => {
      await request(http)
        .post('/api/unit-conversions')
        .set('Cookie', goldenForkCookie)
        .send({ fromUnit: 'g', toUnit: 'kg', factor: 0.001 })
        .expect(400)
    })

    test('an organization-wide rule may be recorded once, in either direction', async () => {
      const created = await request(http)
        .post('/api/unit-conversions')
        .set('Cookie', goldenForkCookie)
        .send({ fromUnit: 'dozen', toUnit: 'kg', factor: 12 })
        .expect(201)

      await request(http)
        .post('/api/unit-conversions')
        .set('Cookie', goldenForkCookie)
        .send({ fromUnit: 'dozen', toUnit: 'kg', factor: 15 })
        .expect(400)

      await request(http)
        .post('/api/unit-conversions')
        .set('Cookie', goldenForkCookie)
        .send({ fromUnit: 'kg', toUnit: 'dozen', factor: 0.08 })
        .expect(400)

      await request(http)
        .delete(`/api/unit-conversions/${(created.body as { id: string }).id}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
    })

    test('a conversion names units the catalogue offers, and a rule recorded before keeps its own', async () => {
      const refused = await request(http)
        .post('/api/unit-conversions')
        .set('Cookie', goldenForkCookie)
        .send({ fromUnit: 'crate', toUnit: 'g', factor: 50 })
        .expect(400)
      expect(JSON.stringify(refused.body)).toMatch(/crate is not a unit/)

      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const older = await prisma.client.unitConversion.create({
        data: { organizationId: org.id, fromUnit: 'crate', toUnit: 'g', factor: 2 },
      })
      try {
        await request(http)
          .patch(`/api/unit-conversions/${older.id}`)
          .set('Cookie', goldenForkCookie)
          .send({ factor: 3 })
          .expect(200)
        await request(http)
          .patch(`/api/unit-conversions/${older.id}`)
          .set('Cookie', goldenForkCookie)
          .send({ toUnit: 'leaf' })
          .expect(400)
      } finally {
        await prisma.client.unitConversion.deleteMany({ where: { id: older.id } })
      }
    })

    test('a base unit changes into one it converts to, and stock, prices and recipe costs follow', async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const downtown = await prisma.client.location.findFirstOrThrow({
        where: { name: 'Golden Fork — Downtown' },
      })
      const stamp = Date.now()
      const ingredient = await prisma.client.ingredient.create({
        data: {
          organizationId: org.id,
          name: `Probe Rebased ${stamp}`,
          unit: 'kg',
          costPerUnit: 10,
          onHand: 2,
          reorderLevel: 1,
          stock: { create: [{ locationId: downtown.id, onHand: 2 }] },
          perLocation: { create: [{ locationId: downtown.id, costPerUnit: 12 }] },
        },
      })
      const recipe = await prisma.client.recipe.create({
        data: {
          organizationId: org.id,
          name: `Probe Rebased Recipe ${stamp}`,
          ingredients: { create: [{ ingredientId: ingredient.id, quantity: 0.5, unit: 'kg' }] },
        },
      })
      try {
        await request(http)
          .patch(`/api/ingredients/${ingredient.id}`)
          .set('Cookie', goldenForkCookie)
          .send({ unit: 'g' })
          .expect(200)
        const after = await prisma.client.ingredient.findUniqueOrThrow({
          where: { id: ingredient.id },
          include: { stock: true, perLocation: true },
        })
        expect([
          after.unit,
          Number(after.onHand),
          Number(after.costPerUnit),
          Number(after.reorderLevel),
          Number(after.stock[0].onHand),
          Number(after.perLocation[0].costPerUnit),
        ]).toEqual(['g', 2000, 0.01, 1000, 2000, 0.012])
        const costed = await prisma.client.recipe.findUniqueOrThrow({ where: { id: recipe.id } })
        expect(Number(costed.totalCost)).toBeCloseTo(5, 3)

        await request(http)
          .patch(`/api/ingredients/${ingredient.id}`)
          .set('Cookie', goldenForkCookie)
          .send({ unit: 'ea' })
          .expect(400)
      } finally {
        await prisma.client.recipe.delete({ where: { id: recipe.id } })
        await prisma.client.ingredient.delete({ where: { id: ingredient.id } })
      }
    })

    test('an ingredient is counted in a unit the catalogue offers', async () => {
      const res = await request(http)
        .post('/api/ingredients')
        .set('Cookie', goldenForkCookie)
        .send({ name: `Probe Crate ${Date.now()}`, unit: 'crate', costPerUnit: 1 })
        .expect(400)
      expect(JSON.stringify(res.body)).toMatch(/crate is not a unit/)
      const kept = await prisma.client.ingredient.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, name: 'Eggs' },
      })
      await request(http)
        .patch(`/api/ingredients/${kept.id}`)
        .set('Cookie', goldenForkCookie)
        .send({ unit: 'crate' })
        .expect(400)
    })

    test('a base unit that is not a unit is replaced, and the recipe lines written in it say which to check', async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const stamp = Date.now()
      const ingredient = await prisma.client.ingredient.create({
        data: { organizationId: org.id, name: `Probe Frying Oil ${stamp}`, unit: 'to fry' },
      })
      const recipe = await prisma.client.recipe.create({
        data: {
          organizationId: org.id,
          name: `Probe Fried ${stamp}`,
          ingredients: { create: [{ ingredientId: ingredient.id, quantity: 1, unit: 'to fry' }] },
        },
      })
      try {
        const res = await request(http)
          .patch(`/api/ingredients/${ingredient.id}`)
          .set('Cookie', goldenForkCookie)
          .send({ unit: 'l' })
          .expect(200)
        expect((res.body as { relabelled: string[] }).relabelled).toEqual([recipe.name])
        const line = await prisma.client.recipeIngredient.findFirstOrThrow({
          where: { recipeId: recipe.id },
        })
        expect([line.unit, Number(line.quantity)]).toEqual(['l', 1])
      } finally {
        await prisma.client.recipe.delete({ where: { id: recipe.id } })
        await prisma.client.ingredient.delete({ where: { id: ingredient.id } })
      }
    })

    test('a conversion may not name another organization ingredient', async () => {
      const foreign = await prisma.client.ingredient.findFirstOrThrow({
        where: { organization: { slug: 'bella-cucina' } },
      })
      await request(http)
        .post('/api/unit-conversions')
        .set('Cookie', goldenForkCookie)
        .send({ ingredientId: foreign.id, fromUnit: 'ea', toUnit: 'kg', factor: 0.1 })
        .expect(400)
    })
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
      .send({ componentId: marinara.id, quantity: 1, unit: 'portion' })
      .expect(201)
    expect((added.body as { cost: number }).cost).toBeGreaterThan(before)

    await request(http)
      .post(`/api/recipes/${brulee.id}/components`)
      .set('Cookie', goldenForkCookie)
      .send({ componentId: marinara.id, quantity: 1, unit: 'portion' })
      .expect(400)

    await request(http)
      .delete(`/api/recipes/${brulee.id}/components/${marinara.id}`)
      .set('Cookie', goldenForkCookie)
      .expect(200)
    const restored = await recipeByName('Crème Brûlée')
    expect(Number(restored.totalCost)).toBeCloseTo(before, 3)
  })

  test('the quantity of a nested recipe is changed in place and the parent is recosted', async () => {
    const brulee = await recipeByName('Crème Brûlée')
    const marinara = await recipeByName('Marinara Sauce')
    const before = Number(brulee.totalCost)
    const change = (body: object, cookie = goldenForkCookie, componentId = marinara.id) =>
      request(http)
        .patch(`/api/recipes/${brulee.id}/components/${componentId}`)
        .set('Cookie', cookie)
        .send(body)

    const added = await request(http)
      .post(`/api/recipes/${brulee.id}/components`)
      .set('Cookie', goldenForkCookie)
      .send({ componentId: marinara.id, quantity: 1, unit: 'portion' })
      .expect(201)
    const one = (added.body as { cost: number }).cost - before
    try {
      const doubled = await change({ quantity: 2 }).expect(200)
      const body = doubled.body as {
        cost: number
        components: { componentId: string; qty: number }[]
      }
      expect(body.components.find((c) => c.componentId === marinara.id)?.qty).toBe(2)
      expect(body.cost - before).toBeCloseTo(one * 2, 2)

      await change({ quantity: 1 }, bellaCucinaCookie).expect(404)
      await change({ quantity: 1 }, goldenForkCookie, brulee.id).expect(404)
      await change({ quantity: -1 }).expect(400)
    } finally {
      await request(http)
        .delete(`/api/recipes/${brulee.id}/components/${marinara.id}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
    }
    const restored = await recipeByName('Crème Brûlée')
    expect(Number(restored.totalCost)).toBeCloseTo(before, 3)
  })

  describe('a sub-recipe is measured in what it yields', () => {
    const steakAndMarinara = async () => ({
      steak: await recipeByName('Steak Frites'),
      marinara: await recipeByName('Marinara Sauce'),
    })
    const add = (parentId: string, componentId: string, quantity: number, unit: string) =>
      request(http)
        .post(`/api/recipes/${parentId}/components`)
        .set('Cookie', goldenForkCookie)
        .send({ componentId, quantity, unit })
    const drop = (parentId: string, componentId: string) =>
      request(http)
        .delete(`/api/recipes/${parentId}/components/${componentId}`)
        .set('Cookie', goldenForkCookie)
    const setYield = (id: string, body: object) =>
      request(http).patch(`/api/recipes/${id}`).set('Cookie', goldenForkCookie).send(body)

    afterEach(async () => {
      const { steak, marinara } = await steakAndMarinara()
      await drop(steak.id, marinara.id)
      await setYield(marinara.id, { yieldAmount: null, yieldUnit: null })
    })

    test('a weight of a recipe that states no yield is refused, not counted as portions', async () => {
      const { steak, marinara } = await steakAndMarinara()
      const before = Number(steak.totalCost)
      const res = await add(steak.id, marinara.id, 200, 'g').expect(400)
      expect((res.body as { error: { message: string } }).error.message).toMatch(
        /Marinara Sauce states no yield in g/,
      )
      expect(Number((await recipeByName('Steak Frites')).totalCost)).toBeCloseTo(before, 3)
    })

    test('a rule a share is measured through is kept while the share stands', async () => {
      const { steak, marinara } = await steakAndMarinara()
      const rule = await request(http)
        .post('/api/unit-conversions')
        .set('Cookie', goldenForkCookie)
        .send({ fromUnit: 'ea', toUnit: 'g', factor: 50 })
        .expect(201)
      const ruleId = (rule.body as { id: string }).id
      try {
        await setYield(marinara.id, { yieldAmount: 24, yieldUnit: 'ea' }).expect(200)
        await add(steak.id, marinara.id, 100, 'g').expect(201)
        const costed = Number((await recipeByName('Steak Frites')).totalCost)
        const refused = await request(http)
          .delete(`/api/unit-conversions/${ruleId}`)
          .set('Cookie', goldenForkCookie)
          .expect(400)
        expect((refused.body as { error: { message: string } }).error.message).toMatch(
          /Steak Frites/,
        )
        await request(http)
          .patch(`/api/unit-conversions/${ruleId}`)
          .set('Cookie', goldenForkCookie)
          .send({ toUnit: 'ml' })
          .expect(400)
        expect(Number((await recipeByName('Steak Frites')).totalCost)).toBeCloseTo(costed, 3)
      } finally {
        await drop(steak.id, marinara.id)
        await setYield(marinara.id, { yieldAmount: null, yieldUnit: null })
        await prisma.client.unitConversion.deleteMany({ where: { id: ruleId } })
      }
    })

    test('portions are always accepted', async () => {
      const { steak, marinara } = await steakAndMarinara()
      const res = await add(steak.id, marinara.id, 2, 'portion').expect(201)
      const share = (res.body as { components: { componentId: string; cost: number }[] }).components
      expect(share.find((c) => c.componentId === marinara.id)?.cost).toBeCloseTo(
        (Number(marinara.totalCost) / marinara.portions) * 2,
        2,
      )
    })

    test('a stated yield lets a parent take a share by volume, and only in a unit that reaches it', async () => {
      const { steak, marinara } = await steakAndMarinara()
      const stated = await setYield(marinara.id, { yieldAmount: 3, yieldUnit: 'l' }).expect(200)
      expect(stated.status).toBe(200)
      const grams = await add(steak.id, marinara.id, 200, 'g').expect(400)
      expect((grams.body as { error: { message: string } }).error.message).toMatch(/yields 3 l/)
      const res = await add(steak.id, marinara.id, 300, 'ml').expect(201)
      const share = (res.body as { components: { componentId: string; cost: number }[] }).components
      expect(share.find((c) => c.componentId === marinara.id)?.cost).toBeCloseTo(
        Number(marinara.totalCost) * 0.1,
        2,
      )
    })

    test('a yield needs both an amount and a unit', async () => {
      const { marinara } = await steakAndMarinara()
      await setYield(marinara.id, { yieldAmount: 3 }).expect(400)
      await setYield(marinara.id, { yieldUnit: 'l' }).expect(400)
      await setYield(marinara.id, { yieldAmount: 0, yieldUnit: 'l' }).expect(400)
    })

    test('a yield a parent already measures by cannot be taken away under it', async () => {
      const { steak, marinara } = await steakAndMarinara()
      await setYield(marinara.id, { yieldAmount: 3, yieldUnit: 'l' }).expect(200)
      await add(steak.id, marinara.id, 300, 'ml').expect(201)
      const cleared = await setYield(marinara.id, { yieldAmount: null, yieldUnit: null }).expect(
        400,
      )
      expect((cleared.body as { error: { message: string } }).error.message).toMatch(/Steak Frites/)
      const changed = await setYield(marinara.id, { yieldAmount: 2, yieldUnit: 'kg' }).expect(400)
      expect((changed.body as { error: { message: string } }).error.message).toMatch(/Steak Frites/)
      await setYield(marinara.id, { yieldAmount: 4, yieldUnit: 'l' }).expect(200)
    })

    test('the detail names the yield a sub-recipe can be measured in', async () => {
      const { steak, marinara } = await steakAndMarinara()
      await setYield(marinara.id, { yieldAmount: 3, yieldUnit: 'l' }).expect(200)
      await add(steak.id, marinara.id, 1, 'portion').expect(201)
      const res = await request(http)
        .get(`/api/recipes/${steak.id}/detail`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const body = res.body as {
        yieldAmount: number | null
        components: { componentId: string; yieldAmount: number | null; yieldUnit: string | null }[]
      }
      const part = body.components.find((c) => c.componentId === marinara.id)
      expect(part).toMatchObject({ yieldAmount: 3, yieldUnit: 'l' })
      expect(body.yieldAmount).toBeNull()
    })
  })

  describe('location as an access boundary, not a label in the header', () => {
    const locationByName = (name: string) =>
      prisma.client.location.findFirstOrThrow({ where: { name } })

    test('stock reflects the selected location rather than the organization total', async () => {
      const downtown = await locationByName('Golden Fork — Downtown')
      const riverside = await locationByName('Golden Fork — Riverside')

      const all = await request(http)
        .get('/api/inventory')
        .set('Cookie', goldenForkCookie)
        .expect(200)
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
      const base = await request(http)
        .get('/api/inventory')
        .set('Cookie', goldenForkCookie)
        .expect(200)
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
      const all = await request(http).get('/api/waste').set('Cookie', goldenForkCookie).expect(200)
      const here = await request(http)
        .get('/api/waste')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', riverside.id)
        .expect(200)
      const count = (b: unknown) => (b as { pagination: { total: number } }).pagination.total
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

      await request(http)
        .post('/api/inventory/transactions')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', airport.id)
        .send({ ingredientId: ingredient.id, type: 'RECEIVE', quantity: 1 })
        .expect(201)

      const elsewhere = await request(http)
        .post('/api/waste')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', airport.id)
        .send({ ingredientId: ingredient.id, quantity: 0.2, reason: 'spoilage' })
        .expect(201)
      const id = (elsewhere.body as { id: string }).id

      const has = async (cookie: string) => {
        const res = await request(http).get('/api/waste').set('Cookie', cookie).expect(200)
        return (res.body as { data: { id: string }[] }).data.some((r) => r.id === id)
      }

      expect(await has(goldenForkCookie)).toBe(true)
      expect(await has(staff)).toBe(false)

      await prisma.client.wasteEntry.delete({ where: { id } })
      await prisma.client.inventoryTransaction.deleteMany({
        where: { locationId: airport.id, ingredientId: ingredient.id, type: 'WASTE' },
      })
    })

    test('without a location, a price recorded where a manager does not work stays out of her trend and history', async () => {
      const manager = await login('maria@goldenfork.com')
      const airport = await locationByName('Golden Fork — Airport')
      const ingredient = await prisma.client.ingredient.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
      })
      const settingsBefore = await prisma.client.ingredientLocationSettings.findUnique({
        where: { ingredientId_locationId: { ingredientId: ingredient.id, locationId: airport.id } },
      })

      await request(http)
        .patch(`/api/ingredients/${ingredient.id}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', airport.id)
        .send({ costPerUnit: 77.77 })
        .expect(200)

      try {
        const trend = await request(http)
          .get('/api/reports/price-trends')
          .set('Cookie', manager)
          .expect(200)
        const row = (trend.body as { id: string; current: number }[]).find(
          (r) => r.id === ingredient.id,
        )
        expect(row?.current).not.toBe(77.77)

        const history = await request(http)
          .get(`/api/ingredients/${ingredient.id}/price-history`)
          .set('Cookie', manager)
          .expect(200)
        const records = (history.body as { data: { locationId: string | null }[] }).data
        expect(records.some((r) => r.locationId === airport.id)).toBe(false)
      } finally {
        await prisma.client.ingredientPriceHistory.deleteMany({
          where: { ingredientId: ingredient.id, locationId: airport.id, costPerUnit: 77.77 },
        })
        if (settingsBefore) {
          await prisma.client.ingredientLocationSettings.update({
            where: { id: settingsBefore.id },
            data: { costPerUnit: settingsBefore.costPerUnit },
          })
        } else {
          await prisma.client.ingredientLocationSettings.deleteMany({
            where: { ingredientId: ingredient.id, locationId: airport.id },
          })
        }
      }
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
      await request(http)
        .delete(`/api/menu-items/${created.id}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
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
    expect(clash.body.error.message).toMatch(/name/i)

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
    const countBefore = (before.body as { pagination: { total: number } }).pagination.total

    await request(http)
      .patch(`/api/ingredients/${ingredient.id}`)
      .set('Cookie', goldenForkCookie)
      .send({ costPerUnit: 10.25 })
      .expect(200)

    const after = await request(http)
      .get(`/api/ingredients/${ingredient.id}/price-history`)
      .set('Cookie', goldenForkCookie)
      .expect(200)
    const afterPage = after.body as {
      data: { costPerUnit: number; source: string }[]
      pagination: { total: number }
    }
    const records = afterPage.data
    expect(afterPage.pagination.total).toBe(countBefore + 1)
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

  test('the seven-day trend leaves out a sale from the day before its first day', async () => {
    const location = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    const dish = await prisma.client.menuItem.findFirstOrThrow({
      where: {
        organization: { slug: 'golden-fork' },
        OR: [{ locationId: location.id }, { locationId: null }],
        isActive: true,
      },
    })
    const firstDay = async () =>
      (
        await request(http)
          .get('/api/dashboard/trends')
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', location.id)
          .expect(200)
      ).body.revenue[0] as number
    const before = await firstDay()
    const sale = await request(http)
      .post('/api/sales')
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', location.id)
      .send({
        date: new Date(Date.now() - 7 * 86400000 + 60000).toISOString(),
        items: [{ menuItemId: dish.id, quantity: 3 }],
      })
      .expect(201)
    try {
      expect(await firstDay()).toBe(before)
    } finally {
      await prisma.client.sale.delete({ where: { id: (sale.body as { id: string }).id } })
    }
  })

  test('a sale of more than a column can hold is refused with the field named', async () => {
    const location = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    const dish = await prisma.client.menuItem.findFirstOrThrow({
      where: {
        organization: { slug: 'golden-fork' },
        OR: [{ locationId: location.id }, { locationId: null }],
        isActive: true,
      },
    })
    const res = await request(http)
      .post('/api/sales')
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', location.id)
      .send({ items: [{ menuItemId: dish.id, quantity: 10_000_000_000 }] })
    if (res.status === 201)
      await prisma.client.sale.delete({ where: { id: (res.body as { id: string }).id } })
    expect(res.status).toBe(400)
    expect(JSON.stringify((res.body as { error: unknown }).error)).toMatch(/quantity/)
  })

  test('a recipe of more portions than a column can hold is refused with the field named', async () => {
    const res = await request(http)
      .post('/api/recipes')
      .set('Cookie', goldenForkCookie)
      .send({ name: `Probe Endless Pot ${Date.now()}`, portions: 10_000_000_000, ingredients: [] })
    if (res.status === 201)
      await prisma.client.recipe.delete({ where: { id: (res.body as { id: string }).id } })
    expect(res.status).toBe(400)
    expect(JSON.stringify((res.body as { error: unknown }).error)).toMatch(/portions/)
  })

  test('a dish takes some of a recipe, not none of it', async () => {
    const recipe = await prisma.client.recipe.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, locationId: null },
    })
    const res = await request(http)
      .post('/api/menu-items')
      .set('Cookie', goldenForkCookie)
      .send({
        name: `Probe Free Lunch ${Date.now()}`,
        price: 10,
        recipes: [{ recipeId: recipe.id, portions: 0 }],
      })
    if (res.status === 201)
      await prisma.client.menuItem.delete({ where: { id: (res.body as { id: string }).id } })
    expect(res.status).toBe(400)
    expect(JSON.stringify((res.body as { error: unknown }).error)).toMatch(/portions/)
  })

  test('a recipe line takes some of what it names, not none of it', async () => {
    const ingredient = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, isActive: true },
    })
    const res = await request(http)
      .post('/api/recipes')
      .set('Cookie', goldenForkCookie)
      .send({
        name: `Probe Air Soup ${Date.now()}`,
        portions: 1,
        ingredients: [{ ingredientId: ingredient.id, quantity: 0, unit: ingredient.unit }],
      })
    if (res.status === 201)
      await prisma.client.recipe.delete({ where: { id: (res.body as { id: string }).id } })
    expect(res.status).toBe(400)
    expect(JSON.stringify((res.body as { error: unknown }).error)).toMatch(/quantity/)

    const [parent, child] = await prisma.client.recipe.findMany({
      where: { organization: { slug: 'golden-fork' }, locationId: null },
      take: 2,
      orderBy: { name: 'asc' },
    })
    const nested = await request(http)
      .post(`/api/recipes/${parent.id}/components`)
      .set('Cookie', goldenForkCookie)
      .send({ componentId: child.id, quantity: 0, unit: 'portion' })
    if (nested.status === 201) {
      await request(http)
        .delete(`/api/recipes/${parent.id}/components/${child.id}`)
        .set('Cookie', goldenForkCookie)
    }
    expect(nested.status).toBe(400)
  })

  test('the thirty-day revenue trend shows whole days only', async () => {
    const location = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    const dish = await prisma.client.menuItem.findFirstOrThrow({
      where: {
        organization: { slug: 'golden-fork' },
        OR: [{ locationId: location.id }, { locationId: null }],
        isActive: true,
      },
    })
    const at = new Date(Date.now() - 30 * 86400000 + 60000)
    const sale = await request(http)
      .post('/api/sales')
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', location.id)
      .send({ date: at.toISOString(), items: [{ menuItemId: dish.id, quantity: 1 }] })
      .expect(201)
    try {
      const trend = await request(http)
        .get('/api/analytics/revenue-trend')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', location.id)
        .expect(200)
      const rows = trend.body as { date: string }[]
      expect(rows.length).toBeLessThanOrEqual(30)
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: org.timezone }).format(at)
      expect(rows.map((r) => r.date)).not.toContain(day)
    } finally {
      await prisma.client.sale.delete({ where: { id: (sale.body as { id: string }).id } })
    }
  })

  test('a dish is not moved away from the location whose sales names read as it', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const [downtown, riverside] = await Promise.all(
      ['Golden Fork — Downtown', 'Golden Fork — Riverside'].map((name) =>
        prisma.client.location.findFirstOrThrow({ where: { name } }),
      ),
    )
    const dish = await prisma.client.menuItem.create({
      data: { organizationId: org.id, name: `Probe Moving Soup ${Date.now()}`, price: 6 },
    })
    const alias = await prisma.client.menuItemAlias.create({
      data: {
        organizationId: org.id,
        locationId: riverside.id,
        rawName: `PROBE SOUP CUP ${Date.now()}`,
        menuItemId: dish.id,
      },
    })
    try {
      const moved = await request(http)
        .patch(`/api/menu-items/${dish.id}`)
        .set('Cookie', goldenForkCookie)
        .send({ locationId: downtown.id })
      expect(moved.status).toBe(400)
      expect(JSON.stringify(moved.body)).toContain(alias.rawName)
      const stayed = await prisma.client.menuItem.findUniqueOrThrow({ where: { id: dish.id } })
      expect(stayed.locationId).toBeNull()

      const toItsOwn = await request(http)
        .patch(`/api/menu-items/${dish.id}`)
        .set('Cookie', goldenForkCookie)
        .send({ locationId: riverside.id })
      expect(toItsOwn.status).toBe(200)
    } finally {
      await prisma.client.menuItemAlias.delete({ where: { id: alias.id } })
      await prisma.client.menuItem.delete({ where: { id: dish.id } })
    }
  })

  test('a draft order and a recommendation leave out a vendor marked inactive', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const downtown = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    const vendor = await prisma.client.vendor.create({
      data: {
        organizationId: org.id,
        name: `Probe Retired Vendor ${Date.now()}`,
        status: 'inactive',
      },
    })
    const ingredient = await prisma.client.ingredient.create({
      data: {
        organizationId: org.id,
        name: `Probe Retired Supply ${Date.now()}`,
        unit: 'kg',
        costPerUnit: 2,
        vendorId: vendor.id,
      },
    })
    try {
      const res = await request(http)
        .post('/api/purchasing/drafts')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown.id)
        .send({ lines: [{ ingredientId: ingredient.id, quantity: 3 }] })
      expect(res.status).toBe(201)
      const drafts = res.body as { id: string; vendorId: string | null }[]
      expect(drafts.map((d) => d.vendorId)).toEqual([null])
      const advice = await request(http)
        .get('/api/purchasing/recommendations')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown.id)
        .expect(200)
      const named = (advice.body as { rows: { vendorName: string | null }[] }).rows.map(
        (r) => r.vendorName,
      )
      expect(named).not.toContain(vendor.name)
      await prisma.client.purchaseDraft.deleteMany({
        where: { id: { in: drafts.map((d) => d.id) } },
      })
    } finally {
      await prisma.client.purchaseDraft.deleteMany({ where: { vendorId: vendor.id } })
      await prisma.client.ingredient.delete({ where: { id: ingredient.id } })
      await prisma.client.vendor.delete({ where: { id: vendor.id } })
    }
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
    expect(
      (mine.body as { data: { id: string }[] }).data.some((row) => row.id === invoice.id),
    ).toBe(true)

    const theirs = await request(http)
      .get('/api/invoices')
      .set('Cookie', bellaCucinaCookie)
      .expect(200)
    expect(
      (theirs.body as { data: { id: string }[] }).data.some((row) => row.id === invoice.id),
    ).toBe(false)
    await request(http)
      .get(`/api/invoices/${invoice.id}`)
      .set('Cookie', bellaCucinaCookie)
      .expect(404)

    const listed = async (query: string) => {
      const res = await request(http)
        .get(`/api/invoices${query}&limit=200`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      return (res.body as { data: { id: string; invoiceDate: string }[] }).data
    }
    const ours = await listed(`?vendorId=${vendorId}`)
    expect(ours.map((row) => row.id)).toContain(invoice.id)
    const other = (vendors.body as { id: string }[]).find((v) => v.id !== vendorId)!
    expect((await listed(`?vendorId=${other.id}`)).map((row) => row.id)).not.toContain(invoice.id)
    expect(await listed('?vendorId=no-such-vendor')).toEqual([])

    const newest = ours
      .map((row) => row.invoiceDate)
      .sort()
      .at(-1)
    const vendorRows = await request(http).get('/api/vendors').set('Cookie', goldenForkCookie)
    const vendor = (vendorRows.body as { id: string; lastInvoice: string | null }[]).find(
      (v) => v.id === vendorId,
    )
    expect(vendor?.lastInvoice).toBe(newest)

    await request(http)
      .delete(`/api/invoices/${invoice.id}`)
      .set('Cookie', goldenForkCookie)
      .expect(200)
  })

  test('a vendor is credited with what was confirmed, not with what is still a draft', async () => {
    const list = async () => {
      const res = await request(http)
        .get('/api/vendors')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      return res.body as { id: string; spend30: number }[]
    }
    const vendorId = (await list())[0].id
    const before = (await list()).find((v) => v.id === vendorId)?.spend30 ?? 0

    const location = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    const created = await request(http)
      .post('/api/invoices')
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', location.id)
      .send({
        vendorId,
        number: `INV-DRAFT-${Date.now()}`,
        invoiceDate: new Date().toISOString().slice(0, 10),
        items: [{ description: 'Olive Oil', quantity: 1, unit: 'l', unitPrice: 100 }],
      })
      .expect(201)
    const id = (created.body as { id: string }).id

    try {
      const drafted = (await list()).find((v) => v.id === vendorId)?.spend30 ?? 0
      expect(drafted).toBeCloseTo(before, 2)

      await request(http)
        .patch(`/api/invoices/${id}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', location.id)
        .send({ status: 'confirmed' })
        .expect(200)

      const confirmed = (await list()).find((v) => v.id === vendorId)?.spend30 ?? 0
      expect(confirmed).toBeCloseTo(before + 100, 2)
    } finally {
      await request(http).delete(`/api/invoices/${id}`).set('Cookie', goldenForkCookie).expect(200)
    }
  })

  test('a vendor written answers with the row its list shows', async () => {
    const locations = await prisma.client.location.findMany({
      where: { organization: { name: 'The Golden Fork Group' }, isActive: true },
      select: { id: true },
    })
    expect(locations.length).toBeGreaterThan(1)
    for (const header of [{}, ...locations.map((l) => ({ 'X-Location-Id': l.id }))]) {
      const list = await request(http)
        .get('/api/vendors')
        .set('Cookie', goldenForkCookie)
        .set(header)
        .expect(200)
      const rows = list.body as {
        id: string
        notes: string
        spend30: number
        lastInvoice: string | null
      }[]
      for (const row of rows.filter((r) => r.spend30 > 0 || r.lastInvoice !== null)) {
        const res = await request(http)
          .patch(`/api/vendors/${row.id}`)
          .set('Cookie', goldenForkCookie)
          .set(header)
          .send({ notes: row.notes })
          .expect(200)
        expect(res.body).toEqual(row)
      }
    }
  })

  test('the locations of a menu and of a member are named in the order the switcher names them', async () => {
    const open = await prisma.client.location.findMany({
      where: { organization: { name: 'The Golden Fork Group' }, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true },
    })
    expect(open.length).toBeGreaterThan(2)
    const expected = open.map((l) => l.name)
    const reversed = [...open].reverse().map((l) => l.id)

    const menu = await request(http)
      .post('/api/menus')
      .set('Cookie', goldenForkCookie)
      .send({ name: `Probe Ordered Menu ${Date.now()}`, locationIds: reversed })
      .expect(201)
    const menuId = (menu.body as { id: string }).id
    const ken = await prisma.client.user.findFirstOrThrow({
      where: { email: 'ken@goldenfork.com' },
      include: { locationAccess: { select: { locationId: true } } },
    })
    try {
      const listed = await request(http)
        .get('/api/menus')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const row = (listed.body as { id: string; locations: { name: string }[] }[]).find(
        (m) => m.id === menuId,
      )
      expect(row?.locations.map((l) => l.name)).toEqual(expected)

      const member = await request(http)
        .patch(`/api/users/${ken.id}`)
        .set('Cookie', goldenForkCookie)
        .send({ locationIds: reversed })
        .expect(200)
      expect(
        (member.body as { locations: { name: string }[] }).locations.map((l) => l.name),
      ).toEqual(expected)
    } finally {
      await prisma.client.menu.delete({ where: { id: menuId } })
      await request(http)
        .patch(`/api/users/${ken.id}`)
        .set('Cookie', goldenForkCookie)
        .send({ locationIds: ken.locationAccess.map((a) => a.locationId) })
        .expect(200)
    }
  })

  test('movements recorded at one instant are paged through once each', async () => {
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const ingredient = await prisma.client.ingredient.findFirstOrThrow({
      where: { organizationId: org.id },
    })
    const location = await prisma.client.location.findFirstOrThrow({
      where: { organizationId: org.id },
    })
    const at = new Date('2099-01-01T12:00:00Z')
    const count = 40
    await prisma.client.inventoryTransaction.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        organizationId: org.id,
        locationId: location.id,
        ingredientId: ingredient.id,
        type: 'USE' as const,
        quantity: -(i + 1) / 1000,
        unit: ingredient.unit,
        cost: 0,
        notes: 'Probe tie',
        createdAt: at,
      })),
    })
    try {
      const seen: string[] = []
      for (let offset = 0; offset < count; offset++) {
        const res = await request(http)
          .get(`/api/inventory/transactions?offset=${offset}&limit=1`)
          .set('Cookie', goldenForkCookie)
          .expect(200)
        seen.push(...(res.body as { data: { id: string }[] }).data.map((t) => t.id))
      }
      expect(new Set(seen).size).toBe(count)
    } finally {
      await prisma.client.inventoryTransaction.deleteMany({ where: { notes: 'Probe tie' } })
    }
  })

  test('an opening balance worth more than a money column holds leaves no ingredient behind', async () => {
    const location = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    const name = `Probe Opening Balance ${Date.now()}`
    try {
      const res = await request(http)
        .post('/api/ingredients')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', location.id)
        .send({ name, unit: 'kg', costPerUnit: 100000, onHand: 1000000 })
      expect(res.status).toBe(400)
      expect(await prisma.client.ingredient.count({ where: { name } })).toBe(0)
    } finally {
      const left = await prisma.client.ingredient.findMany({
        where: { name },
        select: { id: true },
      })
      const ids = left.map((i) => i.id)
      await prisma.client.inventoryTransaction.deleteMany({ where: { ingredientId: { in: ids } } })
      await prisma.client.ingredientLocationStock.deleteMany({
        where: { ingredientId: { in: ids } },
      })
      await prisma.client.ingredientLocationSettings.deleteMany({
        where: { ingredientId: { in: ids } },
      })
      await prisma.client.ingredient.deleteMany({ where: { id: { in: ids } } })
    }
  })

  test('a price that cannot enter the history is not set either', async () => {
    const location = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    const butter = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
    })
    const before = await prisma.client.ingredientLocationSettings.findUnique({
      where: { ingredientId_locationId: { ingredientId: butter.id, locationId: location.id } },
    })
    await prisma.client.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION e2e_refuse_history() RETURNS trigger AS $$
      BEGIN
        IF NEW."ingredientId" = '${butter.id}' THEN RAISE EXCEPTION 'e2e refuses the history'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`)
    await prisma.client.$executeRawUnsafe(
      `CREATE TRIGGER e2e_refuse_history BEFORE INSERT ON "IngredientPriceHistory" FOR EACH ROW EXECUTE FUNCTION e2e_refuse_history()`,
    )
    try {
      const res = await request(http)
        .patch(`/api/ingredients/${butter.id}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', location.id)
        .send({ costPerUnit: 77.77 })
      expect(res.status).toBeGreaterThanOrEqual(400)
      const after = await prisma.client.ingredientLocationSettings.findUnique({
        where: { ingredientId_locationId: { ingredientId: butter.id, locationId: location.id } },
      })
      expect(after?.costPerUnit?.toString() ?? null).toBe(before?.costPerUnit?.toString() ?? null)
    } finally {
      await prisma.client.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS e2e_refuse_history ON "IngredientPriceHistory"',
      )
      await prisma.client.$executeRawUnsafe('DROP FUNCTION IF EXISTS e2e_refuse_history()')
      if (before) {
        await prisma.client.ingredientLocationSettings.update({
          where: { id: before.id },
          data: { costPerUnit: before.costPerUnit },
        })
      } else {
        await prisma.client.ingredientLocationSettings.deleteMany({
          where: { ingredientId: butter.id, locationId: location.id },
        })
      }
    }
  })

  test('vendor spend over time draws the confirmed invoices and nothing else', async () => {
    const trend = async () => {
      const res = await request(http)
        .get('/api/vendors/spend')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      return res.body as { period: string; total: number }[]
    }

    const before = await trend()
    expect(before).toHaveLength(6)
    expect(before.map((p) => p.period)).toEqual([...before.map((p) => p.period)].sort())
    const thisMonth = new Date().toISOString().slice(0, 7)
    expect(before[before.length - 1].period).toBe(thisMonth)
    expect(before.some((p) => p.total > 0)).toBe(true)

    const vendors = await request(http).get('/api/vendors').set('Cookie', goldenForkCookie)
    const vendorId = (vendors.body as { id: string }[])[0].id
    const location = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    const created = await request(http)
      .post('/api/invoices')
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', location.id)
      .send({
        vendorId,
        number: `INV-TREND-${Date.now()}`,
        invoiceDate: new Date().toISOString().slice(0, 10),
        items: [{ description: 'Olive Oil', quantity: 1, unit: 'l', unitPrice: 250 }],
      })
      .expect(201)
    const id = (created.body as { id: string }).id

    try {
      const drafted = await trend()
      expect(drafted[drafted.length - 1].total).toBeCloseTo(before[before.length - 1].total, 2)

      await request(http)
        .patch(`/api/invoices/${id}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', location.id)
        .send({ status: 'confirmed' })
        .expect(200)

      const confirmed = await trend()
      expect(confirmed[confirmed.length - 1].total).toBeCloseTo(
        before[before.length - 1].total + 250,
        2,
      )
    } finally {
      await request(http).delete(`/api/invoices/${id}`).set('Cookie', goldenForkCookie).expect(200)
    }
  })

  describe('stock is not allowed below zero', () => {
    let ingredientId = ''
    let locationId = ''

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const location = await prisma.client.location.findFirstOrThrow({
        where: { organizationId: org.id },
        orderBy: { name: 'asc' },
      })
      locationId = location.id
      const ingredient = await prisma.client.ingredient.create({
        data: {
          organizationId: org.id,
          name: 'Stock Guard Probe',
          unit: 'kg',
          costPerUnit: 1,
          onHand: 2,
        },
      })
      ingredientId = ingredient.id
      await prisma.client.ingredientLocationStock.create({
        data: { ingredientId, locationId, onHand: 2 },
      })
    })

    afterAll(async () => {
      await prisma.client.wasteEntry.deleteMany({ where: { ingredientId } })
      await prisma.client.inventoryTransaction.deleteMany({ where: { ingredientId } })
      await prisma.client.ingredientLocationStock.deleteMany({ where: { ingredientId } })
      await prisma.client.ingredient.delete({ where: { id: ingredientId } })
    })

    const stockNow = async () => {
      const row = await prisma.client.ingredientLocationStock.findUniqueOrThrow({
        where: { ingredientId_locationId: { ingredientId, locationId } },
      })
      return Number(row.onHand)
    }

    test('waste is recorded on the waste log only, so every report counts it the same', async () => {
      const res = await request(http)
        .post('/api/inventory/transactions')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ ingredientId, type: 'WASTE', quantity: 0.5 })
        .expect(400)
      expect(res.body.error.message).toMatch(/waste log/i)
      expect(await stockNow()).toBe(2)
    })

    test('waste beyond what the location holds is refused, and nothing moves', async () => {
      const before = await stockNow()
      const refused = await request(http)
        .post('/api/waste')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ ingredientId, quantity: before + 1, reason: 'spoilage' })
        .expect(400)
      expect((refused.body as { error: { message: string } }).error.message).toContain('in stock')

      expect(await stockNow()).toBeCloseTo(before, 3)
      const entries = await prisma.client.wasteEntry.count({ where: { ingredientId } })
      expect(entries).toBe(0)
      const movements = await prisma.client.inventoryTransaction.count({ where: { ingredientId } })
      expect(movements).toBe(0)
    })

    test('waste within the stock goes through and takes the quantity away', async () => {
      const before = await stockNow()
      await request(http)
        .post('/api/waste')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ ingredientId, quantity: 1, reason: 'spoilage' })
        .expect(201)
      expect(await stockNow()).toBeCloseTo(before - 1, 3)
    })

    test('waste logged for an earlier day moves stock on that day, not on the day it was typed', async () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      await request(http)
        .post('/api/waste')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ ingredientId, quantity: 0.25, reason: 'spoilage', date: yesterday })
        .expect(201)
      const entry = await prisma.client.wasteEntry.findFirstOrThrow({
        where: { ingredientId, quantity: 0.25 },
      })
      const movement = await prisma.client.inventoryTransaction.findFirstOrThrow({
        where: { ingredientId, type: 'WASTE', quantity: -0.25 },
      })
      expect(movement.createdAt.getTime()).toBe(entry.date.getTime())
      expect(entry.date.getTime()).toBeLessThan(Date.now() - 3600000)
    })

    test('a quantity stated in another unit of the same kind is converted before it is taken', async () => {
      const before = await stockNow()
      await request(http)
        .post('/api/waste')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ ingredientId, quantity: 500, unit: 'g', reason: 'trim' })
        .expect(201)
      expect(await stockNow()).toBeCloseTo(before - 0.5, 3)
    })

    test('a unit that does not convert is refused rather than treated as the counted one', async () => {
      const before = await stockNow()
      await request(http)
        .post('/api/waste')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ ingredientId, quantity: 1, unit: 'ea', reason: 'trim' })
        .expect(400)
      expect(await stockNow()).toBeCloseTo(before, 3)
    })

    test('a unit a rule names is read in the plural as well', async () => {
      const owner = await prisma.client.ingredient.findUniqueOrThrow({
        where: { id: ingredientId },
      })
      const rule = await prisma.client.unitConversion.create({
        data: {
          organizationId: owner.organizationId,
          ingredientId,
          fromUnit: 'bag',
          toUnit: 'kg',
          factor: 0.1,
        },
      })
      try {
        const before = await stockNow()
        await request(http)
          .post('/api/waste')
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', locationId)
          .send({ ingredientId, quantity: 1, unit: 'Bags', reason: 'trim' })
          .expect(201)
        expect(await stockNow()).toBeCloseTo(before - 0.1, 3)
      } finally {
        await prisma.client.unitConversion.delete({ where: { id: rule.id } })
      }
    })

    test('a USE movement beyond the stock is refused on the same terms', async () => {
      const before = await stockNow()
      await request(http)
        .post('/api/inventory/transactions')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ ingredientId, type: 'USE', quantity: before + 5 })
        .expect(400)
      expect(await stockNow()).toBeCloseTo(before, 3)
    })

    test('a count cannot be entered as a negative number', async () => {
      await request(http)
        .post('/api/inventory/transactions')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ ingredientId, type: 'COUNT', quantity: -3 })
        .expect(400)
    })

    test('the waste form is told how much the location holds', async () => {
      const list = await request(http)
        .get('/api/waste/ingredients')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(200)
      const row = (list.body as { id: string; onHand: number }[]).find((i) => i.id === ingredientId)
      expect(row?.onHand).toBeCloseTo(await stockNow(), 3)
    })
  })

  describe('a recipe line may only be stated in a unit that reaches the price', () => {
    let ingredientId = ''

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const ingredient = await prisma.client.ingredient.create({
        data: { organizationId: org.id, name: 'Unit Rule Probe', unit: 'kg', costPerUnit: 4 },
      })
      ingredientId = ingredient.id
    })

    afterAll(async () => {
      await prisma.client.unitConversion.deleteMany({ where: { ingredientId } })
      await prisma.client.recipeIngredient.deleteMany({ where: { ingredientId } })
      await prisma.client.ingredient.delete({ where: { id: ingredientId } })
    })

    const create = (unit: string) =>
      request(http)
        .post('/api/recipes')
        .set('Cookie', goldenForkCookie)
        .send({
          name: `Unit Rule Probe Recipe ${unit}`,
          portions: 1,
          ingredients: [{ ingredientId, quantity: 1, unit }],
        })

    test('a unit of the same kind is accepted', async () => {
      const res = await create('g').expect(201)
      await request(http)
        .delete(`/api/recipes/${(res.body as { id: string }).id}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
    })

    test('a unit from another dimension is refused while no rule bridges it', async () => {
      const res = await create('ea').expect(400)
      expect((res.body as { error: { message: string } }).error.message).toContain(
        'does not convert',
      )
    })

    test('the same unit is accepted once a rule bridges it', async () => {
      const rule = await request(http)
        .post('/api/unit-conversions')
        .set('Cookie', goldenForkCookie)
        .send({ ingredientId, fromUnit: 'ea', toUnit: 'kg', factor: 0.5 })
        .expect(201)

      const res = await create('ea').expect(201)
      await request(http)
        .delete(`/api/recipes/${(res.body as { id: string }).id}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      await request(http)
        .delete(`/api/unit-conversions/${(rule.body as { id: string }).id}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
    })
  })

  describe('a conversion may belong to one recipe, and there it wins', () => {
    let organizationId = ''
    let ingredientId = ''
    const recipeIds: string[] = []

    const recipe = async (name: string, extra: Record<string, unknown> = {}) => {
      const res = await request(http)
        .post('/api/recipes')
        .set('Cookie', goldenForkCookie)
        .send({ name, portions: 1, ...extra })
        .expect(201)
      const id = (res.body as { id: string }).id
      recipeIds.push(id)
      return id
    }
    const rule = (body: Record<string, unknown>) =>
      request(http).post('/api/unit-conversions').set('Cookie', goldenForkCookie).send(body)
    const lines = (id: string, unit: string, quantity = 2) =>
      request(http)
        .patch(`/api/recipes/${id}`)
        .set('Cookie', goldenForkCookie)
        .send({ ingredients: [{ ingredientId, quantity, unit }] })
    const cost = async (id: string) => {
      const res = await request(http)
        .get(`/api/recipes/${id}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      return (res.body as { cost: number }).cost
    }

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      organizationId = org.id
      const ingredient = await prisma.client.ingredient.create({
        data: { organizationId, name: 'Recipe Rule Probe Oil', unit: 'kg', costPerUnit: 10 },
      })
      ingredientId = ingredient.id
    })

    afterAll(async () => {
      await prisma.client.unitConversion.deleteMany({
        where: { OR: [{ ingredientId }, { recipeId: { in: recipeIds } }] },
      })
      await prisma.client.recipeComponent.deleteMany({
        where: { OR: [{ parentId: { in: recipeIds } }, { componentId: { in: recipeIds } }] },
      })
      await prisma.client.recipeIngredient.deleteMany({ where: { recipeId: { in: recipeIds } } })
      await prisma.client.recipe.deleteMany({ where: { id: { in: recipeIds } } })
      await prisma.client.ingredient.delete({ where: { id: ingredientId } })
    })

    test('a rule recorded for one recipe lets that recipe state the unit, and only that recipe', async () => {
      const mine = await recipe('Recipe Rule Probe Vinaigrette')
      const other = await recipe('Recipe Rule Probe Dressing')
      await lines(mine, 'cup').expect(400)

      const created = await rule({
        recipeId: mine,
        ingredientId,
        fromUnit: 'cup',
        toUnit: 'kg',
        factor: 0.2,
      }).expect(201)
      expect(created.body).toMatchObject({
        recipeId: mine,
        recipe: 'Recipe Rule Probe Vinaigrette',
      })

      await lines(mine, 'cup').expect(200)
      expect(await cost(mine)).toBeCloseTo(4, 4)
      const refused = await lines(other, 'cup').expect(400)
      expect((refused.body as { error: { message: string } }).error.message).toContain(
        'does not convert',
      )

      const listed = await request(http)
        .get('/api/unit-conversions')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const row = (listed.body as { id: string; recipeId: string | null }[]).find(
        (r) => r.id === (created.body as { id: string }).id,
      )
      expect(row?.recipeId).toBe(mine)
    })

    test("a recipe's own rule is taken over the ingredient's, and the ingredient's still holds elsewhere", async () => {
      const mine = await recipe('Recipe Rule Probe Taro Cups')
      const other = await recipe('Recipe Rule Probe Fried Taro')
      await rule({ ingredientId, fromUnit: 'tbsp', toUnit: 'kg', factor: 0.5 }).expect(201)
      await rule({
        recipeId: mine,
        ingredientId,
        fromUnit: 'tbsp',
        toUnit: 'kg',
        factor: 0.1,
      }).expect(201)

      await lines(mine, 'tbsp').expect(200)
      await lines(other, 'tbsp').expect(200)
      expect(await cost(mine)).toBeCloseTo(2, 4)
      expect(await cost(other)).toBeCloseTo(10, 4)
    })

    test('the same pair twice in one recipe is refused, beside a shared one it is not', async () => {
      const mine = await recipe('Recipe Rule Probe Glaze')
      await rule({ ingredientId, fromUnit: 'tsp', toUnit: 'kg', factor: 0.001 }).expect(201)
      await rule({
        recipeId: mine,
        ingredientId,
        fromUnit: 'tsp',
        toUnit: 'kg',
        factor: 0.002,
      }).expect(201)
      const again = await rule({
        recipeId: mine,
        ingredientId,
        fromUnit: 'kg',
        toUnit: 'tsp',
        factor: 500,
      }).expect(400)
      expect((again.body as { error: { code: string } }).error.code).toBe(
        'CONVERSION_ALREADY_RECORDED',
      )
    })

    test('a nested recipe is measured through the rules of the recipe that uses it', async () => {
      const component = await recipe('Recipe Rule Probe Soy-Lime', {
        yieldAmount: 1,
        yieldUnit: 'l',
        ingredients: [{ ingredientId, quantity: 1, unit: 'kg' }],
      })
      const parent = await recipe('Recipe Rule Probe Tartare')
      const elsewhere = await recipe('Recipe Rule Probe Ceviche')
      await rule({ recipeId: parent, fromUnit: 'ea', toUnit: 'l', factor: 0.25 }).expect(201)

      await request(http)
        .post(`/api/recipes/${parent}/components`)
        .set('Cookie', goldenForkCookie)
        .send({ componentId: component, quantity: 2, unit: 'ea' })
        .expect(201)
      expect(await cost(parent)).toBeCloseTo(5, 4)

      const refused = await request(http)
        .post(`/api/recipes/${elsewhere}/components`)
        .set('Cookie', goldenForkCookie)
        .send({ componentId: component, quantity: 2, unit: 'ea' })
        .expect(400)
      expect((refused.body as { error: { code: string } }).error.code).toBe(
        'COMPONENT_UNIT_INVALID',
      )
    })

    test('a rule a recipe line still needs cannot be removed, and goes with its recipe', async () => {
      const mine = await recipe('Recipe Rule Probe Crumb')
      const created = await rule({
        recipeId: mine,
        ingredientId,
        fromUnit: 'dozen',
        toUnit: 'kg',
        factor: 0.3,
      }).expect(201)
      const id = (created.body as { id: string }).id
      await lines(mine, 'dozen').expect(200)

      const refused = await request(http)
        .delete(`/api/unit-conversions/${id}`)
        .set('Cookie', goldenForkCookie)
        .expect(400)
      expect((refused.body as { error: { code: string } }).error.code).toBe('CONVERSION_IN_USE')

      await request(http).delete(`/api/recipes/${mine}`).set('Cookie', goldenForkCookie).expect(200)
      expect(await prisma.client.unitConversion.count({ where: { id } })).toBe(0)
    })

    test('a recipe of another organization cannot be given a rule', async () => {
      const mine = await recipe('Recipe Rule Probe Foreign')
      await request(http)
        .post('/api/unit-conversions')
        .set('Cookie', bellaCucinaCookie)
        .send({ recipeId: mine, fromUnit: 'ea', toUnit: 'kg', factor: 1 })
        .expect((res) => expect([400, 404]).toContain(res.status))
      expect(await prisma.client.unitConversion.count({ where: { recipeId: mine } })).toBe(0)
    })
  })

  describe('a closed location is history, not a price anyone pays now', () => {
    test('the cost range across locations leaves out what an archived location paid', async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const closed = await prisma.client.location.create({
        data: { organizationId: org.id, name: 'Probe Closed Kitchen', isActive: false },
      })
      const ingredient = await prisma.client.ingredient.create({
        data: { organizationId: org.id, name: 'Probe Range Saffron', unit: 'kg', costPerUnit: 10 },
      })
      try {
        await prisma.client.ingredientLocationSettings.create({
          data: { ingredientId: ingredient.id, locationId: closed.id, costPerUnit: 99 },
        })
        const rows = (
          await request(http).get('/api/ingredients').set('Cookie', goldenForkCookie).expect(200)
        ).body as { id: string; costLow: number | null; costHigh: number | null }[]
        const row = rows.find((r) => r.id === ingredient.id)!
        expect([row.costLow, row.costHigh]).toEqual([10, 10])
      } finally {
        await prisma.client.ingredientLocationSettings.deleteMany({
          where: { ingredientId: ingredient.id },
        })
        await prisma.client.ingredient.delete({ where: { id: ingredient.id } })
        await prisma.client.location.delete({ where: { id: closed.id } })
      }
    })
  })

  test('the activity feed speaks in the currency the organization chose', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    await prisma.client.organization.update({ where: { id: org.id }, data: { currency: 'EUR' } })
    try {
      const events = (
        await request(http)
          .get('/api/dashboard/activity')
          .set('Cookie', goldenForkCookie)
          .expect(200)
      ).body as { type: string; text: string }[]
      const costed = events.filter((e) => e.type === 'recipe')
      expect(costed.length).toBeGreaterThan(0)
      for (const e of costed) expect(e.text).toMatch(/€/)
    } finally {
      await prisma.client.organization.update({
        where: { id: org.id },
        data: { currency: org.currency },
      })
    }
  })

  describe('a price trend compares a price with the earlier price of the same place', () => {
    test('two locations paying differently is not a change in price', async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const [airport, riverside] = await Promise.all(
        ['Airport', 'Riverside'].map((n) =>
          prisma.client.location.findFirstOrThrow({
            where: { organizationId: org.id, name: { endsWith: n } },
          }),
        ),
      )
      const ingredient = await prisma.client.ingredient.create({
        data: { organizationId: org.id, name: 'Probe Trend Vanilla', unit: 'kg', costPerUnit: 10 },
      })
      const day = 86400000
      try {
        await prisma.client.ingredientPriceHistory.createMany({
          data: [
            {
              organizationId: org.id,
              ingredientId: ingredient.id,
              locationId: riverside.id,
              costPerUnit: 10,
              source: 'receipt',
              recordedAt: new Date(Date.now() - 3 * day),
            },
            {
              organizationId: org.id,
              ingredientId: ingredient.id,
              locationId: airport.id,
              costPerUnit: 20,
              source: 'receipt',
              recordedAt: new Date(Date.now() - 2 * day),
            },
          ],
        })
        const trendOf = async () =>
          (
            (
              await request(http)
                .get('/api/reports/price-trends')
                .set('Cookie', goldenForkCookie)
                .expect(200)
            ).body as {
              id: string
              previous: number
              current: number
              change: number
            }[]
          ).find((r) => r.id === ingredient.id)!
        expect(await trendOf()).toMatchObject({ previous: 20, current: 20, change: 0 })

        await prisma.client.ingredientPriceHistory.create({
          data: {
            organizationId: org.id,
            ingredientId: ingredient.id,
            locationId: riverside.id,
            costPerUnit: 12,
            source: 'receipt',
            recordedAt: new Date(Date.now() - day),
          },
        })
        expect(await trendOf()).toMatchObject({ previous: 10, current: 12, change: 20 })
      } finally {
        await prisma.client.ingredientPriceHistory.deleteMany({
          where: { ingredientId: ingredient.id },
        })
        await prisma.client.ingredient.delete({ where: { id: ingredient.id } })
      }
    })
  })

  describe('stock across locations is worth what each location paid for it', () => {
    test('the value of a row is each location stock at its own price', async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const locations = await prisma.client.location.findMany({
        where: { organizationId: org.id, isActive: true },
        orderBy: { name: 'asc' },
      })
      const ingredient = await prisma.client.ingredient.create({
        data: {
          organizationId: org.id,
          name: 'Probe Valued Saffron',
          unit: 'kg',
          costPerUnit: 10,
          onHand: 3 * locations.length,
        },
      })
      try {
        await prisma.client.ingredientLocationStock.createMany({
          data: locations.map((l) => ({
            ingredientId: ingredient.id,
            locationId: l.id,
            onHand: 3,
          })),
        })
        await prisma.client.ingredientLocationSettings.create({
          data: { ingredientId: ingredient.id, locationId: locations[0].id, costPerUnit: 50 },
        })
        const rows = (
          await request(http).get('/api/ingredients').set('Cookie', goldenForkCookie).expect(200)
        ).body as { id: string; value: number }[]
        expect(rows.find((r) => r.id === ingredient.id)!.value).toBe(
          3 * 50 + 3 * 10 * (locations.length - 1),
        )
        const here = (
          await request(http)
            .get('/api/ingredients')
            .set('Cookie', goldenForkCookie)
            .set('X-Location-Id', locations[0].id)
            .expect(200)
        ).body as { id: string; value: number }[]
        expect(here.find((r) => r.id === ingredient.id)!.value).toBe(150)
      } finally {
        await prisma.client.ingredientLocationSettings.deleteMany({
          where: { ingredientId: ingredient.id },
        })
        await prisma.client.ingredientLocationStock.deleteMany({
          where: { ingredientId: ingredient.id },
        })
        await prisma.client.ingredient.delete({ where: { id: ingredient.id } })
      }
    })
  })

  describe('stock is low wherever one location runs low', () => {
    test('across locations an ingredient is low when a location holds no more than its own level', async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const locations = await prisma.client.location.findMany({
        where: { organizationId: org.id, isActive: true },
        orderBy: { name: 'asc' },
      })
      const ingredient = await prisma.client.ingredient.create({
        data: {
          organizationId: org.id,
          name: 'Probe Low Somewhere',
          unit: 'kg',
          costPerUnit: 1,
          reorderLevel: 5,
          onHand: 103,
        },
      })
      try {
        await prisma.client.ingredientLocationStock.createMany({
          data: locations.map((l, at) => ({
            ingredientId: ingredient.id,
            locationId: l.id,
            onHand: at === 0 ? 3 : 50,
          })),
        })
        const rowOf = async () => {
          const rows = (
            await request(http).get('/api/ingredients').set('Cookie', goldenForkCookie).expect(200)
          ).body as { id: string; status: string; lowAt: string[] }[]
          return rows.find((r) => r.id === ingredient.id)!
        }
        const statusOf = async () => (await rowOf()).status
        expect(await statusOf()).toBe('low')
        expect((await rowOf()).lowAt).toEqual([locations[0].name])

        await prisma.client.ingredientLocationSettings.create({
          data: { ingredientId: ingredient.id, locationId: locations[0].id, reorderLevel: 2 },
        })
        expect(await statusOf()).toBe('ok')
      } finally {
        await prisma.client.ingredientLocationSettings.deleteMany({
          where: { ingredientId: ingredient.id },
        })
        await prisma.client.ingredientLocationStock.deleteMany({
          where: { ingredientId: ingredient.id },
        })
        await prisma.client.ingredient.delete({ where: { id: ingredient.id } })
      }
    })
  })

  describe('one shared ingredient, priced and sourced by each location', () => {
    let ingredientId = ''
    let downtown = ''
    let riverside = ''
    let vendorA = ''
    let vendorB = ''

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const locations = await prisma.client.location.findMany({
        where: { organizationId: org.id, isActive: true },
        orderBy: { name: 'asc' },
      })
      downtown = locations.find((l) => l.name.includes('Downtown'))!.id
      riverside = locations.find((l) => l.name.includes('Riverside'))!.id

      const vendors = await prisma.client.vendor.findMany({
        where: { organizationId: org.id, status: 'active' },
        orderBy: { name: 'asc' },
        take: 2,
      })
      vendorA = vendors[0].id
      vendorB = vendors[1].id

      const created = await prisma.client.ingredient.create({
        data: {
          organizationId: org.id,
          name: 'Mozzarella Probe 10 kg pack',
          unit: 'kg',
          costPerUnit: 6,
          reorderLevel: 10,
          vendorId: vendorA,
          sku: '124',
        },
      })
      ingredientId = created.id
    })

    afterAll(async () => {
      await prisma.client.ingredientLocationSettings.deleteMany({ where: { ingredientId } })
      await prisma.client.ingredientLocationStock.deleteMany({ where: { ingredientId } })
      await prisma.client.ingredientPriceHistory.deleteMany({ where: { ingredientId } })
      await prisma.client.ingredient.delete({ where: { id: ingredientId } })
    })

    const seenAt = async (locationId: string) => {
      const res = await request(http)
        .get('/api/ingredients')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(200)
      return (
        res.body as {
          id: string
          costPerUnit: number
          vendor: string
          vendorSku: string
          reorderLevel: number
        }[]
      ).find((i) => i.id === ingredientId)!
    }

    test('cost, vendor, reorder level and vendor code belong to the location that set them', async () => {
      await request(http)
        .patch(`/api/ingredients/${ingredientId}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({ costPerUnit: 6, vendorId: vendorA, reorderLevel: 10, vendorSku: '123' })
        .expect(200)

      const before = await seenAt(riverside)

      await request(http)
        .patch(`/api/ingredients/${ingredientId}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', riverside)
        .send({ costPerUnit: 7, vendorId: vendorB, reorderLevel: 15, vendorSku: '321' })
        .expect(200)

      const here = await seenAt(downtown)
      expect(here.costPerUnit).toBeCloseTo(6, 2)
      expect(here.vendorSku).toBe('123')
      expect(here.reorderLevel).toBeCloseTo(10, 3)

      const there = await seenAt(riverside)
      expect(there.costPerUnit).toBeCloseTo(7, 2)
      expect(there.vendorSku).toBe('321')
      expect(there.reorderLevel).toBeCloseTo(15, 3)
      expect(there.vendor).not.toBe(before.vendor)
    })

    test('the name and the base unit stay shared across every location', async () => {
      await request(http)
        .patch(`/api/ingredients/${ingredientId}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({ name: 'Mozzarella Probe 12 kg pack' })
        .expect(200)

      for (const locationId of [downtown, riverside]) {
        const row = await seenAt(locationId)
        expect((row as unknown as { name: string }).name).toBe('Mozzarella Probe 12 kg pack')
      }
    })

    test('all locations answers with the shared record and what each location does with it', async () => {
      const res = await request(http)
        .get(`/api/ingredients/${ingredientId}/locations`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const body = res.body as {
        shared: { name: string; unit: string; sku: string }
        locations: { location: string; costPerUnit: number; vendorSku: string }[]
        totals: { locations: number; vendors: number; costLow: number; costHigh: number }
      }
      expect(body.shared.unit).toBe('kg')
      expect(body.shared.sku).toBe('124')
      expect(body.locations.length).toBe(body.totals.locations)
      expect(body.totals.costLow).toBeCloseTo(6, 2)
      expect(body.totals.costHigh).toBeCloseTo(7, 2)
      expect(body.totals.vendors).toBeGreaterThanOrEqual(2)
    })

    test('another organization is not shown what a location pays', async () => {
      await request(http)
        .get(`/api/ingredients/${ingredientId}/locations`)
        .set('Cookie', bellaCucinaCookie)
        .expect(404)
    })

    test('stock is valued at the price the location itself pays', async () => {
      const offered = async (locationId: string) => {
        const res = await request(http)
          .get('/api/waste/ingredients')
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', locationId)
          .expect(200)
        return (res.body as { id: string; unitCost: number }[]).find((i) => i.id === ingredientId)!
      }

      expect((await offered(downtown)).unitCost).toBeCloseTo(6, 2)
      expect((await offered(riverside)).unitCost).toBeCloseTo(7, 2)

      await request(http)
        .post('/api/inventory/transactions')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', riverside)
        .send({ ingredientId, type: 'RECEIVE', quantity: 4 })
        .expect(201)

      const waste = await request(http)
        .post('/api/waste')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', riverside)
        .send({ ingredientId, quantity: 1, reason: 'spoilage' })
        .expect(201)

      const entry = await prisma.client.wasteEntry.findUniqueOrThrow({
        where: { id: (waste.body as { id: string }).id },
      })
      expect(Number(entry.value)).toBeCloseTo(7, 2)

      await prisma.client.wasteEntry.delete({ where: { id: entry.id } })
      await prisma.client.inventoryTransaction.deleteMany({ where: { ingredientId } })
    })

    test('price history at a location does not carry another location the same ingredient', async () => {
      const res = await request(http)
        .get(`/api/ingredients/${ingredientId}/price-history`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', riverside)
        .expect(200)
      const records = (res.body as { data: { locationId: string | null }[] }).data
      expect(records.length).toBeGreaterThan(0)
      expect(records.every((r) => r.locationId === riverside || r.locationId === null)).toBe(true)
      expect(records.some((r) => r.locationId === downtown)).toBe(false)
    })

    test('a price recorded at a location credits the vendor that location buys from', async () => {
      await request(http)
        .patch(`/api/ingredients/${ingredientId}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', riverside)
        .send({ costPerUnit: 7.5 })
        .expect(200)

      const res = await request(http)
        .get(`/api/ingredients/${ingredientId}/price-history`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', riverside)
        .expect(200)
      const latest = (res.body as { data: { vendorId: string | null; costPerUnit: number }[] })
        .data[0]
      expect(latest.costPerUnit).toBeCloseTo(7.5, 2)
      expect(latest.vendorId).toBe(vendorB)
    })

    test('the price trend at a location follows that location, and names who it buys from', async () => {
      await request(http)
        .patch(`/api/ingredients/${ingredientId}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({ costPerUnit: 6.25, vendorId: vendorA })
        .expect(200)
      await request(http)
        .patch(`/api/ingredients/${ingredientId}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', riverside)
        .send({ costPerUnit: 8.75, vendorId: vendorB })
        .expect(200)

      const trendAt = async (locationId: string) => {
        const res = await request(http)
          .get('/api/reports/price-trends')
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', locationId)
          .expect(200)
        return (res.body as { id: string; current: number; vendor: string }[]).find(
          (r) => r.id === ingredientId,
        )!
      }

      const here = await trendAt(downtown)
      expect(here.current).toBeCloseTo(6.25, 2)

      const there = await trendAt(riverside)
      expect(there.current).toBeCloseTo(8.75, 2)
      expect(there.vendor).not.toBe(here.vendor)
    })

    test('the catalogue says how many locations share the ingredient', async () => {
      const res = await request(http)
        .get('/api/ingredients')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const row = (res.body as { id: string; locations: number }[]).find(
        (i) => i.id === ingredientId,
      )!
      const active = await prisma.client.location.count({
        where: { organization: { slug: 'golden-fork' }, isActive: true },
      })
      expect(row.locations).toBe(active)
    })

    test('the answer to a write is what that location will read back', async () => {
      const written = await request(http)
        .patch(`/api/ingredients/${ingredientId}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({ costPerUnit: 6.75, vendorId: vendorB, reorderLevel: 11, vendorSku: 'DT-9' })
        .expect(200)

      const body = written.body as {
        costPerUnit: number
        reorderLevel: number
        vendorSku: string
        vendor: string
      }
      expect(body.costPerUnit).toBeCloseTo(6.75, 2)
      expect(body.reorderLevel).toBeCloseTo(11, 3)
      expect(body.vendorSku).toBe('DT-9')

      const read = await seenAt(downtown)
      expect(body.costPerUnit).toBeCloseTo(read.costPerUnit, 2)
      expect(body.vendorSku).toBe(read.vendorSku)
      expect(body.vendor).toBe(read.vendor)
    })

    test('a write with no location answers with the consolidated view', async () => {
      const written = await request(http)
        .patch(`/api/ingredients/${ingredientId}`)
        .set('Cookie', goldenForkCookie)
        .send({ costPerUnit: 7.5 })
        .expect(200)

      const active = await prisma.client.location.count({
        where: { organization: { slug: 'golden-fork' }, isActive: true },
      })
      const body = written.body as {
        locations: number
        vendors: number
        costLow: number | null
        costHigh: number | null
      }
      expect(body.locations).toBe(active)
      expect(body.vendors).toBeGreaterThan(0)

      const res = await request(http)
        .get('/api/ingredients')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const listed = (
        res.body as {
          id: string
          locations: number
          vendors: number
          costLow: number | null
          costHigh: number | null
        }[]
      ).find((i) => i.id === ingredientId)!
      expect(body).toMatchObject({
        locations: listed.locations,
        vendors: listed.vendors,
        costLow: listed.costLow,
        costHigh: listed.costHigh,
      })
    })

    test('an ingredient entered at a location carries its own settings there', async () => {
      const created = await request(http)
        .post('/api/ingredients')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({
          name: 'Provolone Probe 5 kg pack',
          unit: 'kg',
          costPerUnit: 8,
          reorderLevel: 12,
          vendorId: vendorA,
          vendorSku: 'DT-PROV',
        })
        .expect(201)
      const newId = (created.body as { id: string }).id

      try {
        expect(created.body).toMatchObject({ vendorSku: 'DT-PROV' })

        const res = await request(http)
          .get(`/api/ingredients/${newId}/locations`)
          .set('Cookie', goldenForkCookie)
          .expect(200)
        const rows = (
          res.body as {
            locations: {
              locationId: string
              costPerUnit: number
              reorderLevel: number
              vendorSku: string
              ownSettings: boolean
            }[]
          }
        ).locations
        const here = rows.find((r) => r.locationId === downtown)!
        expect(here.ownSettings).toBe(true)
        expect(here.costPerUnit).toBeCloseTo(8, 2)
        expect(here.reorderLevel).toBeCloseTo(12, 3)
        expect(here.vendorSku).toBe('DT-PROV')

        const elsewhere = rows.find((r) => r.locationId === riverside)!
        expect(elsewhere.ownSettings).toBe(false)
        expect(elsewhere.costPerUnit).toBeCloseTo(8, 2)

        await request(http)
          .patch(`/api/ingredients/${newId}`)
          .set('Cookie', goldenForkCookie)
          .send({ costPerUnit: 9.25 })
          .expect(200)

        const again = await request(http)
          .get(`/api/ingredients/${newId}/locations`)
          .set('Cookie', goldenForkCookie)
          .expect(200)
        const rowsAgain = (
          again.body as { locations: { locationId: string; costPerUnit: number }[] }
        ).locations
        expect(rowsAgain.find((r) => r.locationId === downtown)!.costPerUnit).toBeCloseTo(8, 2)
        expect(rowsAgain.find((r) => r.locationId === riverside)!.costPerUnit).toBeCloseTo(9.25, 2)
      } finally {
        await prisma.client.ingredientLocationSettings.deleteMany({
          where: { ingredientId: newId },
        })
        await prisma.client.ingredientLocationStock.deleteMany({ where: { ingredientId: newId } })
        await prisma.client.ingredientPriceHistory.deleteMany({ where: { ingredientId: newId } })
        await prisma.client.ingredient.delete({ where: { id: newId } })
      }
    })
  })

  test('the unit catalogue names the dimension each unit belongs to', async () => {
    const res = await request(http).get('/api/units').set('Cookie', goldenForkCookie).expect(200)
    const rows = res.body as { value: string; label: string; dimension: string; perBase: number }[]
    const kg = rows.find((u) => u.value === 'kg')
    expect(kg).toMatchObject({ dimension: 'mass', label: 'Kilogram' })
    expect(rows.find((u) => u.value === 'l')?.dimension).toBe('volume')
    expect(rows.find((u) => u.value === 'ea')?.dimension).toBe('count')
  })

  test('the target a food cost is measured against is the one the organization set', async () => {
    const read = async () => {
      const res = await request(http)
        .get('/api/dashboard/kpis')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      return (res.body as { foodCostTarget: number }).foodCostTarget
    }
    const before = await read()

    try {
      await request(http)
        .patch('/api/organizations/current')
        .set('Cookie', goldenForkCookie)
        .send({ foodCostTargetPct: 26.5 })
        .expect(200)
      expect(await read()).toBeCloseTo(26.5, 2)

      const theirs = await request(http)
        .get('/api/dashboard/kpis')
        .set('Cookie', bellaCucinaCookie)
        .expect(200)
      expect((theirs.body as { foodCostTarget: number }).foodCostTarget).toBeCloseTo(30, 2)
    } finally {
      await request(http)
        .patch('/api/organizations/current')
        .set('Cookie', goldenForkCookie)
        .send({ foodCostTargetPct: before })
        .expect(200)
    }
  })

  test('waste is recorded on the day it happened, not the day it was typed', async () => {
    const ingredient = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'All-Purpose Flour' },
    })
    const location = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    const happened = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString().slice(0, 10)

    const res = await request(http)
      .post('/api/waste')
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', location.id)
      .send({ ingredientId: ingredient.id, quantity: 0.2, reason: 'spoilage', date: happened })
      .expect(201)
    const id = (res.body as { id: string }).id

    try {
      const stored = await prisma.client.wasteEntry.findUniqueOrThrow({ where: { id } })
      expect(stored.date.toISOString().slice(0, 10)).toBe(happened)
    } finally {
      const entry = await prisma.client.wasteEntry.findUnique({ where: { id } })
      if (entry) {
        await prisma.client.wasteEntry.delete({ where: { id } })
        await prisma.client.inventoryTransaction.deleteMany({
          where: { ingredientId: ingredient.id, type: 'WASTE', quantity: -0.2 },
        })
        await prisma.client.ingredient.update({
          where: { id: ingredient.id },
          data: { onHand: { increment: 0.2 } },
        })
        await prisma.client.ingredientLocationStock.update({
          where: {
            ingredientId_locationId: { ingredientId: ingredient.id, locationId: location.id },
          },
          data: { onHand: { increment: 0.2 } },
        })
      }
    }
  })

  test('a menu item answers with what was written, on creation and on edit', async () => {
    const recipe = await prisma.client.recipe.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' } },
      select: { id: true, name: true },
    })
    const name = `E2E Dish ${Date.now()}`

    const created = await request(http)
      .post('/api/menu-items')
      .set('Cookie', goldenForkCookie)
      .send({ name, price: 21.5, recipes: [{ recipeId: recipe.id, portions: 1 }] })
      .expect(201)
    const dish = created.body as {
      id: string
      name: string
      price: number
      cost: number
      active: boolean
      recipes: { id: string; name: string }[]
    }

    expect(dish.id).toEqual(expect.any(String))

    try {
      expect(dish.name).toBe(name)
      expect(dish.price).toBeCloseTo(21.5, 2)
      expect(dish.recipes.map((r) => r.id)).toEqual([recipe.id])
      expect(dish.cost).toBeGreaterThan(0)

      const listed = await request(http)
        .get('/api/menu-items')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const fromList = (listed.body as (typeof dish)[]).find((m) => m.id === dish.id)
      expect(fromList).toEqual(dish)

      const edited = await request(http)
        .patch(`/api/menu-items/${dish.id}`)
        .set('Cookie', goldenForkCookie)
        .send({ price: 24 })
        .expect(200)
      expect((edited.body as typeof dish).price).toBeCloseTo(24, 2)
      expect((edited.body as typeof dish).cost).toBeCloseTo(dish.cost, 2)
    } finally {
      await request(http)
        .delete(`/api/menu-items/${dish.id}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
    }
  })

  test('the variance report costs the dishes that were sold, not only their categories', async () => {
    const res = await request(http)
      .get('/api/analytics/food-cost-variance')
      .set('Cookie', goldenForkCookie)
      .expect(200)
    const report = res.body as {
      theoreticalCost: number
      actualCost: number
      wasteCost: number
      byDish: {
        menuItemId: string
        name: string
        quantity: number
        standardCost: number
        actualCost: number
        wasteCost: number
        variance: number
      }[]
    }

    expect(report.byDish.length).toBeGreaterThan(0)
    for (const dish of report.byDish) {
      expect(dish.name).not.toBe('')
      expect(dish.quantity).toBeGreaterThan(0)
      expect(dish.standardCost).toBeGreaterThan(0)
      expect(dish.variance).toBeCloseTo(dish.actualCost - dish.standardCost, 2)
      expect(dish.wasteCost).toBeLessThanOrEqual(dish.actualCost + 0.01)
    }

    const dishTotal = report.byDish.reduce((sum, d) => sum + d.standardCost, 0)
    expect(dishTotal).toBeCloseTo(report.theoreticalCost, 1)
    const apportioned = report.byDish.reduce((sum, d) => sum + d.actualCost, 0)
    expect(apportioned).toBeLessThanOrEqual(report.actualCost + 0.01)
    expect(report.wasteCost).toBeGreaterThan(0)

    const theirs = await request(http)
      .get('/api/analytics/food-cost-variance')
      .set('Cookie', bellaCucinaCookie)
      .expect(200)
    const names = (theirs.body as typeof report).byDish.map((d) => d.name)
    expect(names).not.toContain(report.byDish[0].name)
  })
  describe('an ingredient is archived rather than deleted', () => {
    let ingredientId = ''

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const created = await prisma.client.ingredient.create({
        data: {
          organizationId: org.id,
          name: 'Seasonal Probe Ingredient',
          unit: 'kg',
          costPerUnit: 4,
        },
      })
      ingredientId = created.id
    })

    afterAll(async () => {
      await prisma.client.ingredient.deleteMany({ where: { id: ingredientId } })
    })

    const names = async (path: string) => {
      const res = await request(http).get(path).set('Cookie', goldenForkCookie).expect(200)
      return (res.body as { name: string }[]).map((r) => r.name)
    }

    test('an archived ingredient leaves the catalogue but stays on file', async () => {
      expect(await names('/api/ingredients')).toContain('Seasonal Probe Ingredient')

      await request(http)
        .patch(`/api/ingredients/${ingredientId}`)
        .set('Cookie', goldenForkCookie)
        .send({ isActive: false })
        .expect(200)
        .expect((res) => expect((res.body as { isActive: boolean }).isActive).toBe(false))

      expect(await names('/api/ingredients')).not.toContain('Seasonal Probe Ingredient')
      expect(await names('/api/ingredients?includeArchived=true')).toContain(
        'Seasonal Probe Ingredient',
      )

      const stillThere = await prisma.client.ingredient.findUniqueOrThrow({
        where: { id: ingredientId },
      })
      expect(Number(stillThere.costPerUnit)).toBe(4)
    })

    test("archiving and restoring are a manager's, as the screen already says", async () => {
      const chef = await login('ken@goldenfork.com')
      const refused = await request(http)
        .patch(`/api/ingredients/${ingredientId}`)
        .set('Cookie', chef)
        .send({ isActive: true })
        .expect(403)
      expect(refused.body.error.message).toMatch(/manager or above/)
      await request(http)
        .patch(`/api/ingredients/${ingredientId}`)
        .set('Cookie', chef)
        .send({ sku: 'PROBE-CHEF' })
        .expect(200)
      const manager = await login('maria@goldenfork.com')
      await request(http)
        .patch(`/api/ingredients/${ingredientId}`)
        .set('Cookie', manager)
        .send({ isActive: false })
        .expect(200)
    })

    test('an archived ingredient is offered nowhere new work is written', async () => {
      const waste = await request(http)
        .get('/api/waste/ingredients')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      expect((waste.body as { name: string }[]).map((r) => r.name)).not.toContain(
        'Seasonal Probe Ingredient',
      )
    })

    test('restoring it puts it back where it was', async () => {
      await request(http)
        .patch(`/api/ingredients/${ingredientId}`)
        .set('Cookie', goldenForkCookie)
        .send({ isActive: true })
        .expect(200)
      expect(await names('/api/ingredients')).toContain('Seasonal Probe Ingredient')
    })

    test('an ingredient a recipe uses refuses deletion and names the way out', async () => {
      const ing = await prisma.client.ingredient.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, usedIn: { some: {} } },
      })
      const res = await request(http)
        .delete(`/api/ingredients/${ing.id}`)
        .set('Cookie', goldenForkCookie)
        .expect(400)
      expect((res.body as { error: { message: string } }).error.message).toMatch(
        /archive it instead/i,
      )
    })

    test('an ingredient with stock and movements on record refuses deletion, an untouched one goes', async () => {
      const location = await prisma.client.location.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, isActive: true },
        orderBy: { name: 'asc' },
      })
      const held = await request(http)
        .post('/api/ingredients')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', location.id)
        .send({ name: 'Probe Held Saffron', unit: 'kg', costPerUnit: 100, onHand: 2 })
        .expect(201)
      const heldId = (held.body as { id: string }).id
      const untouched = await request(http)
        .post('/api/ingredients')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Probe Typo Saffron', unit: 'kg', costPerUnit: 100 })
        .expect(201)
      try {
        const res = await request(http)
          .delete(`/api/ingredients/${heldId}`)
          .set('Cookie', goldenForkCookie)
          .expect(400)
        expect((res.body as { error: { message: string } }).error.message).toMatch(
          /archive it instead/i,
        )
        expect(
          await prisma.client.inventoryTransaction.count({ where: { ingredientId: heldId } }),
        ).toBe(1)

        await request(http)
          .delete(`/api/ingredients/${(untouched.body as { id: string }).id}`)
          .set('Cookie', goldenForkCookie)
          .expect(200)
      } finally {
        await prisma.client.inventoryTransaction.deleteMany({ where: { ingredientId: heldId } })
        await prisma.client.ingredientLocationStock.deleteMany({ where: { ingredientId: heldId } })
        await prisma.client.ingredientLocationSettings.deleteMany({
          where: { ingredientId: heldId },
        })
        await prisma.client.ingredientPriceHistory.deleteMany({ where: { ingredientId: heldId } })
        await prisma.client.ingredient.deleteMany({
          where: { name: { in: ['Probe Held Saffron', 'Probe Typo Saffron'] } },
        })
      }
    })
  })
  describe('a dish name belongs to the menu that serves it', () => {
    const NAME = 'Probe Caesar'
    let downtown = ''
    let riverside = ''
    const created: string[] = []

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const locations = await prisma.client.location.findMany({
        where: { organizationId: org.id, isActive: true },
        orderBy: { name: 'asc' },
      })
      downtown = locations.find((l) => l.name.includes('Downtown'))!.id
      riverside = locations.find((l) => l.name.includes('Riverside'))!.id
    })

    afterAll(async () => {
      await prisma.client.menuItem.deleteMany({ where: { id: { in: created } } })
    })

    const add = (body: Record<string, unknown>) =>
      request(http).post('/api/menu-items').set('Cookie', goldenForkCookie).send(body)

    test('the same dish carries its own price at another location', async () => {
      const here = await add({ name: NAME, price: 14, locationId: downtown }).expect(201)
      created.push(here.body.id as string)
      const there = await add({ name: NAME, price: 17, locationId: riverside }).expect(201)
      created.push(there.body.id as string)

      expect(here.body.price).toBe(14)
      expect(there.body.price).toBe(17)
      expect(here.body.id).not.toBe(there.body.id)
    })

    test('the same name twice at one location is refused, whatever its case', async () => {
      const res = await add({ name: NAME.toUpperCase(), price: 19, locationId: downtown }).expect(
        409,
      )
      expect((res.body as { error: { message: string } }).error.message).toMatch(
        /already on the menu/i,
      )
    })

    test('a dish for the whole organization may not repeat a name a location already uses', async () => {
      const res = await add({ name: NAME, price: 15 }).expect(409)
      expect((res.body as { error: { message: string } }).error.message).toMatch(
        /already on the menu/i,
      )
    })

    test('a location may not repeat a name the whole organization already serves', async () => {
      const shared = await add({ name: 'Probe Shared Dish', price: 11 }).expect(201)
      created.push(shared.body.id as string)
      await add({ name: 'Probe Shared Dish', price: 13, locationId: downtown }).expect(409)
    })

    test('renaming into a taken name is refused, and saving a dish under its own name is not', async () => {
      await request(http)
        .patch(`/api/menu-items/${created[1]}`)
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Probe Shared Dish' })
        .expect(409)
      await request(http)
        .patch(`/api/menu-items/${created[1]}`)
        .set('Cookie', goldenForkCookie)
        .send({ name: NAME, price: 18 })
        .expect(200)
        .expect((res) => expect((res.body as { price: number }).price).toBe(18))
    })
  })
  describe('a menu is a named collection assigned to the locations that serve it', () => {
    let downtown = ''
    let riverside = ''
    let steak = ''
    let pasta = ''
    let menuId = ''

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const locations = await prisma.client.location.findMany({
        where: { organizationId: org.id, isActive: true },
        orderBy: { name: 'asc' },
      })
      downtown = locations.find((l) => l.name.includes('Downtown'))!.id
      riverside = locations.find((l) => l.name.includes('Riverside'))!.id
      steak = (
        await prisma.client.menuItem.findFirstOrThrow({
          where: { organizationId: org.id, name: 'Steak Frites' },
        })
      ).id
      pasta = (
        await prisma.client.menuItem.findFirstOrThrow({
          where: { organizationId: org.id, name: 'Pasta Marinara' },
        })
      ).id
    })

    afterAll(async () => {
      await prisma.client.menu.deleteMany({ where: { name: { startsWith: 'Probe ' } } })
    })

    test('a menu is created with its locations and its items, and answers with both', async () => {
      const res = await request(http)
        .post('/api/menus')
        .set('Cookie', goldenForkCookie)
        .send({
          name: 'Probe Dinner',
          description: 'Evening service',
          locationIds: [downtown, riverside],
          menuItemIds: [steak, pasta],
        })
        .expect(201)

      menuId = res.body.id as string
      expect(res.body.name).toBe('Probe Dinner')
      expect((res.body.locations as { id: string }[]).map((l) => l.id).sort()).toEqual(
        [downtown, riverside].sort(),
      )
      expect((res.body.items as { id: string }[]).map((i) => i.id)).toEqual([steak, pasta])
    })

    test('the analytics are the sum over the items the menu includes', async () => {
      const res = await request(http)
        .get(`/api/menus/${menuId}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)

      const items = res.body.items as { price: number; cost: number }[]
      const a = res.body.analytics as {
        items: number
        price: number
        cost: number
        margin: number
        foodCostPct: number
        target: number
      }
      expect(a.items).toBe(items.length)
      expect(a.price).toBeCloseTo(
        items.reduce((sum, i) => sum + i.price, 0),
        2,
      )
      expect(a.cost).toBeCloseTo(
        items.reduce((sum, i) => sum + i.cost, 0),
        2,
      )
      expect(a.margin).toBeCloseTo(a.price - a.cost, 2)
      expect(a.foodCostPct).toBeCloseTo((a.cost / a.price) * 100, 1)
      expect(a.target).toBeGreaterThan(0)
    })

    test('a dish with no recipe is counted but neither priced nor costed in the analytics', async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const bare = await prisma.client.menuItem.create({
        data: { organizationId: org.id, name: `Probe Bare Dish ${Date.now()}`, price: 40 },
      })
      try {
        const res = await request(http)
          .post('/api/menus')
          .set('Cookie', goldenForkCookie)
          .send({ name: 'Probe Uncosted', locationIds: [downtown], menuItemIds: [steak, bare.id] })
          .expect(201)
        const menu = (
          await request(http)
            .get(`/api/menus/${res.body.id as string}`)
            .set('Cookie', goldenForkCookie)
            .expect(200)
        ).body as {
          items: { id: string; price: number }[]
          analytics: { items: number; price: number; uncosted: number }
        }
        expect(menu.analytics.items).toBe(2)
        expect(menu.analytics.uncosted).toBe(1)
        expect(menu.analytics.price).toBeCloseTo(menu.items.find((i) => i.id === steak)!.price, 2)
      } finally {
        await prisma.client.menu.deleteMany({ where: { name: 'Probe Uncosted' } })
        await prisma.client.menuItem.delete({ where: { id: bare.id } })
      }
    })

    test('what a menu includes and where it is served can be changed', async () => {
      const res = await request(http)
        .patch(`/api/menus/${menuId}`)
        .set('Cookie', goldenForkCookie)
        .send({ locationIds: [riverside], menuItemIds: [pasta] })
        .expect(200)

      expect((res.body.locations as { id: string }[]).map((l) => l.id)).toEqual([riverside])
      expect((res.body.items as { id: string }[]).map((i) => i.id)).toEqual([pasta])
      expect((res.body.analytics as { items: number }).items).toBe(1)
    })

    test('two menus may not share a name', async () => {
      await request(http)
        .post('/api/menus')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'probe dinner' })
        .expect(409)
    })

    test('a menu may not reach a location or an item of another organization', async () => {
      const theirs = await prisma.client.menuItem.findFirstOrThrow({
        where: { organization: { slug: 'bella-cucina' } },
      })
      await request(http)
        .post('/api/menus')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Probe Trespass', menuItemIds: [theirs.id] })
        .expect(400)
    })

    test('another organization sees none of our menus', async () => {
      const res = await request(http).get('/api/menus').set('Cookie', bellaCucinaCookie).expect(200)
      expect((res.body as { name: string }[]).map((m) => m.name)).not.toContain('Probe Dinner')
    })

    test('a chef may read menus but not write them', async () => {
      const chef = await login('ken@goldenfork.com')
      await request(http).get('/api/menus').set('Cookie', chef).expect(200)
      await request(http)
        .post('/api/menus')
        .set('Cookie', chef)
        .send({ name: 'Probe Chef Menu' })
        .expect(403)
    })

    test('a dish the menu no longer serves is on it but not counted', async () => {
      const before = await request(http)
        .get(`/api/menus/${menuId}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const counted = (before.body.analytics as { items: number; price: number }).items
      const priced = (before.body.analytics as { price: number }).price

      await request(http)
        .patch(`/api/menu-items/${pasta}`)
        .set('Cookie', goldenForkCookie)
        .send({ isActive: false })
        .expect(200)

      const after = await request(http)
        .get(`/api/menus/${menuId}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      expect((after.body.analytics as { items: number }).items).toBe(counted - 1)
      expect((after.body.analytics as { price: number }).price).toBeLessThan(priced)
      expect((after.body.items as { id: string }[]).map((i) => i.id)).toContain(pasta)

      await request(http)
        .patch(`/api/menu-items/${pasta}`)
        .set('Cookie', goldenForkCookie)
        .send({ isActive: true })
        .expect(200)
    })

    test('a menu is served by an active location, not an archived one', async () => {
      await request(http)
        .delete(`/api/locations/${riverside}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)

      const listed = await request(http)
        .get(`/api/menus/${menuId}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      expect((listed.body.locations as { id: string }[]).map((l) => l.id)).not.toContain(riverside)

      await request(http)
        .post('/api/menus')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Probe Archived Menu', locationIds: [riverside] })
        .expect(400)

      await request(http)
        .patch(`/api/locations/${riverside}`)
        .set('Cookie', goldenForkCookie)
        .send({ isActive: true })
        .expect(200)
    })

    test('a second menu under the same name in other letters is refused the way every name is', async () => {
      await request(http)
        .post('/api/menus')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Probe Twin Menu' })
        .expect(201)
      const twin = await request(http)
        .post('/api/menus')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'PROBE TWIN MENU' })
        .expect(409)
      expect(twin.body.error.message).toBe('A menu named Probe Twin Menu already exists')
    })

    test('the list answers for the location in the header, and keeps menus assigned to none', async () => {
      await request(http)
        .post('/api/menus')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Probe Riverside Only', locationIds: [riverside] })
        .expect(201)
      await request(http)
        .post('/api/menus')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Probe Both Kitchens', locationIds: [downtown, riverside] })
        .expect(201)
      await request(http)
        .post('/api/menus')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Probe Unassigned' })
        .expect(201)

      const names = async (location?: string) => {
        const req = request(http).get('/api/menus').set('Cookie', goldenForkCookie)
        const res = await (location ? req.set('X-Location-Id', location) : req).expect(200)
        return (res.body as { name: string }[]).map((m) => m.name)
      }

      const atDowntown = await names(downtown)
      expect(atDowntown).toContain('Probe Both Kitchens')
      expect(atDowntown).toContain('Probe Unassigned')
      expect(atDowntown).not.toContain('Probe Riverside Only')

      const atRiverside = await names(riverside)
      expect(atRiverside).toContain('Probe Both Kitchens')
      expect(atRiverside).toContain('Probe Riverside Only')

      const everywhere = await names()
      expect(everywhere).toEqual(
        expect.arrayContaining(['Probe Both Kitchens', 'Probe Riverside Only', 'Probe Unassigned']),
      )
    })

    test('a menu whose every location is archived is kept under All locations, not served at another', async () => {
      const place = await request(http)
        .post('/api/locations')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Probe Closed Kitchen' })
        .expect(201)
      const placeId = place.body.id as string
      try {
        await request(http)
          .post('/api/menus')
          .set('Cookie', goldenForkCookie)
          .send({ name: 'Probe Closed Menu', locationIds: [placeId] })
          .expect(201)
        await request(http)
          .delete(`/api/locations/${placeId}`)
          .set('Cookie', goldenForkCookie)
          .expect(200)

        const here = await request(http)
          .get('/api/menus')
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', downtown)
          .expect(200)
        expect((here.body as { name: string }[]).map((m) => m.name)).not.toContain(
          'Probe Closed Menu',
        )
        const res = await request(http)
          .get('/api/menus')
          .set('Cookie', goldenForkCookie)
          .expect(200)
        const closed = (res.body as { name: string; locations: unknown[] }[]).find(
          (m) => m.name === 'Probe Closed Menu',
        )
        expect(closed?.locations).toEqual([])
      } finally {
        await prisma.client.menu.deleteMany({ where: { name: 'Probe Closed Menu' } })
        await prisma.client.location.delete({ where: { id: placeId } })
      }
    })

    test('deleting a menu leaves the items it grouped in the catalogue', async () => {
      await request(http).delete(`/api/menus/${menuId}`).set('Cookie', goldenForkCookie).expect(200)
      await request(http).get(`/api/menus/${menuId}`).set('Cookie', goldenForkCookie).expect(404)
      expect(await prisma.client.menuItem.count({ where: { id: { in: [steak, pasta] } } })).toBe(2)
    })
  })
  describe('a name made of spaces is not a name', () => {
    const blank = '   '

    test.each([
      ['menus', { name: blank }],
      ['menu-items', { name: blank, price: 10 }],
      ['recipes', { name: blank }],
      ['ingredients', { name: blank, unit: 'kg', costPerUnit: 1 }],
      ['vendors', { name: blank }],
      ['categories', { name: blank, kind: 'menu' }],
      ['locations', { name: blank }],
    ])('%s refuses one', async (path, body) => {
      await request(http)
        .post(`/api/${path}`)
        .set('Cookie', goldenForkCookie)
        .send(body)
        .expect(400)
    })

    test('a name with space around it is stored trimmed', async () => {
      const res = await request(http)
        .post('/api/vendors')
        .set('Cookie', goldenForkCookie)
        .send({ name: '  Probe Padded Vendor  ' })
        .expect(201)
      expect((res.body as { name: string }).name).toBe('Probe Padded Vendor')
      await prisma.client.vendor.delete({ where: { id: (res.body as { id: string }).id } })
    })
  })
  describe('a platform administrator is not a member of every organization', () => {
    let platformCookie = ''
    let theirManager = ''

    beforeAll(async () => {
      platformCookie = await login('platform@nexus.app')
      theirManager = (
        await prisma.client.user.findFirstOrThrow({
          where: { organization: { slug: 'golden-fork' }, role: 'manager' },
        })
      ).id
    })

    test('they may not issue a reset for a tenant member', async () => {
      await request(http)
        .post(`/api/users/${theirManager}/password-reset`)
        .set('Cookie', platformCookie)
        .expect(404)
    })

    test('they may not rename or delete what a tenant owns', async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const menu = await prisma.client.menu.findFirstOrThrow({
        where: { organizationId: org.id },
      })
      const ingredient = await prisma.client.ingredient.findFirstOrThrow({
        where: { organizationId: org.id },
      })
      const vendor = await prisma.client.vendor.findFirstOrThrow({
        where: { organizationId: org.id },
      })

      await request(http)
        .patch(`/api/menus/${menu.id}`)
        .set('Cookie', platformCookie)
        .send({ name: 'Hijacked' })
        .expect(404)
      await request(http)
        .patch(`/api/ingredients/${ingredient.id}`)
        .set('Cookie', platformCookie)
        .send({ name: 'Hijacked Ingredient' })
        .expect(404)
      await request(http)
        .delete(`/api/vendors/${vendor.id}`)
        .set('Cookie', platformCookie)
        .expect(404)

      expect((await prisma.client.menu.findUniqueOrThrow({ where: { id: menu.id } })).name).toBe(
        menu.name,
      )
      expect(
        (await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } })).name,
      ).toBe(ingredient.name)
      expect(await prisma.client.vendor.count({ where: { id: vendor.id } })).toBe(1)
    })

    test('the queue panel still reaches every organization, because it says so', async () => {
      const doc = await prisma.client.document.findFirst({
        where: { organization: { slug: 'golden-fork' } },
      })
      if (!doc) return
      const res = await request(http)
        .get(`/api/admin/queue/${doc.id}`)
        .set('Cookie', platformCookie)
        .expect(200)
      expect((res.body as { organizationId: string }).organizationId).toBe(doc.organizationId)
    })

    test('they may not change a tenant member role or deactivate them', async () => {
      await request(http)
        .patch(`/api/users/${theirManager}`)
        .set('Cookie', platformCookie)
        .send({ role: 'viewer' })
        .expect(404)
      await request(http)
        .delete(`/api/users/${theirManager}`)
        .set('Cookie', platformCookie)
        .expect(404)

      const untouched = await prisma.client.user.findUniqueOrThrow({ where: { id: theirManager } })
      expect(untouched.role).toBe('manager')
      expect(untouched.isActive).toBe(true)
    })
  })
  describe('a platform administrator manages access across organizations', () => {
    let platformCookie = ''
    let goldenForkId = ''
    let ownOrganizationId = ''
    let staffId = ''
    let managerId = ''

    beforeAll(async () => {
      platformCookie = await login('platform@nexus.app')
      goldenForkId = (
        await prisma.client.organization.findUniqueOrThrow({ where: { slug: 'golden-fork' } })
      ).id
      ownOrganizationId = (
        await prisma.client.user.findUniqueOrThrow({ where: { email: 'platform@nexus.app' } })
      ).organizationId
      staffId = (
        await prisma.client.user.findUniqueOrThrow({ where: { email: 'ken@goldenfork.com' } })
      ).id
      managerId = (
        await prisma.client.user.findUniqueOrThrow({ where: { email: 'maria@goldenfork.com' } })
      ).id
    })

    afterAll(async () => {
      await prisma.client.organization.update({
        where: { id: goldenForkId },
        data: { isActive: true },
      })
      await prisma.client.user.updateMany({
        where: { id: { in: [staffId, managerId] } },
        data: { isActive: true, lockoutUntil: null, failedLoginAttempts: 0 },
      })
      goldenForkCookie = await login('owner@goldenfork.com')
    })

    test('a tenant is told none of it exists', async () => {
      await request(http)
        .get(`/api/admin/organizations/${goldenForkId}`)
        .set('Cookie', goldenForkCookie)
        .expect(404)
      await request(http)
        .patch(`/api/admin/organizations/${goldenForkId}`)
        .set('Cookie', goldenForkCookie)
        .send({ isActive: false })
        .expect(404)
      await request(http).get('/api/admin/users?q=ken').set('Cookie', goldenForkCookie).expect(404)
      await request(http)
        .patch(`/api/admin/users/${staffId}`)
        .set('Cookie', goldenForkCookie)
        .send({ isActive: false })
        .expect(404)
      await request(http)
        .post(`/api/admin/users/${staffId}/password-reset`)
        .set('Cookie', goldenForkCookie)
        .expect(404)
      expect(
        (await prisma.client.organization.findUniqueOrThrow({ where: { id: goldenForkId } }))
          .isActive,
      ).toBe(true)
    })

    test('an organization answers with its locations, members, subscription and documents', async () => {
      const res = await request(http)
        .get(`/api/admin/organizations/${goldenForkId}`)
        .set('Cookie', platformCookie)
        .expect(200)
      const body = res.body as {
        name: string
        isActive: boolean
        subscription: { status: string; foodCostTargetPct: number }
        locations: { name: string; isActive: boolean; assignedUsers: number }[]
        users: { email: string; role: string; isActive: boolean; lockedUntil: string | null }[]
        documents: Record<string, number>
      }
      expect(body.name).toBe('The Golden Fork Group')
      expect(body.isActive).toBe(true)
      expect(['trial', 'active', 'past_due', 'canceled']).toContain(body.subscription.status)
      expect(body.subscription.foodCostTargetPct).toBeGreaterThan(0)
      expect(body.locations.length).toBeGreaterThanOrEqual(3)
      expect(body.users.map((u) => u.email)).toEqual(
        expect.arrayContaining([
          'owner@goldenfork.com',
          'maria@goldenfork.com',
          'ken@goldenfork.com',
        ]),
      )
      expect(typeof body.documents).toBe('object')
    })

    test('the list filters by subscription status and by a search term', async () => {
      const trial = await request(http)
        .get('/api/admin/organizations?status=trial')
        .set('Cookie', platformCookie)
        .expect(200)
      for (const o of (trial.body as { data: { status: string }[] }).data)
        expect(o.status).toBe('trial')

      const found = await request(http)
        .get('/api/admin/organizations?q=golden')
        .set('Cookie', platformCookie)
        .expect(200)
      const names = (found.body as { data: { name: string }[] }).data.map((o) => o.name)
      expect(names).toContain('The Golden Fork Group')
      expect(names).not.toContain('Bella Cucina LLC')

      await request(http)
        .get('/api/admin/organizations?status=whatever')
        .set('Cookie', platformCookie)
        .expect(400)
    })

    test('accounts are found across organizations by email or name', async () => {
      const res = await request(http)
        .get('/api/admin/users?q=goldenfork')
        .set('Cookie', platformCookie)
        .expect(200)
      const rows = (res.body as { data: { email: string; organization: { name: string } }[] }).data
      expect(rows.length).toBeGreaterThanOrEqual(3)
      expect(rows.every((r) => r.organization.name === 'The Golden Fork Group')).toBe(true)

      const empty = await request(http)
        .get('/api/admin/users')
        .set('Cookie', platformCookie)
        .expect(200)
      expect(empty.body).toEqual({ data: [], pagination: { limit: 50, offset: 0, total: 0 } })
    })

    test('deactivating an organization signs everyone out and refuses their next sign-in', async () => {
      const ownerCookie = await login('owner@goldenfork.com')

      const res = await request(http)
        .patch(`/api/admin/organizations/${goldenForkId}`)
        .set('Cookie', platformCookie)
        .send({ isActive: false })
        .expect(200)
      expect((res.body as { isActive: boolean }).isActive).toBe(false)

      await request(http).get('/api/auth/refresh').set('Cookie', ownerCookie).expect(401)
      await request(http)
        .post('/api/auth/login')
        .send({ email: 'owner@goldenfork.com', password: 'Nexus_dev1' })
        .expect(403)
      expect(
        await prisma.client.userSession.count({
          where: { user: { organizationId: goldenForkId } },
        }),
      ).toBe(0)

      await request(http)
        .patch(`/api/admin/organizations/${goldenForkId}`)
        .set('Cookie', platformCookie)
        .send({ isActive: true })
        .expect(200)
      await request(http)
        .post('/api/auth/login')
        .send({ email: 'owner@goldenfork.com', password: 'Nexus_dev1' })
        .expect(200)
    })

    test('the administrator cannot deactivate their own organization', async () => {
      await request(http)
        .patch(`/api/admin/organizations/${ownOrganizationId}`)
        .set('Cookie', platformCookie)
        .send({ isActive: false })
        .expect(400)
      expect(
        (await prisma.client.organization.findUniqueOrThrow({ where: { id: ownOrganizationId } }))
          .isActive,
      ).toBe(true)
    })

    test('deactivating an account ends its sessions; reactivating lets it back in', async () => {
      const staffCookie = await login('ken@goldenfork.com')

      const res = await request(http)
        .patch(`/api/admin/users/${staffId}`)
        .set('Cookie', platformCookie)
        .send({ isActive: false })
        .expect(200)
      expect((res.body as { isActive: boolean }).isActive).toBe(false)
      await request(http).get('/api/auth/refresh').set('Cookie', staffCookie).expect(401)
      await request(http)
        .post('/api/auth/login')
        .send({ email: 'ken@goldenfork.com', password: 'Nexus_dev1' })
        .expect(401)

      await request(http)
        .patch(`/api/admin/users/${staffId}`)
        .set('Cookie', platformCookie)
        .send({ isActive: true })
        .expect(200)
      await request(http)
        .post('/api/auth/login')
        .send({ email: 'ken@goldenfork.com', password: 'Nexus_dev1' })
        .expect(200)
    })

    test('an owner is not deactivated on their own; the organization is', async () => {
      const ownerId = (
        await prisma.client.user.findUniqueOrThrow({ where: { email: 'owner@goldenfork.com' } })
      ).id
      await request(http)
        .patch(`/api/admin/users/${ownerId}`)
        .set('Cookie', platformCookie)
        .send({ isActive: false })
        .expect(400)
    })

    test('unlocking clears a lockout left by failed sign-ins', async () => {
      await prisma.client.user.update({
        where: { id: managerId },
        data: { lockoutUntil: new Date(Date.now() + 10 * 60 * 1000), failedLoginAttempts: 5 },
      })
      await request(http)
        .post('/api/auth/login')
        .send({ email: 'maria@goldenfork.com', password: 'Nexus_dev1' })
        .expect(423)

      const found = await request(http)
        .get('/api/admin/users?q=maria@goldenfork.com')
        .set('Cookie', platformCookie)
        .expect(200)
      expect(
        (found.body as { data: { lockedUntil: string | null }[] }).data[0].lockedUntil,
      ).not.toBeNull()

      const res = await request(http)
        .patch(`/api/admin/users/${managerId}`)
        .set('Cookie', platformCookie)
        .send({ unlock: true })
        .expect(200)
      expect((res.body as { lockedUntil: string | null }).lockedUntil).toBeNull()
      await request(http)
        .post('/api/auth/login')
        .send({ email: 'maria@goldenfork.com', password: 'Nexus_dev1' })
        .expect(200)
    })

    test('a reset is issued for a tenant account and never for the administrator themselves', async () => {
      const res = await request(http)
        .post(`/api/admin/users/${staffId}/password-reset`)
        .set('Cookie', platformCookie)
        .expect(200)
      const body = res.body as { emailDelivered: boolean; resetUrl: string | null }
      expect(body.emailDelivered).toBe(false)
      expect(body.resetUrl).toContain('/reset-password?token=')

      const self = (
        await prisma.client.user.findUniqueOrThrow({ where: { email: 'platform@nexus.app' } })
      ).id
      await request(http)
        .post(`/api/admin/users/${self}/password-reset`)
        .set('Cookie', platformCookie)
        .expect(400)
      await request(http)
        .patch(`/api/admin/users/${self}`)
        .set('Cookie', platformCookie)
        .send({ isActive: false })
        .expect(400)
    })

    test('a deactivated account is reactivated before it is given a reset, and nobody is found by nothing', async () => {
      await request(http)
        .patch(`/api/admin/users/${managerId}`)
        .set('Cookie', platformCookie)
        .send({ isActive: false })
        .expect(200)
      await request(http)
        .post(`/api/admin/users/${managerId}/password-reset`)
        .set('Cookie', platformCookie)
        .expect(400)
      await request(http)
        .patch(`/api/admin/users/${managerId}`)
        .set('Cookie', platformCookie)
        .send({ isActive: true })
        .expect(200)

      const blank = await request(http)
        .get('/api/admin/users?q=%20%20')
        .set('Cookie', platformCookie)
        .expect(200)
      expect(blank.body).toEqual({ data: [], pagination: { limit: 50, offset: 0, total: 0 } })
    })

    test('a platform administrator reaches ids that do not exist as not found, and bad filters as bad requests', async () => {
      await request(http)
        .get('/api/admin/organizations/nothing')
        .set('Cookie', platformCookie)
        .expect(404)
      await request(http)
        .patch('/api/admin/organizations/nothing')
        .set('Cookie', platformCookie)
        .send({ isActive: false })
        .expect(404)
      await request(http)
        .patch('/api/admin/users/nothing')
        .set('Cookie', platformCookie)
        .send({ unlock: true })
        .expect(404)
      await request(http)
        .get('/api/admin/organizations?status=free')
        .set('Cookie', platformCookie)
        .expect(400)
    })

    test('a switch that is not a boolean is refused, not read as one', async () => {
      await request(http)
        .patch(`/api/admin/organizations/${goldenForkId}`)
        .set('Cookie', platformCookie)
        .send({ isActive: false })
        .expect(200)
      try {
        const answer = await request(http)
          .patch(`/api/admin/organizations/${goldenForkId}`)
          .set('Cookie', platformCookie)
          .send({ isActive: 'false' })
        const org = await prisma.client.organization.findUniqueOrThrow({
          where: { id: goldenForkId },
        })
        expect(org.isActive).toBe(false)
        expect(answer.status).toBe(400)
      } finally {
        await prisma.client.organization.update({
          where: { id: goldenForkId },
          data: { isActive: true },
        })
      }
    })
  })
  test('a draft order of an archived location is neither changed nor approved', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const closed = await prisma.client.location.create({
      data: { organizationId: org.id, name: 'Probe Closed Purchasing', isActive: false },
    })
    const flour = await prisma.client.ingredient.findFirstOrThrow({
      where: { organizationId: org.id, name: 'All-Purpose Flour' },
    })
    const draft = await prisma.client.purchaseDraft.create({
      data: {
        organizationId: org.id,
        locationId: closed.id,
        days: 28,
        horizon: 7,
        lines: {
          create: [{ ingredientId: flour.id, quantity: 1, unit: 'kg', suggested: 1, onHand: 0 }],
        },
      },
    })
    try {
      const refused = await request(http)
        .post(`/api/purchasing/drafts/${draft.id}/approve`)
        .set('Cookie', goldenForkCookie)
        .expect(403)
      expect(refused.body.error.message).toMatch(/archived/)
      expect(
        (await prisma.client.purchaseDraft.findUniqueOrThrow({ where: { id: draft.id } })).status,
      ).toBe('draft')
    } finally {
      await prisma.client.purchaseDraft.delete({ where: { id: draft.id } })
      await prisma.client.location.delete({ where: { id: closed.id } })
    }
  })

  describe('purchasing: a recommendation becomes a draft a person approves', () => {
    let downtown = ''
    let airport = ''
    let staffCookie = ''
    let beefId = ''
    let creamId = ''
    let goldenForkId = ''

    const at = (locationId: string) => ({ Cookie: goldenForkCookie, 'X-Location-Id': locationId })

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      goldenForkId = org.id
      const locations = await prisma.client.location.findMany({
        where: { organizationId: org.id },
      })
      downtown = locations.find((l) => l.name.includes('Downtown'))!.id
      airport = locations.find((l) => l.name.includes('Airport'))!.id
      beefId = (
        await prisma.client.ingredient.findFirstOrThrow({
          where: { organizationId: org.id, name: 'Beef Tenderloin' },
        })
      ).id
      creamId = (
        await prisma.client.ingredient.findFirstOrThrow({
          where: { organizationId: org.id, name: 'Heavy Cream 33%' },
        })
      ).id
      staffCookie = await login('ken@goldenfork.com')
    })

    afterAll(async () => {
      await prisma.client.purchaseDraft.deleteMany({ where: { organizationId: goldenForkId } })
    })

    test('a recommendation needs a location and a sensible window', async () => {
      await request(http)
        .get('/api/purchasing/recommendations')
        .set('Cookie', goldenForkCookie)
        .expect(400)
      await request(http)
        .get('/api/purchasing/recommendations?days=3')
        .set(at(downtown))
        .expect(400)
      await request(http)
        .get('/api/purchasing/recommendations?horizon=0')
        .set(at(downtown))
        .expect(400)
    })

    test('sales at the location reach the ingredients through the recipes', async () => {
      const res = await request(http)
        .get('/api/purchasing/recommendations?days=30&horizon=60')
        .set(at(downtown))
        .expect(200)
      const body = res.body as {
        days: number
        horizon: number
        examined: number
        rows: {
          ingredientId: string
          name: string
          unit: string
          basis: string
          salesQty: number
          dailyRate: number
          suggested: number
          onHand: number
          vendorName: string | null
          unitPrice: number
          estimatedCost: number
        }[]
      }
      expect(body.days).toBe(30)
      expect(body.horizon).toBe(60)
      expect(body.examined).toBeGreaterThan(5)
      const beef = body.rows.find((r) => r.ingredientId === beefId)
      expect(beef).toBeDefined()
      expect(beef!.basis).toBe('sales')
      expect(beef!.salesQty).toBeGreaterThan(0)
      expect(beef!.suggested).toBeGreaterThan(0)
      expect(beef!.unit).toBe('kg')
      expect(beef!.vendorName).toBe('Prime Meats Co.')
      expect(beef!.estimatedCost).toBeCloseTo(beef!.suggested * beef!.unitPrice, 1)
      for (const row of body.rows) expect(row.suggested).toBeGreaterThan(0)
    })

    test('an ingredient nobody sells or records use of is ordered at the pace it is delivered', async () => {
      const created = await request(http)
        .post('/api/ingredients')
        .set(at(downtown))
        .send({ name: 'Probe delivered flour', unit: 'kg', costPerUnit: 1 })
        .expect(201)
      const ingredientId = (created.body as { id: string }).id
      try {
        await request(http)
          .post('/api/inventory/transactions')
          .set(at(downtown))
          .send({ ingredientId, type: 'RECEIVE', quantity: 14 })
          .expect(201)

        const res = await request(http)
          .get('/api/purchasing/recommendations?days=28&horizon=60')
          .set(at(downtown))
          .expect(200)
        const row = (res.body as { rows: Record<string, unknown>[] }).rows.find(
          (r) => r.ingredientId === ingredientId,
        )
        expect(row).toMatchObject({
          basis: 'receipts',
          receivedQty: 14,
          salesQty: 0,
          useQty: 0,
          onHand: 14,
          dailyRate: 0.5,
          suggested: 16,
        })

        const elsewhere = await request(http)
          .get('/api/purchasing/recommendations?days=28&horizon=60')
          .set(at(airport))
          .expect(200)
        expect(
          (elsewhere.body as { rows: { ingredientId: string }[] }).rows.some(
            (r) => r.ingredientId === ingredientId,
          ),
        ).toBe(false)
      } finally {
        await prisma.client.inventoryTransaction.deleteMany({ where: { ingredientId } })
        await prisma.client.ingredientLocationStock.deleteMany({ where: { ingredientId } })
        await prisma.client.ingredientLocationSettings.deleteMany({ where: { ingredientId } })
        await prisma.client.ingredientPriceHistory.deleteMany({ where: { ingredientId } })
        await prisma.client.ingredient.delete({ where: { id: ingredientId } })
      }
    })

    let beefDraft = ''
    let creamDraft = ''

    test('chosen lines become one draft per vendor, each line remembering what it rested on', async () => {
      const res = await request(http)
        .post('/api/purchasing/drafts')
        .set(at(downtown))
        .send({
          days: 30,
          horizon: 60,
          lines: [
            { ingredientId: beefId, quantity: 5 },
            { ingredientId: creamId, quantity: 3 },
          ],
        })
        .expect(201)
      const drafts = res.body as {
        id: string
        status: string
        vendorName: string | null
        lines: { ingredientId: string; quantity: number; unitPrice: number; onHand: number }[]
        total: number
      }[]
      expect(drafts).toHaveLength(2)
      const vendors = drafts.map((d) => d.vendorName).sort()
      expect(vendors).toEqual(['Dairy Direct', 'Prime Meats Co.'])
      for (const d of drafts) {
        expect(d.status).toBe('draft')
        expect(d.lines).toHaveLength(1)
        expect(d.lines[0].unitPrice).toBeGreaterThan(0)
        expect(d.total).toBeCloseTo(d.lines[0].quantity * d.lines[0].unitPrice, 1)
      }
      beefDraft = drafts.find((d) => d.lines[0].ingredientId === beefId)!.id
      creamDraft = drafts.find((d) => d.lines[0].ingredientId === creamId)!.id

      await request(http)
        .post('/api/purchasing/drafts')
        .set(at(downtown))
        .send({ lines: [{ ingredientId: beefId, quantity: 0 }] })
        .expect(400)
    })

    test('a draft is adjusted line by line and never left empty', async () => {
      const changed = await request(http)
        .patch(`/api/purchasing/drafts/${beefDraft}`)
        .set(at(downtown))
        .send({ lines: [{ ingredientId: beefId, quantity: 7 }], note: 'Friday delivery' })
        .expect(200)
      const body = changed.body as {
        note: string
        lines: { ingredientId: string; quantity: number }[]
      }
      expect(body.note).toBe('Friday delivery')
      expect(body.lines[0].quantity).toBe(7)

      await request(http)
        .patch(`/api/purchasing/drafts/${beefDraft}`)
        .set(at(downtown))
        .send({ lines: [{ ingredientId: beefId, quantity: 0 }] })
        .expect(400)

      const otherVendor = await request(http)
        .patch(`/api/purchasing/drafts/${beefDraft}`)
        .set(at(downtown))
        .send({ lines: [{ ingredientId: creamId, quantity: 2 }] })
        .expect(400)
      expect(JSON.stringify(otherVendor.body)).toMatch(/Dairy Direct/)

      const butterId = (
        await prisma.client.ingredient.findFirstOrThrow({
          where: { organizationId: goldenForkId, name: 'Unsalted Butter' },
        })
      ).id
      const added = await request(http)
        .patch(`/api/purchasing/drafts/${creamDraft}`)
        .set(at(downtown))
        .send({ lines: [{ ingredientId: butterId, quantity: 2 }] })
        .expect(200)
      expect((added.body as { lines: unknown[] }).lines).toHaveLength(2)

      const removed = await request(http)
        .patch(`/api/purchasing/drafts/${creamDraft}`)
        .set(at(downtown))
        .send({ lines: [{ ingredientId: butterId, quantity: 0 }] })
        .expect(200)
      expect((removed.body as { lines: { ingredientId: string }[] }).lines).toEqual([
        expect.objectContaining({ ingredientId: creamId }),
      ])
    })

    test('approving is a manager decision, taken once, and moves no stock', async () => {
      const before = await prisma.client.ingredientLocationStock.findUnique({
        where: { ingredientId_locationId: { ingredientId: beefId, locationId: downtown } },
      })

      await request(http)
        .post(`/api/purchasing/drafts/${beefDraft}/approve`)
        .set({ Cookie: staffCookie, 'X-Location-Id': downtown })
        .expect(403)

      const res = await request(http)
        .post(`/api/purchasing/drafts/${beefDraft}/approve`)
        .set(at(downtown))
        .expect(201)
      const body = res.body as { status: string; approvedAt: string | null }
      expect(body.status).toBe('approved')
      expect(body.approvedAt).not.toBeNull()

      await request(http)
        .post(`/api/purchasing/drafts/${beefDraft}/approve`)
        .set(at(downtown))
        .expect(409)
      await request(http)
        .patch(`/api/purchasing/drafts/${beefDraft}`)
        .set(at(downtown))
        .send({ note: 'too late' })
        .expect(409)
      await request(http)
        .delete(`/api/purchasing/drafts/${beefDraft}`)
        .set(at(downtown))
        .expect(409)

      const after = await prisma.client.ingredientLocationStock.findUnique({
        where: { ingredientId_locationId: { ingredientId: beefId, locationId: downtown } },
      })
      expect(after?.onHand.toString() ?? '0').toBe(before?.onHand.toString() ?? '0')
    })

    test('a draft belongs to its location and its organization', async () => {
      await request(http)
        .get(`/api/purchasing/drafts/${creamDraft}`)
        .set({ Cookie: bellaCucinaCookie, 'X-Location-Id': downtown })
        .expect(403)
      await request(http)
        .get(`/api/purchasing/drafts/${creamDraft}`)
        .set('Cookie', bellaCucinaCookie)
        .expect(404)

      await request(http).get(`/api/purchasing/drafts/${creamDraft}`).set(at(airport)).expect(404)
      const list = await request(http).get('/api/purchasing/drafts').set(at(airport)).expect(200)
      expect((list.body as { data: { id: string }[] }).data.map((d) => d.id)).not.toContain(
        creamDraft,
      )

      const seen = await request(http).get('/api/purchasing/drafts').set(at(downtown)).expect(200)
      expect(
        (seen.body as { data: { id: string; lines: number }[] }).data.map((d) => d.id),
      ).toContain(creamDraft)

      await request(http)
        .delete(`/api/purchasing/drafts/${creamDraft}`)
        .set({ Cookie: staffCookie, 'X-Location-Id': downtown })
        .expect(403)
      await request(http)
        .delete(`/api/purchasing/drafts/${creamDraft}`)
        .set(at(downtown))
        .expect(200)
      await request(http).get(`/api/purchasing/drafts/${creamDraft}`).set(at(downtown)).expect(404)
    })

    const draftFor = async (
      lines: { ingredientId: string; quantity: number }[],
      cookie = goldenForkCookie,
    ) => {
      const res = await request(http)
        .post('/api/purchasing/drafts')
        .set({ Cookie: cookie, 'X-Location-Id': downtown })
        .send({ lines })
        .expect(201)
      return (res.body as { id: string }[])[0].id
    }

    test('a line named twice in one change cannot leave a draft empty', async () => {
      const id = await draftFor([{ ingredientId: beefId, quantity: 3 }])
      const twice = [
        { ingredientId: beefId, quantity: 0 },
        { ingredientId: beefId, quantity: 5 },
      ]
      const refused = await request(http)
        .patch(`/api/purchasing/drafts/${id}`)
        .set(at(downtown))
        .send({ lines: twice })
        .expect(400)
      expect(JSON.stringify(refused.body)).toMatch(/each ingredient once/)
      await request(http)
        .post('/api/purchasing/drafts')
        .set(at(downtown))
        .send({ lines: twice })
        .expect(400)
      const stored = await prisma.client.purchaseDraftLine.findMany({ where: { draftId: id } })
      expect(stored.map((l) => Number(l.quantity))).toEqual([3])
    })

    test('a chef turns recommendations into drafts and adjusts them, but a note alone leaves the lines be', async () => {
      const id = await draftFor([{ ingredientId: beefId, quantity: 4 }], staffCookie)
      const res = await request(http)
        .patch(`/api/purchasing/drafts/${id}`)
        .set({ Cookie: staffCookie, 'X-Location-Id': downtown })
        .send({ note: '  Morning delivery  ' })
        .expect(200)
      const body = res.body as { note: string; lines: { ingredientId: string; quantity: number }[] }
      expect(body.note).toBe('Morning delivery')
      expect(body.lines).toEqual([expect.objectContaining({ ingredientId: beefId, quantity: 4 })])
    })

    test('a draft is not made of what the organization does not own, has archived, or cannot store', async () => {
      const foreign = await prisma.client.ingredient.findFirstOrThrow({
        where: { organization: { slug: 'bella-cucina' } },
      })
      await request(http)
        .post('/api/purchasing/drafts')
        .set(at(downtown))
        .send({ lines: [{ ingredientId: foreign.id, quantity: 1 }] })
        .expect(400)

      const id = await draftFor([{ ingredientId: beefId, quantity: 1 }])
      await request(http)
        .patch(`/api/purchasing/drafts/${id}`)
        .set(at(downtown))
        .send({ lines: [{ ingredientId: foreign.id, quantity: 1 }] })
        .expect(400)

      await request(http)
        .post('/api/purchasing/drafts')
        .set(at(downtown))
        .send({ lines: [{ ingredientId: beefId, quantity: 1e12 }] })
        .expect(400)

      await prisma.client.ingredient.update({ where: { id: creamId }, data: { isActive: false } })
      try {
        await request(http)
          .post('/api/purchasing/drafts')
          .set(at(downtown))
          .send({ lines: [{ ingredientId: creamId, quantity: 1 }] })
          .expect(400)
      } finally {
        await prisma.client.ingredient.update({ where: { id: creamId }, data: { isActive: true } })
      }
    })

    test('a line records the price the location pays, and the draft totals its lines', async () => {
      const id = await draftFor([{ ingredientId: beefId, quantity: 2 }])
      const res = await request(http)
        .get(`/api/purchasing/drafts/${id}`)
        .set(at(downtown))
        .expect(200)
      const body = res.body as {
        total: number
        lines: { unitPrice: number | null; lineTotal: number | null; quantity: number }[]
      }
      const [line] = body.lines
      expect(line.unitPrice).not.toBeNull()
      expect(line.lineTotal).toBeCloseTo(line.quantity * (line.unitPrice as number), 2)
      expect(body.total).toBeCloseTo(line.lineTotal as number, 2)
    })

    test('a location that buys from its own vendor, at its own price and level, is recommended and drafted that way', async () => {
      const beef = await prisma.client.ingredient.findUniqueOrThrow({ where: { id: beefId } })
      const dairy = await prisma.client.vendor.findFirstOrThrow({
        where: { organizationId: goldenForkId, name: 'Dairy Direct' },
      })
      expect(beef.vendorId).not.toBe(dairy.id)
      const key = { ingredientId_locationId: { ingredientId: beefId, locationId: downtown } }
      const before = await prisma.client.ingredientLocationSettings.findUnique({ where: key })
      await prisma.client.ingredientLocationSettings.upsert({
        where: key,
        create: {
          ingredientId: beefId,
          locationId: downtown,
          vendorId: dairy.id,
          costPerUnit: 41.5,
          reorderLevel: 500,
        },
        update: { vendorId: dairy.id, costPerUnit: 41.5, reorderLevel: 500 },
      })
      try {
        const recs = await request(http)
          .get('/api/purchasing/recommendations')
          .set(at(downtown))
          .expect(200)
        const row = (
          recs.body as {
            rows: {
              ingredientId: string
              vendorId: string
              vendorName: string
              unitPrice: number
              reorderLevel: number
            }[]
          }
        ).rows.find((r) => r.ingredientId === beefId)
        expect(row).toMatchObject({
          vendorId: dairy.id,
          vendorName: 'Dairy Direct',
          unitPrice: 41.5,
          reorderLevel: 500,
        })

        const res = await request(http)
          .post('/api/purchasing/drafts')
          .set(at(downtown))
          .send({ lines: [{ ingredientId: beefId, quantity: 2 }] })
          .expect(201)
        const [draft] = res.body as {
          vendorId: string
          vendorName: string
          lines: { unitPrice: number }[]
        }[]
        expect(draft).toMatchObject({ vendorId: dairy.id, vendorName: 'Dairy Direct' })
        expect(draft.lines[0].unitPrice).toBe(41.5)

        const elsewhere = await request(http)
          .get('/api/purchasing/recommendations')
          .set(at(airport))
          .expect(200)
        const there = (
          elsewhere.body as { rows: { ingredientId: string; vendorId: string }[] }
        ).rows.find((r) => r.ingredientId === beefId)
        const airportOwn = await prisma.client.ingredientLocationSettings.findUnique({
          where: { ingredientId_locationId: { ingredientId: beefId, locationId: airport } },
        })
        if (there) expect(there.vendorId).toBe(airportOwn?.vendorId ?? beef.vendorId)
        if (there) expect(there.vendorId).not.toBe(dairy.id)
      } finally {
        if (before) {
          await prisma.client.ingredientLocationSettings.update({
            where: key,
            data: {
              vendorId: before.vendorId,
              costPerUnit: before.costPerUnit,
              reorderLevel: before.reorderLevel,
            },
          })
        } else {
          await prisma.client.ingredientLocationSettings.delete({ where: key })
        }
      }
    })

    test('an archived ingredient is not added to a draft that is already open', async () => {
      const id = await draftFor([{ ingredientId: beefId, quantity: 1 }])
      await prisma.client.ingredient.update({ where: { id: creamId }, data: { isActive: false } })
      try {
        await request(http)
          .patch(`/api/purchasing/drafts/${id}`)
          .set(at(downtown))
          .send({ lines: [{ ingredientId: creamId, quantity: 1 }] })
          .expect(400)
      } finally {
        await prisma.client.ingredient.update({ where: { id: creamId }, data: { isActive: true } })
      }
      expect(await prisma.client.purchaseDraftLine.count({ where: { draftId: id } })).toBe(1)
    })
  })
  describe('a record cannot be dated in the future', () => {
    let locationId = ''
    let ingredientId = ''
    let unit = ''

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      locationId = (
        await prisma.client.location.findFirstOrThrow({
          where: { organizationId: org.id, isActive: true },
          orderBy: { name: 'asc' },
        })
      ).id
      const ingredient = await prisma.client.ingredient.findFirstOrThrow({
        where: { organizationId: org.id },
        orderBy: { name: 'asc' },
      })
      ingredientId = ingredient.id
      unit = ingredient.unit
    })

    test('waste is refused', async () => {
      await request(http)
        .post('/api/waste')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ ingredientId, quantity: 0.1, unit, reason: 'spoilage', date: '2099-01-01' })
        .expect(400)
    })

    test('a date that is not a date is refused rather than stored as one', async () => {
      await request(http)
        .post('/api/waste')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ ingredientId, quantity: 0.1, unit, reason: 'spoilage', date: 'not a date' })
        .expect(400)
    })

    test('a day the calendar does not have is refused on an invoice rather than thrown', async () => {
      const line = { description: 'Impossible day', ingredientId, quantity: 1, unit, unitPrice: 1 }
      for (const dates of [
        { invoiceDate: '2026-02-30' },
        { invoiceDate: '2026-02-01', dueDate: '2026-04-31' },
      ]) {
        const res = await request(http)
          .post('/api/invoices')
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', locationId)
          .send({ ...dates, items: [line] })
        expect(res.status).toBe(400)
      }
    })

    test('an invoice is not dated after today, though it may fall due later', async () => {
      const line = { description: 'Dated probe', ingredientId, quantity: 1, unit, unitPrice: 1 }
      const ahead = await request(http)
        .post('/api/invoices')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ invoiceDate: '2099-01-01', items: [line] })
      expect(ahead.status).toBe(400)
      expect(String(ahead.body.error.message)).toMatch(/future/)

      const res = await request(http)
        .post('/api/invoices')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ invoiceDate: '2026-09-01', dueDate: '2099-01-01', items: [line] })
        .expect(201)
      const id = (res.body as { id: string }).id
      try {
        await request(http)
          .patch(`/api/invoices/${id}`)
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', locationId)
          .send({ invoiceDate: '2099-01-01' })
          .expect(400)
      } finally {
        await prisma.client.invoice.delete({ where: { id } })
      }
    })

    test('a date already past is still accepted', async () => {
      const res = await request(http)
        .post('/api/waste')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ ingredientId, quantity: 0.1, unit, reason: 'spoilage', date: '2026-09-01' })
        .expect(201)
      const id = (res.body as { id: string }).id
      await prisma.client.wasteEntry.delete({ where: { id } })
      await prisma.client.inventoryTransaction.deleteMany({
        where: { ingredientId, type: 'WASTE', createdAt: { gte: new Date(Date.now() - 60000) } },
      })
      await prisma.client.ingredientLocationStock.update({
        where: { ingredientId_locationId: { ingredientId, locationId } },
        data: { onHand: { increment: 0.1 } },
      })
      await prisma.client.ingredient.update({
        where: { id: ingredientId },
        data: { onHand: { increment: 0.1 } },
      })
    })
  })
  describe('a name differing only in case is the same name', () => {
    test('a vendor, an ingredient and a location are not created twice under another case', async () => {
      const made: { vendor?: string; ingredient?: string; location?: string } = {}
      try {
        const vendor = await request(http)
          .post('/api/vendors')
          .set('Cookie', goldenForkCookie)
          .send({ name: 'dairy direct' })
        if (vendor.status === 201) made.vendor = vendor.body.id
        const ingredient = await request(http)
          .post('/api/ingredients')
          .set('Cookie', goldenForkCookie)
          .send({ name: 'unsalted butter', unit: 'kg', costPerUnit: 1 })
        if (ingredient.status === 201) made.ingredient = ingredient.body.id
        const location = await request(http)
          .post('/api/locations')
          .set('Cookie', goldenForkCookie)
          .send({ name: 'golden fork — downtown' })
        if (location.status === 201) made.location = location.body.id
        expect([vendor.status, ingredient.status, location.status]).toEqual([409, 409, 409])
        expect(vendor.body.error.message).toMatch(/Dairy Direct/)

        const riverside = await prisma.client.location.findFirstOrThrow({
          where: { name: 'Golden Fork — Riverside' },
        })
        await request(http)
          .patch(`/api/locations/${riverside.id}`)
          .set('Cookie', goldenForkCookie)
          .send({ name: 'GOLDEN FORK — DOWNTOWN' })
          .expect(409)
        await request(http)
          .patch(`/api/locations/${riverside.id}`)
          .set('Cookie', goldenForkCookie)
          .send({ name: 'Golden Fork — Riverside' })
          .expect(200)
      } finally {
        if (made.vendor) await prisma.client.vendor.delete({ where: { id: made.vendor } })
        if (made.ingredient)
          await prisma.client.ingredient.delete({ where: { id: made.ingredient } })
        if (made.location) await prisma.client.location.delete({ where: { id: made.location } })
      }
    })
  })

  describe('a vendor named on an invoice is kept, so the same paper is not received twice', () => {
    test('deleting it is refused with the way out, and it goes once nothing names it', async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const location = await prisma.client.location.findFirstOrThrow({
        where: { organizationId: org.id, isActive: true },
        orderBy: { name: 'asc' },
      })
      const ingredient = await prisma.client.ingredient.findFirstOrThrow({
        where: { organizationId: org.id },
        orderBy: { name: 'asc' },
      })
      const vendor = await request(http)
        .post('/api/vendors')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Probe Paper Vendor' })
        .expect(201)
      const vendorId = (vendor.body as { id: string }).id
      try {
        const invoice = await request(http)
          .post('/api/invoices')
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', location.id)
          .send({
            vendorId,
            number: 'PPV-1',
            invoiceDate: '2026-09-01',
            items: [
              {
                description: 'Probe line',
                ingredientId: ingredient.id,
                quantity: 1,
                unit: ingredient.unit,
                unitPrice: 1,
              },
            ],
          })
          .expect(201)

        const refused = await request(http)
          .delete(`/api/vendors/${vendorId}`)
          .set('Cookie', goldenForkCookie)
          .expect(400)
        expect(refused.body.error.message).toMatch(/invoice/i)
        expect(refused.body.error.message).toMatch(/inactive/i)
        expect(await prisma.client.invoice.count({ where: { vendorId } })).toBe(1)

        await request(http)
          .delete(`/api/invoices/${(invoice.body as { id: string }).id}`)
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', location.id)
          .expect(200)
        await request(http)
          .delete(`/api/vendors/${vendorId}`)
          .set('Cookie', goldenForkCookie)
          .expect(200)
      } finally {
        await prisma.client.invoice.deleteMany({ where: { vendorId } })
        await prisma.client.vendor.deleteMany({ where: { id: vendorId } })
      }
    })
  })

  describe('a table with no organization of its own is still out of reach', () => {
    test('an empty recipe list cannot wipe another organization dish', async () => {
      const theirs = await prisma.client.menuItem.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, recipes: { some: {} } },
        include: { recipes: true },
      })
      expect(theirs.recipes.length).toBeGreaterThan(0)

      await request(http)
        .patch(`/api/menu-items/${theirs.id}`)
        .set('Cookie', bellaCucinaCookie)
        .send({ recipes: [] })
        .expect(404)

      const after = await prisma.client.menuItemRecipe.count({ where: { menuItemId: theirs.id } })
      expect(after).toBe(theirs.recipes.length)
    })

    test('an empty location list cannot strip another organization menu', async () => {
      const theirs = await prisma.client.menu.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, locations: { some: {} } },
        include: { locations: true },
      })
      expect(theirs.locations.length).toBeGreaterThan(0)

      await request(http)
        .patch(`/api/menus/${theirs.id}`)
        .set('Cookie', bellaCucinaCookie)
        .send({ locationIds: [] })
        .expect(404)

      const after = await prisma.client.menuOnLocation.count({ where: { menuId: theirs.id } })
      expect(after).toBe(theirs.locations.length)
    })
  })

  describe('a recipe name belongs to the kitchen that cooks it', () => {
    let airport = ''
    let downtown = ''
    const made: string[] = []

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const locations = await prisma.client.location.findMany({
        where: { organizationId: org.id, isActive: true },
        orderBy: { name: 'asc' },
        take: 2,
      })
      airport = locations[0].id
      downtown = locations[1].id
    })

    afterAll(async () => {
      await prisma.client.recipe.deleteMany({ where: { id: { in: made } } })
    })

    const add = (locationId: string | null, name = 'Probe House Sauce') =>
      request(http)
        .post('/api/recipes')
        .set('Cookie', goldenForkCookie)
        .send({ name, portions: 4, ...(locationId ? { locationId } : {}) })

    test('two kitchens may each keep a recipe of the same name', async () => {
      const first = await add(downtown).expect(201)
      made.push((first.body as { id: string }).id)
      const second = await add(airport).expect(201)
      made.push((second.body as { id: string }).id)
    })

    test('one kitchen may not repeat it, whatever the case', async () => {
      const res = await add(downtown, 'probe house sauce').expect(409)
      expect(JSON.stringify(res.body)).toMatch(/already a recipe at/)
    })

    test('an organization-wide recipe may not take a name a kitchen already uses', async () => {
      const res = await add(null).expect(409)
      expect(JSON.stringify(res.body)).toMatch(/already a recipe at/)
    })
  })

  describe('a manager runs their own locations, and what every location shares is changed by someone who works at all of them', () => {
    let maria = ''
    let downtown = ''
    let organizationId = ''
    const made: { recipes: string[]; dishes: string[]; menus: string[] } = {
      recipes: [],
      dishes: [],
      menus: [],
    }

    beforeAll(async () => {
      maria = await login('maria@goldenfork.com')
      const user = await prisma.client.user.findUniqueOrThrow({
        where: { email: 'maria@goldenfork.com' },
        include: { locationAccess: true },
      })
      organizationId = user.organizationId
      downtown = user.locationAccess[0].locationId
    })

    afterAll(async () => {
      await prisma.client.menu.deleteMany({ where: { id: { in: made.menus } } })
      await prisma.client.menuItem.deleteMany({ where: { id: { in: made.dishes } } })
      await prisma.client.recipe.deleteMany({ where: { id: { in: made.recipes } } })
    })

    test("a shared recipe, dish or menu is read but not changed; her own location's are", async () => {
      const shared = await prisma.client.recipe.create({
        data: { organizationId, name: 'Probe Shared Stock', portions: 2 },
      })
      made.recipes.push(shared.id)
      const dish = await prisma.client.menuItem.create({
        data: { organizationId, name: 'Probe Shared Plate', price: 9 },
      })
      made.dishes.push(dish.id)
      const menu = await prisma.client.menu.create({
        data: { organizationId, name: 'Probe Shared Menu' },
      })
      made.menus.push(menu.id)

      await request(http).get(`/api/recipes/${shared.id}`).set('Cookie', maria).expect(200)
      const refused = [
        await request(http)
          .patch(`/api/recipes/${shared.id}`)
          .set('Cookie', maria)
          .send({ portions: 3 }),
        await request(http).delete(`/api/recipes/${shared.id}`).set('Cookie', maria),
        await request(http)
          .post('/api/recipes')
          .set('Cookie', maria)
          .send({ name: 'Probe Maria Everywhere', portions: 1 }),
        await request(http)
          .patch(`/api/menu-items/${dish.id}`)
          .set('Cookie', maria)
          .send({ price: 10 }),
        await request(http)
          .post('/api/menu-items')
          .set('Cookie', maria)
          .send({ name: 'Probe Maria Plate', price: 5 }),
        await request(http)
          .patch(`/api/menus/${menu.id}`)
          .set('Cookie', maria)
          .send({ name: 'Probe Shared Menu 2' }),
        await request(http)
          .post('/api/menus')
          .set('Cookie', maria)
          .send({ name: 'Probe Maria Menu', locationIds: [] }),
      ]
      expect(refused.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403])
      expect(refused[0].body.error.message).toMatch(/every location/)

      const own = await request(http)
        .post('/api/recipes')
        .set('Cookie', maria)
        .send({ name: 'Probe Maria Stock', portions: 1, locationId: downtown })
        .expect(201)
      made.recipes.push(own.body.id)
      await request(http)
        .patch(`/api/recipes/${own.body.id}`)
        .set('Cookie', maria)
        .send({ portions: 2 })
        .expect(200)
      const ownMenu = await request(http)
        .post('/api/menus')
        .set('Cookie', maria)
        .send({ name: 'Probe Maria Menu', locationIds: [downtown] })
        .expect(201)
      made.menus.push(ownMenu.body.id)
      await request(http)
        .patch(`/api/menus/${ownMenu.body.id}`)
        .set('Cookie', maria)
        .send({ locationIds: [] })
        .expect(403)
    })

    test("a price for every location is not set from All locations; her location's is", async () => {
      const butter = await prisma.client.ingredient.findFirstOrThrow({
        where: { organizationId, name: 'Unsalted Butter' },
      })
      const before = Number(butter.costPerUnit)
      const res = await request(http)
        .patch(`/api/ingredients/${butter.id}`)
        .set('Cookie', maria)
        .send({ costPerUnit: before + 5 })
        .expect(403)
      expect(res.body.error.message).toMatch(/header/)
      expect(
        Number(
          (await prisma.client.ingredient.findUniqueOrThrow({ where: { id: butter.id } }))
            .costPerUnit,
        ),
      ).toBe(before)
      await request(http)
        .patch(`/api/ingredients/${butter.id}`)
        .set('Cookie', maria)
        .set('X-Location-Id', downtown)
        .send({ sku: butter.sku ?? '' })
        .expect(200)
    })
  })

  describe('a recipe or dish of a location someone does not work at is not theirs to open or change', () => {
    let chef = ''
    let airport = ''
    let downtown = ''
    let recipe = ''
    let base = ''
    let shared = ''
    let dish = ''
    const stamp = Date.now()

    const make = async (name: string, locationId: string | null) =>
      (
        await request(http)
          .post('/api/recipes')
          .set('Cookie', goldenForkCookie)
          .send({ name, portions: 2, locationId })
          .expect(201)
      ).body.id as string

    beforeAll(async () => {
      chef = await login('ken@goldenfork.com')
      const locations = await prisma.client.location.findMany({
        where: { organization: { slug: 'golden-fork' }, isActive: true },
      })
      airport = locations.find((l) => l.name.includes('Airport'))!.id
      downtown = locations.find((l) => l.name.includes('Downtown'))!.id
      recipe = await make(`Probe Reach Airport ${stamp}`, airport)
      base = await make(`Probe Reach Airport Base ${stamp}`, airport)
      shared = await make(`Probe Reach Shared ${stamp}`, null)
      await request(http)
        .post(`/api/recipes/${recipe}/components`)
        .set('Cookie', goldenForkCookie)
        .send({ componentId: base, quantity: 1, unit: 'portion' })
        .expect(201)
      dish = (
        await request(http)
          .post('/api/menu-items')
          .set('Cookie', goldenForkCookie)
          .send({ name: `Probe Reach Dish ${stamp}`, price: 12, locationId: airport })
          .expect(201)
      ).body.id as string
    })

    afterAll(async () => {
      await prisma.client.menuItem.deleteMany({ where: { id: dish } })
      await prisma.client.recipe.deleteMany({ where: { id: { in: [recipe, shared] } } })
      await prisma.client.recipe.deleteMany({ where: { id: base } })
    })

    test('a chef working elsewhere is answered as if the recipe did not exist', async () => {
      const as = <T extends request.Test>(r: T) =>
        r.set('Cookie', chef).set('X-Location-Id', downtown)
      await as(request(http).get(`/api/recipes/${recipe}`)).expect(404)
      await as(request(http).get(`/api/recipes/${recipe}/detail`)).expect(404)
      await as(request(http).patch(`/api/recipes/${recipe}`))
        .send({ portions: 5 })
        .expect(404)
      await as(request(http).patch(`/api/recipes/${recipe}/components/${base}`))
        .send({ quantity: 5 })
        .expect(404)
      await as(request(http).delete(`/api/recipes/${recipe}/components/${base}`)).expect(404)
      await as(request(http).post(`/api/recipes/${shared}/components`))
        .send({ componentId: base, quantity: 1, unit: 'portion' })
        .expect(404)
      await request(http).get(`/api/recipes/${recipe}/detail`).set('Cookie', chef).expect(404)

      const kept = await prisma.client.recipe.findUniqueOrThrow({
        where: { id: recipe },
        include: { components: true },
      })
      expect(kept.portions).toBe(2)
      expect(kept.components.map((c) => Number(c.quantity))).toEqual([1])
      expect(await prisma.client.recipeComponent.count({ where: { parentId: shared } })).toBe(0)
    })

    test('a dish at a location the chef does not work at is refused the same way', async () => {
      await request(http)
        .patch(`/api/menu-items/${dish}`)
        .set('Cookie', chef)
        .set('X-Location-Id', downtown)
        .send({ price: 1 })
        .expect(404)
      const kept = await prisma.client.menuItem.findUniqueOrThrow({ where: { id: dish } })
      expect(Number(kept.price)).toBe(12)
    })

    test('nothing is created or moved into a location the chef does not work at', async () => {
      const name = `Probe Reach Filed ${stamp}`
      await request(http)
        .post('/api/recipes')
        .set('Cookie', chef)
        .set('X-Location-Id', downtown)
        .send({ name, portions: 1, locationId: airport })
        .expect(403)
      await request(http)
        .post('/api/menu-items')
        .set('Cookie', chef)
        .set('X-Location-Id', downtown)
        .send({ name, price: 3, locationId: airport })
        .expect(403)
      expect(await prisma.client.recipe.count({ where: { name } })).toBe(0)
      expect(await prisma.client.menuItem.count({ where: { name } })).toBe(0)

      const own = (
        await request(http)
          .post('/api/menu-items')
          .set('Cookie', chef)
          .set('X-Location-Id', downtown)
          .send({ name, price: 3, locationId: downtown })
          .expect(201)
      ).body.id as string
      try {
        await request(http)
          .patch(`/api/menu-items/${own}`)
          .set('Cookie', chef)
          .set('X-Location-Id', downtown)
          .send({ locationId: airport })
          .expect(403)
      } finally {
        await prisma.client.menuItem.delete({ where: { id: own } })
      }
    })

    describe('menus served only where a manager does not work', () => {
      let manager = ''
      let airportMenu = ''
      let sharedMenu = ''
      let everywhere = ''

      const menu = async (name: string, locationIds: string[], menuItemIds: string[] = []) =>
        (
          await request(http)
            .post('/api/menus')
            .set('Cookie', goldenForkCookie)
            .send({ name, locationIds, menuItemIds })
            .expect(201)
        ).body.id as string

      beforeAll(async () => {
        manager = await login('maria@goldenfork.com')
        everywhere = (
          await request(http)
            .post('/api/menu-items')
            .set('Cookie', goldenForkCookie)
            .send({ name: `Probe Reach Everywhere ${stamp}`, price: 4 })
            .expect(201)
        ).body.id as string
        airportMenu = await menu(`Probe Reach Airport Menu ${stamp}`, [airport], [everywhere])
        sharedMenu = await menu(`Probe Reach Shared Menu ${stamp}`, [downtown, airport], [dish])
      })

      afterAll(async () => {
        await prisma.client.menu.deleteMany({ where: { id: { in: [airportMenu, sharedMenu] } } })
        await prisma.client.menuItem.deleteMany({ where: { id: everywhere } })
      })

      test('are not listed, opened, changed or removed', async () => {
        const as = <T extends request.Test>(r: T) => r.set('Cookie', manager)
        const listed = await as(request(http).get('/api/menus')).expect(200)
        expect((listed.body as { id: string }[]).map((m) => m.id)).not.toContain(airportMenu)
        await as(request(http).get(`/api/menus/${airportMenu}`)).expect(404)
        await as(request(http).get(`/api/menus/${airportMenu}/available-items`)).expect(404)
        await as(request(http).patch(`/api/menus/${airportMenu}`))
          .send({ name: 'Taken' })
          .expect(404)
        await as(request(http).delete(`/api/menus/${airportMenu}`)).expect(404)
        await as(request(http).post('/api/menus'))
          .send({ name: `Probe Reach Refused ${stamp}`, locationIds: [airport] })
          .expect(403)
        const kept = await prisma.client.menu.findUniqueOrThrow({ where: { id: airportMenu } })
        expect(kept.name).toBe(`Probe Reach Airport Menu ${stamp}`)
      })

      test('saving a shared menu keeps the location and the dish the manager cannot see', async () => {
        await request(http)
          .patch(`/api/menus/${sharedMenu}`)
          .set('Cookie', manager)
          .send({ locationIds: [downtown], menuItemIds: [] })
          .expect(200)
        const kept = await prisma.client.menu.findUniqueOrThrow({
          where: { id: sharedMenu },
          include: { locations: true, items: true },
        })
        expect(kept.locations.map((l) => l.locationId).sort()).toEqual([airport, downtown].sort())
        expect(kept.items.map((i) => i.menuItemId)).toEqual([dish])
      })

      test('a dish every location shares is not changed by the manager, and a loose one is put on no menu the manager cannot see', async () => {
        await request(http)
          .patch(`/api/menu-items/${everywhere}`)
          .set('Cookie', manager)
          .send({ menuIds: [] })
          .expect(403)
        expect(
          await prisma.client.menuItemOnMenu.count({
            where: { menuId: airportMenu, menuItemId: everywhere },
          }),
        ).toBe(1)

        const loose = (
          await request(http)
            .post('/api/menu-items')
            .set('Cookie', goldenForkCookie)
            .send({ name: `Probe Reach Loose ${stamp}`, price: 4 })
            .expect(201)
        ).body.id as string
        try {
          await request(http)
            .patch(`/api/menu-items/${loose}`)
            .set('Cookie', manager)
            .send({ menuIds: [airportMenu] })
            .expect(403)
          expect(await prisma.client.menuItemOnMenu.count({ where: { menuItemId: loose } })).toBe(0)
        } finally {
          await prisma.client.menuItem.delete({ where: { id: loose } })
        }
      })
    })

    test('recipes shared by every location stay open to read but not to change, and the owner reaches every location', async () => {
      await request(http)
        .get(`/api/recipes/${shared}`)
        .set('Cookie', chef)
        .set('X-Location-Id', downtown)
        .expect(200)
      await request(http)
        .patch(`/api/recipes/${shared}`)
        .set('Cookie', chef)
        .set('X-Location-Id', downtown)
        .send({ portions: 3 })
        .expect(403)
      await request(http)
        .get(`/api/recipes/${recipe}/detail`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .expect(200)
      await request(http)
        .patch(`/api/recipes/${recipe}/components/${base}`)
        .set('Cookie', goldenForkCookie)
        .send({ quantity: 2 })
        .expect(200)
    })
  })

  describe('a recipe knows every recipe it is part of, so a loop is never offered', () => {
    let top = ''
    let mid = ''
    let base = ''

    const make = async (name: string) =>
      (
        await request(http)
          .post('/api/recipes')
          .set('Cookie', goldenForkCookie)
          .send({ name, portions: 2 })
          .expect(201)
      ).body.id as string

    const nest = (parent: string, componentId: string) =>
      request(http)
        .post(`/api/recipes/${parent}/components`)
        .set('Cookie', goldenForkCookie)
        .send({ componentId, quantity: 1, unit: 'portion' })

    beforeAll(async () => {
      top = await make('Probe Chain Top')
      mid = await make('Probe Chain Mid')
      base = await make('Probe Chain Base')
      await nest(top, mid).expect(201)
      await nest(mid, base).expect(201)
    })

    afterAll(async () => {
      await prisma.client.recipe.deleteMany({ where: { id: top } })
      await prisma.client.recipe.deleteMany({ where: { id: mid } })
      await prisma.client.recipe.deleteMany({ where: { id: base } })
    })

    const containedBy = async (id: string) =>
      (
        (
          await request(http)
            .get(`/api/recipes/${id}/detail`)
            .set('Cookie', goldenForkCookie)
            .expect(200)
        ).body as { containedBy: string[] }
      ).containedBy.sort()

    test('the answer names the recipes above, directly and through the chain', async () => {
      expect(await containedBy(base)).toEqual([mid, top].sort())
      expect(await containedBy(mid)).toEqual([top])
      expect(await containedBy(top)).toEqual([])
    })

    test('closing the loop is refused, directly and through the chain', async () => {
      const direct = await nest(mid, top).expect(400)
      expect(direct.body.error.message).toMatch(/circular recipe relationship/)
      const chain = await nest(base, top).expect(400)
      expect(chain.body.error.message).toMatch(/circular recipe relationship/)
    })
  })

  describe('a recipe moves to another kitchen together with what it is connected to', () => {
    let airport = ''
    let downtown = ''
    let parent = ''
    let component = ''
    let loose = ''

    const make = async (name: string, locationId: string) =>
      (
        await request(http)
          .post('/api/recipes')
          .set('Cookie', goldenForkCookie)
          .send({ name, portions: 2, locationId })
          .expect(201)
      ).body.id as string

    const move = (id: string, locationId: string | null, cookie = goldenForkCookie) =>
      request(http).patch(`/api/recipes/${id}`).set('Cookie', cookie).send({ locationId })

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const locations = await prisma.client.location.findMany({
        where: { organizationId: org.id, isActive: true },
      })
      airport = locations.find((l) => l.name.includes('Airport'))!.id
      downtown = locations.find((l) => l.name.includes('Downtown'))!.id
      parent = await make('Probe Move Parent', downtown)
      component = await make('Probe Move Base', downtown)
      loose = await make('Probe Move Loose', downtown)
      await request(http)
        .post(`/api/recipes/${parent}/components`)
        .set('Cookie', goldenForkCookie)
        .send({ componentId: component, quantity: 1, unit: 'portion' })
        .expect(201)
    })

    afterAll(async () => {
      await prisma.client.recipe.deleteMany({ where: { id: { in: [parent, loose] } } })
      await prisma.client.recipe.deleteMany({ where: { id: component } })
    })

    test('a recipe nobody uses moves, and the kitchens list it where it now is', async () => {
      const res = await move(loose, airport).expect(200)
      expect(res.body.location?.id).toBe(airport)

      const at = async (location: string) =>
        (
          (
            await request(http)
              .get('/api/recipes')
              .set('Cookie', goldenForkCookie)
              .set('X-Location-Id', location)
              .expect(200)
          ).body as { id: string }[]
        ).map((r) => r.id)
      expect(await at(airport)).toContain(loose)
      expect(await at(downtown)).not.toContain(loose)
    })

    test('a component used at another kitchen stays, and the answer names who uses it', async () => {
      const res = await move(component, airport).expect(400)
      expect(res.body.error.message).toMatch(/Probe Move Parent/)
    })

    test('a recipe built on a component of another kitchen stays too', async () => {
      const res = await move(parent, airport).expect(400)
      expect(res.body.error.message).toMatch(/Probe Move Base/)
    })

    test('a recipe says which recipes and dishes are built on it', async () => {
      const res = await request(http)
        .get(`/api/recipes/${component}/detail`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      expect(res.body.usedBy.recipes).toEqual([{ id: parent, name: 'Probe Move Parent' }])
      expect(res.body.usedBy.dishes).toEqual([])
    })

    test('a recipe for all locations may not rest on a component of one kitchen', async () => {
      const res = await move(parent, null).expect(400)
      expect(res.body.error.message).toMatch(/Probe Move Base/)
    })

    test('a manager of one kitchen moves nothing in or out of the others', async () => {
      const maria = await login('maria@goldenfork.com')
      await move(loose, downtown, maria).expect(404)
      const own = await make('Probe Move Maria', downtown)
      try {
        await move(own, null, maria).expect(403)
      } finally {
        await prisma.client.recipe.delete({ where: { id: own } })
      }
    })

    test('a manager of one kitchen is shown only the users of a recipe she can open', async () => {
      const shared = (
        await request(http)
          .post('/api/recipes')
          .set('Cookie', goldenForkCookie)
          .send({ name: 'Probe Move Shared', portions: 2 })
          .expect(201)
      ).body.id as string
      const far = await make('Probe Move Far', airport)
      try {
        await request(http)
          .post(`/api/recipes/${far}/components`)
          .set('Cookie', goldenForkCookie)
          .send({ componentId: shared, quantity: 1, unit: 'portion' })
          .expect(201)
        const usersSeenBy = async (cookie: string) =>
          (
            (
              await request(http)
                .get(`/api/recipes/${shared}/detail`)
                .set('Cookie', cookie)
                .expect(200)
            ).body as { usedBy: { recipes: { id: string; name: string }[] } }
          ).usedBy.recipes
        expect(await usersSeenBy(goldenForkCookie)).toEqual([{ id: far, name: 'Probe Move Far' }])
        expect(await usersSeenBy(await login('maria@goldenfork.com'))).toEqual([])
      } finally {
        await prisma.client.recipe.deleteMany({ where: { id: far } })
        await prisma.client.recipe.deleteMany({ where: { id: shared } })
      }
    })

    test('a component may always become a recipe for all locations', async () => {
      const res = await move(component, null).expect(200)
      expect(res.body.location).toBeNull()
    })

    test('a chef edits a recipe but does not move it', async () => {
      const chef = await login('ken@goldenfork.com')
      const own = await make('Probe Move Ken', downtown)
      try {
        await request(http)
          .patch(`/api/recipes/${own}`)
          .set('Cookie', chef)
          .send({ portions: 3 })
          .expect(200)
        await move(own, null, chef).expect(403)
      } finally {
        await prisma.client.recipe.delete({ where: { id: own } })
      }
    })
  })

  test('a category says how many records it files, and deleting it leaves them uncategorized', async () => {
    const category = (
      await request(http)
        .post('/api/categories')
        .set('Cookie', goldenForkCookie)
        .send({ name: `Probe Count ${Date.now()}`, kind: 'recipe' })
        .expect(201)
    ).body as { id: string }
    const recipe = (
      await request(http)
        .post('/api/recipes')
        .set('Cookie', goldenForkCookie)
        .send({ name: `Probe Counted ${Date.now()}`, portions: 1, categoryId: category.id })
        .expect(201)
    ).body as { id: string }
    try {
      const list = await request(http)
        .get('/api/categories?kind=recipe')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const row = (list.body as { id: string; used: number }[]).find((c) => c.id === category.id)
      expect(row?.used).toBe(1)

      await request(http)
        .delete(`/api/categories/${category.id}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const kept = await prisma.client.recipe.findUniqueOrThrow({ where: { id: recipe.id } })
      expect(kept.categoryId).toBeNull()
    } finally {
      await prisma.client.recipe.delete({ where: { id: recipe.id } })
      await prisma.client.category.deleteMany({ where: { id: category.id } })
    }
  })

  test('a chef adds a category where it is chosen, and only a manager renames or deletes one', async () => {
    const chef = await login('ken@goldenfork.com')
    const stamp = Date.now()
    const made = await request(http)
      .post('/api/categories')
      .set('Cookie', chef)
      .send({ name: `Probe Chef Shelf ${stamp}`, kind: 'recipe' })
      .expect(201)
    const id = made.body.id as string
    const recipe = (
      await request(http)
        .post('/api/recipes')
        .set('Cookie', goldenForkCookie)
        .send({ name: `Probe Filed ${stamp}`, portions: 1, categoryId: id })
        .expect(201)
    ).body as { id: string }
    try {
      await request(http)
        .patch(`/api/categories/${id}`)
        .set('Cookie', chef)
        .send({ name: 'Renamed' })
        .expect(403)
      await request(http).delete(`/api/categories/${id}`).set('Cookie', chef).expect(403)

      const renamed = await request(http)
        .patch(`/api/categories/${id}`)
        .set('Cookie', goldenForkCookie)
        .send({ name: `Probe Renamed ${stamp}` })
        .expect(200)
      expect(renamed.body.name).toBe(`Probe Renamed ${stamp}`)
      const detail = await request(http)
        .get(`/api/recipes/${recipe.id}/detail`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      expect(detail.body.category).toBe(`Probe Renamed ${stamp}`)

      const twin = await request(http)
        .post('/api/categories')
        .set('Cookie', chef)
        .send({ name: `probe renamed ${stamp}`, kind: 'recipe' })
        .expect(409)
      expect(twin.body.error.message).toMatch(/already exists/)
      await request(http)
        .patch(`/api/categories/${id}`)
        .set('Cookie', goldenForkCookie)
        .send({ name: '   ' })
        .expect(400)
      const otherKind = await request(http)
        .post('/api/categories')
        .set('Cookie', goldenForkCookie)
        .send({ name: `Probe Renamed ${stamp}`, kind: 'menu' })
        .expect(201)
      await prisma.client.category.delete({ where: { id: otherKind.body.id } })
      await request(http)
        .patch('/api/categories/no-such-category')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Anything' })
        .expect(404)
    } finally {
      await prisma.client.recipe.delete({ where: { id: recipe.id } })
      await prisma.client.category.deleteMany({ where: { id } })
    }
  })

  test('a category name is taken once per kind, whatever its case, including by a rename', async () => {
    const stamp = Date.now()
    const [a, b] = await Promise.all(
      ['A', 'B'].map(
        async (x) =>
          (
            await request(http)
              .post('/api/categories')
              .set('Cookie', goldenForkCookie)
              .send({ name: `Probe Case ${x} ${stamp}`, kind: 'ingredient' })
              .expect(201)
          ).body.id as string,
      ),
    )
    try {
      const clash = await request(http)
        .patch(`/api/categories/${b}`)
        .set('Cookie', goldenForkCookie)
        .send({ name: `PROBE CASE A ${stamp}` })
        .expect(409)
      expect(clash.body.error.message).toMatch(`Probe Case A ${stamp}`)
      await request(http)
        .patch(`/api/categories/${a}`)
        .set('Cookie', goldenForkCookie)
        .send({ name: `probe case a ${stamp}` })
        .expect(200)
    } finally {
      await prisma.client.category.deleteMany({ where: { id: { in: [a, b] } } })
    }
  })

  test('a production batch names who made it, and the person who recorded it by default', async () => {
    const location = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    const recipe = await prisma.client.recipe.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Marinara Sauce' },
    })
    const owner = await prisma.client.user.findUniqueOrThrow({
      where: { email: 'owner@goldenfork.com' },
    })
    const record = (madeBy?: string) =>
      request(http)
        .post('/api/production')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', location.id)
        .send({
          recipeId: recipe.id,
          quantity: 1,
          unit: 'portion',
          ...(madeBy === undefined ? {} : { madeBy }),
        })
        .expect(201)
    const ids: string[] = []
    try {
      ids.push(((await record()).body as { id: string }).id)
      ids.push(((await record('  ')).body as { id: string }).id)
      ids.push(((await record('Sam Prep Cook')).body as { id: string }).id)
      const rows = await prisma.client.production.findMany({ where: { id: { in: ids } } })
      const by = (id: string) => rows.find((r) => r.id === id)?.madeBy
      expect(by(ids[0])).toBe(owner.fullName)
      expect(by(ids[1])).toBe(owner.fullName)
      expect(by(ids[2])).toBe('Sam Prep Cook')
    } finally {
      await prisma.client.production.deleteMany({ where: { id: { in: ids } } })
    }
  })

  test('a report period reaches movements and batches older than the latest page', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const location = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    const ingredient = await prisma.client.ingredient.findFirstOrThrow({
      where: { organizationId: org.id, name: 'Eggs' },
    })
    const recipe = await prisma.client.recipe.findFirstOrThrow({
      where: { organizationId: org.id, name: 'Marinara Sauce' },
    })
    const day = new Date('2020-03-10T12:00:00Z')
    const movement = await prisma.client.inventoryTransaction.create({
      data: {
        organizationId: org.id,
        locationId: location.id,
        ingredientId: ingredient.id,
        type: 'RECEIVE',
        quantity: 1,
        unit: ingredient.unit,
        cost: 7,
        notes: 'Probe old movement',
        createdAt: day,
      },
    })
    const batch = await prisma.client.production.create({
      data: {
        organizationId: org.id,
        locationId: location.id,
        recipeId: recipe.id,
        quantity: 1,
        unit: 'ea',
        madeBy: 'Probe old batch',
        date: day,
      },
    })
    const get = (path: string) =>
      request(http).get(path).set('Cookie', goldenForkCookie).expect(200)
    try {
      const page = await get('/api/inventory/transactions?limit=1')
      expect((page.body as { data: { id: string }[] }).data.map((t) => t.id)).not.toContain(
        movement.id,
      )
      const period = await get('/api/inventory/transactions?from=2020-03-10&to=2020-03-10')
      expect((period.body as { data: { id: string }[] }).data.map((t) => t.id)).toEqual([
        movement.id,
      ])
      const since = await get('/api/inventory/transactions?from=2020-03-10')
      expect((since.body as { data: { id: string }[] }).data.map((t) => t.id)).toContain(
        movement.id,
      )

      const used = await prisma.client.inventoryTransaction.create({
        data: {
          organizationId: org.id,
          locationId: location.id,
          ingredientId: ingredient.id,
          type: 'USE',
          quantity: -2,
          unit: ingredient.unit,
          cost: 3,
          createdAt: day,
        },
      })
      try {
        const usage = await get('/api/reports/usage?from=2020-03-10&to=2020-03-10')
        expect(usage.body).toEqual([
          expect.objectContaining({ period: '2020-03-09', ingredient: 'Eggs', used: 2, cost: 3 }),
        ])
      } finally {
        await prisma.client.inventoryTransaction.delete({ where: { id: used.id } })
      }

      const batches = await get('/api/production?from=2020-03-10&to=2020-03-10')
      expect((batches.body as { data: { id: string }[] }).data.map((b) => b.id)).toEqual([batch.id])
      await request(http)
        .get('/api/production?from=2020-03-11&to=2020-03-10')
        .set('Cookie', goldenForkCookie)
        .expect(400)
      await request(http)
        .get('/api/inventory/transactions?from=whenever')
        .set('Cookie', goldenForkCookie)
        .expect(400)
    } finally {
      await prisma.client.inventoryTransaction.delete({ where: { id: movement.id } })
      await prisma.client.production.delete({ where: { id: batch.id } })
    }
  })

  test('the owner email is not rewritten through the organization settings', async () => {
    const before = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const res = await request(http)
      .patch('/api/organizations/current')
      .set('Cookie', goldenForkCookie)
      .send({ ownerEmail: 'someone-else@example.com' })
      .expect(400)
    expect(JSON.stringify(res.body)).toMatch(/ownerEmail should not exist/)
    const after = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    expect(after.ownerEmail).toBe(before.ownerEmail)
  })

  describe('a request too large for the door is answered, not crashed', () => {
    test('an oversized body is refused as too large rather than as a server fault', async () => {
      const res = await request(http)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'A'.repeat(200_000) })
        .expect(413)
      expect(JSON.stringify(res.body)).toMatch(/larger than this endpoint accepts/)
    })

    test('a body that is a list rather than an object is refused, not passed on to the database', async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const vendor = await prisma.client.vendor.findFirstOrThrow({
        where: { organizationId: org.id },
      })
      const location = await prisma.client.location.findFirstOrThrow({
        where: { organizationId: org.id },
      })
      for (const url of [
        '/api/organizations/current',
        `/api/vendors/${vendor.id}`,
        `/api/locations/${location.id}`,
      ]) {
        const res = await request(http).patch(url).set('Cookie', goldenForkCookie).send([])
        expect([url, res.status]).toEqual([url, 400])
        expect(JSON.stringify(res.body)).toMatch(/body must be an object/)
      }
    })

    test('an update that sends null for what a record must have is refused, and a note may be cleared with null', async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const scope = { organizationId: org.id }
      const vendor = await prisma.client.vendor.findFirstOrThrow({ where: scope })
      const location = await prisma.client.location.findFirstOrThrow({ where: scope })
      const ingredient = await prisma.client.ingredient.findFirstOrThrow({ where: scope })
      const menu = await prisma.client.menu.findFirstOrThrow({ where: scope })
      const product = await prisma.client.vendorProduct.findFirstOrThrow({ where: scope })
      const edge = await prisma.client.recipeComponent.findFirstOrThrow({
        where: { parent: scope },
      })
      const refused: [string, Record<string, null>][] = [
        [`/api/vendors/${vendor.id}`, { name: null }],
        [`/api/locations/${location.id}`, { name: null }],
        [`/api/ingredients/${ingredient.id}`, { name: null }],
        [`/api/menus/${menu.id}`, { name: null }],
        [`/api/vendor-products/${product.id}`, { vendorId: null }],
        [`/api/recipes/${edge.parentId}/components/${edge.componentId}`, { unit: null }],
      ]
      for (const [url, body] of refused) {
        const res = await request(http).patch(url).set('Cookie', goldenForkCookie).send(body)
        expect([url, res.status]).toEqual([url, 400])
        expect(JSON.stringify(res.body)).toContain(Object.keys(body)[0])
      }

      const cleared = await request(http)
        .patch(`/api/recipes/${edge.parentId}/components/${edge.componentId}`)
        .set('Cookie', goldenForkCookie)
        .send({ prepNote: null })
      expect(cleared.status).toBe(200)
      await prisma.client.recipeComponent.update({
        where: { id: edge.id },
        data: { prepNote: edge.prepNote },
      })

      const ingredientId = ingredient.id
      const drafted = await request(http)
        .post('/api/purchasing/drafts')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', location.id)
        .send({ lines: [{ ingredientId, quantity: 1 }], note: 'probe null note' })
        .expect(201)
      const draftId = (drafted.body as { id: string }[])[0].id
      try {
        const res = await request(http)
          .patch(`/api/purchasing/drafts/${draftId}`)
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', location.id)
          .send({ note: null })
        expect(res.status).toBe(200)
        expect(res.body.note).toBe('')
      } finally {
        await prisma.client.purchaseDraft.delete({ where: { id: draftId } })
      }
    })

    test('a password longer than one can be is refused by name', async () => {
      const res = await request(http)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'A'.repeat(500) })
        .expect(400)
      expect(JSON.stringify(res.body)).toMatch(/password must be shorter/)
    })
  })

  describe('a number the column cannot hold is refused, not thrown', () => {
    let locationId = ''
    let ingredientId = ''

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      locationId = (
        await prisma.client.location.findFirstOrThrow({
          where: { organizationId: org.id, isActive: true },
          orderBy: { name: 'asc' },
        })
      ).id
      ingredientId = (
        await prisma.client.ingredient.findFirstOrThrow({
          where: { organizationId: org.id },
          orderBy: { name: 'asc' },
        })
      ).id
    })

    const named = (body: unknown) => JSON.stringify(body)

    test('a quantity beyond what stock can hold names the field', async () => {
      const res = await request(http)
        .post('/api/inventory/transactions')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ ingredientId, type: 'RECEIVE', quantity: 1e12 })
        .expect(400)
      expect(named(res.body)).toMatch(/quantity must not be greater than/)
    })

    test('a price beyond what a rate can hold names the field', async () => {
      const res = await request(http)
        .post('/api/ingredients')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Probe Beyond Rate', unit: 'kg', costPerUnit: 1e9 })
        .expect(400)
      expect(named(res.body)).toMatch(/costPerUnit must not be greater than/)
    })

    test('a selling price beyond what money can hold names the field', async () => {
      const res = await request(http)
        .post('/api/menu-items')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Probe Beyond Money', price: 1e11 })
        .expect(400)
      expect(named(res.body)).toMatch(/price must not be greater than/)
    })

    test('what the columns do hold is still accepted', async () => {
      const res = await request(http)
        .post('/api/ingredients')
        .set('Cookie', goldenForkCookie)
        .send({ name: `Probe Within Bounds ${Date.now()}`, unit: 'kg', costPerUnit: 99999999.9999 })
        .expect(201)
      await prisma.client.ingredient.delete({ where: { id: (res.body as { id: string }).id } })
    })
  })

  describe('a reporting period is a period', () => {
    const variance = (query: string) =>
      request(http).get(`/api/analytics/food-cost-variance${query}`).set('Cookie', goldenForkCookie)

    test('a range that is not a range is refused rather than answered with zeros', async () => {
      await variance('?from=2026-09-30&to=2026-08-01').expect(400)
    })

    test('a string that is not a date is refused rather than becoming one', async () => {
      await variance('?from=not-a-date&to=2026-09-30').expect(400)
      await variance('?from=2026-08-01&to=whenever').expect(400)
    })

    test('waste by reason is the waste the variance counts, for the same period', async () => {
      const ing = await prisma.client.ingredient.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
      })
      const downtown = await prisma.client.location.findFirstOrThrow({
        where: { name: 'Golden Fork — Downtown' },
      })
      const day = '2020-03-10'
      const breakdown = async (query: string) =>
        (
          await request(http)
            .get(`/api/analytics/waste-breakdown${query}`)
            .set('Cookie', goldenForkCookie)
            .expect(200)
        ).body as { cost: number }[]
      expect(await breakdown(`?from=${day}&to=${day}`)).toEqual([])

      const created = await request(http)
        .post('/api/waste')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown.id)
        .send({
          ingredientId: ing.id,
          quantity: 0.05,
          reason: 'spoilage',
          date: day,
          notes: 'period probe',
        })
        .expect(201)
      try {
        const rows = await breakdown(`?from=${day}&to=${day}`)
        const report = (await variance(`?from=${day}&to=${day}`).expect(200)).body as {
          wasteCost: number
        }
        expect(report.wasteCost).toBeGreaterThan(0)
        expect(rows.reduce((sum, r) => sum + r.cost, 0)).toBeCloseTo(report.wasteCost, 2)
        expect(await breakdown('?from=2020-03-11&to=2020-03-12')).toEqual([])
        await request(http)
          .get('/api/analytics/waste-breakdown?from=2026-09-30&to=2026-08-01')
          .set('Cookie', goldenForkCookie)
          .expect(400)
      } finally {
        await prisma.client.wasteEntry.deleteMany({
          where: { id: (created.body as { id: string }).id },
        })
        await prisma.client.inventoryTransaction.deleteMany({
          where: { ingredientId: ing.id, notes: 'period probe' },
        })
        await prisma.client.ingredient.update({
          where: { id: ing.id },
          data: { onHand: { increment: 0.05 } },
        })
        await prisma.client.ingredientLocationStock.update({
          where: { ingredientId_locationId: { ingredientId: ing.id, locationId: downtown.id } },
          data: { onHand: { increment: 0.05 } },
        })
      }
    })

    test('a real range still answers', async () => {
      const res = await variance('?from=2026-08-01&to=2026-09-30').expect(200)
      const body = res.body as { theoreticalCost: number; byDish: unknown[] }
      expect(body.theoreticalCost).toBeGreaterThan(0)
      expect(body.byDish.length).toBeGreaterThan(0)
    })
  })

  describe('the dashboard answers for the location in the header', () => {
    test('low stock counts what the ingredient list at that location marks low', async () => {
      const locations = await prisma.client.location.findMany({
        where: { organization: { slug: 'golden-fork' }, isActive: true },
        select: { id: true },
      })
      const counts = new Set<number>()
      for (const where of [...locations.map((l) => l.id), null]) {
        const headers: Record<string, string> = where ? { 'X-Location-Id': where } : {}
        const kpis = (
          await request(http)
            .get('/api/dashboard/kpis')
            .set('Cookie', goldenForkCookie)
            .set(headers)
            .expect(200)
        ).body as { lowStockCount: number }
        const rows = (
          await request(http)
            .get('/api/ingredients')
            .set('Cookie', goldenForkCookie)
            .set(headers)
            .expect(200)
        ).body as { status: string }[]
        expect(kpis.lowStockCount).toBe(rows.filter((r) => r.status === 'low').length)
        counts.add(kpis.lowStockCount)
      }
      expect(counts.size).toBeGreaterThan(1)
    })

    test('the recipe last worked on is one this location cooks', async () => {
      const [here, there] = await prisma.client.location.findMany({
        where: { organization: { slug: 'golden-fork' }, isActive: true },
        orderBy: { name: 'asc' },
        take: 2,
      })
      const recipe = await prisma.client.recipe.create({
        data: {
          organizationId: there.organizationId,
          locationId: there.id,
          name: 'Probe Latest Elsewhere',
          portions: 1,
        },
      })
      try {
        const kpis = (
          await request(http)
            .get('/api/dashboard/kpis')
            .set('Cookie', goldenForkCookie)
            .set('X-Location-Id', here.id)
            .expect(200)
        ).body as { recentRecipe: string | null }
        expect(kpis.recentRecipe).not.toBe('Probe Latest Elsewhere')
      } finally {
        await prisma.client.recipe.delete({ where: { id: recipe.id } })
      }
    })

    test('waste stated for today is recent activity, not midnight', async () => {
      const ing = await prisma.client.ingredient.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
      })
      const downtown = await prisma.client.location.findFirstOrThrow({
        where: { name: 'Golden Fork — Downtown' },
      })
      const today = new Date().toISOString().slice(0, 10)
      const before = Date.now()
      const created = await request(http)
        .post('/api/waste')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown.id)
        .send({
          ingredientId: ing.id,
          quantity: 0.01,
          reason: 'other',
          date: today,
          notes: 'activity probe',
        })
        .expect(201)
      try {
        const events = (
          await request(http)
            .get('/api/dashboard/activity')
            .set('Cookie', goldenForkCookie)
            .set('X-Location-Id', downtown.id)
            .expect(200)
        ).body as { type: string; at: string }[]
        const waste = events.find((e) => e.type === 'waste')!
        expect(new Date(waste.at).getTime()).toBeGreaterThanOrEqual(before - 1000)
      } finally {
        const id = (created.body as { id: string }).id
        await prisma.client.wasteEntry.deleteMany({ where: { id } })
        await prisma.client.inventoryTransaction.deleteMany({
          where: { ingredientId: ing.id, notes: 'activity probe' },
        })
        await prisma.client.ingredient.update({
          where: { id: ing.id },
          data: { onHand: { increment: 0.01 } },
        })
        await prisma.client.ingredientLocationStock.update({
          where: { ingredientId_locationId: { ingredientId: ing.id, locationId: downtown.id } },
          data: { onHand: { increment: 0.01 } },
        })
      }
    })

    test('a recipe in the activity feed names its cost as money', async () => {
      const recipe = await prisma.client.recipe.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' } },
      })
      await prisma.client.recipe.update({
        where: { id: recipe.id },
        data: { updatedAt: new Date() },
      })
      const events = (
        await request(http)
          .get('/api/dashboard/activity')
          .set('Cookie', goldenForkCookie)
          .expect(200)
      ).body as { type: string; text: string }[]
      const costed = events.find((e) => e.type === 'recipe')!
      expect(costed.text).toMatch(/costed at \$\d+\.\d\d$/)
    })

    test('a member who joined is named in the activity feed by name and role title', async () => {
      const email = `feed.probe.${Date.now()}@example.com`
      const invited = await request(http)
        .post('/api/invitations')
        .set('Cookie', goldenForkCookie)
        .send({ email, role: 'staff' })
        .expect(201)
      const token = String(invited.body.acceptUrl).split('invite=')[1]
      await request(http)
        .post(`/api/invitations/${token}/accept`)
        .send({ fullName: 'Feed Probe Person', password: 'Feed_pass1!' })
        .expect(200)
      try {
        const events = (
          await request(http)
            .get('/api/dashboard/activity')
            .set('Cookie', goldenForkCookie)
            .expect(200)
        ).body as { type: string; text: string }[]
        const joined = events.find((e) => e.type === 'team' && e.text.includes('Feed Probe Person'))
        expect(joined?.text).toBe('Feed Probe Person joined as Executive Chef')
      } finally {
        const user = await prisma.client.user.findUniqueOrThrow({ where: { email } })
        await request(http)
          .delete(`/api/users/${user.id}`)
          .set('Cookie', goldenForkCookie)
          .expect(200)
      }
    })
  })

  describe('stock you hold is stock you can see', () => {
    let held = ''
    let empty = ''

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      held = (
        await prisma.client.ingredient.create({
          data: {
            organizationId: org.id,
            name: 'Probe Retired With Stock',
            unit: 'kg',
            onHand: 9,
            isActive: false,
          },
        })
      ).id
      empty = (
        await prisma.client.ingredient.create({
          data: {
            organizationId: org.id,
            name: 'Probe Retired Empty',
            unit: 'kg',
            onHand: 0,
            isActive: false,
          },
        })
      ).id
    })

    afterAll(async () => {
      await prisma.client.ingredient.deleteMany({ where: { id: { in: [held, empty] } } })
    })

    test('an archived ingredient still holding stock stays on the inventory screen', async () => {
      const res = await request(http)
        .get('/api/inventory')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const rows = res.body as { id: string }[]
      expect(rows.some((r) => r.id === held)).toBe(true)
      expect(rows.some((r) => r.id === empty)).toBe(false)
    })

    test('stock you hold can still be written off, archived or not', async () => {
      const location = await prisma.client.location.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, isActive: true },
        orderBy: { name: 'asc' },
      })
      await prisma.client.ingredientLocationStock.create({
        data: { ingredientId: held, locationId: location.id, onHand: 9 },
      })
      try {
        const res = await request(http)
          .get('/api/waste/ingredients')
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', location.id)
          .expect(200)
        const rows = res.body as { id: string }[]
        expect(rows.some((r) => r.id === held)).toBe(true)
        expect(rows.some((r) => r.id === empty)).toBe(false)
      } finally {
        await prisma.client.ingredientLocationStock.deleteMany({ where: { ingredientId: held } })
      }
    })

    test('the catalogue still leaves both out until the archive is asked for', async () => {
      const res = await request(http)
        .get('/api/ingredients')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const rows = res.body as { id: string }[]
      expect(rows.some((r) => r.id === held)).toBe(false)
      expect(rows.some((r) => r.id === empty)).toBe(false)
    })
  })

  describe('a product belongs to the vendor that sells it', () => {
    let vendorA = ''
    let vendorB = ''
    let ingredientId = ''
    let foreignProductId = ''
    const created: string[] = []

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const vendors = await prisma.client.vendor.findMany({
        where: { organizationId: org.id, status: 'active' },
        orderBy: { name: 'asc' },
        take: 2,
      })
      vendorA = vendors[0].id
      vendorB = vendors[1].id
      ingredientId = (
        await prisma.client.ingredient.findFirstOrThrow({
          where: { organizationId: org.id },
          orderBy: { name: 'asc' },
        })
      ).id

      const other = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'bella-cucina' },
      })
      const otherVendor = await prisma.client.vendor.findFirstOrThrow({
        where: { organizationId: other.id },
        orderBy: { name: 'asc' },
      })
      foreignProductId = (
        await prisma.client.vendorProduct.create({
          data: {
            organizationId: other.id,
            vendorId: otherVendor.id,
            name: 'Foreign Probe Product',
          },
        })
      ).id
    })

    afterAll(async () => {
      await prisma.client.vendorProduct.deleteMany({ where: { id: { in: created } } })
      await prisma.client.vendorProduct.delete({ where: { id: foreignProductId } })
    })

    const add = (body: Record<string, unknown>) =>
      request(http).post('/api/vendor-products').set('Cookie', goldenForkCookie).send(body)

    test('two vendors may sell a product of the same name, one vendor may not', async () => {
      const first = await add({
        vendorId: vendorA,
        name: 'Probe Butter Case',
        sku: 'PROBE-1',
        ingredientId,
      }).expect(201)
      created.push((first.body as { id: string }).id)
      expect(first.body).toMatchObject({ ingredientId, sku: 'PROBE-1' })

      const second = await add({ vendorId: vendorB, name: 'Probe Butter Case' }).expect(201)
      created.push((second.body as { id: string }).id)

      await add({ vendorId: vendorA, name: 'probe butter case' }).expect(409)
    })

    test('a code is claimed once per vendor', async () => {
      await add({ vendorId: vendorA, name: 'Probe Butter Half Case', sku: 'probe-1' }).expect(409)
    })

    test('a product of another organization is answered as though it did not exist', async () => {
      await request(http)
        .patch(`/api/vendor-products/${foreignProductId}`)
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Hijacked' })
        .expect(404)
      await request(http)
        .delete(`/api/vendor-products/${foreignProductId}`)
        .set('Cookie', goldenForkCookie)
        .expect(404)
      const intact = await prisma.client.vendorProduct.findUniqueOrThrow({
        where: { id: foreignProductId },
      })
      expect(intact.name).toBe('Foreign Probe Product')
    })

    test('the list answers with this organization only, unmapped first', async () => {
      const res = await request(http)
        .get('/api/vendor-products')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const rows = res.body as { id: string; name: string; ingredientId: string | null }[]
      expect(rows.some((r) => r.name === 'Foreign Probe Product')).toBe(false)
      const mine = rows.filter((r) => created.includes(r.id))
      expect(mine.length).toBe(2)
      expect(mine[0].ingredientId).toBeNull()
    })

    test('mapping a product to an ingredient answers with the mapping', async () => {
      const res = await request(http)
        .patch(`/api/vendor-products/${created[1]}`)
        .set('Cookie', goldenForkCookie)
        .send({ ingredientId })
        .expect(200)
      expect(res.body).toMatchObject({ ingredientId, vendorId: vendorB })
    })

    test('clearing a code is a change, not a crash', async () => {
      const res = await request(http)
        .patch(`/api/vendor-products/${created[0]}`)
        .set('Cookie', goldenForkCookie)
        .send({ sku: null })
        .expect(200)
      expect((res.body as { sku: string }).sku).toBe('')
      await request(http)
        .patch(`/api/vendor-products/${created[0]}`)
        .set('Cookie', goldenForkCookie)
        .send({ sku: 'PROBE-1' })
        .expect(200)
    })

    test('the last price is the one this location paid, not the one another location did', async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const [here, elsewhere] = await prisma.client.location.findMany({
        where: { organizationId: org.id, isActive: true },
        orderBy: { name: 'asc' },
        take: 2,
      })
      const own = await prisma.client.vendorProduct.create({
        data: {
          organizationId: org.id,
          vendorId: vendorA,
          ingredientId,
          name: 'Probe Priced Product',
        },
      })
      created.push(own.id)
      const cheap = await prisma.client.ingredientPriceHistory.create({
        data: {
          organizationId: org.id,
          ingredientId,
          vendorId: vendorA,
          locationId: here.id,
          costPerUnit: 11.11,
          source: 'receipt',
        },
      })
      const dear = await prisma.client.ingredientPriceHistory.create({
        data: {
          organizationId: org.id,
          ingredientId,
          vendorId: vendorA,
          locationId: elsewhere.id,
          costPerUnit: 99.99,
          source: 'receipt',
        },
      })
      try {
        const res = await request(http)
          .get('/api/vendor-products')
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', here.id)
          .expect(200)
        const row = (res.body as { id: string; lastPrice: number | null }[]).find(
          (p) => p.id === own.id,
        )
        expect(row?.lastPrice).toBe(11.11)
      } finally {
        await prisma.client.ingredientPriceHistory.deleteMany({
          where: { id: { in: [cheap.id, dear.id] } },
        })
      }
    })

    test('a chef may read the catalogue and may not write to it', async () => {
      const chef = await login('ken@goldenfork.com')
      await request(http).get('/api/vendor-products').set('Cookie', chef).expect(200)
      await request(http)
        .post('/api/vendor-products')
        .set('Cookie', chef)
        .send({ vendorId: vendorA, name: 'Probe Chef Product' })
        .expect(403)
    })
  })

  describe('a menu is edited for the locations that serve it, whatever the header says', () => {
    const stamp = Date.now()
    let downtown = ''
    let airport = ''
    let menuId = ''
    let downtownDish = ''
    let airportDish = ''

    const dish = async (name: string, locationId: string) => {
      const res = await request(http)
        .post('/api/menu-items')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ name, price: 10, locationId })
        .expect(201)
      return (res.body as { id: string }).id
    }

    beforeAll(async () => {
      downtown = (
        await prisma.client.location.findFirstOrThrow({ where: { name: 'Golden Fork — Downtown' } })
      ).id
      airport = (
        await prisma.client.location.findFirstOrThrow({ where: { name: 'Golden Fork — Airport' } })
      ).id
      downtownDish = await dish(`Probe Downtown Dish ${stamp}`, downtown)
      airportDish = await dish(`Probe Airport Dish ${stamp}`, airport)
      const menu = await request(http)
        .post('/api/menus')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({
          name: `Probe Served Menu ${stamp}`,
          locationIds: [downtown],
          menuItemIds: [downtownDish],
        })
        .expect(201)
      menuId = (menu.body as { id: string }).id
    })

    afterAll(async () => {
      await prisma.client.menu.deleteMany({ where: { id: menuId } })
      await prisma.client.menuItem.deleteMany({
        where: { id: { in: [downtownDish, airportDish] } },
      })
    })

    test('a dish of the location that serves the menu is removed and added back with another location in the header', async () => {
      const removed = await request(http)
        .patch(`/api/menus/${menuId}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', airport)
        .send({ menuItemIds: [] })
        .expect(200)
      expect((removed.body as { items: unknown[] }).items).toHaveLength(0)

      const offered = await request(http)
        .get(`/api/menus/${menuId}/available-items`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', airport)
        .expect(200)
      const names = (offered.body as { name: string }[]).map((i) => i.name)
      expect(names).toContain(`Probe Downtown Dish ${stamp}`)
      expect(names).not.toContain(`Probe Airport Dish ${stamp}`)

      const added = await request(http)
        .patch(`/api/menus/${menuId}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', airport)
        .send({ menuItemIds: [downtownDish] })
        .expect(200)
      expect((added.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([
        downtownDish,
      ])
    })

    test('a dish sold only at a location that does not serve the menu is refused with a sentence', async () => {
      const res = await request(http)
        .patch(`/api/menus/${menuId}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', airport)
        .send({ menuItemIds: [downtownDish, airportDish] })
        .expect(400)
      expect((res.body as { error: { message: string } }).error.message).toMatch(
        /does not serve Probe Served Menu/,
      )

      await request(http)
        .patch(`/api/menu-items/${airportDish}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', airport)
        .send({ menuIds: [menuId] })
        .expect(400)
    })
  })

  describe('a recalculation reaches every kitchen, whoever asks and from wherever', () => {
    let airport = ''
    let downtown = ''
    let ingredient = ''
    let airportRecipe = ''
    let downtownBase = ''
    let downtownParent = ''

    const make = async (name: string, locationId: string, withLine: boolean) =>
      (
        await request(http)
          .post('/api/recipes')
          .set('Cookie', goldenForkCookie)
          .send({
            name,
            portions: 1,
            locationId,
            ingredients: withLine ? [{ ingredientId: ingredient, quantity: 1, unit: 'kg' }] : [],
          })
          .expect(201)
      ).body.id as string

    const costOf = async (id: string) =>
      (await prisma.client.recipe.findUniqueOrThrow({ where: { id } })).totalCost.toNumber()

    const priceAt = (cost: number) =>
      prisma.client.ingredient.update({ where: { id: ingredient }, data: { costPerUnit: cost } })

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const locations = await prisma.client.location.findMany({
        where: { organizationId: org.id, isActive: true },
      })
      airport = locations.find((l) => l.name.includes('Airport'))!.id
      downtown = locations.find((l) => l.name.includes('Downtown'))!.id
      ingredient = (
        await request(http)
          .post('/api/ingredients')
          .set('Cookie', goldenForkCookie)
          .send({ name: 'Probe Recalc Stock', unit: 'kg', costPerUnit: 10 })
          .expect(201)
      ).body.id as string
      airportRecipe = await make('Probe Recalc Airport', airport, true)
      downtownBase = await make('Probe Recalc Base', downtown, true)
      downtownParent = await make('Probe Recalc Parent', downtown, false)
      await request(http)
        .post(`/api/recipes/${downtownParent}/components`)
        .set('Cookie', goldenForkCookie)
        .send({ componentId: downtownBase, quantity: 1, unit: 'portion' })
        .expect(201)
    })

    afterAll(async () => {
      await prisma.client.recipe.deleteMany({
        where: { id: { in: [downtownParent, airportRecipe] } },
      })
      await prisma.client.recipe.deleteMany({ where: { id: downtownBase } })
      await prisma.client.ingredient.deleteMany({ where: { id: ingredient } })
    })

    test('an edit made with one kitchen in the header recalculates the other kitchens too', async () => {
      expect(await costOf(downtownParent)).toBe(10)
      await priceAt(20)
      await request(http)
        .patch(`/api/recipes/${airportRecipe}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', airport)
        .send({ description: 'probe' })
        .expect(200)
      expect(await costOf(airportRecipe)).toBe(20)
      expect(await costOf(downtownBase)).toBe(20)
      expect(await costOf(downtownParent)).toBe(20)
    })

    test('an edit by someone who works at one kitchen recalculates the others too', async () => {
      await priceAt(30)
      const maria = await login('maria@goldenfork.com')
      await request(http)
        .patch(`/api/recipes/${downtownBase}`)
        .set('Cookie', maria)
        .send({ description: 'probe' })
        .expect(200)
      expect(await costOf(downtownParent)).toBe(30)
      expect(await costOf(airportRecipe)).toBe(30)
    })
  })

  describe('a recipe or dish is built only on recipes its own kitchen can cook', () => {
    let airport = ''
    let downtown = ''
    let airportBase = ''
    let sharedParent = ''
    let downtownParent = ''
    const dishes: string[] = []
    const stamp = Date.now()

    const make = async (name: string, locationId?: string) =>
      (
        await request(http)
          .post('/api/recipes')
          .set('Cookie', goldenForkCookie)
          .send({ name, portions: 1, ...(locationId ? { locationId } : {}) })
          .expect(201)
      ).body.id as string

    const dish = (name: string, locationId: string | undefined, recipeId: string) =>
      request(http)
        .post('/api/menu-items')
        .set('Cookie', goldenForkCookie)
        .send({
          name,
          price: 10,
          ...(locationId ? { locationId } : {}),
          recipes: [{ recipeId, portions: 1 }],
        })

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const locations = await prisma.client.location.findMany({
        where: { organizationId: org.id, isActive: true },
      })
      airport = locations.find((l) => l.name.includes('Airport'))!.id
      downtown = locations.find((l) => l.name.includes('Downtown'))!.id
      airportBase = await make(`Probe Kitchen Airport ${stamp}`, airport)
      sharedParent = await make(`Probe Kitchen Shared ${stamp}`)
      downtownParent = await make(`Probe Kitchen Downtown ${stamp}`, downtown)
    })

    afterAll(async () => {
      await prisma.client.menuItem.deleteMany({
        where: { OR: [{ id: { in: dishes } }, { name: { startsWith: 'Probe Kitchen Dish' } }] },
      })
      await prisma.client.recipe.deleteMany({
        where: { id: { in: [sharedParent, downtownParent] } },
      })
      await prisma.client.recipe.deleteMany({ where: { id: airportBase } })
    })

    test('a recipe of one kitchen is not nested in a shared recipe or in another kitchen', async () => {
      for (const parent of [sharedParent, downtownParent]) {
        const res = await request(http)
          .post(`/api/recipes/${parent}/components`)
          .set('Cookie', goldenForkCookie)
          .send({ componentId: airportBase, quantity: 1, unit: 'portion' })
          .expect(400)
        expect(res.body.error.message).toMatch(new RegExp(`Probe Kitchen Airport ${stamp}`))
      }
    })

    test('a dish is not built on a recipe of another kitchen, and a dish of that kitchen is', async () => {
      const shared = await dish(
        `Probe Kitchen Dish Shared ${stamp}`,
        undefined,
        airportBase,
      ).expect(400)
      expect(shared.body.error.message).toMatch(new RegExp(`Probe Kitchen Airport ${stamp}`))
      await dish(`Probe Kitchen Dish Downtown ${stamp}`, downtown, airportBase).expect(400)
      const here = await dish(`Probe Kitchen Dish Airport ${stamp}`, airport, airportBase).expect(
        201,
      )
      dishes.push(here.body.id)

      const moved = await request(http)
        .patch(`/api/menu-items/${here.body.id}`)
        .set('Cookie', goldenForkCookie)
        .send({ locationId: downtown })
        .expect(400)
      expect(moved.body.error.message).toMatch(new RegExp(`Probe Kitchen Airport ${stamp}`))
    })
  })

  describe('a conversion rule a recipe line stands on stays until the line is gone', () => {
    let ingredient = ''
    let rule = ''
    let recipe = ''
    const stamp = Date.now()

    beforeAll(async () => {
      ingredient = (
        await request(http)
          .post('/api/ingredients')
          .set('Cookie', goldenForkCookie)
          .send({ name: `Probe Rule Eggs ${stamp}`, unit: 'kg', costPerUnit: 8 })
          .expect(201)
      ).body.id as string
      rule = (
        await request(http)
          .post('/api/unit-conversions')
          .set('Cookie', goldenForkCookie)
          .send({ ingredientId: ingredient, fromUnit: 'ea', toUnit: 'kg', factor: 0.05 })
          .expect(201)
      ).body.id as string
      recipe = (
        await request(http)
          .post('/api/recipes')
          .set('Cookie', goldenForkCookie)
          .send({
            name: `Probe Rule Omelette ${stamp}`,
            portions: 1,
            ingredients: [{ ingredientId: ingredient, quantity: 4, unit: 'ea' }],
          })
          .expect(201)
      ).body.id as string
    })

    afterAll(async () => {
      await prisma.client.recipe.deleteMany({ where: { id: recipe } })
      await prisma.client.unitConversion.deleteMany({ where: { id: rule } })
      await prisma.client.ingredient.deleteMany({ where: { id: ingredient } })
    })

    test('the rule is not deleted or turned into another unit while a line needs it', async () => {
      expect(
        (
          await prisma.client.recipe.findUniqueOrThrow({ where: { id: recipe } })
        ).totalCost.toNumber(),
      ).toBe(1.6)
      const gone = await request(http)
        .delete(`/api/unit-conversions/${rule}`)
        .set('Cookie', goldenForkCookie)
        .expect(400)
      expect(gone.body.error.message).toMatch(new RegExp(`Probe Rule Omelette ${stamp}`))
      await request(http)
        .patch(`/api/unit-conversions/${rule}`)
        .set('Cookie', goldenForkCookie)
        .send({ toUnit: 'l' })
        .expect(400)
      await request(http)
        .patch(`/api/unit-conversions/${rule}`)
        .set('Cookie', goldenForkCookie)
        .send({ factor: 0.06 })
        .expect(200)
      expect(
        (
          await prisma.client.recipe.findUniqueOrThrow({ where: { id: recipe } })
        ).totalCost.toNumber(),
      ).toBe(1.92)
    })

    test('once no line needs it, the rule goes', async () => {
      await request(http)
        .delete(`/api/recipes/${recipe}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      await request(http)
        .delete(`/api/unit-conversions/${rule}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
    })
  })

  describe('a production batch costs what the quantity made of it costs', () => {
    const ids: string[] = []
    let downtown = ''
    let marinara = { id: '', totalCost: 0, portions: 1 }

    const record = (quantity: number, unit: string) =>
      request(http)
        .post('/api/production')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({ recipeId: marinara.id, quantity, unit })

    beforeAll(async () => {
      downtown = (
        await prisma.client.location.findFirstOrThrow({
          where: { name: { endsWith: 'Downtown' }, organization: { slug: 'golden-fork' } },
        })
      ).id
      const r = await prisma.client.recipe.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, name: 'Marinara Sauce' },
      })
      marinara = { id: r.id, totalCost: r.totalCost.toNumber(), portions: r.portions }
    })

    afterAll(async () => {
      await prisma.client.production.deleteMany({ where: { id: { in: ids } } })
    })

    test('twice the portions cost twice as much', async () => {
      const half = await record(marinara.portions / 2, 'portion').expect(201)
      const whole = await record(marinara.portions, 'portion').expect(201)
      ids.push(half.body.id, whole.body.id)
      expect(Number(half.body.cost)).toBeCloseTo(marinara.totalCost / 2, 2)
      expect(Number(whole.body.cost)).toBeCloseTo(marinara.totalCost, 2)
    })

    test('a unit the recipe has no yield in is refused with a sentence', async () => {
      const res = await record(12, 'l').expect(400)
      expect(res.body.error.message).toMatch(/Marinara Sauce/)
      expect(res.body.error.message).toMatch(/portion/)
    })

    test('a batch of nothing is not a batch', async () => {
      const res = await record(0, 'portion')
      if (res.status === 201) ids.push(res.body.id)
      expect(res.status).toBe(400)
      expect(JSON.stringify(res.body.error)).toMatch(/quantity must not be less than 0.001/)
    })

    test('a unit that does not reach the stated yield is refused for that reason', async () => {
      await prisma.client.recipe.update({
        where: { id: marinara.id },
        data: { yieldAmount: 5, yieldUnit: 'l' },
      })
      try {
        const res = await record(2, 'kg').expect(400)
        expect(res.body.error.message).toMatch(
          /Marinara Sauce yields 5 l, and kg does not convert to it/,
        )
        const made = await record(2.5, 'l').expect(201)
        ids.push(made.body.id)
        expect(Number(made.body.cost)).toBeCloseTo(marinara.totalCost / 2, 2)
      } finally {
        await prisma.client.recipe.update({
          where: { id: marinara.id },
          data: { yieldAmount: null, yieldUnit: null },
        })
      }
    })

    test('a batch is recorded only of a recipe the kitchen it is made in cooks', async () => {
      const other = await prisma.client.location.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, isActive: true, id: { not: downtown } },
      })
      const recipe = await prisma.client.recipe.create({
        data: {
          organizationId: other.organizationId,
          locationId: other.id,
          name: 'Probe Elsewhere Stock',
          portions: 4,
        },
      })
      try {
        const res = await request(http)
          .post('/api/production')
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', downtown)
          .send({ recipeId: recipe.id, quantity: 1, unit: 'portion' })
        if (res.status === 201) ids.push(res.body.id)
        expect(res.status).toBe(400)
        expect(res.body.error.message).toMatch(/Probe Elsewhere Stock/)
        await request(http)
          .post('/api/production')
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', other.id)
          .send({ recipeId: recipe.id, quantity: 1, unit: 'portion' })
          .expect(201)
          .then((made) => ids.push(made.body.id))
      } finally {
        await prisma.client.production.deleteMany({ where: { recipeId: recipe.id } })
        await prisma.client.recipe.delete({ where: { id: recipe.id } })
      }
    })
  })

  describe('food cost weighs both sides at the price the report names', () => {
    let downtown = ''
    let ingredient = ''
    const stamp = Date.now()
    const today = new Date().toISOString().slice(0, 10)

    const report = async () =>
      (
        await request(http)
          .get(`/api/analytics/food-cost-variance?from=${today}&to=${today}`)
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', downtown)
          .expect(200)
      ).body as { wasteCost: number; actualCost: number }

    beforeAll(async () => {
      downtown = (
        await prisma.client.location.findFirstOrThrow({
          where: { name: { endsWith: 'Downtown' }, organization: { slug: 'golden-fork' } },
        })
      ).id
      ingredient = (
        await request(http)
          .post('/api/ingredients')
          .set('Cookie', goldenForkCookie)
          .send({ name: `Probe Weighed ${stamp}`, unit: 'kg', costPerUnit: 10 })
          .expect(201)
      ).body.id as string
      await request(http)
        .patch(`/api/ingredients/${ingredient}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({ costPerUnit: 30 })
        .expect(200)
      await request(http)
        .post('/api/inventory/transactions')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({ ingredientId: ingredient, type: 'RECEIVE', quantity: 5, cost: 150 })
        .expect(201)
    })

    afterAll(async () => {
      await prisma.client.wasteEntry.deleteMany({ where: { ingredientId: ingredient } })
      await prisma.client.inventoryTransaction.deleteMany({ where: { ingredientId: ingredient } })
      await prisma.client.ingredientPriceHistory.deleteMany({ where: { ingredientId: ingredient } })
      await prisma.client.ingredientLocationStock.deleteMany({
        where: { ingredientId: ingredient },
      })
      await prisma.client.ingredientLocationSettings.deleteMany({
        where: { ingredientId: ingredient },
      })
      await prisma.client.ingredient.deleteMany({ where: { id: ingredient } })
    })

    test('waste at a location with its own price counts at the shared price', async () => {
      const before = await report()
      await request(http)
        .post('/api/waste')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({ ingredientId: ingredient, quantity: 1, reason: 'spoilage' })
        .expect(201)
      const after = await report()
      expect(after.wasteCost - before.wasteCost).toBeCloseTo(10, 2)
      expect(after.actualCost - before.actualCost).toBeCloseTo(10, 2)
    })
  })

  describe('a price that did not change is not recorded as a new price', () => {
    let ingredient = ''
    let downtown = ''

    const history = () =>
      prisma.client.ingredientPriceHistory.count({ where: { ingredientId: ingredient } })

    beforeAll(async () => {
      downtown = (
        await prisma.client.location.findFirstOrThrow({
          where: { name: { endsWith: 'Downtown' }, organization: { slug: 'golden-fork' } },
        })
      ).id
      ingredient = (
        await request(http)
          .post('/api/ingredients')
          .set('Cookie', goldenForkCookie)
          .send({ name: `Probe Same Price ${Date.now()}`, unit: 'kg', costPerUnit: 7 })
          .expect(201)
      ).body.id as string
    })

    afterAll(async () => {
      await prisma.client.ingredientPriceHistory.deleteMany({ where: { ingredientId: ingredient } })
      await prisma.client.ingredientLocationSettings.deleteMany({
        where: { ingredientId: ingredient },
      })
      await prisma.client.ingredient.deleteMany({ where: { id: ingredient } })
    })

    test('the same price, shared or at a location, adds no record; a new one does', async () => {
      const before = await history()
      const patch = (costPerUnit: number, location?: string) => {
        const req = request(http)
          .patch(`/api/ingredients/${ingredient}`)
          .set('Cookie', goldenForkCookie)
        return (location ? req.set('X-Location-Id', location) : req)
          .send({ costPerUnit })
          .expect(200)
      }
      await patch(7)
      await patch(7, downtown)
      expect(await history()).toBe(before)
      await patch(8, downtown)
      expect(await history()).toBe(before + 1)
      await patch(8, downtown)
      expect(await history()).toBe(before + 1)
    })
  })

  describe('an ingredient keeps the unit its figures are counted in', () => {
    let fresh = ''
    let used = ''
    let recipe = ''
    const stamp = Date.now()

    const make = async (name: string) =>
      (
        await request(http)
          .post('/api/ingredients')
          .set('Cookie', goldenForkCookie)
          .send({ name, unit: 'kg', costPerUnit: 5 })
          .expect(201)
      ).body.id as string
    const unitTo = (id: string, unit: string) =>
      request(http).patch(`/api/ingredients/${id}`).set('Cookie', goldenForkCookie).send({ unit })

    beforeAll(async () => {
      fresh = await make(`Probe Unit Fresh ${stamp}`)
      used = await make(`Probe Unit Used ${stamp}`)
      recipe = (
        await request(http)
          .post('/api/recipes')
          .set('Cookie', goldenForkCookie)
          .send({
            name: `Probe Unit Recipe ${stamp}`,
            portions: 1,
            ingredients: [{ ingredientId: used, quantity: 2, unit: 'kg' }],
          })
          .expect(201)
      ).body.id as string
    })

    afterAll(async () => {
      await prisma.client.recipe.deleteMany({ where: { id: recipe } })
      await prisma.client.ingredient.deleteMany({ where: { id: { in: [fresh, used] } } })
    })

    test('an ingredient nothing has counted yet may change its unit', async () => {
      const res = await unitTo(fresh, 'g').expect(200)
      expect(res.body.unit).toBe('g')
    })

    test('an ingredient a recipe already counts changes only into a unit its figures convert to, and the answer says why', async () => {
      const res = await unitTo(used, 'ea').expect(400)
      expect(res.body.error.message).toMatch(new RegExp(`Probe Unit Used ${stamp}`))
      await unitTo(used, 'g').expect(200)
      const line = await prisma.client.recipeIngredient.findFirstOrThrow({
        where: { recipeId: recipe },
      })
      expect([line.unit, Number(line.quantity)]).toEqual(['kg', 2])
      const butter = await prisma.client.ingredient.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
      })
      await unitTo(butter.id, 'ea').expect(400)
      await unitTo(butter.id, butter.unit).expect(200)
    })
  })

  describe('an opening balance is a count at the location that holds it', () => {
    const made: string[] = []
    let downtown = ''
    const stamp = Date.now()

    beforeAll(async () => {
      downtown = (
        await prisma.client.location.findFirstOrThrow({
          where: { name: { endsWith: 'Downtown' }, organization: { slug: 'golden-fork' } },
        })
      ).id
    })

    afterAll(async () => {
      await prisma.client.inventoryTransaction.deleteMany({ where: { ingredientId: { in: made } } })
      await prisma.client.ingredientLocationStock.deleteMany({
        where: { ingredientId: { in: made } },
      })
      await prisma.client.ingredientLocationSettings.deleteMany({
        where: { ingredientId: { in: made } },
      })
      await prisma.client.ingredient.deleteMany({ where: { id: { in: made } } })
    })

    test('stated at a location, it lands there, in the total and in the movements', async () => {
      const res = await request(http)
        .post('/api/ingredients')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({ name: `Probe Opening Here ${stamp}`, unit: 'kg', costPerUnit: 4, onHand: 5 })
        .expect(201)
      made.push(res.body.id)
      const row = await prisma.client.ingredient.findUniqueOrThrow({
        where: { id: res.body.id },
        include: { stock: true, transactions: true },
      })
      expect(row.onHand.toNumber()).toBe(5)
      expect(row.stock.map((s) => [s.locationId, s.onHand.toNumber()])).toEqual([[downtown, 5]])
      expect(row.transactions.map((t) => [t.type, t.quantity.toNumber()])).toEqual([['COUNT', 5]])
    })

    test('stated with no location, it is refused rather than lost', async () => {
      const res = await request(http)
        .post('/api/ingredients')
        .set('Cookie', goldenForkCookie)
        .send({ name: `Probe Opening Nowhere ${stamp}`, unit: 'kg', costPerUnit: 4, onHand: 5 })
        .expect(400)
      expect(res.body.error.message).toMatch(/location/i)
      const stray = await prisma.client.ingredient.findMany({
        where: { name: `Probe Opening Nowhere ${stamp}` },
      })
      made.push(...stray.map((s) => s.id))
      expect(stray).toHaveLength(0)
    })
  })

  describe('a count records what it found missing or extra, not a delivery', () => {
    let downtown = ''
    let ingredient = ''
    const stamp = Date.now()

    const move = (type: string, quantity: number) =>
      request(http)
        .post('/api/inventory/transactions')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({ ingredientId: ingredient, type, quantity })
        .expect(201)

    beforeAll(async () => {
      downtown = (
        await prisma.client.location.findFirstOrThrow({
          where: { name: { endsWith: 'Downtown' }, organization: { slug: 'golden-fork' } },
        })
      ).id
      ingredient = (
        await request(http)
          .post('/api/ingredients')
          .set('Cookie', goldenForkCookie)
          .send({ name: `Probe Counted ${stamp}`, unit: 'kg', costPerUnit: 2 })
          .expect(201)
      ).body.id as string
    })

    afterAll(async () => {
      await prisma.client.inventoryTransaction.deleteMany({ where: { ingredientId: ingredient } })
      await prisma.client.ingredientLocationStock.deleteMany({
        where: { ingredientId: ingredient },
      })
      await prisma.client.ingredient.deleteMany({ where: { id: ingredient } })
    })

    test('counting 3 where 5 were held records 2 missing, and the history says counted', async () => {
      await move('RECEIVE', 5)
      const counted = await move('COUNT', 3)
      expect(Number(counted.body.quantity)).toBe(-2)
      expect(Number(counted.body.cost)).toBe(4)
      const stock = await prisma.client.ingredientLocationStock.findFirstOrThrow({
        where: { ingredientId: ingredient, locationId: downtown },
      })
      expect(stock.onHand.toNumber()).toBe(3)

      const history = (
        await request(http)
          .get('/api/inventory/transactions')
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', downtown)
          .expect(200)
      ).body.data as { ingredient: string; type: string; quantity: number; cost: number }[]
      const row = history.find(
        (t) => t.ingredient === `Probe Counted ${stamp}` && t.type !== 'received',
      )
      expect(row).toMatchObject({ type: 'counted', quantity: -2, cost: -4 })
    })
  })

  test('a delivery received by hand cannot cost less than nothing', async () => {
    const downtown = (
      await prisma.client.location.findFirstOrThrow({
        where: { name: { endsWith: 'Downtown' }, organization: { slug: 'golden-fork' } },
      })
    ).id
    const butter = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
    })
    const history = await prisma.client.ingredientPriceHistory.count({
      where: { ingredientId: butter.id },
    })
    const res = await request(http)
      .post('/api/inventory/transactions')
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', downtown)
      .send({ ingredientId: butter.id, type: 'RECEIVE', quantity: 1, cost: -5 })
      .expect(400)
    expect(res.body.error.message).toMatch(/cost/)
    expect(
      await prisma.client.ingredientPriceHistory.count({ where: { ingredientId: butter.id } }),
    ).toBe(history)
  })

  test('a delivery received by hand for nothing is not a price', async () => {
    const downtown = (
      await prisma.client.location.findFirstOrThrow({
        where: { name: { endsWith: 'Downtown' }, organization: { slug: 'golden-fork' } },
      })
    ).id
    const butter = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
    })
    const where = { ingredientId_locationId: { ingredientId: butter.id, locationId: downtown } }
    const stock = await prisma.client.ingredientLocationStock.findUniqueOrThrow({ where })
    const history = await prisma.client.ingredientPriceHistory.count({
      where: { ingredientId: butter.id },
    })
    const res = await request(http)
      .post('/api/inventory/transactions')
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', downtown)
      .send({
        ingredientId: butter.id,
        type: 'RECEIVE',
        quantity: 1,
        cost: 0,
        notes: 'Probe free sample',
      })
      .expect(201)
    try {
      expect(
        await prisma.client.ingredientPriceHistory.count({ where: { ingredientId: butter.id } }),
      ).toBe(history)
    } finally {
      await prisma.client.inventoryTransaction.delete({ where: { id: res.body.id } })
      await prisma.client.ingredientLocationStock.update({ where, data: { onHand: stock.onHand } })
      await prisma.client.ingredient.update({
        where: { id: butter.id },
        data: { onHand: butter.onHand },
      })
    }
  })

  test('the thirty days of the food cost card are the thirty days of the trend beneath it', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const downtown = (
      await prisma.client.location.findFirstOrThrow({
        where: { organizationId: org.id, name: { endsWith: 'Downtown' } },
      })
    ).id
    const dish = await prisma.client.menuItem.findFirstOrThrow({
      where: { organizationId: org.id, locationId: null },
    })
    const read = async () => {
      const kpis = (
        await request(http).get('/api/dashboard/kpis').set('Cookie', goldenForkCookie).expect(200)
      ).body
      const trend = (
        await request(http)
          .get('/api/analytics/revenue-trend')
          .set('Cookie', goldenForkCookie)
          .expect(200)
      ).body as { revenue: number }[]
      return {
        foodCostPct: kpis.foodCostPct,
        revenue: trend.reduce((sum, d) => sum + d.revenue, 0),
      }
    }
    const before = await read()
    const since = Date.now() - 30 * 86400000
    const lastMoment = endOfDay(dayKey(new Date(since), org.timezone), org.timezone).getTime()
    const sale = await prisma.client.sale.create({
      data: {
        organizationId: org.id,
        locationId: downtown,
        date: new Date(since + (lastMoment - since) / 2),
        items: { create: [{ menuItemId: dish.id, quantity: 1, unitPrice: 1000, unitCost: 1000 }] },
      },
    })
    try {
      expect(await read()).toEqual(before)
    } finally {
      await prisma.client.sale.delete({ where: { id: sale.id } })
    }
  })

  describe('days are counted where the restaurant is', () => {
    let downtown = ''
    let dish = ''
    let recipe = ''
    const made: { sales: string[]; batches: string[] } = { sales: [], batches: [] }
    const day = (offset: number) =>
      new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10)
    const lateEvening = `${day(3)}T02:00:00.000Z`
    const organization = { slug: 'golden-fork' }

    beforeAll(async () => {
      downtown = (
        await prisma.client.location.findFirstOrThrow({
          where: { name: { endsWith: 'Downtown' }, organization },
        })
      ).id
      dish = (
        await prisma.client.menuItem.findFirstOrThrow({ where: { organization, locationId: null } })
      ).id
      recipe = (
        await prisma.client.recipe.findFirstOrThrow({ where: { organization, locationId: null } })
      ).id
      await prisma.client.organization.update({
        where: { slug: 'golden-fork' },
        data: { timezone: 'America/New_York' },
      })
    })

    afterAll(async () => {
      await prisma.client.saleItem.deleteMany({ where: { saleId: { in: made.sales } } })
      await prisma.client.sale.deleteMany({ where: { id: { in: made.sales } } })
      await prisma.client.production.deleteMany({ where: { id: { in: made.batches } } })
      await prisma.client.organization.update({
        where: { slug: 'golden-fork' },
        data: { timezone: 'America/New_York' },
      })
    })

    const daily = async () =>
      (
        await request(http)
          .get('/api/sales/daily')
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', downtown)
          .expect(200)
      ).body as { date: string; sales: number }[]

    test('a sale rung up at ten in the evening in New York lands on that evening', async () => {
      const before = await daily()
      const sold = await request(http)
        .post('/api/sales')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({ date: lateEvening, items: [{ menuItemId: dish, quantity: 7 }] })
        .expect(201)
      made.sales.push(sold.body.id as string)
      const after = await daily()
      const count = (rows: { date: string; sales: number }[], key: string) =>
        rows.find((r) => r.date === key)?.sales ?? 0
      expect(count(after, day(4)) - count(before, day(4))).toBe(7)
      expect(count(after, day(3)) - count(before, day(3))).toBe(0)
    })

    test('a period asked for by its days holds what happened on them there', async () => {
      const batch = await request(http)
        .post('/api/production')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({ recipeId: recipe, quantity: 1, unit: 'portion', date: lateEvening })
        .expect(201)
      made.batches.push(batch.body.id as string)
      const on = async (key: string) =>
        (
          (
            await request(http)
              .get(`/api/production?from=${key}&to=${key}`)
              .set('Cookie', goldenForkCookie)
              .set('X-Location-Id', downtown)
              .expect(200)
          ).body.data as { id: string }[]
        ).some((b) => b.id === batch.body.id)
      expect(await on(day(4))).toBe(true)
      expect(await on(day(3))).toBe(false)
    })

    test('a day stated without a time is that day in every report', async () => {
      const batch = await request(http)
        .post('/api/production')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({ recipeId: recipe, quantity: 1, unit: 'portion', date: day(5) })
        .expect(201)
      made.batches.push(batch.body.id as string)
      const rows = (
        await request(http)
          .get(`/api/production?from=${day(5)}&to=${day(5)}`)
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', downtown)
          .expect(200)
      ).body.data as { id: string }[]
      expect(rows.some((b) => b.id === batch.body.id)).toBe(true)
    })

    test('the organization keeps only a timezone, a currency and a date format that exist', async () => {
      for (const body of [
        { timezone: 'Mars/Olympus' },
        { currency: 'XYZ1' },
        { dateFormat: 'whenever' },
      ]) {
        const res = await request(http)
          .patch('/api/organizations/current')
          .set('Cookie', goldenForkCookie)
          .send(body)
          .expect(400)
        expect(JSON.stringify(res.body.error)).toMatch(/timezone|currency|dateFormat/)
      }
      await request(http)
        .patch('/api/organizations/current')
        .set('Cookie', goldenForkCookie)
        .send({ timezone: 'America/Chicago', currency: 'EUR', dateFormat: 'YYYY-MM-DD' })
        .expect(200)
      await request(http)
        .patch('/api/organizations/current')
        .set('Cookie', goldenForkCookie)
        .send({ timezone: 'America/New_York', currency: 'USD', dateFormat: 'MM/DD/YYYY' })
        .expect(200)
    })
  })

  describe('sales are read by the period asked for, not by the latest records', () => {
    let downtown = ''
    let dish = ''
    const made: string[] = []
    const day = (offset: number) =>
      new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10)
    const organization = { slug: 'golden-fork' }

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      downtown = (
        await prisma.client.location.findFirstOrThrow({
          where: { name: { endsWith: 'Downtown' }, organization },
        })
      ).id
      dish = (
        await prisma.client.menuItem.findFirstOrThrow({ where: { organization, locationId: null } })
      ).id
      const recent = await Promise.all(
        Array.from({ length: 95 }, () =>
          prisma.client.sale.create({
            data: {
              organizationId: org.id,
              locationId: downtown,
              date: new Date(Date.now() - 3600000),
            },
          }),
        ),
      )
      made.push(...recent.map((s) => s.id))
      const sold = await request(http)
        .post('/api/sales')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({ date: day(120), items: [{ menuItemId: dish, quantity: 3 }] })
        .expect(201)
      made.push(sold.body.id as string)
    })

    afterAll(async () => {
      await prisma.client.saleItem.deleteMany({ where: { saleId: { in: made } } })
      await prisma.client.sale.deleteMany({ where: { id: { in: made } } })
    })

    test('a day four months back is there when that day is asked for', async () => {
      const rows = (
        await request(http)
          .get(`/api/sales/daily?from=${day(120)}&to=${day(120)}`)
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', downtown)
          .expect(200)
      ).body as { date: string; sales: number }[]
      expect(rows).toEqual([expect.objectContaining({ date: day(120), sales: 3 })])
    })

    test('the lines of that day are listed too', async () => {
      const rows = (
        await request(http)
          .get(`/api/sales?from=${day(120)}&to=${day(120)}`)
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', downtown)
          .expect(200)
      ).body.data as { date: string; qty: number }[]
      expect(rows).toEqual([expect.objectContaining({ date: day(120), qty: 3 })])
    })

    test('without a period the last ninety days come back whole, however many records they hold', async () => {
      const rows = (
        await request(http)
          .get('/api/sales/daily')
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', downtown)
          .expect(200)
      ).body as { date: string }[]
      expect(rows.some((r) => r.date <= day(25))).toBe(true)
      expect(rows.some((r) => r.date === day(120))).toBe(false)
    })
  })

  test('a price set at the only location of an organization reaches its recipes', async () => {
    const organization = { slug: 'bella-cucina' }
    const main = await prisma.client.location.findFirstOrThrow({
      where: { organization, isActive: true },
    })
    const line = await prisma.client.recipeIngredient.findFirstOrThrow({
      where: { recipe: { organization } },
      include: { ingredient: true, recipe: true },
    })
    const before = Number(line.recipe.totalCost)
    const price = Number(line.ingredient.costPerUnit)
    const held = await prisma.client.ingredientLocationSettings.findUnique({
      where: { ingredientId_locationId: { ingredientId: line.ingredientId, locationId: main.id } },
    })
    const raised = Math.max(price, Number(held?.costPerUnit ?? 0)) * 2 + 1
    try {
      await request(http)
        .patch(`/api/ingredients/${line.ingredientId}`)
        .set('Cookie', bellaCucinaCookie)
        .set('X-Location-Id', main.id)
        .send({ costPerUnit: raised })
        .expect(200)
      const after = await prisma.client.recipe.findUniqueOrThrow({ where: { id: line.recipeId } })
      expect(Number(after.totalCost)).toBeGreaterThan(before)
      expect(
        Number(
          (await prisma.client.ingredient.findUniqueOrThrow({ where: { id: line.ingredientId } }))
            .costPerUnit,
        ),
      ).toBeCloseTo(raised, 4)
    } finally {
      await request(http)
        .patch(`/api/ingredients/${line.ingredientId}`)
        .set('Cookie', bellaCucinaCookie)
        .send({ costPerUnit: price + 0.01 })
      await request(http)
        .patch(`/api/ingredients/${line.ingredientId}`)
        .set('Cookie', bellaCucinaCookie)
        .send({ costPerUnit: price })
      if (held) {
        await prisma.client.ingredientLocationSettings.update({
          where: {
            ingredientId_locationId: { ingredientId: line.ingredientId, locationId: main.id },
          },
          data: { costPerUnit: held.costPerUnit },
        })
      } else {
        await prisma.client.ingredientLocationSettings.deleteMany({
          where: { ingredientId: line.ingredientId, locationId: main.id },
        })
      }
    }
  })

  test('a price set for every location of an organization with one is the price of that location too', async () => {
    const organization = { slug: 'bella-cucina' }
    const main = await prisma.client.location.findFirstOrThrow({
      where: { organization, isActive: true },
    })
    const ingredient = await prisma.client.ingredient.findFirstOrThrow({ where: { organization } })
    const price = Number(ingredient.costPerUnit)
    const held = await prisma.client.ingredientLocationSettings.findUnique({
      where: { ingredientId_locationId: { ingredientId: ingredient.id, locationId: main.id } },
    })
    await prisma.client.ingredientLocationSettings.upsert({
      where: { ingredientId_locationId: { ingredientId: ingredient.id, locationId: main.id } },
      create: { ingredientId: ingredient.id, locationId: main.id, costPerUnit: price + 5 },
      update: { costPerUnit: price + 5 },
    })
    try {
      await request(http)
        .patch(`/api/ingredients/${ingredient.id}`)
        .set('Cookie', bellaCucinaCookie)
        .send({ costPerUnit: price + 1 })
        .expect(200)
      const here = await prisma.client.ingredientLocationSettings.findUniqueOrThrow({
        where: { ingredientId_locationId: { ingredientId: ingredient.id, locationId: main.id } },
      })
      expect(Number(here.costPerUnit)).toBeCloseTo(price + 1, 4)
    } finally {
      await request(http)
        .patch(`/api/ingredients/${ingredient.id}`)
        .set('Cookie', bellaCucinaCookie)
        .send({ costPerUnit: price })
      if (held) {
        await prisma.client.ingredientLocationSettings.update({
          where: { ingredientId_locationId: { ingredientId: ingredient.id, locationId: main.id } },
          data: { costPerUnit: held.costPerUnit },
        })
      } else {
        await prisma.client.ingredientLocationSettings.deleteMany({
          where: { ingredientId: ingredient.id, locationId: main.id },
        })
      }
    }
  })

  test('the location a person opens on is the default one, as the locations page says', async () => {
    const def = await prisma.client.location.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, isDefault: true },
    })
    const listed = (
      await request(http).get('/api/properties').set('Cookie', goldenForkCookie).expect(200)
    ).body as { id: string; name: string }[]
    expect(listed[0]?.id).toBe(def.id)
    const me = (await request(http).get('/api/auth/me').set('Cookie', goldenForkCookie).expect(200))
      .body as {
      locations: { id: string }[]
    }
    expect(me.locations[0]?.id).toBe(def.id)
  })

  test('an inactive vendor is not given a new ingredient to supply, and one it already supplies keeps it', async () => {
    const organization = { slug: 'bella-cucina' }
    const main = await prisma.client.location.findFirstOrThrow({
      where: { organization, isActive: true },
    })
    const active = await prisma.client.vendor.findFirstOrThrow({ where: { organization } })
    const closed = await prisma.client.vendor.create({
      data: {
        organizationId: active.organizationId,
        name: `Probe Closed Vendor ${Date.now()}`,
        status: 'inactive',
      },
    })
    const ids: string[] = []
    try {
      const refused = await request(http)
        .post('/api/ingredients')
        .set('Cookie', bellaCucinaCookie)
        .set('X-Location-Id', main.id)
        .send({
          name: `Probe Closed Supply ${Date.now()}`,
          unit: 'kg',
          costPerUnit: 2,
          vendorId: closed.id,
        })
      if (refused.status === 201) ids.push((refused.body as { id: string }).id)
      expect(refused.status).toBe(400)
      expect((refused.body as { error: { message: string } }).error.message).toMatch(/inactive/)

      const kept = await prisma.client.ingredient.create({
        data: {
          organizationId: active.organizationId,
          name: `Probe Closed Kept ${Date.now()}`,
          unit: 'kg',
          costPerUnit: 2,
          vendorId: closed.id,
        },
      })
      ids.push(kept.id)
      await request(http)
        .patch(`/api/ingredients/${kept.id}`)
        .set('Cookie', bellaCucinaCookie)
        .send({ vendorId: closed.id, reorderLevel: 3 })
        .expect(200)
      const moved = await request(http)
        .patch(`/api/ingredients/${kept.id}`)
        .set('Cookie', bellaCucinaCookie)
        .set('X-Location-Id', main.id)
        .send({ vendorId: closed.id })
      expect(moved.status).toBe(200)
    } finally {
      await prisma.client.ingredientLocationSettings.deleteMany({
        where: { ingredientId: { in: ids } },
      })
      await prisma.client.ingredientPriceHistory.deleteMany({
        where: { ingredientId: { in: ids } },
      })
      await prisma.client.ingredient.deleteMany({ where: { id: { in: ids } } })
      await prisma.client.vendor.delete({ where: { id: closed.id } })
    }
  })

  test("a vendor and a reorder level set for every location of an organization with one are that location's too", async () => {
    const organization = { slug: 'bella-cucina' }
    const main = await prisma.client.location.findFirstOrThrow({
      where: { organization, isActive: true },
    })
    const first = await prisma.client.vendor.findFirstOrThrow({ where: { organization } })
    const second = await prisma.client.vendor.create({
      data: { organizationId: first.organizationId, name: `Probe Second Vendor ${Date.now()}` },
    })
    const created = await request(http)
      .post('/api/ingredients')
      .set('Cookie', bellaCucinaCookie)
      .set('X-Location-Id', main.id)
      .send({
        name: `Probe Sole Kitchen ${Date.now()}`,
        unit: 'kg',
        costPerUnit: 3,
        reorderLevel: 5,
        vendorId: first.id,
      })
      .expect(201)
    const id = (created.body as { id: string }).id
    try {
      await request(http)
        .patch(`/api/ingredients/${id}`)
        .set('Cookie', bellaCucinaCookie)
        .send({ reorderLevel: 9, vendorId: second.id })
        .expect(200)
      const here = (
        await request(http)
          .get('/api/ingredients')
          .set('Cookie', bellaCucinaCookie)
          .set('X-Location-Id', main.id)
          .expect(200)
      ).body as { id: string; reorderLevel: number; vendorId: string | null }[]
      const row = here.find((i) => i.id === id)
      expect(row?.reorderLevel).toBe(9)
      expect(row?.vendorId).toBe(second.id)
    } finally {
      await prisma.client.ingredientLocationSettings.deleteMany({ where: { ingredientId: id } })
      await prisma.client.ingredient.delete({ where: { id } })
      await prisma.client.vendor.delete({ where: { id: second.id } })
    }
  })

  describe('an archived location is kept for its history and nothing new is recorded there', () => {
    let probe = ''
    let ken = ''
    const stamp = Date.now()
    const organization = { slug: 'golden-fork' }

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({ where: organization })
      probe = (
        await prisma.client.location.create({
          data: { organizationId: org.id, name: `Probe Closed Kitchen ${stamp}`, isActive: false },
        })
      ).id
      ken = (await prisma.client.user.findUniqueOrThrow({ where: { email: 'ken@goldenfork.com' } }))
        .id
      await prisma.client.userLocation.create({ data: { userId: ken, locationId: probe } })
    })

    afterAll(async () => {
      await prisma.client.userLocation.deleteMany({ where: { locationId: probe } })
      await prisma.client.invitation.deleteMany({
        where: { email: `probe-closed-${stamp}@example.com` },
      })
      await prisma.client.location.deleteMany({ where: { id: probe } })
    })

    test('reading there still works, recording there is refused', async () => {
      const butter = await prisma.client.ingredient.findFirstOrThrow({
        where: { organization, name: 'Unsalted Butter' },
      })
      await request(http)
        .get('/api/inventory')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', probe)
        .expect(200)
      const refused = await request(http)
        .post('/api/inventory/transactions')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', probe)
        .send({ ingredientId: butter.id, type: 'RECEIVE', quantity: 1 })
        .expect(403)
      expect(refused.body.error.message).toMatch(
        /archived; restore it under Settings, Property Management/,
      )
    })

    test('a person assigned to it is not offered it, in the same order as the switcher', async () => {
      const kenCookie = await login('ken@goldenfork.com')
      const me = (await request(http).get('/api/auth/me').set('Cookie', kenCookie).expect(200))
        .body as {
        locations: { id: string; name: string }[]
      }
      const switcher = (
        await request(http).get('/api/properties').set('Cookie', kenCookie).expect(200)
      ).body as {
        id: string
      }[]
      expect(me.locations.map((l) => l.id)).not.toContain(probe)
      expect(me.locations.map((l) => l.id)).toEqual(switcher.map((l) => l.id))
    })

    test('an invitation accepted after it was archived does not place anyone there', async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({ where: organization })
      const downtown = await prisma.client.location.findFirstOrThrow({
        where: { organization, name: { endsWith: 'Downtown' } },
      })
      const invite = (email: string, locationIds: string[]) =>
        prisma.client.invitation.create({
          data: {
            organizationId: org.id,
            email,
            role: 'staff',
            token: `probe-closed-token-${email}`,
            expiresAt: new Date(Date.now() + 3_600_000),
            locationIds,
          },
        })
      const only = await invite(`probe-closed-only-${stamp}@example.com`, [probe])
      const mixed = await invite(`probe-closed-mixed-${stamp}@example.com`, [probe, downtown.id])
      try {
        const refused = await request(http)
          .post(`/api/invitations/${only.token}/accept`)
          .send({ fullName: 'Probe Closed Only', password: 'Nexus_dev1' })
          .expect(400)
        expect(refused.body.error.message).toMatch(/archived/)
        expect(await prisma.client.user.count({ where: { email: only.email } })).toBe(0)
        await request(http)
          .post(`/api/invitations/${mixed.token}/accept`)
          .send({ fullName: 'Probe Closed Mixed', password: 'Nexus_dev1' })
          .expect(200)
        const placed = await prisma.client.user.findUniqueOrThrow({
          where: { email: mixed.email },
          include: { locationAccess: true },
        })
        expect(placed.locationAccess.map((a) => a.locationId)).toEqual([downtown.id])
      } finally {
        const users = await prisma.client.user.findMany({
          where: { email: { in: [only.email, mixed.email] } },
        })
        await prisma.client.userLocation.deleteMany({
          where: { userId: { in: users.map((u) => u.id) } },
        })
        await prisma.client.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } })
        await prisma.client.invitation.deleteMany({ where: { id: { in: [only.id, mixed.id] } } })
      }
    })

    test('nobody is invited into it', async () => {
      const res = await request(http)
        .post('/api/invitations')
        .set('Cookie', goldenForkCookie)
        .send({ email: `probe-closed-${stamp}@example.com`, role: 'staff', locationIds: [probe] })
        .expect(400)
      expect(res.body.error.message).toMatch(/archived/)
    })

    test('the last active location of an organization is not archived', async () => {
      const main = await prisma.client.location.findFirstOrThrow({
        where: { organization: { slug: 'bella-cucina' }, isActive: true },
      })
      const res = await request(http)
        .delete(`/api/locations/${main.id}`)
        .set('Cookie', bellaCucinaCookie)
        .expect(400)
      expect(res.body.error.message).toMatch(/only active location/)
      await request(http)
        .patch(`/api/locations/${main.id}`)
        .set('Cookie', bellaCucinaCookie)
        .send({ isActive: false })
        .expect(400)
      expect(
        (await prisma.client.location.findUniqueOrThrow({ where: { id: main.id } })).isActive,
      ).toBe(true)
    })

    test('no recipe, dish or assignment is filed there through the body either', async () => {
      const stamp2 = Date.now()
      const recipe = await request(http)
        .post('/api/recipes')
        .set('Cookie', goldenForkCookie)
        .send({ name: `Probe Closed Recipe ${stamp2}`, portions: 1, locationId: probe })
        .expect(400)
      expect(recipe.body.error.message).toMatch(/archived/)
      const dish = await request(http)
        .post('/api/menu-items')
        .set('Cookie', goldenForkCookie)
        .send({ name: `Probe Closed Dish ${stamp2}`, price: 5, locationId: probe })
        .expect(400)
      expect(dish.body.error.message).toMatch(/archived/)
      const maria = await prisma.client.user.findUniqueOrThrow({
        where: { email: 'maria@goldenfork.com' },
      })
      const assigned = await request(http)
        .patch(`/api/users/${maria.id}`)
        .set('Cookie', goldenForkCookie)
        .send({ locationIds: [probe] })
        .expect(400)
      expect(assigned.body.error.message).toMatch(/archived/)
      expect(
        await prisma.client.recipe.count({ where: { name: `Probe Closed Recipe ${stamp2}` } }),
      ).toBe(0)
      expect(
        await prisma.client.menuItem.count({ where: { name: `Probe Closed Dish ${stamp2}` } }),
      ).toBe(0)
    })

    test('its menu stays its own, not one served everywhere', async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({ where: organization })
      const downtown = await prisma.client.location.findFirstOrThrow({
        where: { organization, name: { endsWith: 'Downtown' } },
      })
      const menu = await prisma.client.menu.create({
        data: {
          organizationId: org.id,
          name: `Probe Closed Menu ${stamp}`,
          locations: { create: [{ locationId: probe }] },
        },
      })
      try {
        const maria = await login('maria@goldenfork.com')
        const as = <T extends request.Test>(r: T) =>
          r.set('Cookie', maria).set('X-Location-Id', downtown.id)
        const listed = await as(request(http).get('/api/menus')).expect(200)
        expect((listed.body as { id: string }[]).map((m) => m.id)).not.toContain(menu.id)
        await as(request(http).get(`/api/menus/${menu.id}`)).expect(404)
        await as(request(http).patch(`/api/menus/${menu.id}`))
          .send({ name: `Probe Closed Taken ${stamp}` })
          .expect(404)
        await as(request(http).delete(`/api/menus/${menu.id}`)).expect(404)
        const owner = await request(http)
          .get('/api/menus')
          .set('Cookie', goldenForkCookie)
          .expect(200)
        expect((owner.body as { id: string }[]).map((m) => m.id)).toContain(menu.id)
        expect((await prisma.client.menu.findUniqueOrThrow({ where: { id: menu.id } })).name).toBe(
          `Probe Closed Menu ${stamp}`,
        )
      } finally {
        await prisma.client.menu.deleteMany({ where: { id: menu.id } })
      }
    })

    test('the management list says how many people each location holds', async () => {
      const rows = (
        await request(http).get('/api/locations').set('Cookie', goldenForkCookie).expect(200)
      ).body as {
        id: string
        people: number
      }[]
      expect(rows.find((r) => r.id === probe)?.people).toBe(1)
    })
  })

  describe('moving a dish or a menu keeps every menu it is on served where the dish is sold', () => {
    let downtown = ''
    let airport = ''
    let dish = ''
    let menu = ''
    const stamp = Date.now()
    const organization = { slug: 'golden-fork' }

    beforeAll(async () => {
      downtown = (
        await prisma.client.location.findFirstOrThrow({
          where: { organization, name: { endsWith: 'Downtown' } },
        })
      ).id
      airport = (
        await prisma.client.location.findFirstOrThrow({
          where: { organization, name: { endsWith: 'Airport' } },
        })
      ).id
      dish = (
        await request(http)
          .post('/api/menu-items')
          .set('Cookie', goldenForkCookie)
          .send({ name: `Probe Moving Dish ${stamp}`, price: 9, locationId: downtown })
          .expect(201)
      ).body.id as string
      menu = (
        await request(http)
          .post('/api/menus')
          .set('Cookie', goldenForkCookie)
          .send({
            name: `Probe Downtown Lunch ${stamp}`,
            locationIds: [downtown],
            menuItemIds: [dish],
          })
          .expect(201)
      ).body.id as string
    })

    afterAll(async () => {
      await prisma.client.menuItemOnMenu.deleteMany({ where: { menuId: menu } })
      await prisma.client.menuOnLocation.deleteMany({ where: { menuId: menu } })
      await prisma.client.menu.deleteMany({ where: { id: menu } })
      await prisma.client.menuItem.deleteMany({ where: { id: dish } })
    })

    test('a dish on a Downtown menu is not moved to the airport while it stays on that menu', async () => {
      const res = await request(http)
        .patch(`/api/menu-items/${dish}`)
        .set('Cookie', goldenForkCookie)
        .send({ locationId: airport })
        .expect(400)
      expect(res.body.error.message).toMatch(/Probe Downtown Lunch/)
      expect(
        (await prisma.client.menuItem.findUniqueOrThrow({ where: { id: dish } })).locationId,
      ).toBe(downtown)
    })

    test('a menu is not moved away from the location its dishes are sold at', async () => {
      const res = await request(http)
        .patch(`/api/menus/${menu}`)
        .set('Cookie', goldenForkCookie)
        .send({ locationIds: [airport] })
        .expect(400)
      expect(res.body.error.message).toMatch(/Probe Moving Dish/)
    })

    test('taking the dish off the menu in the same change lets it move', async () => {
      await request(http)
        .patch(`/api/menu-items/${dish}`)
        .set('Cookie', goldenForkCookie)
        .send({ locationId: airport, menuIds: [] })
        .expect(200)
    })
  })

  describe('a manager runs the team below them, at the locations they work at', () => {
    const stamp = Date.now()
    const at = (name: string) => `probe-${name}-${stamp}@example.com`
    let maria = ''
    let adminCookie = ''
    let downtown = ''
    let airport = ''
    let here = ''
    let there = ''
    let peer = ''

    const member = async (
      email: string,
      role: 'viewer' | 'manager' | 'admin',
      locationId?: string,
    ) => {
      const template = await prisma.client.user.findUniqueOrThrow({
        where: { email: 'maria@goldenfork.com' },
      })
      const user = await prisma.client.user.create({
        data: {
          organizationId: template.organizationId,
          email,
          fullName: 'Probe Member',
          role,
          hashedPassword: template.hashedPassword,
        },
      })
      if (locationId)
        await prisma.client.userLocation.create({ data: { userId: user.id, locationId } })
      return user.id
    }

    const invite = (cookie: string, email: string, role: string, locationIds: string[]) =>
      request(http)
        .post('/api/invitations')
        .set('Cookie', cookie)
        .send({ email, role, locationIds })

    beforeAll(async () => {
      const locations = await prisma.client.location.findMany({
        where: { organization: { slug: 'golden-fork' } },
      })
      downtown = locations.find((l) => l.name.endsWith('Downtown'))!.id
      airport = locations.find((l) => l.name.endsWith('Airport'))!.id
      here = await member(at('here'), 'viewer', downtown)
      there = await member(at('there'), 'viewer', airport)
      peer = await member(at('peer'), 'manager', downtown)
      await member(at('admin'), 'admin')
      maria = await login('maria@goldenfork.com')
      adminCookie = await login(at('admin'))
    })

    afterAll(async () => {
      await prisma.client.invitation.deleteMany({
        where: { email: { contains: `-${stamp}@example.com` } },
      })
      const ids = (
        await prisma.client.user.findMany({
          where: { email: { contains: `-${stamp}@example.com` } },
        })
      ).map((u) => u.id)
      await prisma.client.userSession.deleteMany({ where: { userId: { in: ids } } })
      await prisma.client.userLocation.deleteMany({ where: { userId: { in: ids } } })
      await prisma.client.user.deleteMany({ where: { id: { in: ids } } })
    })

    test('a manager invites a chef or a team member to their own location, and takes the invitation back', async () => {
      const res = await invite(maria, at('chef'), 'staff', [downtown]).expect(201)
      await request(http)
        .post(`/api/invitations/${res.body.id}/resend`)
        .set('Cookie', maria)
        .expect(200)
      await request(http).delete(`/api/invitations/${res.body.id}`).set('Cookie', maria).expect(200)
      await invite(maria, at('viewer'), 'viewer', [downtown]).expect(201)
    })

    test('a manager invites nobody to their own rank or above, nor anywhere they do not work', async () => {
      const refused = await invite(maria, at('manager'), 'manager', [downtown]).expect(403)
      expect(refused.body.error.message).toMatch(/below your own/)
      const elsewhere = await invite(maria, at('airport'), 'staff', [airport]).expect(403)
      expect(elsewhere.body.error.message).toMatch(/locations you work at/)
      await invite(maria, at('everywhere'), 'staff', []).expect(403)
      await invite(maria, at('both'), 'staff', [downtown, airport]).expect(403)
    })

    test('a manager changes, resets, deactivates and brings back a member of their location', async () => {
      await request(http)
        .patch(`/api/users/${here}`)
        .set('Cookie', maria)
        .send({ role: 'staff' })
        .expect(200)
      await request(http).post(`/api/users/${here}/password-reset`).set('Cookie', maria).expect(200)
      await request(http).delete(`/api/users/${here}`).set('Cookie', maria).expect(200)
      await request(http).post(`/api/users/${here}/reactivate`).set('Cookie', maria).expect(200)
      const moved = await request(http)
        .patch(`/api/users/${here}`)
        .set('Cookie', maria)
        .send({ locationIds: [airport] })
      expect(moved.status).toBe(403)
    })

    test('a manager does not reach a member of another location, nor another manager', async () => {
      await request(http)
        .patch(`/api/users/${there}`)
        .set('Cookie', maria)
        .send({ role: 'staff' })
        .expect(403)
      await request(http).delete(`/api/users/${there}`).set('Cookie', maria).expect(403)
      await request(http)
        .post(`/api/users/${there}/password-reset`)
        .set('Cookie', maria)
        .expect(403)
      await request(http)
        .patch(`/api/users/${peer}`)
        .set('Cookie', maria)
        .send({ role: 'viewer' })
        .expect(403)
      const invited = await invite(goldenForkCookie, at('airport-chef'), 'staff', [airport]).expect(
        201,
      )
      await request(http)
        .delete(`/api/invitations/${invited.body.id}`)
        .set('Cookie', maria)
        .expect(403)
    })

    test('an administrator assigned to a location works there only, as anyone assigned does', async () => {
      await member(at('admin-downtown'), 'admin', downtown)
      const assigned = await login(at('admin-downtown'))
      await request(http)
        .get('/api/inventory')
        .set('Cookie', assigned)
        .set('X-Location-Id', downtown)
        .expect(200)
      await request(http)
        .get('/api/inventory')
        .set('Cookie', assigned)
        .set('X-Location-Id', airport)
        .expect(403)
      await request(http)
        .patch(`/api/users/${there}`)
        .set('Cookie', assigned)
        .send({ role: 'staff' })
        .expect(403)
      await invite(assigned, at('admin-airport-chef'), 'staff', [airport]).expect(403)
      await request(http)
        .patch(`/api/users/${here}`)
        .set('Cookie', assigned)
        .send({ role: 'viewer' })
        .expect(200)
      await request(http)
        .get('/api/inventory')
        .set('Cookie', adminCookie)
        .set('X-Location-Id', airport)
        .expect(200)
    })

    test('an administrator assigned to a location edits and archives only the locations they work at', async () => {
      await member(at('admin-downtown-places'), 'admin', downtown)
      const assigned = await login(at('admin-downtown-places'))
      const before = await prisma.client.location.findUniqueOrThrow({ where: { id: airport } })
      const organization = await prisma.client.organization.findUniqueOrThrow({
        where: { id: before.organizationId },
      })
      try {
        const archive = await request(http)
          .delete(`/api/locations/${airport}`)
          .set('Cookie', assigned)
        const rename = await request(http)
          .patch(`/api/locations/${airport}`)
          .set('Cookie', assigned)
          .send({ name: 'Probe Renamed Elsewhere' })
        const add = await request(http)
          .post('/api/locations')
          .set('Cookie', assigned)
          .send({ name: 'Probe Assigned Adds' })
        if (add.status === 201) await prisma.client.location.delete({ where: { id: add.body.id } })
        const settings = await request(http)
          .patch('/api/organizations/current')
          .set('Cookie', assigned)
          .send({ foodCostTargetPct: 31 })
        expect([archive.status, rename.status, add.status, settings.status]).toEqual([
          403, 403, 403, 403,
        ])
        await request(http)
          .patch(`/api/locations/${downtown}`)
          .set('Cookie', assigned)
          .send({
            phone:
              (await prisma.client.location.findUniqueOrThrow({ where: { id: downtown } })).phone ??
              '',
          })
          .expect(200)
      } finally {
        await prisma.client.location.update({
          where: { id: airport },
          data: { name: before.name, isActive: before.isActive },
        })
        await prisma.client.organization.update({
          where: { id: organization.id },
          data: { foodCostTargetPct: organization.foodCostTargetPct },
        })
      }
    })

    test('an administrator invites below their own role only, and the owner still reaches every location', async () => {
      await invite(adminCookie, at('second-admin'), 'admin', []).expect(403)
      await invite(adminCookie, at('manager-anywhere'), 'manager', []).expect(201)
      await invite(goldenForkCookie, at('owner-airport'), 'staff', [airport]).expect(201)
    })
  })

  describe('a member is changed only by someone above their role', () => {
    const stamp = Date.now()
    const emails = [`probe-admin-a-${stamp}@example.com`, `probe-admin-b-${stamp}@example.com`]
    let admins: string[] = []
    let ken = ''
    let adminCookie = ''

    beforeAll(async () => {
      const maria = await prisma.client.user.findUniqueOrThrow({
        where: { email: 'maria@goldenfork.com' },
      })
      admins = await Promise.all(
        emails.map(
          async (email) =>
            (
              await prisma.client.user.create({
                data: {
                  organizationId: maria.organizationId,
                  email,
                  fullName: 'Probe Admin',
                  role: 'admin',
                  hashedPassword: maria.hashedPassword,
                },
              })
            ).id,
        ),
      )
      ken = (await prisma.client.user.findUniqueOrThrow({ where: { email: 'ken@goldenfork.com' } }))
        .id
      adminCookie = await login(emails[0])
    })

    afterAll(async () => {
      await prisma.client.user.update({
        where: { id: ken },
        data: { role: 'staff', isActive: true },
      })
      await prisma.client.userSession.deleteMany({ where: { userId: { in: admins } } })
      await prisma.client.invitation.deleteMany({
        where: { email: `probe-invited-${stamp}@example.com` },
      })
      await prisma.client.user.deleteMany({ where: { id: { in: admins } } })
    })

    test('an administrator does not demote, deactivate or bring back another administrator', async () => {
      await request(http)
        .patch(`/api/users/${admins[1]}`)
        .set('Cookie', adminCookie)
        .send({ role: 'viewer' })
        .expect(403)
      await request(http).delete(`/api/users/${admins[1]}`).set('Cookie', adminCookie).expect(403)
      await prisma.client.user.update({ where: { id: admins[1] }, data: { isActive: false } })
      await request(http)
        .post(`/api/users/${admins[1]}/reactivate`)
        .set('Cookie', adminCookie)
        .expect(403)
      expect((await prisma.client.user.findUniqueOrThrow({ where: { id: admins[1] } })).role).toBe(
        'admin',
      )
    })

    test('an administrator does not raise anyone to their own role, and does change those below', async () => {
      await request(http)
        .patch(`/api/users/${ken}`)
        .set('Cookie', adminCookie)
        .send({ role: 'admin' })
        .expect(403)
      await request(http)
        .patch(`/api/users/${ken}`)
        .set('Cookie', adminCookie)
        .send({ role: 'manager' })
        .expect(200)
      await request(http)
        .patch(`/api/users/${ken}`)
        .set('Cookie', goldenForkCookie)
        .send({ role: 'staff' })
        .expect(200)
    })

    test('an invited person is listed with the locations the invitation offers', async () => {
      const downtown = await prisma.client.location.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, name: { endsWith: 'Downtown' } },
      })
      await request(http)
        .post('/api/invitations')
        .set('Cookie', goldenForkCookie)
        .send({
          email: `probe-invited-${stamp}@example.com`,
          role: 'staff',
          locationIds: [downtown.id],
        })
        .expect(201)
      const team = (
        await request(http).get('/api/users').set('Cookie', goldenForkCookie).expect(200)
      ).body as {
        email: string
        locations: { id: string }[]
      }[]
      expect(team.find((m) => m.email === `probe-invited-${stamp}@example.com`)?.locations).toEqual(
        [expect.objectContaining({ id: downtown.id })],
      )
    })
  })

  test('a platform administrator is an ordinary member of their own organization outside the panel', async () => {
    const platform = await login('platform@nexus.app')
    const res = await request(http).post('/api/billing/portal').set('Cookie', platform).expect(403)
    expect(res.body.error.message).toMatch(/owner/)
    await request(http).get('/api/admin/organizations').set('Cookie', platform).expect(200)
  })

  test('the owner named in Settings is the owner account, whatever the owner changes on their profile', async () => {
    const owner = await prisma.client.user.findUniqueOrThrow({
      where: { email: 'owner@goldenfork.com' },
    })
    const before = await prisma.client.organization.findUniqueOrThrow({
      where: { id: owner.organizationId },
    })
    const probe = `owner-probe-${Date.now()}@example.com`
    try {
      await request(http)
        .patch('/api/auth/me')
        .set('Cookie', goldenForkCookie)
        .send({ fullName: 'Probe Owner Name', email: probe, currentPassword: 'Nexus_dev1' })
        .expect(200)
      const org = (
        await request(http)
          .get('/api/organizations/current')
          .set('Cookie', goldenForkCookie)
          .expect(200)
      ).body as { ownerName: string; ownerEmail: string }
      expect(org).toMatchObject({ ownerName: 'Probe Owner Name', ownerEmail: probe })
      const stored = await prisma.client.organization.findUniqueOrThrow({
        where: { id: owner.organizationId },
      })
      expect(stored.ownerEmail).toBe(probe)
      await request(http)
        .patch('/api/organizations/current')
        .set('Cookie', goldenForkCookie)
        .send({ name: '   ' })
        .expect(400)
    } finally {
      await prisma.client.user.update({
        where: { id: owner.id },
        data: { email: owner.email, fullName: owner.fullName },
      })
      await prisma.client.organization.update({
        where: { id: owner.organizationId },
        data: { ownerEmail: before.ownerEmail, ownerName: before.ownerName },
      })
    }
  })

  describe('small refusals say what is wrong instead of saying nothing or the wrong thing', () => {
    const organization = { slug: 'golden-fork' }

    test('a dish is not filed under a category of recipes', async () => {
      const recipes = await prisma.client.category.create({
        data: {
          organizationId: (
            await prisma.client.organization.findUniqueOrThrow({ where: organization })
          ).id,
          name: `Probe Recipe Shelf ${Date.now()}`,
          kind: 'recipe',
        },
      })
      try {
        const res = await request(http)
          .post('/api/menu-items')
          .set('Cookie', goldenForkCookie)
          .send({ name: `Probe Misfiled ${Date.now()}`, price: 5, categoryId: recipes.id })
          .expect(400)
        expect(res.body.error.message).toMatch(/category of recipes, not of menu items/)
      } finally {
        await prisma.client.menuItem.deleteMany({
          where: { name: { startsWith: 'Probe Misfiled' } },
        })
        await prisma.client.category.delete({ where: { id: recipes.id } })
      }
    })

    test('waste of nothing, or of more than a column holds, is refused', async () => {
      const downtown = await prisma.client.location.findFirstOrThrow({
        where: { organization, name: { endsWith: 'Downtown' } },
      })
      const butter = await prisma.client.ingredient.findFirstOrThrow({
        where: { organization, name: 'Unsalted Butter' },
      })
      for (const quantity of [0, 1e12]) {
        await request(http)
          .post('/api/waste')
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', downtown.id)
          .send({ ingredientId: butter.id, quantity, reason: 'spoilage' })
          .expect(400)
      }
    })

    test('trimmed waste has one name everywhere it is reported', async () => {
      const rows = (
        await request(http)
          .get('/api/analytics/waste-breakdown?from=2000-01-01')
          .set('Cookie', goldenForkCookie)
          .expect(200)
      ).body as { reason: string }[]
      expect(rows.map((r) => r.reason)).toContain('Trim waste')
      expect(rows.map((r) => r.reason)).not.toContain('Prep waste')
    })

    test('a vendor named like another answers that the name is taken, not that it is missing', async () => {
      const vendors = await prisma.client.vendor.findMany({
        where: { organization },
        take: 2,
        orderBy: { name: 'asc' },
      })
      const res = await request(http)
        .patch(`/api/vendors/${vendors[1].id}`)
        .set('Cookie', goldenForkCookie)
        .send({ name: vendors[0].name })
        .expect(409)
      expect(res.body.error.message).not.toMatch(/not found/)
    })
  })

  describe('with no location in the header, an ingredient is read at the locations a person works at', () => {
    const byName = (name: string) => prisma.client.location.findFirstOrThrow({ where: { name } })
    const beefOf = (body: unknown) =>
      (
        body as {
          id: string
          name: string
          onHand: number
          costPerUnit: number
          locations: number
          costHigh: number | null
        }[]
      ).find((r) => r.name === 'Beef Tenderloin')!

    test('the catalogue and the inventory sum stock and range prices over those locations only', async () => {
      const downtown = await byName('Golden Fork — Downtown')
      const maria = await login('maria@goldenfork.com')
      const here = beefOf(
        (
          await request(http)
            .get('/api/inventory')
            .set('Cookie', goldenForkCookie)
            .set('X-Location-Id', downtown.id)
            .expect(200)
        ).body,
      )
      const everywhere = beefOf(
        (await request(http).get('/api/inventory').set('Cookie', goldenForkCookie).expect(200))
          .body,
      )
      expect(everywhere.onHand).toBeGreaterThan(here.onHand)

      for (const path of ['/api/inventory', '/api/ingredients']) {
        const seen = beefOf((await request(http).get(path).set('Cookie', maria).expect(200)).body)
        expect(seen.onHand).toBeCloseTo(here.onHand, 3)
        expect(seen.locations).toBe(1)
        expect(seen.costHigh).toBeCloseTo(here.costPerUnit, 2)
      }
    })

    test('the per-location view lists those locations only', async () => {
      const downtown = await byName('Golden Fork — Downtown')
      const maria = await login('maria@goldenfork.com')
      const beef = beefOf(
        (await request(http).get('/api/ingredients').set('Cookie', goldenForkCookie).expect(200))
          .body,
      )
      const res = await request(http)
        .get(`/api/ingredients/${beef.id}/locations`)
        .set('Cookie', maria)
        .expect(200)
      const body = res.body as {
        locations: { locationId: string; onHand: number }[]
        totals: { locations: number; onHand: number }
      }
      expect(body.locations.map((l) => l.locationId)).toEqual([downtown.id])
      expect(body.totals.locations).toBe(1)
      expect(body.totals.onHand).toBeCloseTo(body.locations[0].onHand, 3)
    })

    test('the waste form is offered the stock of those locations only', async () => {
      const downtown = await byName('Golden Fork — Downtown')
      const maria = await login('maria@goldenfork.com')
      const here = beefOf(
        (
          await request(http)
            .get('/api/inventory')
            .set('Cookie', goldenForkCookie)
            .set('X-Location-Id', downtown.id)
            .expect(200)
        ).body,
      )
      const offered = (
        (await request(http).get('/api/waste/ingredients').set('Cookie', maria).expect(200))
          .body as { name: string; onHand: number }[]
      ).find((r) => r.name === 'Beef Tenderloin')!
      expect(offered.onHand).toBeCloseTo(here.onHand, 3)
    })
  })

  describe('a value the database refuses is answered, not thrown', () => {
    test('null in an optional field of a column that cannot hold it answers 400 naming the field', async () => {
      const res = await request(http)
        .post('/api/recipes')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Probe Null Portions', portions: null, ingredients: [] })
        .expect(400)
      expect(String(res.body.error.message)).toMatch(/null|missing/)
      expect(await prisma.client.recipe.count({ where: { name: 'Probe Null Portions' } })).toBe(0)
    })

    test('a control character text cannot carry answers 400', async () => {
      const res = await request(http)
        .post('/api/locations')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Probe \u0000 Nul' })
        .expect(400)
      expect(String(res.body.error.message)).toMatch(/character/i)
      expect(await prisma.client.location.count({ where: { name: { contains: 'Probe' } } })).toBe(0)
    })
  })

  describe('an edit is written whole or not at all', () => {
    const refusing = async (table: string, column: string, id: string, fn: () => Promise<void>) => {
      await prisma.client.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION e2e_refuse_line() RETURNS trigger AS $$
        BEGIN
          IF NEW."${column}" = '${id}' THEN RAISE EXCEPTION 'e2e refuses the line'; END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql`)
      await prisma.client.$executeRawUnsafe(
        `CREATE TRIGGER e2e_refuse_line BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION e2e_refuse_line()`,
      )
      try {
        await fn()
      } finally {
        await prisma.client.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS e2e_refuse_line ON "${table}"`,
        )
        await prisma.client.$executeRawUnsafe('DROP FUNCTION IF EXISTS e2e_refuse_line()')
      }
    }

    const butter = () =>
      prisma.client.ingredient.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
      })

    const sharedRecipe = () =>
      prisma.client.recipe.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, locationId: null },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      })

    test('a recipe keeps its name when its lines cannot be written', async () => {
      const b = await butter()
      const created = await request(http)
        .post('/api/recipes')
        .set('Cookie', goldenForkCookie)
        .send({
          name: 'Probe Whole Recipe',
          portions: 1,
          ingredients: [{ ingredientId: b.id, quantity: 1, unit: 'kg' }],
        })
        .expect(201)
      const id = (created.body as { id: string }).id
      try {
        await refusing('RecipeIngredient', 'recipeId', id, async () => {
          const res = await request(http)
            .patch(`/api/recipes/${id}`)
            .set('Cookie', goldenForkCookie)
            .send({
              name: 'Probe Half Recipe',
              ingredients: [{ ingredientId: b.id, quantity: 2, unit: 'kg' }],
            })
          expect(res.status).toBeGreaterThanOrEqual(400)
        })
        const after = await prisma.client.recipe.findUniqueOrThrow({
          where: { id },
          include: { ingredients: true },
        })
        expect(after.name).toBe('Probe Whole Recipe')
        expect(after.ingredients.map((l) => Number(l.quantity))).toEqual([1])
      } finally {
        await prisma.client.recipeIngredient.deleteMany({ where: { recipeId: id } })
        await prisma.client.recipe.delete({ where: { id } })
      }
    })

    test('a dish keeps its name when its recipes cannot be written', async () => {
      const recipe = await sharedRecipe()
      const created = await request(http)
        .post('/api/menu-items')
        .set('Cookie', goldenForkCookie)
        .send({
          name: 'Probe Whole Dish',
          price: 10,
          recipes: [{ recipeId: recipe.id, portions: 1 }],
        })
        .expect(201)
      const id = (created.body as { id: string }).id
      try {
        await refusing('MenuItemRecipe', 'menuItemId', id, async () => {
          const res = await request(http)
            .patch(`/api/menu-items/${id}`)
            .set('Cookie', goldenForkCookie)
            .send({ name: 'Probe Half Dish', recipes: [{ recipeId: recipe.id, portions: 2 }] })
          expect(res.status).toBeGreaterThanOrEqual(400)
        })
        const after = await prisma.client.menuItem.findUniqueOrThrow({
          where: { id },
          include: { recipes: true },
        })
        expect(after.name).toBe('Probe Whole Dish')
        expect(after.recipes.map((r) => Number(r.portions))).toEqual([1])
      } finally {
        await prisma.client.menuItem.delete({ where: { id } })
      }
    })

    test('a dish that cannot be placed on its menus is not created and not renamed', async () => {
      const menu = await request(http)
        .post('/api/menus')
        .set('Cookie', goldenForkCookie)
        .send({ name: 'Probe Whole Menu' })
        .expect(201)
      const menuId = (menu.body as { id: string }).id
      try {
        await refusing('MenuItemOnMenu', 'menuId', menuId, async () => {
          const res = await request(http)
            .post('/api/menu-items')
            .set('Cookie', goldenForkCookie)
            .send({ name: 'Probe Unplaced Dish', price: 10, menuIds: [menuId] })
          expect(res.status).toBeGreaterThanOrEqual(400)
        })
        expect(await prisma.client.menuItem.count({ where: { name: 'Probe Unplaced Dish' } })).toBe(
          0,
        )

        const dish = await request(http)
          .post('/api/menu-items')
          .set('Cookie', goldenForkCookie)
          .send({ name: 'Probe Placed Dish', price: 10 })
          .expect(201)
        const dishId = (dish.body as { id: string }).id
        await refusing('MenuItemOnMenu', 'menuId', menuId, async () => {
          const res = await request(http)
            .patch(`/api/menu-items/${dishId}`)
            .set('Cookie', goldenForkCookie)
            .send({ name: 'Probe Renamed Dish', menuIds: [menuId] })
          expect(res.status).toBeGreaterThanOrEqual(400)
        })
        expect(
          (await prisma.client.menuItem.findUniqueOrThrow({ where: { id: dishId } })).name,
        ).toBe('Probe Placed Dish')
      } finally {
        await prisma.client.menuItem.deleteMany({
          where: {
            name: { in: ['Probe Unplaced Dish', 'Probe Placed Dish', 'Probe Renamed Dish'] },
          },
        })
        await prisma.client.menu.delete({ where: { id: menuId } })
      }
    })
  })
})
