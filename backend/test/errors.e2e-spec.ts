import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app-setup'
import { PrismaService } from '../src/prisma/prisma.service'
import { VendorsService } from '../src/modules/vendors/vendors.service'

jest.setTimeout(60000)

type Envelope = {
  error: { code: string; message: string; details?: { field: string; message: string }[] }
}

describe('Every refusal answers in one envelope with a code (e2e)', () => {
  let app: INestApplication
  let http: ReturnType<INestApplication['getHttpServer']>
  let prisma: PrismaService
  let owner = ''
  let chef = ''

  const signIn = async (email: string) => {
    const res = await request(http)
      .post('/api/auth/login')
      .send({ email, password: 'Nexus_dev1' })
      .expect(200)
    const raw = res.headers['set-cookie'] as unknown as string[]
    return raw.map((c) => c.split(';')[0]).join('; ')
  }

  const envelope = (body: unknown) => {
    const e = body as Envelope
    expect(Object.keys(e)).toEqual(['error'])
    expect(typeof e.error.code).toBe('string')
    expect(e.error.code).toMatch(/^[A-Z][A-Z0-9_]+$/)
    expect(typeof e.error.message).toBe('string')
    return e.error
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    configureApp(app)
    await app.init()
    http = app.getHttpServer()
    prisma = app.get(PrismaService)
    owner = await signIn('owner@goldenfork.com')
    chef = await signIn('ken@goldenfork.com')
  })

  afterAll(async () => {
    await app.close()
  })

  test('a body the DTO refuses lists each field, a nested one by its path', async () => {
    const res = await request(http)
      .post('/api/invoices')
      .set('Cookie', owner)
      .send({ invoiceDate: 'soon', items: [{ description: 'Butter', quantity: 'many' }] })
      .expect(400)
    const error = envelope(res.body)
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.message).toBe('Validation failed')
    const fields = (error.details ?? []).map((d) => d.field)
    expect(fields).toContain('invoiceDate')
    expect(fields).toContain('items.0.quantity')
    for (const d of error.details ?? []) expect(d.message.startsWith(d.field)).toBe(true)
  })

  test('a query the DTO refuses names the field too', async () => {
    const res = await request(http).get('/api/waste?limit=0').set('Cookie', owner).expect(400)
    const error = envelope(res.body)
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.details).toEqual([{ field: 'limit', message: 'limit must not be less than 1' }])
  })

  test('a field nobody asked for is refused by name', async () => {
    const res = await request(http)
      .post('/api/vendors')
      .set('Cookie', owner)
      .send({ name: 'Probe', colour: 'red' })
      .expect(400)
    expect(envelope(res.body).details).toEqual([
      { field: 'colour', message: 'property colour should not exist' },
    ])
  })

  test('a record that is not there answers its own code', async () => {
    const res = await request(http)
      .get('/api/ingredients/no-such-ingredient/price-history')
      .set('Cookie', owner)
      .expect(404)
    expect(envelope(res.body)).toEqual({
      code: 'INGREDIENT_NOT_FOUND',
      message: 'Ingredient not found',
    })
  })

  test('a decision already taken answers a conflict with its own code', async () => {
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const location = await prisma.client.location.findFirstOrThrow({
      where: { organizationId: org.id, name: 'Golden Fork — Downtown' },
    })
    const draft = await prisma.client.purchaseDraft.create({
      data: {
        organizationId: org.id,
        locationId: location.id,
        days: 28,
        horizon: 7,
        status: 'approved',
      },
    })
    try {
      const res = await request(http)
        .post(`/api/purchasing/drafts/${draft.id}/approve`)
        .set('Cookie', owner)
        .set('X-Location-Id', location.id)
        .expect(409)
      expect(envelope(res.body).code).toBe('DRAFT_ALREADY_APPROVED')
    } finally {
      await prisma.client.purchaseDraft.delete({ where: { id: draft.id } })
    }
  })

  test('nobody signed in, a role too low and a page nobody serves each have a code', async () => {
    const anonymous = await request(http).get('/api/vendors').expect(401)
    expect(envelope(anonymous.body).code).toBe('NOT_AUTHENTICATED')

    const low = await request(http)
      .post('/api/vendors')
      .set('Cookie', chef)
      .send({ name: 'Probe Chef Vendor' })
      .expect(403)
    expect(envelope(low.body).code).toBe('ROLE_TOO_LOW')

    const nowhere = await request(http).get('/api/nowhere').set('Cookie', owner).expect(404)
    expect(envelope(nowhere.body).code).toBe('NOT_FOUND')

    const hidden = await request(http).get('/api/admin/queue').set('Cookie', owner).expect(404)
    expect(envelope(hidden.body).code).toBe('NOT_FOUND')
  })

  test('a body that is not JSON, not an object or too large is refused with a code', async () => {
    const broken = await request(http)
      .post('/api/vendors')
      .set('Cookie', owner)
      .set('Content-Type', 'application/json')
      .send('{"name": ')
      .expect(400)
    expect(envelope(broken.body).code).toBe('BAD_REQUEST')

    const list = await request(http)
      .post('/api/vendors')
      .set('Cookie', owner)
      .send([{ name: 'Probe' }])
      .expect(400)
    expect(envelope(list.body).code).toBe('REQUEST_BODY_NOT_OBJECT')

    const huge = await request(http)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.nexus', password: 'x'.repeat(2_000_000) })
      .expect(413)
    expect(envelope(huge.body).code).toBe('PAYLOAD_TOO_LARGE')
  })

  test('what the database itself refuses is told without the database', async () => {
    const res = await request(http)
      .post('/api/vendors')
      .set('Cookie', owner)
      .send({ name: 'Probe \u0000 Nul' })
    const error = envelope(res.body)
    expect(res.status).toBe(400)
    expect(error.code).toMatch(/TEXT_UNSUPPORTED_CHARACTER|VALIDATION_ERROR/)
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|invocation|postgres|22021/i)
  })

  describe('an error nobody expected', () => {
    let broken: INestApplication

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(VendorsService)
        .useValue({
          list: () => {
            throw new Error('boom in /srv/nexus/vendors.service.ts:42 with password=hunter2')
          },
        })
        .compile()
      broken = moduleRef.createNestApplication()
      configureApp(broken)
      await broken.init()
    })

    afterAll(async () => {
      await broken.close()
    })

    test('is a 500 with a code and a plain sentence, and nothing of the error leaks', async () => {
      const cookie = (
        (
          await request(broken.getHttpServer())
            .post('/api/auth/login')
            .send({ email: 'owner@goldenfork.com', password: 'Nexus_dev1' })
            .expect(200)
        ).headers['set-cookie'] as unknown as string[]
      )
        .map((c) => c.split(';')[0])
        .join('; ')
      const res = await request(broken.getHttpServer())
        .get('/api/vendors')
        .set('Cookie', cookie)
        .expect(500)
      expect(envelope(res.body)).toEqual({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Something went wrong on our side; try again in a moment',
      })
      expect(JSON.stringify(res.body)).not.toMatch(/boom|srv|hunter2|stack|\.ts:/)
    })
  })
})
