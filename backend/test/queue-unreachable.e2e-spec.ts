import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { ConfigService } from '@nestjs/config'
import { configWith } from './config'
import { configureApp } from '../src/app-setup'
import { DocumentsQueue } from '../src/modules/documents/documents.queue'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Uploads while the queue is unreachable (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(configWith({ REDIS_URL: 'redis://127.0.0.1:1' }))
      .compile()
    app = moduleRef.createNestApplication({ rawBody: true })
    configureApp(app)
    await app.init()
    prisma = app.get(PrismaService)
  })

  afterAll(async () => {
    await app.close()
  })

  test('an upload answers that the queue is out of reach instead of waiting for it', async () => {
    const http = app.getHttpServer()
    const login = await request(http)
      .post('/api/auth/login')
      .send({ email: 'owner@goldenfork.com', password: 'Nexus_dev1' })
      .expect(200)
    const raw = login.headers['set-cookie']
    const cookie = (Array.isArray(raw) ? raw : [raw]).map((c) => c.split(';')[0]).join('; ')
    const location = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })

    const started = Date.now()
    const res = await request(http)
      .post('/api/documents')
      .set('Cookie', cookie)
      .set('X-Location-Id', location.id)
      .field('type', 'invoice')
      .attach('file', Buffer.from('{"kind":"invoice","items":[]}'), {
        filename: 'unreachable.json',
        contentType: 'application/json',
      })
    try {
      expect(res.status).toBe(503)
      expect(Date.now() - started).toBeLessThan(10_000)
      const doc = await prisma.client.document.findFirstOrThrow({
        where: { fileName: 'unreachable.json' },
        orderBy: { createdAt: 'desc' },
      })
      expect(doc.status).toBe('failed')
    } finally {
      await prisma.client.document.deleteMany({ where: { fileName: 'unreachable.json' } })
    }
  }, 20_000)

  test('the administration panel says the queue cannot be reached instead of waiting for it', async () => {
    const http = app.getHttpServer()
    const login = await request(http)
      .post('/api/auth/login')
      .send({ email: 'platform@nexus.app', password: 'Nexus_dev1' })
      .expect(200)
    const raw = login.headers['set-cookie']
    const cookie = (Array.isArray(raw) ? raw : [raw]).map((c) => c.split(';')[0]).join('; ')

    const started = Date.now()
    const state = await request(http)
      .get('/api/admin/queue/state')
      .set('Cookie', cookie)
      .expect(200)
    expect(state.body).toEqual({ reachable: false, waiting: 0, active: 0, delayed: 0, failed: 0 })
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(await app.get(DocumentsQueue).jobInfo('1')).toBeNull()
  }, 20_000)
})
