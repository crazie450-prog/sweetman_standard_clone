import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app-setup'
import { PrismaService } from '../src/prisma/prisma.service'

jest.setTimeout(60000)

describe('A document refused at the edges says why (e2e)', () => {
  let app: INestApplication
  let http: ReturnType<INestApplication['getHttpServer']>
  let prisma: PrismaService
  let owner = ''
  let organizationId = ''
  let locationId = ''
  const made: string[] = []

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication({ rawBody: true })
    configureApp(app)
    await app.init()
    http = app.getHttpServer()
    prisma = app.get(PrismaService)
    const res = await request(http)
      .post('/api/auth/login')
      .send({ email: 'owner@goldenfork.com', password: 'Nexus_dev1' })
      .expect(200)
    owner = (res.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ')
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    organizationId = org.id
    locationId = (
      await prisma.client.location.findFirstOrThrow({
        where: { organizationId, name: 'Golden Fork — Downtown' },
      })
    ).id
  })

  afterAll(async () => {
    await prisma.client.document.deleteMany({ where: { id: { in: made } } })
    await app.close()
  })

  const document = async (status: 'queued' | 'requires_review', type = 'invoice' as const) => {
    const stamp = `${Date.now()}-${made.length}`
    const doc = await prisma.client.document.create({
      data: {
        organizationId,
        locationId,
        type,
        status,
        fileKey: `edges-${stamp}.json`,
        fileName: `edges-${stamp}.json`,
        mimeType: 'application/json',
        size: 2,
      },
    })
    made.push(doc.id)
    return doc.id
  }

  test('a file over the size limit is refused before it is read whole', async () => {
    const before = await prisma.client.document.count({ where: { fileName: 'too-large.csv' } })
    const res = await request(http)
      .post('/api/documents')
      .set('Cookie', owner)
      .set('X-Location-Id', locationId)
      .field('type', 'invoice')
      .attach('file', Buffer.alloc(15 * 1024 * 1024 + 1, 'a'), {
        filename: 'too-large.csv',
        contentType: 'text/csv',
      })
    expect(res.status).toBe(413)
    expect(res.body.error).toEqual({
      code: 'FILE_TOO_LARGE',
      message: 'File exceeds 15 MB',
    })
    expect(await prisma.client.document.count({ where: { fileName: 'too-large.csv' } })).toBe(
      before,
    )
  })

  test('an upload without a file is refused by name', async () => {
    const res = await request(http)
      .post('/api/documents')
      .set('Cookie', owner)
      .set('X-Location-Id', locationId)
      .field('type', 'invoice')
      .expect(400)
    expect(res.body.error.code).toBe('FILE_REQUIRED')
  })

  test('a document still being read cannot be confirmed', async () => {
    const id = await document('queued')
    const res = await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', owner)
      .set('X-Location-Id', locationId)
      .send({})
      .expect(409)
    expect(res.body.error.code).toBe('DOCUMENT_NOT_READY')
  })

  test('a document with nothing extracted and nothing typed has nothing to apply', async () => {
    const id = await document('requires_review')
    const res = await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', owner)
      .set('X-Location-Id', locationId)
      .send({})
      .expect(400)
    expect(res.body.error.code).toBe('EXTRACTION_MISSING')
    expect((await prisma.client.document.findUniqueOrThrow({ where: { id } })).status).toBe(
      'requires_review',
    )
  })
})
