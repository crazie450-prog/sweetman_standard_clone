import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import * as argon2 from 'argon2'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app-setup'
import { ROLE_ORDER } from '../src/common/decorators/roles.decorator'
import type { Role } from '../src/generated/prisma/client'
import { PrismaService } from '../src/prisma/prisma.service'
import { label, routesOf, type Route } from './routes'

jest.setTimeout(120000)

const ACCESS: Record<string, Role | 'signed-in' | 'public' | 'platform'> = {
  'DELETE /api/categories/:id': 'manager',
  'DELETE /api/documents/:id': 'staff',
  'DELETE /api/documents/ingredient-aliases/:id': 'manager',
  'DELETE /api/documents/menu-item-aliases/:id': 'manager',
  'DELETE /api/ingredients/:id': 'manager',
  'DELETE /api/invitations/:id': 'manager',
  'DELETE /api/invoices/:id': 'manager',
  'DELETE /api/locations/:id': 'admin',
  'DELETE /api/menu-items/:id': 'manager',
  'DELETE /api/menus/:id': 'manager',
  'DELETE /api/purchasing/drafts/:id': 'manager',
  'DELETE /api/recipes/:id': 'manager',
  'DELETE /api/recipes/:id/components/:componentId': 'staff',
  'DELETE /api/unit-conversions/:id': 'manager',
  'DELETE /api/users/:id': 'manager',
  'DELETE /api/vendor-products/:id': 'manager',
  'DELETE /api/vendors/:id': 'manager',
  'GET /api/admin/integrations': 'platform',
  'GET /api/admin/organizations': 'platform',
  'GET /api/admin/organizations/:id': 'platform',
  'GET /api/admin/queue': 'platform',
  'GET /api/admin/queue/:id': 'platform',
  'GET /api/admin/queue/state': 'platform',
  'GET /api/admin/queue/summary': 'platform',
  'GET /api/admin/users': 'platform',
  'GET /api/analytics/cost-by-category': 'signed-in',
  'GET /api/analytics/food-cost-variance': 'signed-in',
  'GET /api/analytics/revenue-trend': 'signed-in',
  'GET /api/analytics/spend': 'signed-in',
  'GET /api/analytics/waste-breakdown': 'signed-in',
  'GET /api/auth/me': 'signed-in',
  'GET /api/auth/refresh': 'public',
  'GET /api/billing/plans': 'signed-in',
  'GET /api/billing/subscription': 'signed-in',
  'GET /api/billing/trial': 'signed-in',
  'GET /api/categories': 'signed-in',
  'GET /api/dashboard/activity': 'signed-in',
  'GET /api/dashboard/kpis': 'signed-in',
  'GET /api/dashboard/trends': 'signed-in',
  'GET /api/documents': 'signed-in',
  'GET /api/documents/:id': 'signed-in',
  'GET /api/documents/ingredient-aliases': 'manager',
  'GET /api/documents/menu-item-aliases': 'manager',
  'GET /api/documents/summary': 'signed-in',
  'GET /api/ingredients': 'signed-in',
  'GET /api/ingredients/:id/locations': 'signed-in',
  'GET /api/ingredients/:id/price-history': 'signed-in',
  'GET /api/inventory': 'signed-in',
  'GET /api/inventory/transactions': 'signed-in',
  'GET /api/inventory/transactions/summary': 'signed-in',
  'GET /api/invitations': 'manager',
  'GET /api/invitations/:token': 'public',
  'GET /api/invoices': 'signed-in',
  'GET /api/invoices/:id': 'signed-in',
  'GET /api/locations': 'manager',
  'GET /api/menu-items': 'signed-in',
  'GET /api/menus': 'signed-in',
  'GET /api/menus/:id': 'signed-in',
  'GET /api/menus/:id/available-items': 'signed-in',
  'GET /api/organizations/current': 'signed-in',
  'GET /api/production': 'signed-in',
  'GET /api/production/summary': 'signed-in',
  'GET /api/properties': 'signed-in',
  'GET /api/purchasing/drafts': 'signed-in',
  'GET /api/purchasing/drafts/:id': 'signed-in',
  'GET /api/purchasing/recommendations': 'signed-in',
  'GET /api/recipes': 'signed-in',
  'GET /api/recipes/:id': 'signed-in',
  'GET /api/recipes/:id/detail': 'signed-in',
  'GET /api/reports/price-trends': 'signed-in',
  'GET /api/reports/usage': 'signed-in',
  'GET /api/sales': 'signed-in',
  'GET /api/sales/daily': 'signed-in',
  'GET /api/sales/menu-items': 'signed-in',
  'GET /api/unit-conversions': 'signed-in',
  'GET /api/units': 'signed-in',
  'GET /api/users': 'manager',
  'GET /api/vendor-products': 'signed-in',
  'GET /api/vendors': 'signed-in',
  'GET /api/vendors/spend': 'signed-in',
  'GET /api/waste': 'signed-in',
  'GET /api/waste/ingredients': 'signed-in',
  'GET /api/waste/reasons': 'signed-in',
  'GET /health': 'public',
  'PATCH /api/admin/organizations/:id': 'platform',
  'PATCH /api/admin/queue/:id/extraction': 'platform',
  'PATCH /api/admin/users/:id': 'platform',
  'PATCH /api/auth/me': 'signed-in',
  'PATCH /api/categories/:id': 'manager',
  'PATCH /api/ingredients/:id': 'staff',
  'PATCH /api/invoices/:id': 'staff',
  'PATCH /api/locations/:id': 'admin',
  'PATCH /api/menu-items/:id': 'staff',
  'PATCH /api/menus/:id': 'manager',
  'PATCH /api/organizations/current': 'admin',
  'PATCH /api/purchasing/drafts/:id': 'staff',
  'PATCH /api/recipes/:id': 'staff',
  'PATCH /api/recipes/:id/components/:componentId': 'staff',
  'PATCH /api/unit-conversions/:id': 'manager',
  'PATCH /api/users/:id': 'manager',
  'PATCH /api/vendor-products/:id': 'manager',
  'PATCH /api/vendors/:id': 'manager',
  'POST /api/admin/queue/:id/map': 'platform',
  'POST /api/admin/queue/:id/retry': 'platform',
  'POST /api/admin/users/:id/password-reset': 'platform',
  'POST /api/auth/change-password': 'signed-in',
  'POST /api/auth/forgot-password': 'public',
  'POST /api/auth/login': 'public',
  'POST /api/auth/logout': 'signed-in',
  'POST /api/auth/register': 'public',
  'POST /api/auth/reset-password': 'public',
  'POST /api/billing/checkout': 'owner',
  'POST /api/billing/portal': 'owner',
  'POST /api/billing/webhook': 'public',
  'POST /api/categories': 'staff',
  'POST /api/documents': 'staff',
  'POST /api/documents/:id/confirm': 'staff',
  'POST /api/documents/:id/check': 'staff',
  'GET /api/documents/:id/file-units': 'staff',
  'POST /api/documents/:id/file-units': 'manager',
  'POST /api/documents/:id/map': 'staff',
  'POST /api/documents/:id/retry': 'staff',
  'POST /api/documents/confirm-many': 'staff',
  'POST /api/documents/ingredient-aliases': 'manager',
  'POST /api/documents/ingredient-aliases/:id': 'manager',
  'POST /api/documents/menu-item-aliases': 'manager',
  'POST /api/documents/menu-item-aliases/:id': 'manager',
  'POST /api/ingredients': 'staff',
  'POST /api/inventory/transactions': 'staff',
  'POST /api/invitations': 'manager',
  'POST /api/invitations/:id/resend': 'manager',
  'POST /api/invitations/:token/accept': 'public',
  'POST /api/invoices': 'staff',
  'POST /api/locations': 'admin',
  'POST /api/menu-items': 'staff',
  'POST /api/menus': 'manager',
  'POST /api/production': 'staff',
  'POST /api/purchasing/drafts': 'staff',
  'POST /api/purchasing/drafts/:id/approve': 'manager',
  'POST /api/recipes': 'staff',
  'POST /api/recipes/:id/components': 'staff',
  'POST /api/sales': 'staff',
  'POST /api/unit-conversions': 'manager',
  'POST /api/users/:id/password-reset': 'manager',
  'POST /api/users/:id/reactivate': 'manager',
  'POST /api/vendor-products': 'manager',
  'POST /api/vendors': 'manager',
  'POST /api/waste': 'staff',
}

