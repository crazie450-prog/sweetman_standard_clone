import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app-setup'
import { PrismaService } from '../src/prisma/prisma.service'
import { label, routesOf, type Route } from './routes'

jest.setTimeout(180000)

type Ids = Record<string, string>

const OWNER_OF: [RegExp, (ids: Ids) => string[]][] = [
  [/^\/api\/categories\/:id$/, (i) => [i.category]],
  [/^\/api\/documents\/ingredient-aliases\/:id$/, (i) => [i.ingredientAlias]],
  [/^\/api\/documents\/menu-item-aliases\/:id$/, (i) => [i.menuItemAlias]],
  [/^\/api\/documents\/:id(\/[\w-]+)?$/, (i) => [i.document]],
  [/^\/api\/ingredients\/:id(\/[\w-]+)?$/, (i) => [i.ingredient]],
  [/^\/api\/invitations\/:id(\/\w+)?$/, (i) => [i.invitation]],
  [/^\/api\/invoices\/:id$/, (i) => [i.invoice]],
  [/^\/api\/locations\/:id$/, (i) => [i.location]],
  [/^\/api\/menu-items\/:id$/, (i) => [i.menuItem]],
  [/^\/api\/menus\/:id(\/[\w-]+)?$/, (i) => [i.menu]],
  [/^\/api\/purchasing\/drafts\/:id(\/\w+)?$/, (i) => [i.purchaseDraft]],
  [/^\/api\/recipes\/:id\/components\/:componentId$/, (i) => [i.recipe, i.component]],
  [/^\/api\/recipes\/:id(\/\w+)?$/, (i) => [i.recipe]],
  [/^\/api\/unit-conversions\/:id$/, (i) => [i.unitConversion]],
  [/^\/api\/users\/:id(\/[\w-]+)?$/, (i) => [i.user]],
  [/^\/api\/vendor-products\/:id$/, (i) => [i.vendorProduct]],
  [/^\/api\/vendors\/:id$/, (i) => [i.vendor]],
]

const BY_TOKEN = /^\/api\/invitations\/:token/

const BODIES: Record<string, (ids: Ids, own: Ids) => object> = {
  'PATCH /api/categories/:id': () => ({ name: 'Isolation probe' }),
  'POST /api/recipes/:id/components': (i) => ({
    componentId: i.component,
    quantity: 1,
    unit: 'portion',
  }),
  'POST /api/documents/:id/map': (_, own) => ({
    rawName: 'ISOLATION PROBE',
    ingredientId: own.ingredient,
  }),
}

