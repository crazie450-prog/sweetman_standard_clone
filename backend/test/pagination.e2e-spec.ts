import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app-setup'
import { PrismaService } from '../src/prisma/prisma.service'

jest.setTimeout(60000)

type PageBody = {
  data: ({ id: string } & Record<string, unknown>)[]
  pagination: { limit: number; offset: number; total: number }
}

describe('Lists that grow are read a page at a time (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let http: ReturnType<INestApplication['getHttpServer']>
  let owner = ''
  let stranger = ''
  let platform = ''
  let ingredientId = ''
  const made = {
    documents: [] as string[],
    drafts: [] as string[],
    batches: [] as string[],
    invoices: [] as string[],
  }

  const signIn = async (email: string) => {
    const res = await request(http)
      .post('/api/auth/login')
      .send({ email, password: 'Nexus_dev1' })
      .expect(200)
    const raw = res.headers['set-cookie'] as unknown as string[]
    return raw.map((c) => c.split(';')[0]).join('; ')
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    configureApp(app)
    await app.init()
    http = app.getHttpServer()
    prisma = app.get(PrismaService)

    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const location = await prisma.client.location.findFirstOrThrow({
      where: { organizationId: org.id, name: 'Golden Fork — Downtown' },
    })
    const recipe = await prisma.client.recipe.findFirstOrThrow({
      where: { organizationId: org.id },
    })
    const history = await prisma.client.ingredientPriceHistory.groupBy({
      by: ['ingredientId'],
      where: { organizationId: org.id },
      _count: true,
      orderBy: { _count: { ingredientId: 'desc' } },
      take: 1,
    })
    ingredientId = history[0].ingredientId

    for (let i = 0; i < 3; i++) {
      const doc = await prisma.client.document.create({
        data: {
          organizationId: org.id,
          locationId: location.id,
          type: i === 0 ? 'recipe' : 'invoice',
          fileKey: `${org.id}/pagination-probe-${Date.now()}-${i}.csv`,
          fileName: `pagination-probe-${i}.csv`,
          mimeType: 'text/csv',
          size: 10,
          status: 'failed',
          error: 'probe',
        },
      })
      made.documents.push(doc.id)
      const draft = await prisma.client.purchaseDraft.create({
        data: {
          organizationId: org.id,
          locationId: location.id,
          days: 28,
          horizon: 7,
          status: i === 0 ? 'approved' : 'draft',
        },
      })
      made.drafts.push(draft.id)
      const batch = await prisma.client.production.create({
        data: {
          organizationId: org.id,
          locationId: location.id,
          recipeId: recipe.id,
          quantity: 1,
          unit: 'portion',
          cost: 2.5,
          date: new Date(Date.now() - (i + 1) * 60_000),
        },
      })
      made.batches.push(batch.id)
      if (i > 0) {
        const invoice = await prisma.client.invoice.create({
          data: {
            organizationId: org.id,
            locationId: location.id,
            number: `PAGE-PROBE-${Date.now()}-${i}`,
            invoiceDate: new Date(Date.now() - i * 86_400_000),
          },
        })
        made.invoices.push(invoice.id)
      }
    }

    owner = await signIn('owner@goldenfork.com')
    stranger = await signIn('owner@bellacucina.com')
    platform = await signIn('platform@nexus.app')
  })

  afterAll(async () => {
    await prisma.client.document.deleteMany({ where: { id: { in: made.documents } } })
    await prisma.client.purchaseDraft.deleteMany({ where: { id: { in: made.drafts } } })
    await prisma.client.production.deleteMany({ where: { id: { in: made.batches } } })
    await prisma.client.invoice.deleteMany({ where: { id: { in: made.invoices } } })
    await app.close()
  })

  const LISTS: { name: string; path: () => string; as: 'owner' | 'platform' }[] = [
    { name: 'documents', path: () => '/api/documents', as: 'owner' },
    { name: 'invoices', path: () => '/api/invoices', as: 'owner' },
    { name: 'inventory transactions', path: () => '/api/inventory/transactions', as: 'owner' },
    { name: 'waste entries', path: () => '/api/waste', as: 'owner' },
    { name: 'production batches', path: () => '/api/production', as: 'owner' },
    { name: 'sold items', path: () => '/api/sales', as: 'owner' },
    {
      name: 'price history',
      path: () => `/api/ingredients/${ingredientId}/price-history`,
      as: 'owner',
    },
    { name: 'draft orders', path: () => '/api/purchasing/drafts', as: 'owner' },
    { name: 'admin organizations', path: () => '/api/admin/organizations', as: 'platform' },
    { name: 'admin users', path: () => '/api/admin/users?q=goldenfork', as: 'platform' },
    { name: 'admin queue', path: () => '/api/admin/queue', as: 'platform' },
  ]

  const read = (path: string, cookie: string, query: Record<string, string | number> = {}) => {
    const glue = path.includes('?') ? '&' : '?'
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()
    return request(http)
      .get(qs ? `${path}${glue}${qs}` : path)
      .set('Cookie', cookie)
  }

  describe.each(LISTS)('$name', ({ path, as }) => {
    const cookie = () => (as === 'owner' ? owner : platform)

    test('answers a page in the standard shape, fifty rows by default', async () => {
      const res = await read(path(), cookie()).expect(200)
      const body = res.body as PageBody
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.pagination).toEqual({
        limit: 50,
        offset: 0,
        total: expect.any(Number) as number,
      })
      expect(body.pagination.total).toBeGreaterThanOrEqual(2)
      expect(body.data.length).toBe(Math.min(50, body.pagination.total))
    })

    test('pages one row at a time read the same rows in the same order as one wider page', async () => {
      const wide = (await read(path(), cookie(), { limit: 3 }).expect(200)).body as PageBody
      const ids: string[] = []
      for (let offset = 0; offset < wide.data.length; offset++) {
        const one = (await read(path(), cookie(), { limit: 1, offset }).expect(200))
          .body as PageBody
        expect(one.data).toHaveLength(1)
        expect(one.pagination).toEqual({ limit: 1, offset, total: wide.pagination.total })
        ids.push(one.data[0].id)
      }
      expect(ids).toEqual(wide.data.map((row) => row.id))
    })

    test('the last page holds what is left, and a page past the end is empty', async () => {
      const { total } = ((await read(path(), cookie()).expect(200)).body as PageBody).pagination
      const last = (await read(path(), cookie(), { limit: 2, offset: total - 1 }).expect(200))
        .body as PageBody
      expect(last.data).toHaveLength(1)
      const past = (await read(path(), cookie(), { offset: total }).expect(200)).body as PageBody
      expect(past.data).toEqual([])
      expect(past.pagination.total).toBe(total)
    })

    test('takes the largest page allowed and refuses one beyond it, an empty one and a negative offset', async () => {
      await read(path(), cookie(), { limit: 200 }).expect(200)
      const tooWide = await read(path(), cookie(), { limit: 201 }).expect(400)
      expect(JSON.stringify(tooWide.body)).toMatch(/limit must not be greater than 200/)
      const empty = await read(path(), cookie(), { limit: 0 }).expect(400)
      expect(JSON.stringify(empty.body)).toMatch(/limit must not be less than 1/)
      const backwards = await read(path(), cookie(), { offset: -1 }).expect(400)
      expect(JSON.stringify(backwards.body)).toMatch(/offset must not be less than 0/)
      const words = await read(path(), cookie(), { limit: 'ten' }).expect(400)
      expect(JSON.stringify(words.body)).toMatch(/limit must be an integer/)
    })
  })

  test("another organization's rows are neither listed nor counted", async () => {
    const mine = (await read('/api/documents', owner).expect(200)).body as PageBody
    const theirs = (await read('/api/documents', stranger).expect(200)).body as PageBody
    const seen = new Set(theirs.data.map((d) => d.id))
    expect(made.documents.some((id) => seen.has(id))).toBe(false)
    expect(theirs.pagination.total).toBeLessThan(mine.pagination.total)
    const drafts = (await read('/api/purchasing/drafts', stranger).expect(200)).body as PageBody
    expect(drafts.data.filter((d) => made.drafts.includes(d.id))).toEqual([])
  })

  test('a tenant is refused the admin lists', async () => {
    await read('/api/admin/queue', owner).expect(404)
    await read('/api/admin/queue/summary', owner).expect(404)
  })

  test('documents narrow by type and state, and the state counts add up to every page', async () => {
    const recipes = (await read('/api/documents', owner, { type: 'recipe' }).expect(200))
      .body as PageBody & { data: { type: string }[] }
    expect(recipes.data.every((d) => d.type === 'recipe')).toBe(true)
    expect(recipes.data.map((d) => d.id)).toContain(made.documents[0])
    const failed = (await read('/api/documents', owner, { status: 'failed' }).expect(200))
      .body as PageBody & { data: { status: string }[] }
    expect(failed.data.every((d) => d.status === 'failed')).toBe(true)
    await read('/api/documents', owner, { status: 'lost' }).expect(400)

    const all = (await read('/api/documents', owner).expect(200)).body as PageBody
    const summary = (await read('/api/documents/summary', owner).expect(200)).body as Record<
      string,
      number
    >
    expect(summary.total).toBe(all.pagination.total)
    expect(summary.failed).toBe(failed.pagination.total)
    const invoices = (await read('/api/documents/summary', owner, { type: 'invoice' }).expect(200))
      .body as Record<string, number>
    expect(invoices.total).toBe(
      ((await read('/api/documents', owner, { type: 'invoice' }).expect(200)).body as PageBody)
        .pagination.total,
    )
  })

  test('a document shows the other parts of its file even when they sit on another page', async () => {
    const res = await read(`/api/documents/${made.documents[0]}`, owner).expect(200)
    expect(res.body.siblings).toEqual([])
  })

  test('transactions narrow by kind, and the period summary equals the sum of every page', async () => {
    const period = { from: '2000-01-01', to: '2100-12-31' }
    const every = async (kind?: string) => {
      const rows: { type: string; cost: number }[] = []
      for (let offset = 0; ; offset += 200) {
        const page = (
          await read('/api/inventory/transactions', owner, {
            ...period,
            ...(kind ? { type: kind } : {}),
            limit: 200,
            offset,
          }).expect(200)
        ).body as { data: { type: string; cost: number }[]; pagination: { total: number } }
        rows.push(...page.data)
        if (offset + 200 >= page.pagination.total) return rows
      }
    }
    const all = await every()
    const received = await every('received')
    expect(received.every((t) => t.type === 'received')).toBe(true)
    await read('/api/inventory/transactions', owner, { type: 'stolen' }).expect(400)

    const summary = (await read('/api/inventory/transactions/summary', owner, period).expect(200))
      .body as Record<string, number>
    const sum = (type: string) =>
      Math.round(all.filter((t) => t.type === type).reduce((s, t) => s + t.cost, 0) * 100) / 100
    expect(summary.received).toBeCloseTo(sum('received'), 2)
    expect(summary.used).toBeCloseTo(sum('used'), 2)
    expect(summary.wasted).toBeCloseTo(sum('wasted'), 2)
    expect(summary.counted).toBeCloseTo(sum('counted'), 2)
    expect(summary.movements).toBe(all.length)
  })

  test('the production summary counts every batch of the period, not one page', async () => {
    const page = (await read('/api/production', owner, { limit: 1 }).expect(200)).body as PageBody
    const summary = (await read('/api/production/summary', owner).expect(200)).body as {
      batches: number
      cost: number
      recipes: number
    }
    expect(summary.batches).toBe(page.pagination.total)
    expect(summary.cost).toBeGreaterThanOrEqual(7.5)
    expect(summary.recipes).toBeGreaterThanOrEqual(1)
  })

  test('sold lines sort by their total and narrow to a range of totals across every page', async () => {
    type Line = { id: string; qty: number; price: number; date: string }
    const period = { from: '2000-01-01', to: '2100-12-31' }
    const all: Line[] = []
    for (let offset = 0; ; offset += 200) {
      const page = (await read('/api/sales', owner, { ...period, limit: 200, offset }).expect(200))
        .body as { data: Line[]; pagination: { total: number } }
      all.push(...page.data)
      if (offset + 200 >= page.pagination.total) break
    }
    const worth = (l: Line) => Math.round(l.qty * l.price * 100) / 100
    const top = (
      await read('/api/sales', owner, { ...period, sort: 'total', dir: 'desc', limit: 5 }).expect(
        200,
      )
    ).body as { data: Line[] }
    const highest = Math.max(...all.map(worth))
    expect(worth(top.data[0])).toBe(highest)
    const totals = top.data.map(worth)
    expect(totals).toEqual([...totals].sort((a, b) => b - a))

    const cheapest = (
      await read('/api/sales', owner, { ...period, sort: 'total', dir: 'asc', limit: 1 }).expect(
        200,
      )
    ).body as { data: Line[] }
    expect(worth(cheapest.data[0])).toBe(Math.min(...all.map(worth)))

    const floor = 20
    const ceiling = 60
    const ranged = (
      await read('/api/sales', owner, {
        ...period,
        minTotal: floor,
        maxTotal: ceiling,
        limit: 200,
      }).expect(200)
    ).body as { data: Line[]; pagination: { total: number } }
    const expected = all.filter((l) => worth(l) >= floor && worth(l) <= ceiling)
    expect(ranged.pagination.total).toBe(expected.length)
    expect(ranged.data.every((l) => worth(l) >= floor && worth(l) <= ceiling)).toBe(true)

    await read('/api/sales', owner, { sort: 'price' }).expect(400)
    await read('/api/sales', owner, { minTotal: -1 }).expect(400)
    const theirs = (await read('/api/sales', stranger, { ...period, limit: 200 }).expect(200))
      .body as { data: Line[] }
    const ours = new Set(all.map((l) => l.id))
    expect(theirs.data.some((l) => ours.has(l.id))).toBe(false)
  })

  test('sold lines stay inside the location in the header and the period asked for', async () => {
    const period = { from: '2000-01-01', to: '2100-12-31' }
    const everywhere = (await read('/api/sales', owner, period).expect(200)).body as PageBody
    const riverside = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Riverside' },
    })
    const here = (
      await request(http)
        .get('/api/sales?from=2000-01-01&to=2100-12-31&limit=200')
        .set('Cookie', owner)
        .set('X-Location-Id', riverside.id)
        .expect(200)
    ).body as PageBody
    const atRiverside = await prisma.client.saleItem.count({
      where: { sale: { locationId: riverside.id } },
    })
    expect(here.pagination.total).toBe(atRiverside)
    expect(here.pagination.total).toBeLessThan(everywhere.pagination.total)

    const longAgo = (
      await read('/api/sales', owner, { from: '2001-01-01', to: '2001-01-31' }).expect(200)
    ).body as PageBody
    expect(longAgo.pagination.total).toBe(0)
  })

  test('draft orders narrow by state', async () => {
    const approved = (
      await read('/api/purchasing/drafts', owner, { status: 'approved', limit: 200 }).expect(200)
    ).body as PageBody & { data: { status: string }[] }
    expect(approved.data.every((d) => d.status === 'approved')).toBe(true)
    expect(approved.data.map((d) => d.id)).toContain(made.drafts[0])
    expect(approved.data.map((d) => d.id)).not.toContain(made.drafts[1])
  })

  test('invoices narrow to one vendor', async () => {
    const vendor = await prisma.client.invoice.findFirstOrThrow({
      where: { vendorId: { not: null }, organization: { slug: 'golden-fork' } },
      select: { vendorId: true },
    })
    const page = (
      await read('/api/invoices', owner, { vendorId: vendor.vendorId as string }).expect(200)
    ).body as PageBody & { data: { vendorId: string }[] }
    expect(page.pagination.total).toBeGreaterThanOrEqual(1)
    expect(page.data.every((i) => i.vendorId === vendor.vendorId)).toBe(true)
  })

  test('the admin queue narrows by state and its counts cover every organization', async () => {
    const failed = (await read('/api/admin/queue', platform, { status: 'failed' }).expect(200))
      .body as PageBody & { data: { status: string }[] }
    expect(failed.data.every((j) => j.status === 'failed')).toBe(true)
    const all = (await read('/api/admin/queue', platform).expect(200)).body as PageBody
    const summary = (await read('/api/admin/queue/summary', platform).expect(200)).body as {
      total: number
      failed: number
    }
    expect(summary.total).toBe(all.pagination.total)
    expect(summary.failed).toBe(failed.pagination.total)
  })

  test('an account search with nothing to look for is an empty page', async () => {
    const res = await read('/api/admin/users', platform).expect(200)
    expect(res.body).toEqual({ data: [], pagination: { limit: 50, offset: 0, total: 0 } })
  })
})
