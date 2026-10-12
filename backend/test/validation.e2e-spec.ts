import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getMetadataStorage } from 'class-validator'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app-setup'
import { PrismaService } from '../src/prisma/prisma.service'
import { label, routesOf, type Input, type Route } from './routes'

jest.setTimeout(180000)

const CHECKED_IN_PLACE: Record<string, string> = {
  'POST /api/documents/:id/confirm body payload': 'read by the payload schema',
  'POST /api/documents/:id/confirm body createMissing': 'refused unless a boolean',
  'POST /api/documents/:id/check body payload': 'read by the payload schema',
  'POST /api/documents/:id/check body createMissing': 'refused unless a boolean',
  'PATCH /api/admin/queue/:id/extraction body payload': 'read by the payload schema',
  'POST /api/documents body type': 'refused unless a document type',
  'GET /api/analytics/food-cost-variance query from': 'read as a reporting period',
  'GET /api/analytics/food-cost-variance query to': 'read as a reporting period',
  'GET /api/analytics/waste-breakdown query from': 'read as a reporting period',
  'GET /api/analytics/waste-breakdown query to': 'read as a reporting period',
  'GET /api/reports/usage query from': 'read as a reporting period',
  'GET /api/reports/usage query to': 'read as a reporting period',
  'GET /api/sales/daily query from': 'read as a reporting period',
  'GET /api/sales/daily query to': 'read as a reporting period',
  'GET /api/ingredients query includeArchived': 'true only when it says true',
  'GET /api/vendor-products query unmappedOnly': 'true only when it says true',
  'GET /api/vendor-products query vendorId': 'an id; a stranger matches nothing',
}

const WRONG_VALUE: Record<string, string> = {
  from: 'not-a-date',
  to: 'not-a-date',
}

const inputLabel = (r: Route, i: Input) => `${label(r)} ${i.source} ${i.key ?? '*'}`

const validated = (type: unknown) =>
  typeof type === 'function' &&
  type !== Object &&
  getMetadataStorage().getTargetValidationMetadatas(type, '', true, false).length > 0

describe('Every input is checked before it reaches a service (e2e)', () => {
  let app: INestApplication
  let http: ReturnType<INestApplication['getHttpServer']>
  let routes: Route[]
  let owner = ''
  let platform = ''
  let location = ''

  const signIn = async (email: string) => {
    const res = await request(http)
      .post('/api/auth/login')
      .send({ email, password: 'Nexus_dev1' })
      .expect(200)
    const raw = res.headers['set-cookie'] as unknown as string[]
    return raw.map((c) => c.split(';')[0]).join('; ')
  }

  const as = (r: Route, req: request.Test) => {
    if (r.isPublic) return req
    return req.set('Cookie', r.platformOnly ? platform : owner).set('X-Location-Id', location)
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication({ rawBody: true })
    configureApp(app)
    await app.init()
    http = app.getHttpServer()
    routes = routesOf(app)
    owner = await signIn('owner@goldenfork.com')
    platform = await signIn('platform@nexus.app')
    const prisma = app.get(PrismaService)
    const golden = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    location = (
      await prisma.client.location.findFirstOrThrow({ where: { organizationId: golden.id } })
    ).id
  })

  afterAll(async () => {
    await app.close()
  })

  test('a whole body or query is a class the validator reads, and anything else is checked in place', () => {
    const unchecked: string[] = []
    const stale = new Set(Object.keys(CHECKED_IN_PLACE))
    for (const r of routes) {
      for (const i of r.inputs) {
        const name = inputLabel(r, i)
        stale.delete(name)
        if (i.key === undefined ? !validated(i.type) : !(name in CHECKED_IN_PLACE)) {
          unchecked.push(name)
        }
      }
    }
    expect(unchecked).toEqual([])
    expect([...stale]).toEqual([])
  })

  test('every body class refuses a field nobody declared, by its name', async () => {
    const open: string[] = []
    for (const r of routes.filter((r) => r.inputs.some((i) => i.source === 'body' && !i.key))) {
      const res = await as(r, request(http)[r.method](r.url)).send({ validationProbe: 1 })
      const fields = (res.body?.error?.details ?? []).map((d: { field: string }) => d.field)
      if (res.status !== 400 || !fields.includes('validationProbe')) {
        open.push(`${label(r)} → ${res.status} ${res.body?.error?.code ?? ''}`)
      }
    }
    expect(open).toEqual([])
  })

  test('every query class refuses a parameter nobody declared, by its name', async () => {
    const open: string[] = []
    for (const r of routes.filter((r) => r.inputs.some((i) => i.source === 'query' && !i.key))) {
      const res = await as(r, request(http).get(`${r.url}?validationProbe=1`))
      const fields = (res.body?.error?.details ?? []).map((d: { field: string }) => d.field)
      if (res.status !== 400 || !fields.includes('validationProbe')) {
        open.push(`${label(r)} → ${res.status} ${res.body?.error?.code ?? ''}`)
      }
    }
    expect(open).toEqual([])
  })

  test('a query value checked in place is refused when it is wrong, not thrown', async () => {
    const answered: string[] = []
    for (const r of routes) {
      for (const i of r.inputs.filter((i) => i.source === 'query' && i.key! in WRONG_VALUE)) {
        const res = await as(r, request(http).get(`${r.url}?${i.key}=${WRONG_VALUE[i.key!]}`))
        if (res.status !== 400) answered.push(`${inputLabel(r, i)} → ${res.status}`)
      }
    }
    expect(answered).toEqual([])
  })

  test('a category kind nobody offers is refused instead of listing every kind', async () => {
    const res = await request(http)
      .get('/api/categories?kind=nonsense')
      .set('Cookie', owner)
      .expect(400)
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual(['kind'])
    const menu = await request(http).get('/api/categories?kind=menu').set('Cookie', owner)
    expect(menu.status).toBe(200)
    expect((menu.body as { kind: string }[]).every((c) => c.kind === 'menu')).toBe(true)
  })
})