describe('Nothing of one organization is reached from another (e2e)', () => {
  let app: INestApplication
  let http: ReturnType<INestApplication['getHttpServer']>
  let prisma: PrismaService
  let routes: Route[]
  let owner = ''
  const ids: Ids = {}
  const own: Ids = {}
  const cleanup: (() => Promise<unknown>)[] = []

  const signIn = async (email: string) => {
    const res = await request(http)
      .post('/api/auth/login')
      .send({ email, password: 'Nexus_dev1' })
      .expect(200)
    const raw = res.headers['set-cookie'] as unknown as string[]
    return raw.map((c) => c.split(';')[0]).join('; ')
  }

  const snapshot = async () => {
    const db = prisma.client
    const where = { organizationId: ids.organization }
    const rows = await Promise.all([
      db.vendor.findMany({ where }),
      db.ingredient.findMany({ where }),
      db.recipe.findMany({ where }),
      db.recipeComponent.findMany({ where: { parent: where } }),
      db.menuItem.findMany({ where }),
      db.menu.findMany({ where }),
      db.document.findMany({ where }),
      db.invoice.findMany({ where }),
      db.purchaseDraft.findMany({ where }),
      db.location.findMany({ where }),
      db.category.findMany({ where }),
      db.unitConversion.findMany({ where }),
      db.vendorProduct.findMany({ where: { vendor: where } }),
      db.user.findMany({ where }),
      db.invitation.findMany({ where }),
      db.ingredientAlias.findMany({ where }),
      db.menuItemAlias.findMany({ where }),
    ])
    return JSON.stringify(rows)
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication({ rawBody: true })
    configureApp(app)
    await app.init()
    http = app.getHttpServer()
    prisma = app.get(PrismaService)
    routes = routesOf(app)
    owner = await signIn('owner@goldenfork.com')
    const golden = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    own.location = (
      await prisma.client.location.findFirstOrThrow({ where: { organizationId: golden.id } })
    ).id
    own.ingredient = (
      await prisma.client.ingredient.findFirstOrThrow({ where: { organizationId: golden.id } })
    ).id

    const db = prisma.client
    const org = await db.organization.findFirstOrThrow({ where: { slug: 'bella-cucina' } })
    const organizationId = org.id
    ids.organization = organizationId
    const first = <T extends { id: string }>(rows: T[]) => rows[0].id
    ids.location = first(await db.location.findMany({ where: { organizationId } }))
    ids.vendor = first(await db.vendor.findMany({ where: { organizationId } }))
    ids.ingredient = first(await db.ingredient.findMany({ where: { organizationId } }))
    ids.recipe = first(await db.recipe.findMany({ where: { organizationId } }))
    ids.menuItem = first(await db.menuItem.findMany({ where: { organizationId } }))
    ids.menu = first(await db.menu.findMany({ where: { organizationId } }))
    ids.vendorProduct = first(
      await db.vendorProduct.findMany({ where: { vendor: { organizationId } } }),
    )
    ids.user = first(await db.user.findMany({ where: { organizationId, role: { not: 'owner' } } }))

    const stamp = Date.now()
    const made = async <T extends { id: string }>(
      key: string,
      create: Promise<T>,
      remove: (id: string) => Promise<unknown>,
    ) => {
      const row = await create
      ids[key] = row.id
      cleanup.unshift(() => remove(row.id))
    }
    await made(
      'component',
      db.recipe.create({
        data: { organizationId, name: `Isolation component ${stamp}`, locationId: null },
      }),
      (id) => db.recipe.delete({ where: { id } }),
    )
    const link = await db.recipeComponent.create({
      data: { parentId: ids.recipe, componentId: ids.component, quantity: 1, unit: 'portion' },
    })
    cleanup.unshift(() => db.recipeComponent.delete({ where: { id: link.id } }))
    await made(
      'category',
      db.category.create({ data: { organizationId, name: `Isolation ${stamp}` } }),
      (id) => db.category.delete({ where: { id } }),
    )
    await made(
      'unitConversion',
      db.unitConversion.create({
        data: { organizationId, fromUnit: 'box', toUnit: 'kg', factor: 2 },
      }),
      (id) => db.unitConversion.delete({ where: { id } }),
    )
    await made(
      'document',
      db.document.create({
        data: {
          organizationId,
          locationId: ids.location,
          type: 'invoice',
          status: 'requires_review',
          fileKey: `isolation-${stamp}.json`,
          fileName: `isolation-${stamp}.json`,
          mimeType: 'application/json',
          size: 2,
        },
      }),
      (id) => db.document.delete({ where: { id } }),
    )
    await made(
      'invoice',
      db.invoice.create({
        data: { organizationId, locationId: ids.location, invoiceDate: new Date() },
      }),
      (id) => db.invoice.delete({ where: { id } }),
    )
    await made(
      'purchaseDraft',
      db.purchaseDraft.create({
        data: { organizationId, locationId: ids.location, days: 28, horizon: 7 },
      }),
      (id) => db.purchaseDraft.delete({ where: { id } }),
    )
    await made(
      'invitation',
      db.invitation.create({
        data: {
          organizationId,
          email: `isolation.${stamp}@test.nexus`,
          token: `isolation-${stamp}`,
          expiresAt: new Date(Date.now() + 86400000),
        },
      }),
      (id) => db.invitation.delete({ where: { id } }),
    )
    await made(
      'ingredientAlias',
      db.ingredientAlias.create({ data: { organizationId, rawName: `ISOLATION ${stamp}` } }),
      (id) => db.ingredientAlias.delete({ where: { id } }),
    )
    await made(
      'menuItemAlias',
      db.menuItemAlias.create({ data: { organizationId, rawName: `ISOLATION ${stamp}` } }),
      (id) => db.menuItemAlias.delete({ where: { id } }),
    )
  })

  afterAll(async () => {
    for (const undo of cleanup) await undo().catch(() => undefined)
    await app.close()
  })

  test('every route that takes an id knows which record of the other organization to try', () => {
    const unknown = routes
      .filter((r) => r.path.includes('/:') && !r.platformOnly && !BY_TOKEN.test(r.path))
      .filter((r) => !OWNER_OF.some(([rx]) => rx.test(r.path)))
      .map(label)
    expect(unknown).toEqual([])
  })

  test("no list carries an id of another organization's record", async () => {
    const theirs = new Set(Object.values(ids))
    const leaked: string[] = []
    for (const r of routes.filter(
      (r) => r.method === 'get' && !r.path.includes('/:') && !r.platformOnly && !r.isPublic,
    )) {
      const res = await request(http).get(r.url).set('Cookie', owner)
      const found = JSON.stringify(res.body).match(/c[a-z0-9]{24}/g) ?? []
      const hits = found.filter((id) => theirs.has(id))
      if (hits.length) leaked.push(`${label(r)} → ${hits.join(', ')}`)
    }
    expect(leaked).toEqual([])
  })

  test("another organization's record is not read, changed or removed through any route", async () => {
    const before = await snapshot()
    const reached: string[] = []
    for (const r of routes.filter(
      (r) => r.path.includes('/:') && !r.platformOnly && !BY_TOKEN.test(r.path),
    )) {
      const [, of] = OWNER_OF.find(([rx]) => rx.test(r.path))!
      const values = of(ids)
      let n = 0
      const url = r.path.replace(/:\w+/g, () => values[n++] ?? values[0])
      const agent = request(http)
      const req = agent[r.method](url).set('Cookie', owner).set('X-Location-Id', own.location)
      const body = BODIES[label(r)]?.(ids, own) ?? {}
      const res = await (r.method === 'get' || r.method === 'delete' ? req : req.send(body))
      if (res.status !== 404) reached.push(`${label(r)} → ${res.status} ${res.body?.error?.code}`)
    }
    expect(reached).toEqual([])
    expect(await snapshot()).toBe(before)
  })
})