const accessOf = (r: Route) =>
  r.platformOnly ? 'platform' : r.isPublic ? 'public' : (r.role ?? 'signed-in')

describe('Every endpoint is closed to whoever may not use it (e2e)', () => {
  let app: INestApplication
  let http: ReturnType<INestApplication['getHttpServer']>
  let prisma: PrismaService
  let routes: Route[]
  const cookies: Partial<Record<Role, string>> = {}
  const made: string[] = []

  const signIn = async (email: string, password: string) => {
    const res = await request(http).post('/api/auth/login').send({ email, password }).expect(200)
    const raw = res.headers['set-cookie'] as unknown as string[]
    return raw.map((c) => c.split(';')[0]).join('; ')
  }

  const call = (r: Route, cookie?: string) => {
    const req = request(http)[r.method](r.url)
    if (cookie) req.set('Cookie', cookie)
    return r.method === 'get' || r.method === 'delete' ? req : req.send({ accessProbe: true })
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication({ rawBody: true })
    configureApp(app)
    await app.init()
    http = app.getHttpServer()
    prisma = app.get(PrismaService)
    routes = routesOf(app)

    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const password = 'Access_probe1'
    const hashedPassword = await argon2.hash(password)
    const stamp = Date.now()
    for (const role of ['viewer', 'admin'] as const) {
      const user = await prisma.client.user.create({
        data: {
          organizationId: org.id,
          email: `access.${role}.${stamp}@test.nexus`,
          fullName: `Access ${role}`,
          role,
          hashedPassword,
        },
      })
      made.push(user.id)
      cookies[role] = await signIn(user.email, password)
    }
    cookies.staff = await signIn('ken@goldenfork.com', 'Nexus_dev1')
    cookies.manager = await signIn('maria@goldenfork.com', 'Nexus_dev1')
    cookies.owner = await signIn('owner@goldenfork.com', 'Nexus_dev1')
  })

  afterAll(async () => {
    await prisma.client.user.deleteMany({ where: { id: { in: made } } })
    await app.close()
  })

  test('the routes are read from the application itself', () => {
    expect(routes.length).toBeGreaterThan(100)
    const names = routes.map(label)
    expect(names).toContain('GET /api/vendors')
    expect(names).toContain('POST /api/billing/checkout')
    expect(names).toContain('GET /api/admin/queue')
    expect(new Set(names).size).toBe(names.length)
  })

  test('every endpoint is open to exactly the access written down for it', () => {
    const found = Object.fromEntries(
      [...routes]
        .sort((a, b) => label(a).localeCompare(label(b)))
        .map((r) => [label(r), accessOf(r)]),
    )
    expect(found).toEqual(ACCESS)
  })

  test('every endpoint that is not public refuses a request with no session', async () => {
    const open: string[] = []
    for (const r of routes.filter((r) => !r.isPublic)) {
      const res = await call(r)
      if (res.status !== 401 || res.body?.error?.code !== 'NOT_AUTHENTICATED') {
        open.push(`${label(r)} → ${res.status} ${res.body?.error?.code ?? ''}`)
      }
    }
    expect(open).toEqual([])
  })

  test('every endpoint with a role refuses the role just below it', async () => {
    const guarded = routes.filter((r) => r.role && r.role !== 'viewer')
    expect(guarded.length).toBeGreaterThan(50)
    const open: string[] = []
    for (const r of guarded) {
      const below = ROLE_ORDER[ROLE_ORDER.indexOf(r.role!) - 1]
      const res = await call(r, cookies[below])
      if (res.status !== 403 || res.body?.error?.code !== 'ROLE_TOO_LOW') {
        open.push(`${label(r)} as ${below} → ${res.status} ${res.body?.error?.code ?? ''}`)
      }
    }
    expect(open).toEqual([])
  })

  test('every endpoint with a role lets that role past the role check', async () => {
    const shut: string[] = []
    for (const r of routes.filter((r) => r.role)) {
      const res = await call(r, cookies[r.role!])
      if (res.body?.error?.code === 'ROLE_TOO_LOW') shut.push(`${label(r)} as ${r.role}`)
    }
    expect(shut).toEqual([])
  })

  test('every platform endpoint is hidden from the owner of an organization', async () => {
    const platform = routes.filter((r) => r.platformOnly)
    expect(platform.length).toBeGreaterThan(5)
    const seen: string[] = []
    for (const r of platform) {
      const res = await call(r, cookies.owner)
      if (res.status !== 404 || res.body?.error?.code !== 'NOT_FOUND') {
        seen.push(`${label(r)} → ${res.status} ${res.body?.error?.code ?? ''}`)
      }
    }
    expect(seen).toEqual([])
  })
})
