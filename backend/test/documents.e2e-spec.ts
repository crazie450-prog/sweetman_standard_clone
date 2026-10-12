import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { ConfigService } from '@nestjs/config'
import { AppModule } from '../src/app.module'
import type { AppConfig } from '../src/config/env.validation'
import { configureApp } from '../src/app-setup'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'
import { DocumentsQueue } from '../src/modules/documents/documents.queue'
import { recalcOrganizationWith } from '../src/costing/costing.service'
import { dayKey, endOfDay, startOfDay } from '../src/common/utils/calendar'
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

jest.setTimeout(40000)

const onDay = (key: string) => ({
  gte: startOfDay(key, 'America/New_York'),
  lte: endOfDay(key, 'America/New_York'),
})

describe('Document ingestion pipeline (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let storage: StorageService
  let http: ReturnType<INestApplication['getHttpServer']>
  let goldenForkCookie = ''
  let bellaCucinaCookie = ''
  let staffCookie = ''
  let platformCookie = ''
  let locationId = ''

  const login = async (email: string): Promise<string> => {
    const res = await request(http)
      .post('/api/auth/login')
      .send({ email, password: 'Nexus_dev1' })
      .expect(200)
    const raw = res.headers['set-cookie']
    const cookies = Array.isArray(raw) ? raw : [raw]
    return cookies.map((c) => c.split(';')[0]).join('; ')
  }

  const waitForStatus = async (id: string, cookie: string, target: string): Promise<string> => {
    for (let i = 0; i < 40; i++) {
      const res = await request(http).get(`/api/documents/${id}`).set('Cookie', cookie).expect(200)
      const status = (res.body as { status: string }).status
      if (status === target || status === 'failed') return status
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error(`document ${id} never reached ${target}`)
  }

  const upload = async (
    type: string,
    fileName: string,
    contentType: string,
    body: Buffer,
    at?: string,
  ) => {
    const res = await request(http)
      .post('/api/documents')
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', at ?? locationId)
      .field('type', type)
      .attach('file', body, { filename: fileName, contentType })
      .expect(201)
    return (res.body as { id: string }).id
  }

  const snapshotIngredient = async (ingredientId: string) => ({
    row: await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ingredientId } }),
    stock: await prisma.client.ingredientLocationStock.findMany({ where: { ingredientId } }),
    settings: await prisma.client.ingredientLocationSettings.findMany({ where: { ingredientId } }),
    history: (
      await prisma.client.ingredientPriceHistory.findMany({
        where: { ingredientId },
        select: { id: true },
      })
    ).map((record) => record.id),
  })

  const restoreIngredient = async (snap: Awaited<ReturnType<typeof snapshotIngredient>>) => {
    const ingredientId = snap.row.id
    await prisma.client.ingredient.update({
      where: { id: ingredientId },
      data: { onHand: snap.row.onHand, costPerUnit: snap.row.costPerUnit },
    })
    for (const held of snap.stock) {
      await prisma.client.ingredientLocationStock.update({
        where: {
          ingredientId_locationId: { ingredientId, locationId: held.locationId },
        },
        data: { onHand: held.onHand },
      })
    }
    for (const settings of snap.settings) {
      await prisma.client.ingredientLocationSettings.update({
        where: {
          ingredientId_locationId: { ingredientId, locationId: settings.locationId },
        },
        data: { costPerUnit: settings.costPerUnit },
      })
    }
    await prisma.client.ingredientLocationSettings.deleteMany({
      where: {
        ingredientId,
        locationId: { notIn: snap.settings.map((settings) => settings.locationId) },
      },
    })
    await prisma.client.ingredientPriceHistory.deleteMany({
      where: { ingredientId, id: { notIn: snap.history } },
    })
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    configureApp(app)
    await app.init()
    http = app.getHttpServer()
    prisma = app.get(PrismaService)
    storage = app.get(StorageService)
    goldenForkCookie = await login('owner@goldenfork.com')
    bellaCucinaCookie = await login('owner@bellacucina.com')
    staffCookie = await login('ken@goldenfork.com')
    platformCookie = await login('platform@nexus.app')
    const location = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    locationId = location.id
  })

  afterAll(async () => {
    await app.close()
  })

  test('an invoice is queued, extracted, then applied on confirm — prices and stock move', async () => {
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'All-Purpose Flour' },
    })
    const beforeOnHand = Number(ing.onHand)
    const beforeCost = Number(ing.costPerUnit)
    const beforeStock = await prisma.client.ingredientLocationStock.findUnique({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })
    const beforeSettings = await prisma.client.ingredientLocationSettings.findUnique({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })

    const body = Buffer.from(
      JSON.stringify({
        kind: 'invoice',
        number: 'E2E-1',
        items: [{ rawName: 'All-Purpose Flour', quantity: 5, unit: ing.unit, unitPrice: 9.99 }],
      }),
    )
    const id = await upload('invoice', 'inv.json', 'application/json', body)
    expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')

    const detail = await request(http)
      .get(`/api/documents/${id}`)
      .set('Cookie', goldenForkCookie)
      .expect(200)
    expect((detail.body as { extraction: { kind: string } }).extraction.kind).toBe('invoice')

    await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)

    const after = await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ing.id } })
    expect(Number(after.onHand)).toBeCloseTo(beforeOnHand + 5, 3)
    expect(Number(after.costPerUnit)).toBeCloseTo(beforeCost, 2)
    const pricedHere = await prisma.client.ingredientLocationSettings.findUniqueOrThrow({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })
    expect(Number(pricedHere.costPerUnit)).toBeCloseTo(9.99, 2)
    const tx = await prisma.client.inventoryTransaction.findFirst({
      where: { ingredientId: ing.id, type: 'RECEIVE', notes: 'Invoice E2E-1' },
    })
    expect(tx).not.toBeNull()

    // A confirmed document does not apply twice.
    await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(409)

    // Restore so downstream suites see the seeded flour cost.
    await prisma.client.inventoryTransaction.deleteMany({ where: { notes: 'Invoice E2E-1' } })
    await prisma.client.invoice.deleteMany({ where: { number: 'E2E-1' } })
    await prisma.client.ingredientPriceHistory.deleteMany({
      where: { ingredientId: ing.id, source: 'receipt', costPerUnit: 9.99 },
    })
    await prisma.client.ingredient.update({
      where: { id: ing.id },
      data: { onHand: beforeOnHand, costPerUnit: beforeCost },
    })
    if (beforeSettings) {
      await prisma.client.ingredientLocationSettings.update({
        where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
        data: { costPerUnit: beforeSettings.costPerUnit },
      })
    } else {
      await prisma.client.ingredientLocationSettings.deleteMany({
        where: { ingredientId: ing.id, locationId },
      })
    }
    if (beforeStock) {
      await prisma.client.ingredientLocationStock.update({
        where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
        data: { onHand: beforeStock.onHand },
      })
    } else {
      await prisma.client.ingredientLocationStock.deleteMany({
        where: { ingredientId: ing.id, locationId },
      })
    }
    await prisma.client.document.delete({ where: { id } })
  })

  test('a price below a cent per unit is kept to four places, not rounded away', async () => {
    const stamp = Date.now()
    const ingredient = (
      await request(http)
        .post('/api/ingredients')
        .set('Cookie', goldenForkCookie)
        .send({ name: `Probe Tiny Price ${stamp}`, unit: 'g', costPerUnit: 0.01 })
        .expect(201)
    ).body.id as string
    const number = `TINY-${stamp}`
    const body = Buffer.from(
      JSON.stringify({
        kind: 'invoice',
        number,
        items: [
          {
            rawName: `Probe Tiny Price ${stamp}`,
            quantity: 1000,
            unit: 'g',
            unitPrice: 0.003,
            lineTotal: 3,
          },
        ],
      }),
    )
    const id = await upload('invoice', 'tiny.json', 'application/json', body)
    try {
      expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')
      await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      const here = await prisma.client.ingredientLocationSettings.findUnique({
        where: { ingredientId_locationId: { ingredientId: ingredient, locationId } },
      })
      expect(here?.costPerUnit?.toNumber()).toBe(0.003)
      const history = await prisma.client.ingredientPriceHistory.findMany({
        where: { ingredientId: ingredient, source: 'receipt' },
      })
      expect(history.map((h) => h.costPerUnit.toNumber())).toEqual([0.003])
    } finally {
      await prisma.client.invoice.deleteMany({ where: { number } })
      await prisma.client.inventoryTransaction.deleteMany({ where: { ingredientId: ingredient } })
      await prisma.client.ingredientPriceHistory.deleteMany({ where: { ingredientId: ingredient } })
      await prisma.client.ingredientLocationSettings.deleteMany({
        where: { ingredientId: ingredient },
      })
      await prisma.client.ingredientLocationStock.deleteMany({
        where: { ingredientId: ingredient },
      })
      await prisma.client.document.deleteMany({ where: { id } })
      await prisma.client.ingredient.deleteMany({ where: { id: ingredient } })
    }
  })

  test('a sales spreadsheet flows through review and records a sale on confirm', async () => {
    const csv = Buffer.from('Menu Item,Quantity,Unit Price\nSteak Frites,2,34\n')
    const id = await upload('sales', 'sales.csv', 'text/csv', csv)
    expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')

    const salesBefore = await prisma.client.sale.count({
      where: { organization: { slug: 'golden-fork' } },
    })
    const res = await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)
    expect((res.body as { applied: number }).applied).toBe(1)

    const salesAfter = await prisma.client.sale.count({
      where: { organization: { slug: 'golden-fork' } },
    })
    expect(salesAfter).toBe(salesBefore + 1)

    const sale = await prisma.client.sale.findFirst({
      where: { organization: { slug: 'golden-fork' } },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    })
    const dish = await prisma.client.menuItem.findUniqueOrThrow({
      where: { id: sale!.items[0].menuItemId },
      include: { recipes: { include: { recipe: true } } },
    })
    const standard = dish.recipes.reduce(
      (sum, r) => sum + (r.recipe.totalCost.toNumber() / r.recipe.portions) * r.portions.toNumber(),
      0,
    )
    expect(standard).toBeGreaterThan(0)
    expect(sale!.items[0].unitCost.toNumber()).toBe(Math.round(standard * 100) / 100)
    await prisma.client.sale.delete({ where: { id: sale!.id } })
    await prisma.client.document.delete({ where: { id } })
  })

  test('a sales line is placed on the dish of the location the file came from', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const elsewhere = await prisma.client.location.findFirstOrThrow({
      where: { organizationId: org.id, isActive: true, id: { not: locationId } },
    })
    const NAME = 'Probe Two-Site Dish'
    const here = await prisma.client.menuItem.create({
      data: { organizationId: org.id, locationId, name: NAME, price: 21 },
    })
    const there = await prisma.client.menuItem.create({
      data: { organizationId: org.id, locationId: elsewhere.id, name: NAME, price: 26 },
    })

    const body = Buffer.from(
      JSON.stringify({
        kind: 'sales',
        items: [{ menuItemName: NAME, quantity: 3, unitPrice: 21 }],
      }),
    )
    const id = await upload('sales', 'two-site.json', 'application/json', body)
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)

    const placed = await prisma.client.saleItem.findMany({
      where: { menuItemId: { in: [here.id, there.id] } },
    })
    expect(placed).toHaveLength(1)
    expect(placed[0].menuItemId).toBe(here.id)

    await prisma.client.sale.delete({ where: { id: placed[0].saleId } })
    await prisma.client.document.delete({ where: { id } })
    await prisma.client.menuItem.deleteMany({ where: { id: { in: [here.id, there.id] } } })
  })

  test('retrying a document that has not failed is refused', async () => {
    const body = Buffer.from(JSON.stringify({ kind: 'menu', name: 'E2E Special', price: 20 }))
    const id = await upload('menu', 'menu.json', 'application/json', body)
    expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')
    await request(http)
      .post(`/api/documents/${id}/retry`)
      .set('Cookie', goldenForkCookie)
      .expect(409)
    await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)
    await prisma.client.menuItem.deleteMany({ where: { name: 'E2E Special' } })
    await prisma.client.document.delete({ where: { id } })
  })

  test('a file holding several documents is split into independent review items', async () => {
    const body = Buffer.from(
      JSON.stringify([
        {
          kind: 'invoice',
          number: 'SPLIT-A',
          items: [{ rawName: 'Split Probe A', quantity: 1, unit: 'kg', unitPrice: 2 }],
        },
        {
          kind: 'invoice',
          number: 'SPLIT-B',
          items: [{ rawName: 'Split Probe B', quantity: 1, unit: 'kg', unitPrice: 3 }],
        },
      ]),
    )
    const id = await upload('invoice', 'batch.json', 'application/json', body)
    expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')

    const original = await prisma.client.document.findUniqueOrThrow({ where: { id } })
    const siblings = await prisma.client.document.findMany({
      where: { fileKey: original.fileKey },
      include: { extractions: true },
      orderBy: { fileName: 'asc' },
    })
    expect(siblings).toHaveLength(2)
    for (const d of siblings) {
      expect(d.status).toBe('requires_review')
      expect(d.extractions).toHaveLength(1)
      expect((d.extractions[0].payload as { kind: string }).kind).toBe('invoice')
    }
    expect(siblings.map((d) => d.fileName)).toEqual(['batch.json (1/2)', 'batch.json (2/2)'])

    await prisma.client.document.deleteMany({ where: { fileKey: original.fileKey } })
  })

  test('an invoice line is received in the unit the ingredient is counted in', async () => {
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
    })
    expect(ing.unit).toBe('kg')
    const beforeOnHand = Number(ing.onHand)
    const beforeCost = Number(ing.costPerUnit)
    const beforeSettings = await prisma.client.ingredientLocationSettings.findUnique({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })

    // Two kilograms written as two thousand grams, at a cent a gram.
    const body = Buffer.from(
      JSON.stringify({
        kind: 'invoice',
        number: 'E2E-UNIT',
        items: [{ rawName: 'Unsalted Butter', quantity: 2000, unit: 'g', unitPrice: 0.01 }],
      }),
    )
    const id = await upload('invoice', 'grams.json', 'application/json', body)
    expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')

    const confirmed = await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)
    expect(confirmed.body).toMatchObject({ applied: 1, unconverted: 0 })

    const after = await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ing.id } })
    // Two kilograms, not two thousand.
    expect(Number(after.onHand)).toBeCloseTo(beforeOnHand + 2, 3)
    expect(Number(after.costPerUnit)).toBeCloseTo(beforeCost, 2)
    // Ten dollars a kilogram, not a cent — at the location that received it.
    const pricedHere = await prisma.client.ingredientLocationSettings.findUniqueOrThrow({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })
    expect(Number(pricedHere.costPerUnit)).toBeCloseTo(10, 2)

    const movement = await prisma.client.inventoryTransaction.findFirstOrThrow({
      where: { ingredientId: ing.id, notes: 'Invoice E2E-UNIT' },
    })
    expect(Number(movement.quantity)).toBeCloseTo(2, 3)
    expect(movement.unit).toBe('kg')
    // The money the invoice states is unchanged by the conversion.
    expect(Number(movement.cost)).toBeCloseTo(20, 2)

    await prisma.client.inventoryTransaction.deleteMany({ where: { notes: 'Invoice E2E-UNIT' } })
    await prisma.client.invoice.deleteMany({ where: { number: 'E2E-UNIT' } })
    await prisma.client.ingredientPriceHistory.deleteMany({
      where: { ingredientId: ing.id, source: 'receipt', costPerUnit: 10 },
    })
    await prisma.client.ingredientLocationStock.update({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
      data: { onHand: { decrement: 2 } },
    })
    await prisma.client.ingredient.update({
      where: { id: ing.id },
      data: { onHand: beforeOnHand, costPerUnit: beforeCost },
    })
    if (beforeSettings) {
      await prisma.client.ingredientLocationSettings.update({
        where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
        data: { costPerUnit: beforeSettings.costPerUnit },
      })
    } else {
      await prisma.client.ingredientLocationSettings.deleteMany({
        where: { ingredientId: ing.id, locationId },
      })
    }
    await prisma.client.document.delete({ where: { id } })
  })

  test('a line in a unit nothing bridges is left alone rather than guessed at', async () => {
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
    })
    const beforeOnHand = Number(ing.onHand)
    const beforeCost = Number(ing.costPerUnit)

    const body = Buffer.from(
      JSON.stringify({
        kind: 'invoice',
        number: 'E2E-NOBRIDGE',
        items: [{ rawName: 'Unsalted Butter', quantity: 3, unit: 'ea', unitPrice: 4 }],
      }),
    )
    const id = await upload('invoice', 'each.json', 'application/json', body)
    expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')

    const confirmed = await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)
    expect(confirmed.body).toMatchObject({ applied: 0, unconverted: 1 })

    const after = await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ing.id } })
    expect(Number(after.onHand)).toBeCloseTo(beforeOnHand, 3)
    expect(Number(after.costPerUnit)).toBeCloseTo(beforeCost, 3)

    await prisma.client.invoice.deleteMany({ where: { number: 'E2E-NOBRIDGE' } })
    await prisma.client.document.delete({ where: { id } })
  })

  test('an invoice uploaded with no location is refused rather than stranded', async () => {
    const before = await prisma.client.document.count()
    const body = Buffer.from(JSON.stringify({ kind: 'invoice', number: 'NOWHERE-1', items: [] }))
    const res = await request(http)
      .post('/api/documents')
      .set('Cookie', goldenForkCookie)
      .field('type', 'invoice')
      .attach('file', body, { filename: 'nowhere.json', contentType: 'application/json' })
      .expect(400)
    expect((res.body as { error: { message: string } }).error.message).toMatch(/location/i)
    expect(await prisma.client.document.count()).toBe(before)
  })

  test('a document that has not been confirmed can be deleted, file and all', async () => {
    const body = Buffer.from(JSON.stringify({ kind: 'menu', name: 'Delete Probe', price: 5 }))
    const id = await upload('menu', 'delete-me.json', 'application/json', body)
    await waitForStatus(id, goldenForkCookie, 'requires_review')

    await request(http)
      .delete(`/api/documents/${id}`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(200)

    expect(await prisma.client.document.findUnique({ where: { id } })).toBeNull()
    expect(await prisma.client.extraction.count({ where: { documentId: id } })).toBe(0)
  })

  test('a chef deletes a document they uploaded by mistake, and a team member who reads may not', async () => {
    const body = Buffer.from(JSON.stringify({ kind: 'menu', name: 'Chef Delete Probe', price: 5 }))
    const id = await upload('menu', 'chef-delete.json', 'application/json', body)
    await waitForStatus(id, goldenForkCookie, 'requires_review')

    const ken = await prisma.client.user.findUniqueOrThrow({
      where: { email: 'ken@goldenfork.com' },
    })
    await prisma.client.user.update({ where: { id: ken.id }, data: { role: 'viewer' } })
    try {
      const viewer = await login('ken@goldenfork.com')
      await request(http)
        .delete(`/api/documents/${id}`)
        .set('Cookie', viewer)
        .set('X-Location-Id', locationId)
        .expect(403)
    } finally {
      await prisma.client.user.update({ where: { id: ken.id }, data: { role: ken.role } })
    }
    expect(await prisma.client.document.findUnique({ where: { id } })).not.toBeNull()

    await request(http)
      .delete(`/api/documents/${id}`)
      .set('Cookie', await login('ken@goldenfork.com'))
      .set('X-Location-Id', locationId)
      .expect(200)
    expect(await prisma.client.document.findUnique({ where: { id } })).toBeNull()
  })

  test('a confirmed document is the record of what it moved, so it stays', async () => {
    const body = Buffer.from(JSON.stringify({ kind: 'menu', name: 'Kept Probe', price: 5 }))
    const id = await upload('menu', 'kept.json', 'application/json', body)
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)

    await request(http)
      .delete(`/api/documents/${id}`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(409)

    expect(await prisma.client.document.findUnique({ where: { id } })).not.toBeNull()
    await prisma.client.document.delete({ where: { id } })
    await prisma.client.menuItem.deleteMany({ where: { name: 'Kept Probe' } })
  })

  test('deleting one of two documents that share a file leaves the other readable', async () => {
    const body = Buffer.from(
      JSON.stringify([
        { kind: 'menu', name: 'Shared A', price: 4 },
        { kind: 'menu', name: 'Shared B', price: 6 },
      ]),
    )
    const first = await upload('menu', 'shared.json', 'application/json', body)
    await waitForStatus(first, goldenForkCookie, 'requires_review')
    const doc = await prisma.client.document.findUniqueOrThrow({ where: { id: first } })
    const sibling = await prisma.client.document.findFirstOrThrow({
      where: { fileKey: doc.fileKey, id: { not: first } },
    })

    await request(http)
      .delete(`/api/documents/${first}`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(200)

    const kept = await request(http)
      .get(`/api/documents/${sibling.id}`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(200)
    expect((kept.body as { extraction: unknown }).extraction).not.toBeNull()
    await expect(storage.get(doc.fileKey)).resolves.toBeInstanceOf(Buffer)

    await request(http)
      .delete(`/api/documents/${sibling.id}`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(200)
    await expect(storage.get(doc.fileKey)).rejects.toBeDefined()
  })

  test('an invoice spreadsheet is read, not stood in for', async () => {
    const csv = 'Item,Quantity,Unit,Unit Price\nBeef Tenderloin,2,kg,61.5\n'
    const id = await upload('invoice', 'invoice.csv', 'text/csv', Buffer.from(csv))
    await waitForStatus(id, goldenForkCookie, 'requires_review')

    const res = await request(http)
      .get(`/api/documents/${id}`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(200)
    const payload = (res.body as { extraction: { items: { rawName: string }[] } }).extraction
    expect(payload.items).toEqual([
      { rawName: 'Beef Tenderloin', quantity: 2, unit: 'kg', unitPrice: 61.5 },
    ])

    await prisma.client.document.delete({ where: { id } })
  })

  test('a file that cannot be read fails on its first attempt with a reason and may be retried', async () => {
    const id = await upload(
      'invoice',
      'broken.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      Buffer.from('this is not a Word document'),
    )
    const status = await waitForStatus(id, goldenForkCookie, 'failed')
    expect(status).toBe('failed')

    const res = await request(http)
      .get(`/api/documents/${id}`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(200)
    expect((res.body as { error: string }).error).toMatch(/Could not read broken\.docx/)
    const { jobId } = await prisma.client.document.findUniqueOrThrow({ where: { id } })
    expect((await app.get(DocumentsQueue).jobInfo(jobId!))?.attemptsMade).toBe(1)

    await request(http)
      .post(`/api/documents/${id}/retry`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)

    await waitForStatus(id, goldenForkCookie, 'failed')
    await prisma.client.document.delete({ where: { id } })
  })

  test('a format nothing can read is refused at the door', async () => {
    const res = await request(http)
      .post('/api/documents')
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .field('type', 'invoice')
      .attach('file', Buffer.from('legacy'), {
        filename: 'old.xls',
        contentType: 'application/vnd.ms-excel',
      })
      .expect(400)
    expect((res.body as { error: { message: string } }).error.message).toMatch(/XLSX/)
  })

  test('WEBP and AVIF images and Word 97 files are taken in and read', async () => {
    const pixel = sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
    const files = [
      {
        filename: 'menu.webp',
        contentType: 'image/webp',
        buffer: await pixel.clone().webp().toBuffer(),
      },
      {
        filename: 'invoice.avif',
        contentType: 'application/octet-stream',
        buffer: await pixel.clone().avif().toBuffer(),
      },
      {
        filename: 'sauce.doc',
        contentType: 'application/msword',
        buffer: readFileSync(join(__dirname, 'fixtures/brown-butter-sauce.doc')),
      },
    ]
    const ids: string[] = []
    for (const f of files) {
      const res = await request(http)
        .post('/api/documents')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .field('type', 'recipe')
        .attach('file', f.buffer, { filename: f.filename, contentType: f.contentType })
        .expect(201)
      ids.push((res.body as { id: string }).id)
    }
    expect(await waitForStatus(ids[0], goldenForkCookie, 'requires_review')).toBe('requires_review')
    expect(await waitForStatus(ids[1], goldenForkCookie, 'requires_review')).toBe('requires_review')
    expect(await waitForStatus(ids[2], goldenForkCookie, 'failed')).toBe('failed')
    const word = await prisma.client.document.findUniqueOrThrow({ where: { id: ids[2] } })
    expect(word.error).toMatch(/no extraction model is configured for this format/)
    await prisma.client.document.deleteMany({ where: { id: { in: ids } } })
  })

  test('confirming an invoice leaves the invoice behind, vendor, number and date', async () => {
    const number = `E2E-${Date.now()}`
    const body = Buffer.from(
      JSON.stringify({
        kind: 'invoice',
        vendorName: 'Prime Meats Co.',
        number,
        invoiceDate: '2026-08-10',
        items: [{ rawName: 'Beef Tenderloin', quantity: 1, unit: 'kg', unitPrice: 41 }],
      }),
    )
    const startedAt = new Date()
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Beef Tenderloin' },
    })
    const beforeOnHand = Number(ing.onHand)
    const beforeCost = Number(ing.costPerUnit)
    const beforeSettings = await prisma.client.ingredientLocationSettings.findUnique({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })
    const beforeStock = await prisma.client.ingredientLocationStock.findUniqueOrThrow({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })

    const id = await upload('invoice', 'vendor.json', 'application/json', body)
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)

    const invoice = await prisma.client.invoice.findFirstOrThrow({
      where: { number },
      include: { items: true, vendor: { select: { name: true } } },
    })
    expect(invoice.vendor?.name).toBe('Prime Meats Co.')
    expect(invoice.invoiceDate.toISOString().slice(0, 10)).toBe('2026-08-10')
    expect(invoice.documentKey).toBeTruthy()
    expect(Number(invoice.total)).toBeCloseTo(41, 2)
    expect(invoice.items).toHaveLength(1)
    expect(Number(invoice.items[0].lineTotal)).toBeCloseTo(41, 2)

    await prisma.client.invoice.delete({ where: { id: invoice.id } })
    await prisma.client.document.delete({ where: { id } })
    await prisma.client.inventoryTransaction.deleteMany({ where: { notes: `Invoice ${number}` } })
    await prisma.client.ingredientPriceHistory.deleteMany({
      where: { ingredientId: ing.id, recordedAt: { gte: startedAt } },
    })
    const where = { ingredientId_locationId: { ingredientId: ing.id, locationId } }
    if (beforeSettings) {
      await prisma.client.ingredientLocationSettings.update({
        where,
        data: { costPerUnit: beforeSettings.costPerUnit },
      })
    } else {
      await prisma.client.ingredientLocationSettings.deleteMany({
        where: { ingredientId: ing.id, locationId },
      })
    }
    await prisma.client.ingredientLocationStock.update({
      where,
      data: { onHand: beforeStock.onHand },
    })
    await prisma.client.ingredient.update({
      where: { id: ing.id },
      data: { onHand: beforeOnHand, costPerUnit: beforeCost },
    })
  })

  test('a line total the paper states is the money the line moved', async () => {
    const number = `E2E-TOTAL-${Date.now()}`
    const body = Buffer.from(
      JSON.stringify({
        kind: 'invoice',
        vendorName: 'Prime Meats Co.',
        number,
        invoiceDate: '2026-08-11',
        items: [
          { rawName: 'Beef Tenderloin', quantity: 4, unit: 'kg', unitPrice: 12, lineTotal: 44 },
        ],
      }),
    )
    const startedAt = new Date()
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Beef Tenderloin' },
    })
    const beforeOnHand = Number(ing.onHand)
    const beforeCost = Number(ing.costPerUnit)
    const beforeSettings = await prisma.client.ingredientLocationSettings.findUnique({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })
    const beforeStock = await prisma.client.ingredientLocationStock.findUniqueOrThrow({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })

    const id = await upload('invoice', 'discounted.json', 'application/json', body)
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)

    const invoice = await prisma.client.invoice.findFirstOrThrow({
      where: { number },
      include: { items: true },
    })
    expect(Number(invoice.items[0].lineTotal)).toBeCloseTo(44, 2)
    expect(Number(invoice.total)).toBeCloseTo(44, 2)

    const movement = await prisma.client.inventoryTransaction.findFirstOrThrow({
      where: { notes: `Invoice ${number}` },
    })
    expect(Number(movement.cost)).toBeCloseTo(44, 2)

    const here = await prisma.client.ingredientLocationSettings.findUniqueOrThrow({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })
    expect(Number(here.costPerUnit)).toBeCloseTo(11, 2)

    await prisma.client.invoice.delete({ where: { id: invoice.id } })
    await prisma.client.document.delete({ where: { id } })
    await prisma.client.inventoryTransaction.deleteMany({ where: { notes: `Invoice ${number}` } })
    await prisma.client.ingredientPriceHistory.deleteMany({
      where: { ingredientId: ing.id, recordedAt: { gte: startedAt } },
    })
    const where = { ingredientId_locationId: { ingredientId: ing.id, locationId } }
    if (beforeSettings) {
      await prisma.client.ingredientLocationSettings.update({
        where,
        data: { costPerUnit: beforeSettings.costPerUnit },
      })
    } else {
      await prisma.client.ingredientLocationSettings.deleteMany({
        where: { ingredientId: ing.id, locationId },
      })
    }
    await prisma.client.ingredientLocationStock.update({
      where,
      data: { onHand: beforeStock.onHand },
    })
    await prisma.client.ingredient.update({
      where: { id: ing.id },
      data: { onHand: beforeOnHand, costPerUnit: beforeCost },
    })
  })

  test('a line that costs nothing adds stock and leaves the price where it was', async () => {
    const number = `E2E-FREE-${Date.now()}`
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Beef Tenderloin' },
    })
    const beforeSettings = await prisma.client.ingredientLocationSettings.findUnique({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })
    const beforeStock = await prisma.client.ingredientLocationStock.findUniqueOrThrow({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })
    const beforeHistory = await prisma.client.ingredientPriceHistory.count({
      where: { ingredientId: ing.id },
    })

    const body = Buffer.from(
      JSON.stringify({
        kind: 'invoice',
        vendorName: 'Prime Meats Co.',
        number,
        items: [
          { rawName: 'Beef Tenderloin', quantity: 2, unit: 'kg', unitPrice: 0, lineTotal: 0 },
        ],
      }),
    )
    const id = await upload('invoice', 'free-sample.json', 'application/json', body)
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)

    const afterStock = await prisma.client.ingredientLocationStock.findUniqueOrThrow({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })
    expect(Number(afterStock.onHand)).toBeCloseTo(Number(beforeStock.onHand) + 2, 3)

    const afterSettings = await prisma.client.ingredientLocationSettings.findUnique({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })
    expect(Number(afterSettings?.costPerUnit ?? 0)).toBeCloseTo(
      Number(beforeSettings?.costPerUnit ?? 0),
      2,
    )
    expect(
      await prisma.client.ingredientPriceHistory.count({ where: { ingredientId: ing.id } }),
    ).toBe(beforeHistory)

    const invoice = await prisma.client.invoice.findFirstOrThrow({ where: { number } })
    await prisma.client.invoice.delete({ where: { id: invoice.id } })
    await prisma.client.document.delete({ where: { id } })
    await prisma.client.inventoryTransaction.deleteMany({ where: { notes: `Invoice ${number}` } })
    await prisma.client.ingredientLocationStock.update({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
      data: { onHand: beforeStock.onHand },
    })
    await prisma.client.ingredient.update({
      where: { id: ing.id },
      data: { onHand: { decrement: 2 } },
    })
  })

  test('a line that reached no ingredient is still on the invoice', async () => {
    const number = `E2E-UNMAPPED-${Date.now()}`
    const body = Buffer.from(
      JSON.stringify({
        kind: 'invoice',
        number,
        items: [{ rawName: 'Nothing Like This Exists', quantity: 2, unit: 'kg', unitPrice: 3 }],
      }),
    )
    const id = await upload('invoice', 'unmapped.json', 'application/json', body)
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    const res = await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)

    expect((res.body as { status: string }).status).toBe('partially_processed')

    const invoice = await prisma.client.invoice.findFirstOrThrow({
      where: { number },
      include: { items: true },
    })
    expect(invoice.items).toHaveLength(1)
    expect(invoice.items[0].ingredientId).toBeNull()

    await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(409)
    await request(http)
      .delete(`/api/documents/${id}`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(409)

    await prisma.client.invoice.delete({ where: { id: invoice.id } })
    await prisma.client.document.delete({ where: { id } })
    await prisma.client.ingredientAlias.deleteMany({
      where: { rawName: 'Nothing Like This Exists' },
    })
  })

  test('the same invoice number from the same vendor is refused, and stock stays put', async () => {
    const number = `E2E-DUP-${Date.now()}`
    const line = { rawName: 'Beef Tenderloin', quantity: 1, unit: 'kg', unitPrice: 44 }
    const body = Buffer.from(
      JSON.stringify({ kind: 'invoice', vendorName: 'Prime Meats Co.', number, items: [line] }),
    )
    const startedAt = new Date()
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Beef Tenderloin' },
    })
    const beforeOnHand = Number(ing.onHand)
    const beforeCost = Number(ing.costPerUnit)
    const beforeSettings = await prisma.client.ingredientLocationSettings.findUnique({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })
    const beforeStock = await prisma.client.ingredientLocationStock.findUniqueOrThrow({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })

    const first = await upload('invoice', 'dup-1.json', 'application/json', body)
    await waitForStatus(first, goldenForkCookie, 'requires_review')
    await request(http)
      .post(`/api/documents/${first}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)
    const afterFirst = Number(
      (await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ing.id } })).onHand,
    )

    const second = await upload('invoice', 'dup-2.json', 'application/json', body)
    await waitForStatus(second, goldenForkCookie, 'requires_review')
    await request(http)
      .post(`/api/documents/${second}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(409)

    const afterSecond = await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ing.id } })
    expect(Number(afterSecond.onHand)).toBeCloseTo(afterFirst, 3)

    const invoice = await prisma.client.invoice.findFirstOrThrow({ where: { number } })
    await prisma.client.invoice.delete({ where: { id: invoice.id } })
    await prisma.client.document.deleteMany({ where: { id: { in: [first, second] } } })
    await prisma.client.inventoryTransaction.deleteMany({ where: { notes: `Invoice ${number}` } })
    await prisma.client.ingredientPriceHistory.deleteMany({
      where: { ingredientId: ing.id, recordedAt: { gte: startedAt } },
    })
    const where = { ingredientId_locationId: { ingredientId: ing.id, locationId } }
    if (beforeSettings) {
      await prisma.client.ingredientLocationSettings.update({
        where,
        data: { costPerUnit: beforeSettings.costPerUnit },
      })
    } else {
      await prisma.client.ingredientLocationSettings.deleteMany({
        where: { ingredientId: ing.id, locationId },
      })
    }
    await prisma.client.ingredientLocationStock.update({
      where,
      data: { onHand: beforeStock.onHand },
    })
    await prisma.client.ingredient.update({
      where: { id: ing.id },
      data: { onHand: beforeOnHand, costPerUnit: beforeCost },
    })
  })

  test('the price a delivery records credits the vendor the invoice names', async () => {
    const number = `E2E-VENDOR-${Date.now()}`
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const delivering = await prisma.client.vendor.findFirstOrThrow({
      where: { organizationId: org.id, name: 'Prime Meats Co.' },
    })
    const configured = await prisma.client.vendor.findFirstOrThrow({
      where: { organizationId: org.id, name: 'Green Valley Produce' },
    })
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organizationId: org.id, name: 'Beef Tenderloin' },
    })
    const startedAt = new Date()
    const beforeOnHand = Number(ing.onHand)
    const beforeCost = Number(ing.costPerUnit)
    const where = { ingredientId_locationId: { ingredientId: ing.id, locationId } }
    const beforeSettings = await prisma.client.ingredientLocationSettings.findUnique({ where })
    const beforeStock = await prisma.client.ingredientLocationStock.findUniqueOrThrow({ where })

    await prisma.client.ingredientLocationSettings.upsert({
      where,
      create: { ingredientId: ing.id, locationId, vendorId: configured.id },
      update: { vendorId: configured.id },
    })

    const body = Buffer.from(
      JSON.stringify({
        kind: 'invoice',
        vendorName: 'Prime Meats Co.',
        number,
        items: [{ rawName: 'Beef Tenderloin', quantity: 1, unit: 'kg', unitPrice: 47 }],
      }),
    )
    const id = await upload('invoice', 'vendor-credit.json', 'application/json', body)
    await waitForStatus(id, goldenForkCookie, 'requires_review')

    try {
      await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)

      const recorded = await prisma.client.ingredientPriceHistory.findFirstOrThrow({
        where: { ingredientId: ing.id, source: 'receipt', recordedAt: { gte: startedAt } },
        orderBy: { recordedAt: 'desc' },
      })
      expect(recorded.vendorId).toBe(delivering.id)
      expect(recorded.vendorId).not.toBe(configured.id)
    } finally {
      await prisma.client.invoice.deleteMany({ where: { number } })
      await prisma.client.document.deleteMany({ where: { id } })
      await prisma.client.inventoryTransaction.deleteMany({ where: { notes: `Invoice ${number}` } })
      await prisma.client.ingredientPriceHistory.deleteMany({
        where: { ingredientId: ing.id, recordedAt: { gte: startedAt } },
      })
      if (beforeSettings) {
        await prisma.client.ingredientLocationSettings.update({
          where,
          data: { vendorId: beforeSettings.vendorId, costPerUnit: beforeSettings.costPerUnit },
        })
      } else {
        await prisma.client.ingredientLocationSettings.deleteMany({
          where: { ingredientId: ing.id, locationId },
        })
      }
      await prisma.client.ingredientLocationStock.update({
        where,
        data: { onHand: beforeStock.onHand },
      })
      await prisma.client.ingredient.update({
        where: { id: ing.id },
        data: { onHand: beforeOnHand, costPerUnit: beforeCost },
      })
    }
  })

  test('a line the paper states as a credit moves no stock and says so', async () => {
    const number = `E2E-CREDIT-${Date.now()}`
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organizationId: org.id, name: 'Beef Tenderloin' },
    })
    const startedAt = new Date()
    const where = { ingredientId_locationId: { ingredientId: ing.id, locationId } }
    const beforeOnHand = Number(ing.onHand)
    const beforeStock = Number(
      (await prisma.client.ingredientLocationStock.findUniqueOrThrow({ where })).onHand,
    )

    const body = Buffer.from(
      JSON.stringify({
        kind: 'invoice',
        vendorName: 'Prime Meats Co.',
        number,
        items: [{ rawName: 'Beef Tenderloin', quantity: -2, unit: 'kg', unitPrice: 44 }],
      }),
    )
    const id = await upload('invoice', 'credit-note.json', 'application/json', body)
    await waitForStatus(id, goldenForkCookie, 'requires_review')

    try {
      const res = await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      expect(res.body).toMatchObject({ applied: 0, credits: 1, status: 'partially_processed' })

      const afterStock = await prisma.client.ingredientLocationStock.findUniqueOrThrow({ where })
      expect(Number(afterStock.onHand)).toBeCloseTo(beforeStock, 3)
      const after = await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ing.id } })
      expect(Number(after.onHand)).toBeCloseTo(beforeOnHand, 3)

      const invoice = await prisma.client.invoice.findFirstOrThrow({
        where: { number },
        include: { items: true },
      })
      expect(Number(invoice.items[0].quantity)).toBeCloseTo(-2, 3)
      expect(Number(invoice.items[0].lineTotal)).toBeCloseTo(-88, 2)
      expect(Number(invoice.total)).toBeCloseTo(-88, 2)
    } finally {
      await prisma.client.invoice.deleteMany({ where: { number } })
      await prisma.client.document.deleteMany({ where: { id } })
      await prisma.client.inventoryTransaction.deleteMany({ where: { notes: `Invoice ${number}` } })
      await prisma.client.ingredientPriceHistory.deleteMany({
        where: { ingredientId: ing.id, recordedAt: { gte: startedAt } },
      })
      await prisma.client.ingredientLocationStock.update({ where, data: { onHand: beforeStock } })
      await prisma.client.ingredient.update({
        where: { id: ing.id },
        data: { onHand: beforeOnHand },
      })
    }
  })

  test('a discount line is kept on the invoice as the paper states it, and moves nothing', async () => {
    const number = `E2E-DISCOUNT-${Date.now()}`
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organizationId: org.id, name: 'Beef Tenderloin' },
    })
    const startedAt = new Date()
    const where = { ingredientId_locationId: { ingredientId: ing.id, locationId } }
    const beforeOnHand = Number(ing.onHand)
    const beforeStock = Number(
      (await prisma.client.ingredientLocationStock.findUniqueOrThrow({ where })).onHand,
    )
    const before = await prisma.client.ingredientLocationSettings.findUnique({ where })

    const body = Buffer.from(
      JSON.stringify({
        kind: 'invoice',
        vendorName: 'Prime Meats Co.',
        number,
        items: [
          { rawName: 'Beef Tenderloin', quantity: 1, unit: 'kg', unitPrice: 40 },
          { rawName: 'Beef Tenderloin', quantity: 1, unit: 'kg', unitPrice: -5 },
          { rawName: 'Volume discount', quantity: 1, unit: '', unitPrice: -3 },
        ],
      }),
    )
    const id = await upload('invoice', 'discount.json', 'application/json', body)
    expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')
    try {
      const res = await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      expect(res.body).toMatchObject({
        applied: 1,
        credits: 2,
        unmapped: 0,
        status: 'partially_processed',
      })
      const afterStock = await prisma.client.ingredientLocationStock.findUniqueOrThrow({ where })
      expect(Number(afterStock.onHand)).toBeCloseTo(beforeStock + 1, 3)
      const invoice = await prisma.client.invoice.findFirstOrThrow({ where: { number } })
      expect(Number(invoice.total)).toBeCloseTo(32, 2)
      expect(
        await prisma.client.ingredientAlias.count({ where: { rawName: 'Volume discount' } }),
      ).toBe(0)
    } finally {
      await prisma.client.invoice.deleteMany({ where: { number } })
      await prisma.client.document.deleteMany({ where: { id } })
      await prisma.client.inventoryTransaction.deleteMany({ where: { notes: `Invoice ${number}` } })
      await prisma.client.ingredientPriceHistory.deleteMany({
        where: { ingredientId: ing.id, recordedAt: { gte: startedAt } },
      })
      await prisma.client.ingredientAlias.deleteMany({ where: { rawName: 'Volume discount' } })
      await prisma.client.ingredientLocationStock.update({ where, data: { onHand: beforeStock } })
      await prisma.client.ingredient.update({
        where: { id: ing.id },
        data: { onHand: beforeOnHand },
      })
      if (before) {
        await prisma.client.ingredientLocationSettings.update({
          where,
          data: { costPerUnit: before.costPerUnit },
        })
      } else {
        await prisma.client.ingredientLocationSettings.deleteMany({
          where: { ingredientId: ing.id, locationId },
        })
      }
    }
  })

  test('with a single location the price a delivery brings is the shared price', async () => {
    const bella = await prisma.client.organization.findFirstOrThrow({
      where: { name: 'Bella Cucina LLC' },
      include: { locations: { select: { id: true } } },
    })
    expect(bella.locations).toHaveLength(1)
    const bellaLocation = bella.locations[0].id
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organizationId: bella.id, name: 'Beef Tenderloin' },
    })
    const recipe = await prisma.client.recipe.findFirstOrThrow({
      where: { organizationId: bella.id, name: 'Marinara Sauce' },
    })
    const beforePrice = Number(ing.costPerUnit)
    const beforeOnHand = Number(ing.onHand)
    const beforeCost = Number(recipe.totalCost)

    const number = `E2E-ALONE-${Date.now()}`
    const body = Buffer.from(
      JSON.stringify({
        kind: 'invoice',
        number,
        items: [
          { rawName: 'Beef Tenderloin', quantity: 1, unit: 'kg', unitPrice: beforePrice * 2 },
        ],
      }),
    )
    const res = await request(http)
      .post('/api/documents')
      .set('Cookie', bellaCucinaCookie)
      .set('X-Location-Id', bellaLocation)
      .field('type', 'invoice')
      .attach('file', body, { filename: 'alone.json', contentType: 'application/json' })
      .expect(201)
    const id = (res.body as { id: string }).id
    await waitForStatus(id, bellaCucinaCookie, 'requires_review')
    await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', bellaCucinaCookie)
      .set('X-Location-Id', bellaLocation)
      .expect(201)

    const moved = await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ing.id } })
    expect(Number(moved.costPerUnit)).toBeCloseTo(beforePrice * 2, 2)
    const recosted = await prisma.client.recipe.findUniqueOrThrow({ where: { id: recipe.id } })
    expect(Number(recosted.totalCost)).toBeGreaterThan(beforeCost)

    const invoice = await prisma.client.invoice.findFirstOrThrow({ where: { number } })
    await prisma.client.invoice.delete({ where: { id: invoice.id } })
    await prisma.client.document.delete({ where: { id } })
    await prisma.client.ingredientLocationSettings.deleteMany({ where: { ingredientId: ing.id } })
    await prisma.client.ingredient.update({
      where: { id: ing.id },
      data: { onHand: beforeOnHand, costPerUnit: beforePrice },
    })
    await recalcOrganizationWith(prisma.client, bella.id)
    const restored = await prisma.client.recipe.findUniqueOrThrow({ where: { id: recipe.id } })
    expect(Number(restored.totalCost)).toBeCloseTo(beforeCost, 2)
  })

  test('with more than one location the shared base is left where it was', async () => {
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { name: 'Button Mushrooms' },
    })
    const beforePrice = Number(ing.costPerUnit)
    const beforeOnHand = Number(ing.onHand)

    const number = `E2E-NOTALONE-${Date.now()}`
    const body = Buffer.from(
      JSON.stringify({
        kind: 'invoice',
        number,
        items: [
          { rawName: 'Button Mushrooms', quantity: 1, unit: 'kg', unitPrice: beforePrice * 3 },
        ],
      }),
    )
    const id = await upload('invoice', 'notalone.json', 'application/json', body)
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)

    const after = await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ing.id } })
    expect(Number(after.costPerUnit)).toBeCloseTo(beforePrice, 2)
    const here = await prisma.client.ingredientLocationSettings.findUniqueOrThrow({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
    })
    expect(Number(here.costPerUnit)).toBeCloseTo(beforePrice * 3, 2)

    const invoice = await prisma.client.invoice.findFirstOrThrow({ where: { number } })
    await prisma.client.invoice.delete({ where: { id: invoice.id } })
    await prisma.client.document.delete({ where: { id } })
    await prisma.client.ingredientLocationSettings.deleteMany({ where: { ingredientId: ing.id } })
    await prisma.client.ingredient.update({
      where: { id: ing.id },
      data: { onHand: beforeOnHand, costPerUnit: beforePrice },
    })
  })

  test('a name no ingredient answers to parks for mapping, and mapping teaches the next document', async () => {
    const rawName = `Probe Creamery Butter ${Date.now()}`
    const startedAt = new Date()
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
    })
    const beforeOnHand = Number(ing.onHand)
    const line = { rawName, quantity: 2, unit: 'kg', unitPrice: 9 }

    const first = await upload(
      'invoice',
      'park.json',
      'application/json',
      Buffer.from(
        JSON.stringify({ kind: 'invoice', number: `E2E-MAP-A-${Date.now()}`, items: [line] }),
      ),
    )
    await waitForStatus(first, goldenForkCookie, 'requires_review')
    const parked = await request(http)
      .post(`/api/documents/${first}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)
    expect((parked.body as { status: string }).status).toBe('partially_processed')

    const listed = await request(http)
      .get('/api/documents/ingredient-aliases')
      .set('Cookie', goldenForkCookie)
      .expect(200)
    const alias = (
      listed.body as { id: string; rawName: string; ingredientId: string | null; lines: number }[]
    ).find((a) => a.rawName === rawName)
    expect(alias).toBeDefined()
    expect(alias?.ingredientId).toBeNull()
    expect(alias?.lines).toBe(1)

    await request(http)
      .post(`/api/documents/ingredient-aliases/${alias?.id}`)
      .set('Cookie', goldenForkCookie)
      .send({ ingredientId: ing.id })
      .expect(201)

    const second = await upload(
      'invoice',
      'mapped.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number: `E2E-MAP-B-${Date.now()}`,
          items: [{ ...line, rawName: rawName.toUpperCase() }],
        }),
      ),
    )
    await waitForStatus(second, goldenForkCookie, 'requires_review')
    const applied = await request(http)
      .post(`/api/documents/${second}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)
    expect(applied.body).toMatchObject({ status: 'confirmed', applied: 1, unmapped: 0 })

    const after = await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ing.id } })
    expect(Number(after.onHand)).toBeCloseTo(beforeOnHand + 2, 4)

    await prisma.client.invoiceItem.deleteMany({
      where: { description: { in: [rawName, rawName.toUpperCase()] } },
    })
    await prisma.client.invoice.deleteMany({ where: { number: { startsWith: 'E2E-MAP-' } } })
    await prisma.client.document.deleteMany({ where: { id: { in: [first, second] } } })
    await prisma.client.inventoryTransaction.deleteMany({
      where: { ingredientId: ing.id, notes: { startsWith: 'Invoice E2E-MAP-' } },
    })
    await prisma.client.ingredientPriceHistory.deleteMany({
      where: { ingredientId: ing.id, recordedAt: { gte: startedAt } },
    })
    await prisma.client.ingredientLocationSettings.deleteMany({ where: { ingredientId: ing.id } })
    await prisma.client.ingredientLocationStock.update({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
      data: { onHand: { decrement: 2 } },
    })
    await prisma.client.ingredient.update({
      where: { id: ing.id },
      data: { onHand: beforeOnHand, costPerUnit: Number(ing.costPerUnit) },
    })
    await prisma.client.ingredientAlias.deleteMany({
      where: { rawName: { in: [rawName, rawName.toUpperCase()] } },
    })
  })

  test('an ingredient written in another case is the same ingredient', async () => {
    const startedAt = new Date()
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'All-Purpose Flour' },
    })
    const beforeOnHand = Number(ing.onHand)
    const number = `E2E-CASE-${Date.now()}`
    const id = await upload(
      'invoice',
      'case.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number,
          items: [{ rawName: 'all-purpose FLOUR', quantity: 3, unit: 'kg', unitPrice: 1.4 }],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    const res = await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)
    expect(res.body).toMatchObject({ status: 'confirmed', applied: 1, unmapped: 0 })

    const invoice = await prisma.client.invoice.findFirstOrThrow({ where: { number } })
    await prisma.client.invoice.delete({ where: { id: invoice.id } })
    await prisma.client.document.delete({ where: { id } })
    await prisma.client.inventoryTransaction.deleteMany({
      where: { ingredientId: ing.id, notes: `Invoice ${number}` },
    })
    await prisma.client.ingredientPriceHistory.deleteMany({
      where: { ingredientId: ing.id, recordedAt: { gte: startedAt } },
    })
    await prisma.client.ingredientLocationStock.update({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
      data: { onHand: { decrement: 3 } },
    })
    await prisma.client.ingredientLocationSettings.deleteMany({ where: { ingredientId: ing.id } })
    await prisma.client.ingredient.update({
      where: { id: ing.id },
      data: { onHand: beforeOnHand, costPerUnit: Number(ing.costPerUnit) },
    })
    await prisma.client.ingredientAlias.deleteMany({ where: { rawName: 'all-purpose FLOUR' } })
  })

  test('an alternative name can be recorded before any document carries it', async () => {
    const rawName = `Probe Alias ${Date.now()}`
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'All-Purpose Flour' },
    })

    const created = await request(http)
      .post('/api/documents/ingredient-aliases')
      .set('Cookie', goldenForkCookie)
      .send({ rawName, ingredientId: ing.id })
      .expect(201)
    const id = (created.body as { id: string }).id

    await request(http)
      .post('/api/documents/ingredient-aliases')
      .set('Cookie', goldenForkCookie)
      .send({ rawName: rawName.toUpperCase(), ingredientId: ing.id })
      .expect(409)

    await request(http)
      .post('/api/documents/ingredient-aliases')
      .set('Cookie', goldenForkCookie)
      .send({ rawName: `${rawName} II`, ingredientId: 'not-an-ingredient' })
      .expect(400)

    await request(http)
      .post(`/api/documents/ingredient-aliases/${id}`)
      .set('Cookie', goldenForkCookie)
      .send({ ingredientId: null })
      .expect(201)
    const unmapped = await prisma.client.ingredientAlias.findUniqueOrThrow({ where: { id } })
    expect(unmapped.ingredientId).toBeNull()

    await request(http)
      .delete(`/api/documents/ingredient-aliases/${id}`)
      .set('Cookie', goldenForkCookie)
      .expect(200)
    expect(await prisma.client.ingredientAlias.findUnique({ where: { id } })).toBeNull()
  })

  test('a chef may not map ingredient names', async () => {
    await request(http)
      .get('/api/documents/ingredient-aliases')
      .set('Cookie', staffCookie)
      .expect(403)
    await request(http)
      .post('/api/documents/ingredient-aliases')
      .set('Cookie', staffCookie)
      .send({ rawName: 'Chef Probe' })
      .expect(403)
  })

  test('another organization sees none of our alternative names', async () => {
    const rawName = `Probe Isolation ${Date.now()}`
    const created = await request(http)
      .post('/api/documents/ingredient-aliases')
      .set('Cookie', goldenForkCookie)
      .send({ rawName })
      .expect(201)
    const id = (created.body as { id: string }).id

    const theirs = await request(http)
      .get('/api/documents/ingredient-aliases')
      .set('Cookie', bellaCucinaCookie)
      .expect(200)
    expect((theirs.body as { rawName: string }[]).map((a) => a.rawName)).not.toContain(rawName)

    await request(http)
      .delete(`/api/documents/ingredient-aliases/${id}`)
      .set('Cookie', bellaCucinaCookie)
      .expect(404)

    await prisma.client.ingredientAlias.delete({ where: { id } })
  })

  test('the admin queue carries the values extracted from that very document', async () => {
    const one = await upload(
      'invoice',
      'admin-a.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          vendorName: 'Prime Meats Co.',
          number: `E2E-ADMIN-A-${Date.now()}`,
          items: [{ rawName: 'Beef Tenderloin', quantity: 1, unit: 'kg', unitPrice: 40 }],
        }),
      ),
    )
    const two = await upload(
      'invoice',
      'admin-b.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          vendorName: 'Green Valley Produce',
          number: `E2E-ADMIN-B-${Date.now()}`,
          items: [{ rawName: 'Button Mushrooms', quantity: 2, unit: 'kg', unitPrice: 7 }],
        }),
      ),
    )
    await waitForStatus(one, goldenForkCookie, 'requires_review')
    await waitForStatus(two, goldenForkCookie, 'requires_review')

    const first = await request(http)
      .get(`/api/admin/queue/${one}`)
      .set('Cookie', platformCookie)
      .expect(200)
    const second = await request(http)
      .get(`/api/admin/queue/${two}`)
      .set('Cookie', platformCookie)
      .expect(200)

    const payloadOf = (res: { body: unknown }) =>
      (res.body as { payload: { vendorName?: string } }).payload
    expect(payloadOf(first).vendorName).toBe('Prime Meats Co.')
    expect(payloadOf(second).vendorName).toBe('Green Valley Produce')
    expect((first.body as { versions: number }).versions).toBe(1)
    expect((first.body as { ingredients: unknown[] }).ingredients.length).toBeGreaterThan(0)

    await prisma.client.document.deleteMany({ where: { id: { in: [one, two] } } })
  })

  test('an administrator correction is what the tenant then reviews', async () => {
    const id = await upload(
      'invoice',
      'admin-fix.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          vendorName: 'Wrongly Read Vendor',
          number: `E2E-ADMIN-FIX-${Date.now()}`,
          items: [{ rawName: 'Beef Tenderloin', quantity: 1, unit: 'kg', unitPrice: 999 }],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')

    const corrected = {
      kind: 'invoice',
      vendorName: 'Prime Meats Co.',
      number: 'CORRECTED-1',
      items: [{ rawName: 'Beef Tenderloin', quantity: 1, unit: 'kg', unitPrice: 40 }],
    }
    const saved = await request(http)
      .patch(`/api/admin/queue/${id}/extraction`)
      .set('Cookie', platformCookie)
      .send({ payload: corrected })
      .expect(200)
    expect((saved.body as { versions: number }).versions).toBe(2)

    const tenant = await request(http)
      .get(`/api/documents/${id}`)
      .set('Cookie', goldenForkCookie)
      .expect(200)
    expect((tenant.body as { extraction: { number: string } }).extraction.number).toBe(
      'CORRECTED-1',
    )

    await request(http)
      .patch(`/api/admin/queue/${id}/extraction`)
      .set('Cookie', platformCookie)
      .send({ payload: { kind: 'menu', name: 'Not an invoice', price: 1 } })
      .expect(400)

    await prisma.client.document.delete({ where: { id } })
  })

  test('values a tenant has already applied are no longer editable', async () => {
    const number = `E2E-ADMIN-DONE-${Date.now()}`
    const id = await upload(
      'invoice',
      'admin-done.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number,
          items: [{ rawName: 'Nothing Answers To This', quantity: 1, unit: 'kg', unitPrice: 2 }],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)

    await request(http)
      .patch(`/api/admin/queue/${id}/extraction`)
      .set('Cookie', platformCookie)
      .send({ payload: { kind: 'invoice', number, items: [] } })
      .expect(409)

    const invoice = await prisma.client.invoice.findFirstOrThrow({ where: { number } })
    await prisma.client.invoice.delete({ where: { id: invoice.id } })
    await prisma.client.document.delete({ where: { id } })
    await prisma.client.ingredientAlias.deleteMany({
      where: { rawName: 'Nothing Answers To This' },
    })
  })

  test('a correction that arrives while the tenant confirms is refused, not left as values nobody applied', async () => {
    const number = `E2E-ADMIN-RACE-${Date.now()}`
    const id = await upload(
      'invoice',
      'admin-race.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number,
          items: [{ rawName: 'Beef Tenderloin', quantity: 1, unit: 'kg', unitPrice: 2 }],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    const original = prisma.client.document.findUnique.bind(prisma.client.document)
    const read = jest.spyOn(prisma.client.document, 'findUnique').mockImplementationOnce((async (
      args: Parameters<typeof original>[0],
    ) => {
      const seen = await original(args)
      await prisma.client.document.update({ where: { id }, data: { status: 'confirmed' } })
      return seen
    }) as never)
    try {
      const corrected = await request(http)
        .patch(`/api/admin/queue/${id}/extraction`)
        .set('Cookie', platformCookie)
        .send({ payload: { kind: 'invoice', number, items: [] } })
      const versions = await prisma.client.extraction.count({ where: { documentId: id } })
      expect([corrected.status, versions]).toEqual([409, 1])
    } finally {
      read.mockRestore()
      await prisma.client.document.delete({ where: { id } })
    }
  })

  test('an administrator cannot map a name onto another organization ingredient', async () => {
    const rawName = `Admin Probe ${Date.now()}`
    const id = await upload(
      'invoice',
      'admin-iso.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number: `E2E-ADMIN-ISO-${Date.now()}`,
          items: [{ rawName, quantity: 1, unit: 'kg', unitPrice: 3 }],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')

    const theirs = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: { not: 'golden-fork' } } },
    })
    await request(http)
      .post(`/api/admin/queue/${id}/map`)
      .set('Cookie', platformCookie)
      .send({ rawName, ingredientId: theirs.id })
      .expect(400)
    expect(await prisma.client.ingredientAlias.findFirst({ where: { rawName } })).toBeNull()

    await prisma.client.document.delete({ where: { id } })
  })

  test('an administrator binding a vendor name writes it into the tenant own catalogue', async () => {
    const rawName = `Admin Vendor Wording ${Date.now()}`
    const golden = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organizationId: golden.id, name: 'Button Mushrooms' },
    })
    const id = await upload(
      'invoice',
      'admin-vendor-map.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number: `E2E-ADMIN-VP-${Date.now()}`,
          vendorName: 'Dairy Direct',
          items: [{ rawName, sku: 'ADMIN-77', quantity: 1, unit: 'kg', unitPrice: 6 }],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')

    await request(http)
      .post(`/api/admin/queue/${id}/map`)
      .set('Cookie', platformCookie)
      .send({ rawName, ingredientId: ing.id })
      .expect(201)

    const written = await prisma.client.vendorProduct.findMany({
      where: { name: rawName },
      include: { vendor: { select: { name: true, organizationId: true } } },
    })
    expect(written).toHaveLength(1)
    expect(written[0].organizationId).toBe(golden.id)
    expect(written[0].vendor.organizationId).toBe(golden.id)
    expect(written[0].vendor.name).toBe('Dairy Direct')
    expect(written[0].ingredientId).toBe(ing.id)
    expect(written[0].sku).toBe('ADMIN-77')
    expect(await prisma.client.ingredientAlias.findFirst({ where: { rawName } })).toBeNull()

    await prisma.client.vendorProduct.deleteMany({ where: { name: rawName } })
    await prisma.client.document.delete({ where: { id } })
  })

  test('a name mapped by an administrator lets the tenant confirm place the line', async () => {
    const rawName = `Admin Wording ${Date.now()}`
    const startedAt = new Date()
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Button Mushrooms' },
    })
    const beforeOnHand = Number(ing.onHand)
    const number = `E2E-ADMIN-MAP-${Date.now()}`
    const id = await upload(
      'invoice',
      'admin-map.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number,
          items: [{ rawName, quantity: 1, unit: 'kg', unitPrice: 6 }],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')

    const before = await request(http)
      .get(`/api/admin/queue/${id}`)
      .set('Cookie', platformCookie)
      .expect(200)
    expect((before.body as { unresolved: { rawName: string }[] }).unresolved).toEqual([
      { rawName, lines: 0 },
    ])

    const after = await request(http)
      .post(`/api/admin/queue/${id}/map`)
      .set('Cookie', platformCookie)
      .send({ rawName, ingredientId: ing.id })
      .expect(201)
    expect((after.body as { unresolved: unknown[] }).unresolved).toHaveLength(0)

    const applied = await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)
    expect(applied.body).toMatchObject({ status: 'confirmed', applied: 1, unmapped: 0 })

    const invoice = await prisma.client.invoice.findFirstOrThrow({ where: { number } })
    await prisma.client.invoice.delete({ where: { id: invoice.id } })
    await prisma.client.document.delete({ where: { id } })
    await prisma.client.inventoryTransaction.deleteMany({ where: { notes: `Invoice ${number}` } })
    await prisma.client.ingredientPriceHistory.deleteMany({
      where: { ingredientId: ing.id, recordedAt: { gte: startedAt } },
    })
    await prisma.client.ingredientLocationSettings.deleteMany({ where: { ingredientId: ing.id } })
    await prisma.client.ingredientLocationStock.update({
      where: { ingredientId_locationId: { ingredientId: ing.id, locationId } },
      data: { onHand: { decrement: 1 } },
    })
    await prisma.client.ingredient.update({
      where: { id: ing.id },
      data: { onHand: beforeOnHand, costPerUnit: Number(ing.costPerUnit) },
    })
    await prisma.client.ingredientAlias.deleteMany({ where: { rawName } })
  })

  test('a recipe document becomes a recipe with its lines, portions and a cost', async () => {
    const name = `E2E Recipe ${Date.now()}`
    const id = await upload(
      'recipe',
      'recipe-full.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'recipe',
          name,
          portions: 8,
          yieldQty: 2,
          yieldUnit: 'l',
          items: [
            { rawName: 'San Marzano Tomatoes', quantity: 3, unit: 'kg' },
            { rawName: 'Unsalted Butter', quantity: 200, unit: 'g' },
          ],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')

    const before = await request(http)
      .get(`/api/documents/${id}`)
      .set('Cookie', goldenForkCookie)
      .expect(200)
    expect((before.body as { unresolved: unknown[] }).unresolved).toHaveLength(0)

    const res = await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)
    expect(res.body).toMatchObject({ status: 'confirmed', applied: 2 })

    const recipe = await prisma.client.recipe.findFirstOrThrow({
      where: { name },
      include: { ingredients: true },
    })
    expect(recipe.ingredients).toHaveLength(2)
    expect(recipe.status).toBe('published')
    expect(recipe.portions).toBe(8)
    expect(Number(recipe.yieldAmount)).toBeCloseTo(2, 3)
    expect(Number(recipe.totalCost)).toBeGreaterThan(0)

    await prisma.client.recipe.delete({ where: { id: recipe.id } })
    await prisma.client.document.delete({ where: { id } })
  })

  test('a recipe naming an ingredient nobody knows is refused, and the name parks', async () => {
    const rawName = `Probe Recipe Wording ${Date.now()}`
    const name = `E2E Unmapped Recipe ${Date.now()}`
    const id = await upload(
      'recipe',
      'recipe-unmapped.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'recipe',
          name,
          items: [{ rawName, quantity: 6, unit: 'ea' }],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')

    const res = await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(400)
    expect((res.body as { error: { message: string } }).error.message).toContain(rawName)
    expect(await prisma.client.recipe.findFirst({ where: { name } })).toBeNull()
    expect(await prisma.client.ingredientAlias.findFirst({ where: { rawName } })).not.toBeNull()

    const listed = await request(http)
      .get(`/api/documents/${id}`)
      .set('Cookie', goldenForkCookie)
      .expect(200)
    expect((listed.body as { unresolved: { rawName: string }[] }).unresolved).toEqual([
      { rawName, lines: 0 },
    ])

    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Eggs' },
    })
    await request(http)
      .post(`/api/documents/${id}/map`)
      .set('Cookie', staffCookie)
      .set('X-Location-Id', locationId)
      .send({ rawName, ingredientId: ing.id })
      .expect(201)

    await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(201)
    const recipe = await prisma.client.recipe.findFirstOrThrow({
      where: { name },
      include: { ingredients: true },
    })
    expect(recipe.ingredients).toHaveLength(1)

    await prisma.client.recipe.delete({ where: { id: recipe.id } })
    await prisma.client.document.delete({ where: { id } })
    await prisma.client.ingredientAlias.deleteMany({ where: { rawName } })
  })

  test('a recipe line in a unit that reaches the priced unit by nothing is refused', async () => {
    const name = `E2E Unconvertible Recipe ${Date.now()}`
    const id = await upload(
      'recipe',
      'recipe-unit.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'recipe',
          name,
          items: [{ rawName: 'Beef Tenderloin', quantity: 2, unit: 'l' }],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    const res = await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(400)
    expect((res.body as { error: { message: string } }).error.message).toContain('Beef Tenderloin')
    expect(await prisma.client.recipe.findFirst({ where: { name } })).toBeNull()

    await prisma.client.document.delete({ where: { id } })
  })

  test('a menu document files the dish under the section it was listed in', async () => {
    const section = `Probe Section ${Date.now()}`
    const first = `E2E Dish A ${Date.now()}`
    const second = `E2E Dish B ${Date.now()}`

    const confirmMenu = async (dish: string) => {
      const id = await upload(
        'menu',
        'menu-section.json',
        'application/json',
        Buffer.from(JSON.stringify({ kind: 'menu', name: dish, price: 21, section })),
      )
      await waitForStatus(id, goldenForkCookie, 'requires_review')
      await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      return id
    }

    const one = await confirmMenu(first)
    const two = await confirmMenu(second)

    const categories = await prisma.client.category.findMany({ where: { name: section } })
    expect(categories).toHaveLength(1)
    const dishes = await prisma.client.menuItem.findMany({
      where: { name: { in: [first, second] } },
    })
    expect(dishes).toHaveLength(2)
    expect(dishes.every((d) => d.categoryId === categories[0].id)).toBe(true)

    await prisma.client.menuItem.deleteMany({ where: { id: { in: dishes.map((d) => d.id) } } })
    await prisma.client.category.delete({ where: { id: categories[0].id } })
    await prisma.client.menu.deleteMany({ where: { name: 'menu-section' } })
    await prisma.client.document.deleteMany({ where: { id: { in: [one, two] } } })
  })

  test('a menu document becomes one menu holding every dish it lists, at the location that confirmed it', async () => {
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const known = await prisma.client.menuItem.findFirstOrThrow({
      where: { organizationId: org.id, OR: [{ locationId }, { locationId: null }] },
    })
    const stamp = Date.now()
    const menuName = `E2E Dinner ${stamp}`
    const fresh = [`E2E Starter ${stamp}`, `E2E Main ${stamp}`]
    const id = await upload(
      'menu',
      'dinner.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'menu',
          name: menuName,
          items: [
            { name: fresh[0], price: 11, section: `E2E Starters ${stamp}` },
            { name: known.name.toUpperCase(), price: 999 },
            { name: fresh[1], price: 27.5 },
            { name: fresh[0], price: 11 },
          ],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')

    try {
      const res = await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      expect(res.body).toMatchObject({ status: 'confirmed', created: 2, existing: 1 })

      const menu = await prisma.client.menu.findFirstOrThrow({
        where: { organizationId: org.id, name: menuName },
        include: {
          items: { orderBy: { sortOrder: 'asc' }, include: { menuItem: true } },
          locations: true,
        },
      })
      expect(menu.items.map((i) => i.menuItem.name)).toEqual([fresh[0], known.name, fresh[1]])
      expect(menu.locations.map((l) => l.locationId)).toEqual([locationId])
      const reused = await prisma.client.menuItem.findUniqueOrThrow({ where: { id: known.id } })
      expect(Number(reused.price)).toBe(Number(known.price))
      const created = menu.items.filter((i) => fresh.includes(i.menuItem.name))
      expect(created.every((i) => i.menuItem.locationId === locationId)).toBe(true)
      expect(Number(created[1].menuItem.price)).toBe(27.5)
    } finally {
      await prisma.client.menu.deleteMany({ where: { organizationId: org.id, name: menuName } })
      await prisma.client.menuItem.deleteMany({
        where: { organizationId: org.id, name: { in: fresh } },
      })
      await prisma.client.category.deleteMany({
        where: { organizationId: org.id, name: `E2E Starters ${stamp}` },
      })
      await prisma.client.document.deleteMany({ where: { id } })
    }
  })

  test('a menu that prints no name is named after its file, and a second file of the same menu adds to it', async () => {
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const stamp = Date.now()
    const fileMenu = `E2E Brunch ${stamp}`
    const dishes = [`E2E Waffles ${stamp}`, `E2E Omelette ${stamp}`]
    const ids: string[] = []
    try {
      for (const dish of dishes) {
        const id = await upload(
          'menu',
          `${fileMenu}.json`,
          'application/json',
          Buffer.from(JSON.stringify({ kind: 'menu', items: [{ name: dish, price: 14 }] })),
        )
        ids.push(id)
        await waitForStatus(id, goldenForkCookie, 'requires_review')
        const detail = await request(http)
          .get(`/api/documents/${id}`)
          .set('Cookie', goldenForkCookie)
          .expect(200)
        expect((detail.body as { extraction: { name: string } }).extraction.name).toBe(fileMenu)
        await request(http)
          .post(`/api/documents/${id}/confirm`)
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', locationId)
          .expect(201)
      }
      const menus = await prisma.client.menu.findMany({
        where: { organizationId: org.id, name: fileMenu },
        include: { items: { orderBy: { sortOrder: 'asc' }, include: { menuItem: true } } },
      })
      expect(menus).toHaveLength(1)
      expect(menus[0].items.map((i) => i.menuItem.name)).toEqual(dishes)
    } finally {
      await prisma.client.menu.deleteMany({ where: { organizationId: org.id, name: fileMenu } })
      await prisma.client.menuItem.deleteMany({
        where: { organizationId: org.id, name: { in: dishes } },
      })
      await prisma.client.document.deleteMany({ where: { id: { in: ids } } })
    }
  })

  test('a document that names nothing is refused rather than filed nameless', async () => {
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })

    const recipe = await upload(
      'recipe',
      'nameless-recipe.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'recipe',
          name: '   ',
          portions: 2,
          items: [{ rawName: 'Unsalted Butter', quantity: 100, unit: 'g' }],
        }),
      ),
    )
    await waitForStatus(recipe, goldenForkCookie, 'requires_review')

    const menu = await upload(
      'menu',
      'nameless-menu.json',
      'application/json',
      Buffer.from(JSON.stringify({ kind: 'menu', name: '', price: 19.5, section: 'E2E Nameless' })),
    )
    await waitForStatus(menu, goldenForkCookie, 'requires_review')

    try {
      const first = await request(http)
        .post(`/api/documents/${recipe}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(400)
      expect((first.body as { error: { message: string } }).error.message).toMatch(/name/i)

      const second = await request(http)
        .post(`/api/documents/${menu}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(400)
      expect((second.body as { error: { message: string } }).error.message).toMatch(/name/i)

      const nameless = await prisma.client.menuItem.count({
        where: { organizationId: org.id, name: '' },
      })
      expect(nameless).toBe(0)
      const section = await prisma.client.category.count({
        where: { organizationId: org.id, name: 'E2E Nameless' },
      })
      expect(section).toBe(0)
    } finally {
      await prisma.client.menuItem.deleteMany({ where: { organizationId: org.id, name: '' } })
      await prisma.client.category.deleteMany({
        where: { organizationId: org.id, name: 'E2E Nameless' },
      })
      await prisma.client.recipe.deleteMany({ where: { organizationId: org.id, name: '' } })
      await prisma.client.document.deleteMany({ where: { id: { in: [recipe, menu] } } })
    }
  })

  test('a dish already on the books is put on the menu as it is, and no section is filed for it', async () => {
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const taken = await prisma.client.menuItem.findFirstOrThrow({
      where: { organizationId: org.id, OR: [{ locationId }, { locationId: null }] },
    })
    const section = `E2E Orphan ${Date.now()}`

    const id = await upload(
      'menu',
      'clashing-menu.json',
      'application/json',
      Buffer.from(JSON.stringify({ kind: 'menu', name: taken.name, price: 99, section })),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')

    try {
      await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)

      const left = await prisma.client.category.count({
        where: { organizationId: org.id, name: section },
      })
      expect(left).toBe(0)
      const same = await prisma.client.menuItem.findMany({
        where: {
          organizationId: org.id,
          name: { equals: taken.name, mode: 'insensitive' },
          OR: [{ locationId }, { locationId: null }],
        },
      })
      expect(same.map((d) => d.id)).toEqual([taken.id])
      expect(Number(same[0].price)).toBe(Number(taken.price))
      const menu = await prisma.client.menu.findFirstOrThrow({
        where: { organizationId: org.id, name: 'clashing-menu' },
        include: { items: true },
      })
      expect(menu.items.map((i) => i.menuItemId)).toEqual([taken.id])
    } finally {
      await prisma.client.category.deleteMany({ where: { organizationId: org.id, name: section } })
      await prisma.client.menu.deleteMany({
        where: { organizationId: org.id, name: 'clashing-menu' },
      })
      await prisma.client.document.deleteMany({ where: { id } })
    }
  })

  test('a document is invisible to another organization', async () => {
    const body = Buffer.from(JSON.stringify({ kind: 'menu', name: 'Iso Probe', price: 5 }))
    const id = await upload('menu', 'iso.json', 'application/json', body)
    const res = await request(http)
      .get('/api/documents')
      .set('Cookie', bellaCucinaCookie)
      .expect(200)
    const ids = (res.body as { data: { id: string }[] }).data.map((d) => d.id)
    expect(ids).not.toContain(id)
    await prisma.client.document.delete({ where: { id } })
  })

  test('a confirm that fails part way leaves no invoice and may be confirmed again', async () => {
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const flour = await prisma.client.ingredient.findFirstOrThrow({
      where: { organizationId: org.id, name: 'All-Purpose Flour' },
    })
    const beef = await prisma.client.ingredient.findFirstOrThrow({
      where: { organizationId: org.id, name: 'Beef Tenderloin' },
    })
    const startedAt = new Date()
    const beforeOnHand = Number(flour.onHand)
    const where = { ingredientId_locationId: { ingredientId: flour.id, locationId } }
    const beforeStock = await prisma.client.ingredientLocationStock.findUnique({ where })
    const beforeSettings = await prisma.client.ingredientLocationSettings.findUnique({ where })

    const number = `E2E-ATOMIC-${Date.now()}`
    const readable = { rawName: flour.name, quantity: 2, unit: flour.unit, unitPrice: 3 }
    const overflowing = {
      kind: 'invoice',
      vendorName: 'Dairy Direct',
      number,
      items: [
        readable,
        { rawName: beef.name, quantity: 999999999, unit: beef.unit, unitPrice: 0.01 },
      ],
    }

    const id = await upload(
      'invoice',
      'atomic.json',
      'application/json',
      Buffer.from(JSON.stringify(overflowing)),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')

    try {
      const failed = await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ payload: overflowing })
      expect(failed.status).toBeGreaterThanOrEqual(400)

      expect(await prisma.client.invoice.count({ where: { number } })).toBe(0)
      const untouched = await prisma.client.ingredient.findUniqueOrThrow({
        where: { id: flour.id },
      })
      expect(Number(untouched.onHand)).toBeCloseTo(beforeOnHand, 3)

      await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({
          payload: { kind: 'invoice', vendorName: 'Dairy Direct', number, items: [readable] },
        })
        .expect(201)
      expect(await prisma.client.invoice.count({ where: { number } })).toBe(1)
    } finally {
      await prisma.client.invoice.deleteMany({ where: { number } })
      await prisma.client.inventoryTransaction.deleteMany({
        where: { ingredientId: flour.id, createdAt: { gte: startedAt } },
      })
      await prisma.client.ingredientPriceHistory.deleteMany({
        where: { ingredientId: flour.id, recordedAt: { gte: startedAt } },
      })
      if (beforeSettings) {
        await prisma.client.ingredientLocationSettings.update({
          where,
          data: { costPerUnit: beforeSettings.costPerUnit },
        })
      } else {
        await prisma.client.ingredientLocationSettings.deleteMany({
          where: { ingredientId: flour.id, locationId },
        })
      }
      if (beforeStock) {
        await prisma.client.ingredientLocationStock.update({
          where,
          data: { onHand: beforeStock.onHand },
        })
      }
      await prisma.client.ingredient.update({
        where: { id: flour.id },
        data: { onHand: beforeOnHand },
      })
      await prisma.client.document.deleteMany({ where: { id } })
    }
  })

  test('a location in the archive does not turn one location into a group', async () => {
    const bella = await prisma.client.organization.findFirstOrThrow({
      where: { name: 'Bella Cucina LLC' },
      include: { locations: { where: { isActive: true }, select: { id: true } } },
    })
    const bellaLocation = bella.locations[0].id
    const ing = await prisma.client.ingredient.findFirstOrThrow({
      where: { organizationId: bella.id, name: 'Beef Tenderloin' },
    })
    const beforePrice = Number(ing.costPerUnit)
    const beforeOnHand = Number(ing.onHand)
    const closed = await prisma.client.location.create({
      data: { organizationId: bella.id, name: `E2E Closed ${Date.now()}`, isActive: false },
    })

    const number = `E2E-ARCHIVED-${Date.now()}`
    const body = Buffer.from(
      JSON.stringify({
        kind: 'invoice',
        number,
        items: [
          { rawName: 'Beef Tenderloin', quantity: 1, unit: 'kg', unitPrice: beforePrice * 2 },
        ],
      }),
    )
    const res = await request(http)
      .post('/api/documents')
      .set('Cookie', bellaCucinaCookie)
      .set('X-Location-Id', bellaLocation)
      .field('type', 'invoice')
      .attach('file', body, { filename: 'archived.json', contentType: 'application/json' })
      .expect(201)
    const id = (res.body as { id: string }).id
    await waitForStatus(id, bellaCucinaCookie, 'requires_review')

    try {
      await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', bellaCucinaCookie)
        .set('X-Location-Id', bellaLocation)
        .expect(201)

      const moved = await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ing.id } })
      expect(Number(moved.costPerUnit)).toBeCloseTo(beforePrice * 2, 2)
    } finally {
      await prisma.client.invoice.deleteMany({ where: { number } })
      await prisma.client.document.deleteMany({ where: { id } })
      await prisma.client.location.delete({ where: { id: closed.id } })
      await prisma.client.ingredientLocationSettings.deleteMany({ where: { ingredientId: ing.id } })
      await prisma.client.inventoryTransaction.deleteMany({ where: { ingredientId: ing.id } })
      await prisma.client.ingredientPriceHistory.deleteMany({ where: { ingredientId: ing.id } })
      await prisma.client.ingredient.update({
        where: { id: ing.id },
        data: { onHand: beforeOnHand, costPerUnit: beforePrice },
      })
      await request(http)
        .patch(`/api/ingredients/${ing.id}`)
        .set('Cookie', bellaCucinaCookie)
        .send({ costPerUnit: beforePrice })
        .expect(200)
      await recalcOrganizationWith(prisma.client, bella.id)
    }
  })

  test('a document waiting for review is counted for the person who has to review it', async () => {
    const before = await request(http)
      .get('/api/dashboard/kpis')
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(200)
    const started = (before.body as { pendingDocuments: number }).pendingDocuments

    const id = await upload(
      'menu',
      'pending.json',
      'application/json',
      Buffer.from(JSON.stringify({ kind: 'menu', name: `E2E Pending ${Date.now()}`, price: 12 })),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')

    try {
      const waiting = await request(http)
        .get('/api/dashboard/kpis')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(200)
      expect((waiting.body as { pendingDocuments: number }).pendingDocuments).toBe(started + 1)

      const elsewhere = await request(http)
        .get('/api/dashboard/kpis')
        .set('Cookie', bellaCucinaCookie)
        .expect(200)
      expect((elsewhere.body as { pendingDocuments: number }).pendingDocuments).toBe(0)
    } finally {
      await prisma.client.document.deleteMany({ where: { id } })
    }

    const after = await request(http)
      .get('/api/dashboard/kpis')
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(200)
    expect((after.body as { pendingDocuments: number }).pendingDocuments).toBe(started)
  })

  test('the administration panel can see the state of the queue itself', async () => {
    const res = await request(http)
      .get('/api/admin/queue/state')
      .set('Cookie', platformCookie)
      .expect(200)
    const state = res.body as {
      reachable: boolean
      waiting: number
      active: number
      delayed: number
      failed: number
    }
    expect(state.reachable).toBe(true)
    for (const count of [state.waiting, state.active, state.delayed, state.failed]) {
      expect(count).toBeGreaterThanOrEqual(0)
    }

    await request(http).get('/api/admin/queue/state').set('Cookie', goldenForkCookie).expect(404)
  })

  test('the administration panel says what each outside service runs on, and nobody else may ask', async () => {
    const res = await request(http)
      .get('/api/admin/integrations')
      .set('Cookie', platformCookie)
      .expect(200)
    const body = res.body as {
      environment: string
      services: { service: string; provider: string; live: boolean; note: string }[]
    }
    expect(body.environment).toBe('development')
    expect(body.services.map((s) => s.service)).toEqual([
      'documents',
      'storage',
      'mail',
      'billing',
      'errors',
    ])
    expect(body.services.find((s) => s.service === 'documents')).toMatchObject({
      provider: 'stub',
      live: false,
    })
    expect(body.services.find((s) => s.service === 'billing')).toMatchObject({
      provider: 'stub',
      live: false,
    })
    const secret = app.get<AppConfig>(ConfigService).get('BILLING_WEBHOOK_SECRET', { infer: true })
    if (secret) expect(JSON.stringify(body)).not.toContain(secret)

    await request(http).get('/api/admin/integrations').set('Cookie', goldenForkCookie).expect(404)
    await request(http).get('/api/admin/integrations').expect(401)
  })

  test('a name that already names an ingredient or a dish is not added to a mapping list, where it would never be read', async () => {
    const butter = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
    })
    const ingredientName = await request(http)
      .post('/api/documents/ingredient-aliases')
      .set('Cookie', goldenForkCookie)
      .send({ rawName: 'unsalted butter' })
    expect(ingredientName.status).toBe(409)
    expect(JSON.stringify(ingredientName.body)).toMatch(/name of an ingredient/)

    const dish = await prisma.client.menuItem.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, locationId: null },
    })
    const dishName = await request(http)
      .post('/api/documents/menu-item-aliases')
      .set('Cookie', goldenForkCookie)
      .send({ rawName: dish.name.toUpperCase() })
    expect(dishName.status).toBe(409)
    expect(JSON.stringify(dishName.body)).toMatch(/name of a dish/)
    expect(butter.id).toBeTruthy()
  })

  test('an upload the queue cannot take is failed with a reason and can be retried', async () => {
    const queue = app.get(DocumentsQueue)
    const spy = jest
      .spyOn(queue, 'enqueue')
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
    let id = ''
    try {
      const res = await request(http)
        .post('/api/documents')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .field('type', 'invoice')
        .attach(
          'file',
          Buffer.from(
            JSON.stringify({
              kind: 'invoice',
              items: [{ rawName: 'Probe Unqueued', quantity: 1, unit: 'kg', unitPrice: 2 }],
            }),
          ),
          { filename: 'unqueued.json', contentType: 'application/json' },
        )
        .expect(503)
      expect(JSON.stringify(res.body)).toMatch(/retry/i)
      const doc = await prisma.client.document.findFirstOrThrow({
        where: { fileName: 'unqueued.json' },
        orderBy: { createdAt: 'desc' },
      })
      id = doc.id
      expect(doc.status).toBe('failed')
      spy.mockRestore()
      await request(http)
        .post(`/api/documents/${id}/retry`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')
    } finally {
      spy.mockRestore()
      if (id) await prisma.client.document.deleteMany({ where: { id } })
    }
  })

  test('a job delivered again does not reopen a document already past it', async () => {
    const id = await upload(
      'invoice',
      'redelivered.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          items: [{ rawName: 'Probe Redelivered', quantity: 1, unit: 'kg', unitPrice: 2 }],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    await prisma.client.document.update({ where: { id }, data: { status: 'confirmed' } })
    const extractions = await prisma.client.extraction.count({ where: { documentId: id } })
    try {
      await app.get(DocumentsQueue).enqueue(id)
      await new Promise((r) => setTimeout(r, 3000))
      const doc = await prisma.client.document.findUniqueOrThrow({ where: { id } })
      expect(doc.status).toBe('confirmed')
      expect(await prisma.client.extraction.count({ where: { documentId: id } })).toBe(extractions)
    } finally {
      await prisma.client.document.deleteMany({ where: { id } })
      await prisma.client.ingredientAlias.deleteMany({ where: { rawName: 'Probe Redelivered' } })
    }
  })

  test('a confirm whose status cannot be written moves nothing', async () => {
    const butter = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
    })
    const snap = await snapshotIngredient(butter.id)
    const number = `E2E-SEALED-${Date.now()}`
    const id = await upload(
      'invoice',
      'sealed.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number,
          items: [{ rawName: 'Unsalted Butter', quantity: 1, unit: 'kg', unitPrice: 9.5 }],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    await prisma.client.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION e2e_refuse_seal() RETURNS trigger AS $$
      BEGIN
        IF NEW.id = '${id}' AND NEW.status IN ('confirmed', 'partially_processed') THEN
          RAISE EXCEPTION 'e2e refuses the status';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`)
    await prisma.client.$executeRawUnsafe(
      `CREATE TRIGGER e2e_refuse_seal BEFORE UPDATE ON "Document" FOR EACH ROW EXECUTE FUNCTION e2e_refuse_seal()`,
    )
    try {
      const res = await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(await prisma.client.invoice.count({ where: { number } })).toBe(0)
      const stock = await prisma.client.ingredientLocationStock.findUniqueOrThrow({
        where: { ingredientId_locationId: { ingredientId: butter.id, locationId } },
      })
      const before = snap.stock.find((st) => st.locationId === locationId)
      expect(Number(stock.onHand)).toBe(Number(before?.onHand ?? 0))
      expect((await prisma.client.document.findUniqueOrThrow({ where: { id } })).status).toBe(
        'requires_review',
      )
    } finally {
      await prisma.client.$executeRawUnsafe('DROP TRIGGER IF EXISTS e2e_refuse_seal ON "Document"')
      await prisma.client.$executeRawUnsafe('DROP FUNCTION IF EXISTS e2e_refuse_seal()')
      await prisma.client.invoice.deleteMany({ where: { number } })
      await restoreIngredient(snap)
      await prisma.client.document.deleteMany({ where: { id } })
    }
  })

  test('a document confirmed with corrected values shows the values it applied, not the ones first read', async () => {
    const butter = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
    })
    const snap = await snapshotIngredient(butter.id)
    const number = `E2E-APPLIED-${Date.now()}`
    const id = await upload(
      'invoice',
      'applied.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number,
          items: [{ rawName: 'Unsalted Butter', quantity: 1, unit: 'kg', unitPrice: 9.5 }],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    try {
      await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({
          payload: {
            kind: 'invoice',
            number,
            items: [{ rawName: 'Unsalted Butter', quantity: 3, unit: 'kg', unitPrice: 9.5 }],
          },
        })
        .expect(201)
      const recorded = await prisma.client.invoice.findFirstOrThrow({
        where: { number },
        include: { items: true },
      })
      const shown = await request(http)
        .get(`/api/documents/${id}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(200)
      const extraction = (shown.body as { extraction: { items: { quantity: number }[] } })
        .extraction
      expect([Number(recorded.items[0].quantity), extraction.items[0].quantity]).toEqual([3, 3])
    } finally {
      await prisma.client.invoice.deleteMany({ where: { number } })
      await restoreIngredient(snap)
      await prisma.client.document.deleteMany({ where: { id } })
    }
  })

  test('an extraction cut off half way is taken up again when its job comes back', async () => {
    const id = await upload(
      'invoice',
      'interrupted.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          items: [{ rawName: 'Probe Interrupted', quantity: 1, unit: 'kg', unitPrice: 2 }],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    await prisma.client.extraction.deleteMany({ where: { documentId: id } })
    await prisma.client.document.update({ where: { id }, data: { status: 'processing' } })
    try {
      await app.get(DocumentsQueue).enqueue(id)
      expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')
      expect(await prisma.client.extraction.count({ where: { documentId: id } })).toBe(1)
    } finally {
      await prisma.client.document.deleteMany({ where: { id } })
      await prisma.client.ingredientAlias.deleteMany({ where: { rawName: 'Probe Interrupted' } })
    }
  })

  test('a sales report dated after today where the restaurant is is not confirmed', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const dish = await prisma.client.menuItem.findFirstOrThrow({
      where: { organizationId: org.id, locationId: null },
    })
    const tomorrow = dayKey(new Date(Date.now() + 86400000), org.timezone)
    const before = await prisma.client.sale.count({ where: { organizationId: org.id } })
    const id = await upload(
      'sales',
      'tomorrow.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'sales',
          date: tomorrow,
          items: [{ menuItemName: dish.name, quantity: 1, unitPrice: 9 }],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    const refused = await request(http)
      .post(`/api/documents/${id}/confirm`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
      .expect(400)
    expect(JSON.stringify(refused.body)).toMatch(/future/)
    expect(await prisma.client.sale.count({ where: { organizationId: org.id } })).toBe(before)
    await request(http)
      .delete(`/api/documents/${id}`)
      .set('Cookie', goldenForkCookie)
      .set('X-Location-Id', locationId)
  })

  test('a sales name mapped at a location wins over a dish of the same name served everywhere', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const stamp = Date.now()
    const name = `Probe Bowl ${stamp}`
    const shared = await prisma.client.menuItem.create({
      data: { organizationId: org.id, name, price: 5 },
    })
    const own = await prisma.client.menuItem.create({
      data: { organizationId: org.id, locationId, name: `${name} Downtown`, price: 7 },
    })
    const alias = await prisma.client.menuItemAlias.create({
      data: { organizationId: org.id, locationId, rawName: name, menuItemId: own.id },
    })
    const day = '2026-08-03'
    try {
      const id = await upload(
        'sales',
        'bowl.json',
        'application/json',
        Buffer.from(
          JSON.stringify({
            kind: 'sales',
            date: day,
            items: [{ menuItemName: name, quantity: 2, unitPrice: 7 }],
          }),
        ),
      )
      await waitForStatus(id, goldenForkCookie, 'requires_review')
      await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      const sold = await prisma.client.saleItem.findMany({
        where: {
          sale: { organizationId: org.id, date: onDay(day) },
          menuItemId: { in: [shared.id, own.id] },
        },
      })
      expect(sold.map((s) => s.menuItemId)).toEqual([own.id])
    } finally {
      await prisma.client.sale.deleteMany({ where: { organizationId: org.id, date: onDay(day) } })
      await prisma.client.menuItemAlias.delete({ where: { id: alias.id } })
      await prisma.client.menuItem.deleteMany({ where: { id: { in: [shared.id, own.id] } } })
    }
  })

  test('a sales name shared by every location is added, mapped and removed only by someone who works at all of them', async () => {
    const maria = await login('maria@goldenfork.com')
    const shared = await prisma.client.menuItemAlias.create({
      data: {
        organizationId: (
          await prisma.client.organization.findUniqueOrThrow({ where: { slug: 'golden-fork' } })
        ).id,
        rawName: 'PROBE SHARED POS NAME',
      },
    })
    try {
      const added = await request(http)
        .post('/api/documents/menu-item-aliases')
        .set('Cookie', maria)
        .send({ rawName: 'PROBE MARIA EVERYWHERE' })
      expect(added.status).toBe(403)
      const mapped = await request(http)
        .post(`/api/documents/menu-item-aliases/${shared.id}`)
        .set('Cookie', maria)
        .send({ menuItemId: null })
      expect(mapped.status).toBe(403)
      const removed = await request(http)
        .delete(`/api/documents/menu-item-aliases/${shared.id}`)
        .set('Cookie', maria)
      expect(removed.status).toBe(403)

      const own = await request(http)
        .post('/api/documents/menu-item-aliases')
        .set('Cookie', maria)
        .set('X-Location-Id', locationId)
        .send({ rawName: 'PROBE MARIA HERE' })
      expect(own.status).toBe(201)
    } finally {
      await prisma.client.menuItemAlias.deleteMany({ where: { rawName: { startsWith: 'PROBE ' } } })
    }
  })

  test('names and ids sent to the mapping routes are checked like every other body', async () => {
    const send = (path: string, body: object, cookie = goldenForkCookie) =>
      request(http).post(path).set('Cookie', cookie).set('X-Location-Id', locationId).send(body)
    const long = 'x'.repeat(201)
    for (const [path, body, cookie] of [
      ['/api/documents/ingredient-aliases', { rawName: { text: 'Butter' } }],
      ['/api/documents/ingredient-aliases', { rawName: long }],
      ['/api/documents/ingredient-aliases', { rawName: '   ' }],
      ['/api/documents/menu-item-aliases', { rawName: ['Burger'] }],
      ['/api/documents/menu-item-aliases', { rawName: long }],
      ['/api/documents/ingredient-aliases/nope', { ingredientId: { id: 7 } }],
      ['/api/documents/menu-item-aliases/nope', { menuItemId: { id: 7 } }],
      ['/api/documents/nope/map', { rawName: { text: 7 }, ingredientId: 'x' }],
      ['/api/documents/nope/map', { rawName: 'Butter' }],
      ['/api/admin/queue/nope/map', { rawName: { text: 7 }, ingredientId: 'x' }, platformCookie],
    ] as [string, object, string?][]) {
      const res = await send(path, body, cookie)
      expect([path, res.status]).toEqual([path, 400])
    }
    expect(await prisma.client.ingredientAlias.count({ where: { rawName: long } })).toBe(0)

    const vendorless = await request(http)
      .post('/api/vendor-products')
      .set('Cookie', goldenForkCookie)
      .send({ name: 'Probe Vendorless', vendorId: '' })
      .expect(400)
    expect(vendorless.body.error.code).toBe('VALIDATION_ERROR')
    expect(JSON.stringify(vendorless.body.error.details)).toMatch(/vendorId should not be empty/)
  })

  test('a menu document does not reach a menu served only where the person does not work', async () => {
    const organization = { slug: 'golden-fork' }
    const org = await prisma.client.organization.findFirstOrThrow({ where: organization })
    const airport = await prisma.client.location.findFirstOrThrow({
      where: { organization, name: { endsWith: 'Airport' } },
    })
    const downtown = await prisma.client.location.findFirstOrThrow({
      where: { organization, name: { endsWith: 'Downtown' } },
    })
    const name = `Probe Airport Supper ${Date.now()}`
    const menu = await prisma.client.menu.create({
      data: { organizationId: org.id, name, locations: { create: [{ locationId: airport.id }] } },
    })
    const maria = await login('maria@goldenfork.com')
    let doc = ''
    try {
      const res = await request(http)
        .post('/api/documents')
        .set('Cookie', maria)
        .set('X-Location-Id', downtown.id)
        .field('type', 'menu')
        .attach(
          'file',
          Buffer.from(
            JSON.stringify({
              kind: 'menu',
              name,
              items: [{ name: `Probe Supper Dish ${Date.now()}`, price: 9 }],
            }),
          ),
          { filename: 'supper.json', contentType: 'application/json' },
        )
        .expect(201)
      doc = (res.body as { id: string }).id
      await waitForStatus(doc, maria, 'requires_review')
      const refused = await request(http)
        .post(`/api/documents/${doc}/confirm`)
        .set('Cookie', maria)
        .set('X-Location-Id', downtown.id)
        .expect(409)
      expect(refused.body.error.message).toMatch(/another name/)
      const after = await prisma.client.menu.findUniqueOrThrow({
        where: { id: menu.id },
        include: { items: true, locations: true },
      })
      expect(after.items).toHaveLength(0)
      expect(after.locations.map((l) => l.locationId)).toEqual([airport.id])
    } finally {
      await prisma.client.document.deleteMany({ where: { id: doc } })
      await prisma.client.menuItemOnMenu.deleteMany({ where: { menuId: menu.id } })
      await prisma.client.menuOnLocation.deleteMany({ where: { menuId: menu.id } })
      await prisma.client.menu.deleteMany({ where: { id: menu.id } })
      await prisma.client.menuItem.deleteMany({
        where: { organizationId: org.id, name: { startsWith: 'Probe Supper Dish' } },
      })
    }
  })

  test('a document is not deleted while it is being confirmed', async () => {
    const doc = await upload(
      'menu',
      'midway.json',
      'application/json',
      Buffer.from(JSON.stringify({ kind: 'menu', name: `Probe Midway ${Date.now()}`, price: 5 })),
    )
    try {
      await waitForStatus(doc, goldenForkCookie, 'requires_review')
      await prisma.client.document.update({ where: { id: doc }, data: { status: 'processing' } })
      const refused = await request(http)
        .delete(`/api/documents/${doc}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(409)
      expect(refused.body.error.message).toMatch(/being/)
      expect(await prisma.client.document.count({ where: { id: doc } })).toBe(1)
    } finally {
      await prisma.client.document.deleteMany({ where: { id: doc } })
    }
  })

  test('a document of a location archived since it was read is not confirmed there', async () => {
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const closing = await prisma.client.location.create({
      data: { organizationId: org.id, name: `Probe Closing Kitchen ${Date.now()}` },
    })
    let doc = ''
    try {
      doc = await upload(
        'recipe',
        'closing.json',
        'application/json',
        Buffer.from(
          JSON.stringify({
            kind: 'recipe',
            name: `Probe Closing Recipe ${Date.now()}`,
            items: [{ rawName: 'Unsalted Butter', quantity: 100, unit: 'g' }],
          }),
        ),
        closing.id,
      )
      await waitForStatus(doc, goldenForkCookie, 'requires_review')
      await prisma.client.location.update({ where: { id: closing.id }, data: { isActive: false } })
      const refused = await request(http)
        .post(`/api/documents/${doc}/confirm`)
        .set('Cookie', goldenForkCookie)
        .expect(403)
      expect(refused.body.error.message).toMatch(/archived/)
      const many = await request(http)
        .post('/api/documents/confirm-many')
        .set('Cookie', goldenForkCookie)
        .send({ ids: [doc] })
        .expect(201)
      expect((many.body as { results: { error?: string }[] }).results[0].error).toMatch(/archived/)
      expect(await prisma.client.recipe.count({ where: { locationId: closing.id } })).toBe(0)
      expect((await prisma.client.document.findUniqueOrThrow({ where: { id: doc } })).status).toBe(
        'requires_review',
      )
    } finally {
      await prisma.client.document.deleteMany({ where: { id: doc } })
      await prisma.client.location.deleteMany({ where: { id: closing.id } })
    }
  })

  test('a menu document leaves a menu served everywhere served everywhere', async () => {
    const organization = { slug: 'golden-fork' }
    const org = await prisma.client.organization.findFirstOrThrow({ where: organization })
    const airport = await prisma.client.location.findFirstOrThrow({
      where: { organization, name: { endsWith: 'Airport' } },
    })
    const downtown = await prisma.client.location.findFirstOrThrow({
      where: { organization, name: { endsWith: 'Downtown' } },
    })
    const stamp = Date.now()
    const name = `Probe Everywhere Lunch ${stamp}`
    const burger = await prisma.client.menuItem.create({
      data: {
        organizationId: org.id,
        locationId: airport.id,
        name: `Probe Everywhere Burger ${stamp}`,
        price: 12,
      },
    })
    const menu = await prisma.client.menu.create({
      data: {
        organizationId: org.id,
        name,
        items: { create: [{ menuItemId: burger.id, sortOrder: 0 }] },
      },
    })
    let doc = ''
    try {
      doc = await upload(
        'menu',
        'everywhere.json',
        'application/json',
        Buffer.from(
          JSON.stringify({
            kind: 'menu',
            name,
            items: [{ name: `Probe Everywhere Salad ${stamp}`, price: 9 }],
          }),
        ),
        downtown.id,
      )
      await waitForStatus(doc, goldenForkCookie, 'requires_review')
      await request(http)
        .post(`/api/documents/${doc}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown.id)
        .expect(201)
      const after = await prisma.client.menu.findUniqueOrThrow({
        where: { id: menu.id },
        include: { items: true, locations: true },
      })
      expect(after.items).toHaveLength(2)
      expect(after.locations).toHaveLength(0)
      const listed = await request(http)
        .get('/api/menus')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', airport.id)
        .expect(200)
      expect((listed.body as { name: string }[]).map((m) => m.name)).toContain(name)
    } finally {
      await prisma.client.document.deleteMany({ where: { id: doc } })
      await prisma.client.menuItemOnMenu.deleteMany({ where: { menuId: menu.id } })
      await prisma.client.menuOnLocation.deleteMany({ where: { menuId: menu.id } })
      await prisma.client.menu.deleteMany({ where: { id: menu.id } })
      await prisma.client.menuItem.deleteMany({
        where: { organizationId: org.id, name: { startsWith: 'Probe Everywhere' } },
      })
    }
  })

  test('a sales line that sells nothing, a discount or a refund beyond the day, is kept for review and recorded as no sale', async () => {
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const dish = await prisma.client.menuItem.findFirstOrThrow({
      where: { organizationId: org.id, locationId: null, isActive: true },
      select: { id: true, name: true },
    })
    const date = '2026-08-09'
    const report = Buffer.from(
      JSON.stringify({
        kind: 'sales',
        date,
        items: [
          { menuItemName: dish.name, quantity: 3, unitPrice: 12 },
          { menuItemName: 'Happy hour discount', quantity: 1, unitPrice: -4 },
        ],
      }),
    )
    const id = await upload('sales', 'discount-sales.json', 'application/json', report)
    try {
      expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')
      const res = await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      expect(res.body).toMatchObject({
        applied: 1,
        credits: 1,
        unmapped: 0,
        status: 'partially_processed',
      })
      expect(
        await prisma.client.menuItemAlias.count({ where: { rawName: 'Happy hour discount' } }),
      ).toBe(0)
    } finally {
      await prisma.client.sale.deleteMany({ where: { organizationId: org.id, date: onDay(date) } })
      await prisma.client.document.deleteMany({ where: { id } })
      await prisma.client.menuItemAlias.deleteMany({ where: { rawName: 'Happy hour discount' } })
    }
  })

  test('the same sales report confirmed twice is refused the second time, and nothing is counted twice', async () => {
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const dish = await prisma.client.menuItem.findFirstOrThrow({
      where: { organizationId: org.id, locationId: null, isActive: true },
      select: { name: true },
    })
    const date = '2026-08-03'
    const report = Buffer.from(
      JSON.stringify({
        kind: 'sales',
        date,
        items: [{ menuItemName: dish.name, quantity: 4, unitPrice: 12 }],
      }),
    )
    const documents: string[] = []
    try {
      for (const name of ['twice-a.json', 'twice-b.json']) {
        const id = await upload('sales', name, 'application/json', report)
        documents.push(id)
        await waitForStatus(id, goldenForkCookie, 'requires_review')
      }
      await request(http)
        .post(`/api/documents/${documents[0]}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      const again = await request(http)
        .post(`/api/documents/${documents[1]}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(409)
      expect(again.body.error.message).toMatch(/already recorded/)
      expect(
        await prisma.client.sale.count({ where: { organizationId: org.id, date: onDay(date) } }),
      ).toBe(1)

      const other = Buffer.from(
        JSON.stringify({
          kind: 'sales',
          date,
          items: [{ menuItemName: dish.name, quantity: 5, unitPrice: 12 }],
        }),
      )
      const third = await upload('sales', 'twice-c.json', 'application/json', other)
      documents.push(third)
      await waitForStatus(third, goldenForkCookie, 'requires_review')
      await request(http)
        .post(`/api/documents/${third}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
    } finally {
      await prisma.client.sale.deleteMany({ where: { organizationId: org.id, date: onDay(date) } })
      await prisma.client.document.deleteMany({ where: { id: { in: documents } } })
    }
  })

  test('a dish name a sales file states is parked, mapped, and understood next time', async () => {
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const dish = await prisma.client.menuItem.findFirstOrThrow({
      where: { organizationId: org.id },
      select: { id: true, name: true },
    })
    const stated = `POS ${dish.name.toUpperCase()} LG`
    const sales = (date: string) =>
      Buffer.from(
        JSON.stringify({
          kind: 'sales',
          date,
          items: [{ menuItemName: stated, quantity: 2, unitPrice: 10 }],
        }),
      )

    const first = await upload(
      'sales',
      'sales-unmapped.json',
      'application/json',
      sales('2026-09-01'),
    )
    await waitForStatus(first, goldenForkCookie, 'requires_review')

    try {
      const applied = await request(http)
        .post(`/api/documents/${first}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      expect((applied.body as { unmapped: number }).unmapped).toBe(1)

      const parked = await request(http)
        .get('/api/documents/menu-item-aliases')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const row = (
        parked.body as { id: string; rawName: string; menuItemId: string | null }[]
      ).find((a) => a.rawName === stated)
      expect(row).toBeDefined()
      expect(row?.menuItemId).toBeNull()

      await request(http)
        .post(`/api/documents/menu-item-aliases/${row?.id}`)
        .set('Cookie', goldenForkCookie)
        .send({ menuItemId: dish.id })
        .expect(201)

      const second = await upload(
        'sales',
        'sales-mapped.json',
        'application/json',
        sales('2026-09-02'),
      )
      await waitForStatus(second, goldenForkCookie, 'requires_review')
      const understood = await request(http)
        .post(`/api/documents/${second}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      expect(understood.body as { applied: number; unmapped: number }).toMatchObject({
        applied: 1,
        unmapped: 0,
      })

      const sale = await prisma.client.sale.findFirst({
        where: { organizationId: org.id, date: onDay('2026-09-02') },
        include: { items: true },
      })
      expect(sale?.items[0]?.menuItemId).toBe(dish.id)

      const theirs = await request(http)
        .get('/api/documents/menu-item-aliases')
        .set('Cookie', bellaCucinaCookie)
        .expect(200)
      expect((theirs.body as { rawName: string }[]).some((a) => a.rawName === stated)).toBe(false)
    } finally {
      await prisma.client.sale.deleteMany({
        where: {
          organizationId: org.id,
          OR: [{ date: onDay('2026-09-01') }, { date: onDay('2026-09-02') }],
        },
      })
      await prisma.client.menuItemAlias.deleteMany({ where: { rawName: stated } })
      await prisma.client.document.deleteMany({ where: { id: { in: [first] } } })
    }
  })

  test('a parked dish name reads only as a dish sold where it was parked', async () => {
    const organization = { slug: 'golden-fork' }
    const org = await prisma.client.organization.findFirstOrThrow({ where: organization })
    const airport = await prisma.client.location.findFirstOrThrow({
      where: { organization, name: { endsWith: 'Airport' } },
    })
    const downtown = await prisma.client.location.findFirstOrThrow({
      where: { organization, name: { endsWith: 'Downtown' } },
    })
    const stamp = Date.now()
    const airportDish = await prisma.client.menuItem.create({
      data: {
        organizationId: org.id,
        locationId: airport.id,
        name: `Probe Airport Only ${stamp}`,
        price: 9,
      },
    })
    const sharedDish = await prisma.client.menuItem.create({
      data: { organizationId: org.id, name: `Probe Everywhere ${stamp}`, price: 9 },
    })
    const aliasName = `PROBE PARKED DOWNTOWN ${stamp}`
    try {
      const everywhere = await request(http)
        .post('/api/documents/menu-item-aliases')
        .set('Cookie', goldenForkCookie)
        .send({ rawName: `${aliasName} EVERYWHERE`, menuItemId: airportDish.id })
        .expect(400)
      expect(everywhere.body.error.message).toMatch(
        /sold only at Golden Fork — Airport.*parked for every location/,
      )

      const parked = await request(http)
        .post('/api/documents/menu-item-aliases')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown.id)
        .send({ rawName: aliasName })
        .expect(201)
      const id = (parked.body as { id: string }).id

      const refused = await request(http)
        .post(`/api/documents/menu-item-aliases/${id}`)
        .set('Cookie', goldenForkCookie)
        .send({ menuItemId: airportDish.id })
        .expect(400)
      expect(refused.body.error.message).toMatch(
        /sold only at Golden Fork — Airport.*parked at another location/,
      )
      await request(http)
        .post(`/api/documents/menu-item-aliases/${id}`)
        .set('Cookie', goldenForkCookie)
        .send({ menuItemId: sharedDish.id })
        .expect(201)
    } finally {
      await prisma.client.menuItemAlias.deleteMany({
        where: { rawName: { startsWith: aliasName } },
      })
      await prisma.client.menuItem.deleteMany({
        where: { id: { in: [airportDish.id, sharedDish.id] } },
      })
    }
  })

  describe('a reviewed payload is validated before it moves anything', () => {
    let organizationId = ''
    let ingredient = ''
    const documents: string[] = []

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      organizationId = org.id
      ingredient = (
        await prisma.client.ingredient.findFirstOrThrow({
          where: { organizationId, name: 'All-Purpose Flour' },
        })
      ).id
    })

    afterAll(async () => {
      await prisma.client.document.deleteMany({ where: { id: { in: documents } } })
    })

    const line = { rawName: 'All-Purpose Flour', quantity: 1, unit: 'kg', unitPrice: 1 }
    const reviewable = async (name: string) => {
      const body = Buffer.from(JSON.stringify({ kind: 'invoice', number: name, items: [line] }))
      const id = await upload('invoice', `${name}.json`, 'application/json', body)
      documents.push(id)
      expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')
      return id
    }
    const flour = async () =>
      Number(
        (await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ingredient } })).onHand,
      )
    const refused = async (id: string, payload: unknown) => {
      const before = await flour()
      const res = await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ payload })
        .expect(400)
      expect(await flour()).toBe(before)
      const doc = await prisma.client.document.findUniqueOrThrow({ where: { id } })
      expect(doc.status).toBe('requires_review')
      return JSON.stringify(res.body)
    }

    test('a quantity that is not a number is refused, naming the line', async () => {
      const id = await reviewable('PROBE-VAL-1')
      const answer = await refused(id, {
        kind: 'invoice',
        items: [{ ...line, quantity: 'abc' }],
      })
      expect(answer).toMatch(/items\[0\]\.quantity/)
    })

    test('a quantity the column cannot hold is refused, not thrown', async () => {
      const id = await reviewable('PROBE-VAL-2')
      const answer = await refused(id, {
        kind: 'invoice',
        items: [{ ...line, quantity: 1e12 }],
      })
      expect(answer).toMatch(/items\[0\]\.quantity/)
    })

    test('a payload with no lines at all is refused', async () => {
      const id = await reviewable('PROBE-VAL-3')
      const answer = await refused(id, { kind: 'invoice', number: 'PROBE-VAL-3' })
      expect(answer).toMatch(/items/)
    })

    test('a date that is not a date is refused before it reaches the database', async () => {
      const id = await reviewable('PROBE-VAL-4')
      const answer = await refused(id, {
        kind: 'invoice',
        invoiceDate: 'not-a-date',
        items: [line],
      })
      expect(answer).toMatch(/invoiceDate/)
    })

    test('an administrator correction is held to the same rule', async () => {
      const id = await reviewable('PROBE-VAL-5')
      const res = await request(http)
        .patch(`/api/admin/queue/${id}/extraction`)
        .set('Cookie', platformCookie)
        .send({ payload: { kind: 'invoice', items: [{ ...line, unitPrice: 1e12 }] } })
        .expect(400)
      expect(JSON.stringify(res.body)).toMatch(/items\[0\]\.unitPrice/)
      expect(await prisma.client.extraction.count({ where: { documentId: id } })).toBe(1)
    })

    test('a model answer that cannot be read fails the job with the reason', async () => {
      const body = Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number: 'PROBE-VAL-6',
          items: [{ ...line, quantity: 'abc' }],
        }),
      )
      const id = await upload('invoice', 'PROBE-VAL-6.json', 'application/json', body)
      documents.push(id)
      expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('failed')
      const doc = await prisma.client.document.findUniqueOrThrow({ where: { id } })
      expect(doc.error).toMatch(/could not be read/)
      expect(doc.error).toMatch(/items\[0\]\.quantity/)
    })
  })

  describe('a location is a boundary for a record reached by id, not only in a list', () => {
    let managerCookie = ''
    let airport = ''
    let elsewhere = ''

    beforeAll(async () => {
      managerCookie = await login('maria@goldenfork.com')
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      airport = (
        await prisma.client.location.findFirstOrThrow({
          where: { organizationId: org.id, name: { contains: 'Airport' } },
        })
      ).id
      const body = Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number: `E2E-REACH-${Date.now()}`,
          vendorName: 'Dairy Direct',
          items: [{ rawName: 'All-Purpose Flour', quantity: 1, unit: 'kg', unitPrice: 2 }],
        }),
      )
      elsewhere = await upload('invoice', 'reach.json', 'application/json', body, airport)
      expect(await waitForStatus(elsewhere, goldenForkCookie, 'requires_review')).toBe(
        'requires_review',
      )
    })

    afterAll(async () => {
      await prisma.client.document.deleteMany({ where: { id: elsewhere } })
    })

    test('the list already hides it', async () => {
      const res = await request(http).get('/api/documents').set('Cookie', managerCookie).expect(200)
      expect((res.body as { data: { id: string }[] }).data.some((d) => d.id === elsewhere)).toBe(
        false,
      )
    })

    test('reading it by id is refused too', async () => {
      await request(http)
        .get(`/api/documents/${elsewhere}`)
        .set('Cookie', managerCookie)
        .expect(404)
    })

    test('and it cannot be applied from a location they do work at', async () => {
      await request(http)
        .post(`/api/documents/${elsewhere}/confirm`)
        .set('Cookie', managerCookie)
        .set('X-Location-Id', locationId)
        .expect(404)
      const untouched = await prisma.client.document.findUniqueOrThrow({
        where: { id: elsewhere },
      })
      expect(untouched.status).toBe('requires_review')
    })

    test('someone who works everywhere still reaches it', async () => {
      await request(http)
        .get(`/api/documents/${elsewhere}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
    })
  })

  describe('a chef finishes the document in front of them and curates nothing', () => {
    let vendorId = ''
    let ingredientId = ''
    const rawName = 'CHEF PROBE WORDING'
    const documents: string[] = []

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      vendorId = (
        await prisma.client.vendor.findFirstOrThrow({
          where: { organizationId: org.id, name: 'Dairy Direct' },
        })
      ).id
      ingredientId = (
        await prisma.client.ingredient.findFirstOrThrow({
          where: { organizationId: org.id, name: 'Unsalted Butter' },
        })
      ).id
    })

    afterAll(async () => {
      await prisma.client.vendorProduct.deleteMany({ where: { name: rawName } })
      await prisma.client.document.deleteMany({ where: { id: { in: documents } } })
    })

    test('the catalogue itself is closed to them', async () => {
      await request(http)
        .post('/api/vendor-products')
        .set('Cookie', staffCookie)
        .send({ vendorId, name: 'Chef Probe Curation' })
        .expect(403)
    })

    test('a name their own document carries is theirs to place', async () => {
      const body = Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number: `E2E-CHEF-${Date.now()}`,
          vendorName: 'Dairy Direct',
          items: [{ rawName, quantity: 1, unit: 'kg', unitPrice: 5 }],
        }),
      )
      const id = await upload('invoice', 'chef-map.json', 'application/json', body)
      documents.push(id)
      expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')

      await request(http)
        .post(`/api/documents/${id}/map`)
        .set('Cookie', staffCookie)
        .set('X-Location-Id', locationId)
        .send({ rawName, ingredientId })
        .expect(201)

      const written = await prisma.client.vendorProduct.findFirstOrThrow({
        where: { vendorId, name: rawName },
      })
      expect(written.ingredientId).toBe(ingredientId)
    })
  })

  describe('an invoice number is claimed once by the vendor that wrote it', () => {
    let organizationId = ''
    let airport = ''
    let ingredient = ''
    let seeded: Awaited<ReturnType<typeof snapshotIngredient>> | null = null
    const documents: string[] = []

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      organizationId = org.id
      airport = (
        await prisma.client.location.findFirstOrThrow({
          where: { organizationId, name: { contains: 'Airport' } },
        })
      ).id
      ingredient = (
        await prisma.client.ingredient.findFirstOrThrow({
          where: { organizationId, name: 'All-Purpose Flour' },
        })
      ).id
      seeded = await snapshotIngredient(ingredient)
    })

    afterAll(async () => {
      await prisma.client.invoice.deleteMany({
        where: { organizationId, number: { startsWith: 'PROBE-NUM-' } },
      })
      await prisma.client.document.deleteMany({ where: { id: { in: documents } } })
      await prisma.client.inventoryTransaction.deleteMany({
        where: { ingredientId: ingredient, notes: { startsWith: 'Invoice PROBE-NUM-' } },
      })
      if (seeded) await restoreIngredient(seeded)
    })

    const send = async (number: string, vendorName: string, at: string, expected: number) => {
      const body = Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number,
          vendorName,
          items: [{ rawName: 'All-Purpose Flour', quantity: 1, unit: 'kg', unitPrice: 1 }],
        }),
      )
      const id = await upload('invoice', `${number}-${at}.json`, 'application/json', body, at)
      documents.push(id)
      expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')
      return request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', at)
        .expect(expected)
    }

    test('the same paper cannot be received twice, even at another location', async () => {
      await send('PROBE-NUM-1', 'Dairy Direct', locationId, 201)
      const again = await send('PROBE-NUM-1', 'Dairy Direct', airport, 409)
      expect(JSON.stringify(again.body)).toMatch(/already recorded/)
    })

    test('two vendors may each write the same number', async () => {
      await send('PROBE-NUM-2', 'Dairy Direct', locationId, 201)
      await send('PROBE-NUM-2', 'Prime Meats Co.', locationId, 201)
    })

    test('a paper naming no vendor is not held to a number at all', async () => {
      await send('PROBE-NUM-3', '', locationId, 201)
      await send('PROBE-NUM-3', '', locationId, 201)
    })

    test('a vendor not in the catalogue is held to its number by the name the paper prints', async () => {
      await send('PROBE-NUM-4', 'Probe Unlisted Supplier', locationId, 201)
      await send('PROBE-NUM-4', 'probe unlisted supplier', locationId, 409)
      await send('PROBE-NUM-4', 'Probe Other Unlisted', locationId, 201)
    })
  })

  describe('an invoice a confirm left is the record of what it moved', () => {
    let organizationId = ''
    let ingredient = ''
    let seeded: Awaited<ReturnType<typeof snapshotIngredient>> | null = null
    const documents: string[] = []

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      organizationId = org.id
      ingredient = (
        await prisma.client.ingredient.findFirstOrThrow({
          where: { organizationId, name: 'All-Purpose Flour' },
        })
      ).id
      seeded = await snapshotIngredient(ingredient)
    })

    afterAll(async () => {
      await prisma.client.invoice.deleteMany({
        where: { organizationId, number: { startsWith: 'PROBE-REC-' } },
      })
      await prisma.client.document.deleteMany({ where: { id: { in: documents } } })
      await prisma.client.inventoryTransaction.deleteMany({
        where: { ingredientId: ingredient, notes: { startsWith: 'Invoice PROBE-REC-' } },
      })
      if (seeded) await restoreIngredient(seeded)
    })

    const confirmPaper = async (number: string) => {
      const body = Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number,
          vendorName: 'Dairy Direct',
          items: [{ rawName: 'All-Purpose Flour', quantity: 1, unit: 'kg', unitPrice: 1 }],
        }),
      )
      const id = await upload('invoice', `${number}.json`, 'application/json', body)
      documents.push(id)
      expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')
      await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      return prisma.client.invoice.findFirstOrThrow({ where: { organizationId, number } })
    }

    test('two lines of one ingredient move its stock by both and leave the price of the later', async () => {
      const where = { ingredientId_locationId: { ingredientId: ingredient, locationId } }
      const stockBefore = Number(
        (await prisma.client.ingredientLocationStock.findUniqueOrThrow({ where })).onHand,
      )
      const historyBefore = await prisma.client.ingredientPriceHistory.count({
        where: { ingredientId: ingredient },
      })
      const body = Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number: 'PROBE-REC-TWICE',
          vendorName: 'Dairy Direct',
          items: [
            { rawName: 'All-Purpose Flour', quantity: 2, unit: 'kg', unitPrice: 1.5 },
            { rawName: 'all-purpose flour', quantity: 500, unit: 'g', unitPrice: 0.002 },
          ],
        }),
      )
      const id = await upload('invoice', 'PROBE-REC-TWICE.json', 'application/json', body)
      documents.push(id)
      expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')
      const res = await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      expect(res.body).toMatchObject({ status: 'confirmed', applied: 2 })

      expect(
        Number((await prisma.client.ingredientLocationStock.findUniqueOrThrow({ where })).onHand),
      ).toBeCloseTo(stockBefore + 2.5, 3)
      expect(
        Number(
          (await prisma.client.ingredientLocationSettings.findUniqueOrThrow({ where })).costPerUnit,
        ),
      ).toBe(2)
      const history = await prisma.client.ingredientPriceHistory.findMany({
        where: { ingredientId: ingredient },
        orderBy: { recordedAt: 'asc' },
        skip: historyBefore,
      })
      expect(history.map((h) => Number(h.costPerUnit))).toEqual([1.5, 2])
      const moves = await prisma.client.inventoryTransaction.findMany({
        where: { ingredientId: ingredient, notes: 'Invoice PROBE-REC-TWICE' },
        select: { quantity: true },
      })
      expect(moves.map((m) => Number(m.quantity)).sort()).toEqual([0.5, 2])
    })

    test('it cannot be deleted, so the same paper cannot be received a second time', async () => {
      const invoice = await confirmPaper('PROBE-REC-1')

      const refused = await request(http)
        .delete(`/api/invoices/${invoice.id}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(409)
      expect(JSON.stringify(refused.body)).toMatch(/record of what it moved/)

      expect(await prisma.client.invoice.findUnique({ where: { id: invoice.id } })).not.toBeNull()

      const body = Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number: 'PROBE-REC-1',
          vendorName: 'Dairy Direct',
          items: [{ rawName: 'All-Purpose Flour', quantity: 1, unit: 'kg', unitPrice: 1 }],
        }),
      )
      const twin = await upload('invoice', 'PROBE-REC-1-twin.json', 'application/json', body)
      documents.push(twin)
      expect(await waitForStatus(twin, goldenForkCookie, 'requires_review')).toBe('requires_review')
      await request(http)
        .post(`/api/documents/${twin}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(409)
    })

    test('nor can its number be rewritten', async () => {
      const invoice = await confirmPaper('PROBE-REC-2')

      await request(http)
        .patch(`/api/invoices/${invoice.id}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ number: 'PROBE-REC-2-EDITED' })
        .expect(409)

      const still = await prisma.client.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
      expect(still.number).toBe('PROBE-REC-2')
    })

    test('an invoice entered by hand moved nothing, so it stays deletable', async () => {
      const created = await request(http)
        .post('/api/invoices')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({
          number: 'PROBE-REC-3',
          invoiceDate: '2026-09-01',
          items: [{ description: 'Typed by hand', quantity: 1, unit: 'kg', unitPrice: 1 }],
        })
        .expect(201)

      await request(http)
        .delete(`/api/invoices/${(created.body as { id: string }).id}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(200)
    })
  })

  test('a POS wording parked at a location is curated only by those who work there', async () => {
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const airport = await prisma.client.location.findFirstOrThrow({
      where: { organizationId: org.id, name: { endsWith: 'Airport' } },
    })
    const alias = await prisma.client.menuItemAlias.create({
      data: {
        organizationId: org.id,
        locationId: airport.id,
        rawName: `PROBE AIRPORT WORDING ${Date.now()}`,
      },
    })
    try {
      const maria = await login('maria@goldenfork.com')
      const listed = await request(http)
        .get('/api/documents/menu-item-aliases')
        .set('Cookie', maria)
        .expect(200)
      expect((listed.body as { id: string }[]).map((a) => a.id)).not.toContain(alias.id)
      await request(http)
        .post(`/api/documents/menu-item-aliases/${alias.id}`)
        .set('Cookie', maria)
        .send({ menuItemId: null })
        .expect(404)
      await request(http)
        .delete(`/api/documents/menu-item-aliases/${alias.id}`)
        .set('Cookie', maria)
        .expect(404)
      expect(await prisma.client.menuItemAlias.count({ where: { id: alias.id } })).toBe(1)
    } finally {
      await prisma.client.menuItemAlias.deleteMany({ where: { id: alias.id } })
    }
  })

  describe('a POS wording means what this location serves', () => {
    let organizationId = ''
    let airport = ''
    let downtown = ''
    let airportDish = ''
    let downtownDish = ''
    const documents: string[] = []

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      organizationId = org.id
      airport = (
        await prisma.client.location.findFirstOrThrow({
          where: { organizationId, name: { contains: 'Airport' } },
        })
      ).id
      downtown = locationId
      airportDish = (
        await prisma.client.menuItem.create({
          data: { organizationId, locationId: airport, name: 'Probe Only Here', price: 40 },
        })
      ).id
      downtownDish = (
        await prisma.client.menuItem.create({
          data: { organizationId, locationId: downtown, name: 'Probe Only Here', price: 30 },
        })
      ).id
    })

    afterAll(async () => {
      await prisma.client.sale.deleteMany({
        where: { organizationId, date: onDay('2026-09-06') },
      })
      await prisma.client.menuItemAlias.deleteMany({ where: { rawName: 'POS PROBE WORDING' } })
      await prisma.client.document.deleteMany({ where: { id: { in: documents } } })
      await prisma.client.menuItem.deleteMany({
        where: { id: { in: [airportDish, downtownDish] } },
      })
    })

    test('a wording bound at one location does not cost a sale at another', async () => {
      await prisma.client.menuItemAlias.create({
        data: {
          organizationId,
          locationId: airport,
          rawName: 'POS PROBE WORDING',
          menuItemId: airportDish,
        },
      })

      const body = Buffer.from(
        JSON.stringify({
          kind: 'sales',
          date: '2026-09-06',
          items: [{ menuItemName: 'POS PROBE WORDING', quantity: 2, unitPrice: 30 }],
        }),
      )
      const id = await upload('sales', 'pos-probe.json', 'application/json', body)
      documents.push(id)
      expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')
      const applied = await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .expect(201)
      expect((applied.body as { unmapped: number }).unmapped).toBe(1)

      const sold = await prisma.client.saleItem.findMany({
        where: { menuItemId: airportDish },
      })
      expect(sold).toHaveLength(0)
    })

    test('the wording parks at the location that could not place it', async () => {
      const res = await request(http)
        .get('/api/documents/menu-item-aliases')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .expect(200)
      const rows = res.body as {
        id: string
        rawName: string
        locationId: string | null
        menuItemId: string | null
      }[]
      const parked = rows.filter((r) => r.rawName === 'POS PROBE WORDING')
      expect(parked).toHaveLength(1)
      expect(parked[0].locationId).toBe(downtown)
      expect(parked[0].menuItemId).toBeNull()

      await request(http)
        .post(`/api/documents/menu-item-aliases/${parked[0].id}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({ menuItemId: downtownDish })
        .expect(201)

      const again = await request(http)
        .post('/api/documents/menu-item-aliases')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', downtown)
        .send({ rawName: 'pos probe wording', menuItemId: downtownDish })
        .expect(409)
      expect(JSON.stringify(again.body)).toMatch(/already on the list/)
    })

    test('the same wording still resolves to each location own dish', async () => {
      const at = async (location: string, dish: string) => {
        const body = Buffer.from(
          JSON.stringify({
            kind: 'sales',
            date: '2026-09-06',
            items: [{ menuItemName: 'POS PROBE WORDING', quantity: 1, unitPrice: 30 }],
          }),
        )
        const id = await upload('sales', `pos-${location}.json`, 'application/json', body, location)
        documents.push(id)
        expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')
        await request(http)
          .post(`/api/documents/${id}/confirm`)
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', location)
          .expect(201)
        const sold = await prisma.client.saleItem.findMany({ where: { menuItemId: dish } })
        expect(sold.length).toBeGreaterThan(0)
      }

      await at(downtown, downtownDish)
      await at(airport, airportDish)
    })
  })

  describe('a line is read in the catalogue of the vendor that sent it', () => {
    const PRODUCT = 'PV MYSTERY GOODS 1LB'
    let organizationId = ''
    let vendorId = ''
    let otherVendorName = ''
    let ingredientId = ''
    const documents: string[] = []

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      organizationId = org.id
      vendorId = (
        await prisma.client.vendor.create({
          data: { organizationId, name: 'Probe Vendor Catalogue' },
        })
      ).id
      otherVendorName = (
        await prisma.client.vendor.findFirstOrThrow({
          where: { organizationId, id: { not: vendorId } },
          orderBy: { name: 'asc' },
        })
      ).name
      ingredientId = (
        await prisma.client.ingredient.create({
          data: { organizationId, name: 'Probe Catalogue Ingredient', unit: 'kg', costPerUnit: 3 },
        })
      ).id
      await prisma.client.vendorProduct.create({
        data: {
          organizationId,
          vendorId,
          ingredientId,
          name: PRODUCT,
          sku: 'PV-9',
        },
      })
    })

    afterAll(async () => {
      await prisma.client.document.deleteMany({ where: { id: { in: documents } } })
      await prisma.client.invoice.deleteMany({
        where: { organizationId, number: { startsWith: 'PROBE-CAT-' } },
      })
      await prisma.client.vendorProduct.deleteMany({ where: { name: PRODUCT } })
      await prisma.client.ingredient.delete({ where: { id: ingredientId } })
      await prisma.client.vendor.delete({ where: { id: vendorId } })
    })

    const confirmInvoice = async (number: string, vendorName: string, rawName: string) => {
      const body = Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number,
          vendorName,
          items: [{ rawName, quantity: 4, unit: 'kg', unitPrice: 3 }],
        }),
      )
      const id = await upload('invoice', `${number}.json`, 'application/json', body)
      documents.push(id)
      expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')
      const res = await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      return res.body as { status: string; unmapped: number }
    }

    test('the name the vendor prints reaches the ingredient it stands for', async () => {
      const before = Number(
        (await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ingredientId } })).onHand,
      )
      const applied = await confirmInvoice('PROBE-CAT-1', 'Probe Vendor Catalogue', PRODUCT)
      expect(applied.status).toBe('confirmed')
      const after = await prisma.client.ingredient.findUniqueOrThrow({
        where: { id: ingredientId },
      })
      expect(Number(after.onHand)).toBeCloseTo(before + 4, 3)
    })

    test('the code the line prints outranks the name beside it', async () => {
      const other = await prisma.client.ingredient.create({
        data: {
          organizationId,
          name: 'Probe Catalogue Decoy',
          unit: 'kg',
          costPerUnit: 3,
        },
      })
      await prisma.client.vendorProduct.create({
        data: {
          organizationId,
          vendorId,
          ingredientId: other.id,
          name: 'ZZ DECOY NAME',
          sku: 'ZZ-999',
        },
      })
      const before = Number(
        (await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ingredientId } })).onHand,
      )

      const number = 'PROBE-CAT-3'
      const body = Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number,
          vendorName: 'Probe Vendor Catalogue',
          items: [{ rawName: 'ZZ DECOY NAME', sku: 'PV-9', quantity: 4, unit: 'kg', unitPrice: 3 }],
        }),
      )
      const id = await upload('invoice', `${number}.json`, 'application/json', body)
      documents.push(id)
      expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')
      await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)

      const decoy = await prisma.client.ingredient.findUniqueOrThrow({ where: { id: other.id } })
      const target = await prisma.client.ingredient.findUniqueOrThrow({
        where: { id: ingredientId },
      })
      expect(Number(decoy.onHand)).toBe(0)
      expect(Number(target.onHand)).toBeCloseTo(before + 4, 3)

      await prisma.client.vendorProduct.deleteMany({ where: { name: 'ZZ DECOY NAME' } })
      await prisma.client.ingredient.delete({ where: { id: other.id } })
    })

    test('a name mapped while reviewing belongs to the vendor that wrote it', async () => {
      const WORDING = 'PV BOUND WORDING'
      const number = 'PROBE-CAT-6'
      const body = Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number,
          vendorName: 'Probe Vendor Catalogue',
          items: [{ rawName: WORDING, quantity: 2, unit: 'kg', unitPrice: 3 }],
        }),
      )
      const id = await upload('invoice', `${number}.json`, 'application/json', body)
      documents.push(id)
      expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')

      await request(http)
        .post(`/api/documents/${id}/map`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ rawName: WORDING, ingredientId })
        .expect(201)

      const bound = await prisma.client.vendorProduct.findFirst({
        where: { organizationId, vendorId, name: WORDING },
      })
      expect(bound?.ingredientId).toBe(ingredientId)
      const loose = await prisma.client.ingredientAlias.findFirst({
        where: { organizationId, rawName: WORDING },
      })
      expect(loose).toBeNull()

      const applied = await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      expect((applied.body as { status: string }).status).toBe('confirmed')

      const elsewhere = await confirmInvoice('PROBE-CAT-7', otherVendorName, WORDING)
      expect(elsewhere.status).toBe('partially_processed')

      await prisma.client.vendorProduct.deleteMany({ where: { name: WORDING } })
    })

    test('parking two lines that print one code leaves that code on one product', async () => {
      const body = Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number: 'PROBE-CAT-5',
          vendorName: 'Probe Vendor Catalogue',
          items: [
            { rawName: 'Probe Dup One', sku: 'DUP-1', quantity: 1, unit: 'kg', unitPrice: 1 },
            { rawName: 'Probe Dup Two', sku: 'DUP-1', quantity: 1, unit: 'kg', unitPrice: 1 },
          ],
        }),
      )
      const id = await upload('invoice', 'PROBE-CAT-5.json', 'application/json', body)
      documents.push(id)
      expect(await waitForStatus(id, goldenForkCookie, 'requires_review')).toBe('requires_review')
      await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)

      const coded = await prisma.client.vendorProduct.findMany({
        where: { organizationId, vendorId, sku: 'DUP-1' },
      })
      expect(coded).toHaveLength(1)
      const parked = await prisma.client.vendorProduct.findMany({
        where: { organizationId, vendorId, name: { startsWith: 'Probe Dup' } },
      })
      expect(parked).toHaveLength(2)
    })

    test('a product taken off the catalogue still reads a document that names it', async () => {
      await prisma.client.vendorProduct.updateMany({
        where: { organizationId, vendorId, name: PRODUCT },
        data: { isActive: false },
      })
      try {
        const applied = await confirmInvoice('PROBE-CAT-4', 'Probe Vendor Catalogue', PRODUCT)
        expect(applied.status).toBe('confirmed')
      } finally {
        await prisma.client.vendorProduct.updateMany({
          where: { organizationId, vendorId, name: PRODUCT },
          data: { isActive: true },
        })
      }
    })

    test('the same name from another vendor reaches nothing and is parked under that vendor', async () => {
      const applied = await confirmInvoice('PROBE-CAT-2', otherVendorName, PRODUCT)
      expect(applied.status).toBe('partially_processed')
      expect(applied.unmapped).toBe(1)

      const parked = await prisma.client.vendorProduct.findFirstOrThrow({
        where: { organizationId, name: PRODUCT, vendor: { name: otherVendorName } },
      })
      expect(parked.ingredientId).toBeNull()
    })
  })
  describe('a workbook of many recipes does not hide the documents still waiting', () => {
    const prefix = `e2e-many-${Date.now()}`
    const waiting: string[] = []

    beforeAll(async () => {
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const base = {
        organizationId: org.id,
        locationId,
        type: 'recipe' as const,
        mimeType: 'text/plain',
        size: 1,
      }
      const start = Date.now() - 1_000_000
      for (let i = 0; i < 3; i++) {
        const doc = await prisma.client.document.create({
          data: {
            ...base,
            fileKey: `${prefix}/book`,
            fileName: 'book.xlsx',
            status: 'requires_review',
            createdAt: new Date(start + i),
          },
        })
        waiting.push(doc.id)
      }
      await prisma.client.document.createMany({
        data: Array.from({ length: 201 }, (_, i) => ({
          ...base,
          fileKey: `${prefix}/done-${i}`,
          fileName: `done-${i}.xlsx`,
          status: 'confirmed' as const,
          createdAt: new Date(start + 1000 + i),
        })),
      })
    })

    afterAll(async () => {
      await prisma.client.document.deleteMany({ where: { fileKey: { startsWith: prefix } } })
    })

    test('every document still waiting for review is one filter away, numbered within its whole file', async () => {
      const res = await request(http)
        .get('/api/documents?status=requires_review&limit=200')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const rows = (
        res.body as {
          data: {
            id: string
            status: string
            part: { index: number; of: number; group: string } | null
          }[]
        }
      ).data
      expect(rows.every((d) => d.status === 'requires_review')).toBe(true)
      const listed = rows.filter((d) => waiting.includes(d.id))
      expect(new Set(listed.map((d) => d.part?.group))).toEqual(new Set([waiting[0]]))
      expect(listed.map((d) => d.part && { index: d.part.index, of: d.part.of })).toEqual([
        { index: 3, of: 3 },
        { index: 2, of: 3 },
        { index: 1, of: 3 },
      ])
    })

    test('the finished documents are all counted and read a page at a time', async () => {
      const first = await request(http)
        .get('/api/documents?status=confirmed')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const page = first.body as { data: unknown[]; pagination: { total: number } }
      expect(page.data).toHaveLength(50)
      expect(page.pagination.total).toBeGreaterThanOrEqual(201)
      const summary = await request(http)
        .get('/api/documents/summary')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      expect(summary.body.requires_review).toBeGreaterThanOrEqual(3)
      expect(summary.body.confirmed).toBe(page.pagination.total)
    })
  })
  describe('one part a model could not read does not take the rest of the file with it', () => {
    let fileKey = ''

    afterAll(async () => {
      if (fileKey) await prisma.client.document.deleteMany({ where: { fileKey } })
    })

    test('a line naming nothing and a name too long are fitted, and an unreadable part fails alone', async () => {
      const stamp = Date.now()
      const long = `E2E Fitted ${stamp} ${'and a very long description '.repeat(8)}`
      const body = Buffer.from(
        JSON.stringify([
          {
            kind: 'recipe',
            name: `E2E Whole ${stamp}`,
            items: [{ rawName: 'Unsalted Butter', quantity: 1, unit: 'kg' }],
          },
          {
            kind: 'recipe',
            name: long,
            yieldQty: 2,
            yieldUnit: 'a batch of about two litres',
            items: [
              { rawName: '', quantity: 1, unit: 'g' },
              { rawName: 'Unsalted Butter', quantity: 50, unit: 'g' },
            ],
          },
          { kind: 'recipe', name: `E2E Broken ${stamp}`, items: 'see the attached sheet' },
        ]),
      )
      const id = await upload('recipe', `fitted-${stamp}.json`, 'application/json', body)
      await waitForStatus(id, goldenForkCookie, 'requires_review')
      fileKey = (await prisma.client.document.findUniqueOrThrow({ where: { id } })).fileKey
      let parts: { id: string; status: string; fileName: string; error: string | null }[] = []
      for (let i = 0; i < 40 && parts.length < 3; i++) {
        parts = await prisma.client.document.findMany({
          where: { fileKey },
          select: { id: true, status: true, fileName: true, error: true },
          orderBy: { fileName: 'asc' },
        })
        if (parts.length < 3) await new Promise((r) => setTimeout(r, 250))
      }
      expect(parts.map((p) => p.status).sort()).toEqual([
        'failed',
        'requires_review',
        'requires_review',
      ])
      const failed = parts.find((p) => p.status === 'failed')!
      expect(failed.fileName).toMatch(/\(3\/3\)$/)
      expect(failed.error).toMatch(/could not be read: items/)
      const again = await request(http)
        .post(`/api/documents/${failed.id}/retry`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(409)
      expect((again.body as { error: { code: string } }).error.code).toBe(
        'DOCUMENT_PART_NOT_RETRIED',
      )

      const stored = await prisma.client.extraction.findMany({ where: { document: { fileKey } } })
      const second = stored
        .map((e) => e.payload as { name: string; yieldUnit?: string; items: unknown[] })
        .find((p) => p.name.startsWith(`E2E Fitted ${stamp}`))!
      expect(second.name.length).toBeLessThanOrEqual(120)
      expect(second.yieldUnit).toBeUndefined()
      expect(second.items).toHaveLength(1)
    })
  })

  describe('a file from a real kitchen is read as the kitchen wrote it', () => {
    const fileKeys: string[] = []
    const stamp = Date.now()

    afterAll(async () => {
      const recipes = await prisma.client.recipe.findMany({
        where: { name: { contains: `E2E Kitchen ${stamp}` } },
        select: { id: true },
      })
      const ids = recipes.map((r) => r.id)
      await prisma.client.recipeIngredient.deleteMany({ where: { recipeId: { in: ids } } })
      await prisma.client.recipeComponent.deleteMany({
        where: { OR: [{ parentId: { in: ids } }, { componentId: { in: ids } }] },
      })
      await prisma.client.recipe.deleteMany({ where: { id: { in: ids } } })
      await prisma.client.ingredient.deleteMany({
        where: { name: { contains: `E2E Kitchen ${stamp}` } },
      })
      await prisma.client.document.deleteMany({ where: { fileKey: { in: fileKeys } } })
    })

    const uploaded = async (type: string, name: string, payloads: unknown[]) => {
      const id = await upload(type, name, 'application/json', Buffer.from(JSON.stringify(payloads)))
      await waitForStatus(id, goldenForkCookie, 'requires_review')
      const { fileKey } = await prisma.client.document.findUniqueOrThrow({ where: { id } })
      fileKeys.push(fileKey)
      for (let i = 0; i < 40; i++) {
        const parts = await prisma.client.document.findMany({
          where: { fileKey },
          include: { extractions: { take: 1, orderBy: { createdAt: 'desc' } } },
        })
        if (parts.length >= payloads.length || i === 39)
          return new Map(
            parts.map((d) => [(d.extractions[0]?.payload as { name?: string })?.name ?? '', d.id]),
          )
        await new Promise((r) => setTimeout(r, 250))
      }
      return new Map<string, string>()
    }
    const confirm = (id: string) =>
      request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ createMissing: true })

    test('a recipe confirmed alone waits for a recipe of its file instead of buying it as an ingredient', async () => {
      const shared = `E2E Kitchen ${stamp} Compound Butter`
      const docs = await uploaded('recipe', `kitchen-${stamp}.json`, [
        {
          kind: 'recipe',
          name: `E2E Kitchen ${stamp} Pilaf`,
          items: [{ rawName: shared, quantity: 2, unit: 'tbsp' }],
        },
        {
          kind: 'recipe',
          name: `E2E Kitchen ${stamp} Corn`,
          items: [{ rawName: shared, quantity: 1, unit: 'tbsp' }],
        },
        {
          kind: 'recipe',
          name: shared,
          items: [{ rawName: 'Unsalted Butter', quantity: 1, unit: 'kg' }],
        },
      ])
      const res = await confirm(docs.get(`E2E Kitchen ${stamp} Pilaf`)!).expect(400)
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'RECIPE_COMPONENTS_UNCONFIRMED',
      )
      expect(await prisma.client.ingredient.count({ where: { name: shared } })).toBe(0)
    })

    test('a line naming a catalogue ingredient in the singular or with how it is cut reaches it', async () => {
      const before = await prisma.client.ingredient.count()
      const name = `E2E Kitchen ${stamp} Omelette`
      const docs = await uploaded('recipe', `eggs-${stamp}.json`, [
        { kind: 'recipe', name, items: [{ rawName: 'Egg, whole', quantity: 2, unit: 'ea' }] },
      ])
      await confirm(docs.get(name)!).expect(201)
      expect(await prisma.client.ingredient.count()).toBe(before)
      const lines = await prisma.client.recipeIngredient.findMany({
        where: { recipe: { name } },
        include: { ingredient: { select: { name: true } } },
      })
      expect(lines.map((l) => l.ingredient.name)).toEqual(['Eggs'])
    })

    test('a document with nothing read on it is not recorded as confirmed', async () => {
      const id = await upload(
        'sales',
        `empty-${stamp}.json`,
        'application/json',
        Buffer.from(JSON.stringify({ kind: 'sales', date: '2026-10-01', items: [] })),
      )
      await waitForStatus(id, goldenForkCookie, 'requires_review')
      fileKeys.push((await prisma.client.document.findUniqueOrThrow({ where: { id } })).fileKey)
      const res = await confirm(id).expect(400)
      expect((res.body as { error: { code: string } }).error.code).toBe('DOCUMENT_EMPTY')
      expect((await prisma.client.document.findUniqueOrThrow({ where: { id } })).status).toBe(
        'requires_review',
      )
    })

    test('a price far from what the location pays is pointed out before it is confirmed', async () => {
      const id = await upload(
        'invoice',
        `jump-${stamp}.json`,
        'application/json',
        Buffer.from(
          JSON.stringify({
            kind: 'invoice',
            number: `E2E-JUMP-${stamp}`,
            items: [
              { rawName: 'Unsalted Butter', quantity: 2, unit: 'kg', unitPrice: 20230450 },
              { rawName: 'Eggs', quantity: 12, unit: 'ea', unitPrice: 0.4 },
            ],
          }),
        ),
      )
      await waitForStatus(id, goldenForkCookie, 'requires_review')
      fileKeys.push((await prisma.client.document.findUniqueOrThrow({ where: { id } })).fileKey)
      const res = await request(http)
        .get(`/api/documents/${id}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(200)
      const jumps = (
        res.body as { priceJumps: { rawName: string; stated: number; now: number; unit: string }[] }
      ).priceJumps
      expect(jumps.map((j) => j.rawName)).toEqual(['Unsalted Butter'])
      expect(jumps[0]).toMatchObject({ stated: 20230450, unit: 'kg' })
      expect(jumps[0].now).toBeGreaterThan(0)
    })
  })

  describe('the review says what would stop a confirm, line by line, before it is pressed', () => {
    const fileKeys: string[] = []
    const stamp = Date.now()
    type Issue = {
      severity: string
      code: string
      message: string
      part?: number | null
      line?: number
      field?: string
    }

    afterAll(async () => {
      await prisma.client.ingredientAlias.deleteMany({
        where: { rawName: { contains: `E2E Check ${stamp}` } },
      })
      await prisma.client.document.deleteMany({ where: { fileKey: { in: fileKeys } } })
    })

    const uploaded = async (type: string, payload: unknown) => {
      const id = await upload(
        type,
        `check-${type}-${stamp}-${fileKeys.length}.json`,
        'application/json',
        Buffer.from(JSON.stringify(payload)),
      )
      await waitForStatus(id, goldenForkCookie, 'requires_review')
      fileKeys.push((await prisma.client.document.findUniqueOrThrow({ where: { id } })).fileKey)
      return id
    }
    const check = async (id: string, body: object = {}) =>
      (
        (
          await request(http)
            .post(`/api/documents/${id}/check`)
            .set('Cookie', goldenForkCookie)
            .set('X-Location-Id', locationId)
            .send(body)
            .expect(200)
        ).body as { issues: Issue[] }
      ).issues

    test('each problem of a recipe is named on its own line and field, and nothing is written', async () => {
      const unknown = `E2E Check ${stamp} Saffron`
      const recipe = {
        kind: 'recipe',
        name: `E2E Check ${stamp} Paella`,
        items: [
          { rawName: 'Unsalted Butter', quantity: 1, unit: 'a handful' },
          { rawName: unknown, quantity: 1, unit: 'g' },
          { rawName: 'Unsalted Butter', quantity: 2, unit: 'cup' },
          { rawName: 'Eggs', quantity: 0, unit: 'ea' },
        ],
      }
      const id = await uploaded('recipe', recipe)
      const aliases = await prisma.client.ingredientAlias.count()
      const issues = await check(id)
      expect(
        issues.map(({ severity, code, part, line, field }) => ({
          severity,
          code,
          part,
          line,
          field,
        })),
      ).toEqual([
        { severity: 'error', code: 'INGREDIENT_UNMAPPED', part: null, line: 1, field: 'rawName' },
        { severity: 'error', code: 'UNIT_NOT_A_UNIT', part: null, line: 0, field: 'unit' },
        { severity: 'error', code: 'UNIT_NOT_CONVERTIBLE', part: null, line: 2, field: 'unit' },
        { severity: 'warning', code: 'QUANTITY_MISSING', part: null, line: 3, field: 'quantity' },
      ])
      expect(issues[2].message).toBe(
        'Unsalted Butter is counted in kg, and cup does not convert to it; record a conversion, or choose a unit of the same kind',
      )
      expect(await prisma.client.ingredientAlias.count()).toBe(aliases)
      expect((await prisma.client.document.findUniqueOrThrow({ where: { id } })).status).toBe(
        'requires_review',
      )
    })

    test('the values being edited are checked, and a recipe the check passes is confirmed', async () => {
      const name = `E2E Check ${stamp} Shortbread`
      const id = await uploaded('recipe', {
        kind: 'recipe',
        name,
        items: [{ rawName: 'Unsalted Butter', quantity: 1, unit: 'a handful' }],
      })
      expect((await check(id)).map((i) => i.code)).toEqual(['UNIT_NOT_A_UNIT'])
      const fixed = {
        kind: 'recipe',
        name,
        items: [{ rawName: 'Unsalted Butter', quantity: 200, unit: 'g' }],
      }
      expect(await check(id, { payload: fixed })).toEqual([])
      await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ payload: fixed })
        .expect(201)
      const made = await prisma.client.recipe.findFirstOrThrow({ where: { name } })
      await prisma.client.recipeIngredient.deleteMany({ where: { recipeId: made.id } })
      await prisma.client.recipe.delete({ where: { id: made.id } })
    })

    test('a new ingredient written in two kinds of unit is pointed at before the confirm', async () => {
      const onion = `E2E Check ${stamp} Onion`
      const id = await uploaded('recipe', {
        kind: 'recipe',
        name: `E2E Check ${stamp} Soup`,
        subRecipes: [],
        items: [
          { rawName: onion, quantity: 2, unit: 'cup' },
          { rawName: `${onion}, diced`, quantity: 1, unit: 'lb' },
        ],
      })
      const issues = await check(id, { createMissing: true })
      expect(issues).toEqual([
        {
          severity: 'error',
          code: 'UNIT_NOT_CONVERTIBLE',
          part: null,
          line: 1,
          field: 'unit',
          message: `${onion} is new and will be counted in l, as another line states it, and lb does not convert to l; state its lines in units of one kind`,
        },
      ])
    })

    test('a recipe of the same file is named as waiting, and a sub-recipe problem names its part', async () => {
      const butter = `E2E Check ${stamp} Herb Butter`
      const ids = await Promise.all([
        uploaded('recipe', [
          {
            kind: 'recipe',
            name: `E2E Check ${stamp} Steak`,
            items: [{ rawName: butter, quantity: 1, unit: 'tbsp' }],
            subRecipes: [
              {
                name: `E2E Check ${stamp} Jus`,
                items: [{ rawName: 'Eggs', quantity: 1, unit: 'a handful' }],
              },
            ],
          },
          {
            kind: 'recipe',
            name: `E2E Check ${stamp} Fish`,
            items: [{ rawName: butter, quantity: 1, unit: 'tbsp' }],
          },
          {
            kind: 'recipe',
            name: butter,
            items: [{ rawName: 'Unsalted Butter', quantity: 1, unit: 'kg' }],
          },
        ]),
      ])
      const { fileKey } = await prisma.client.document.findUniqueOrThrow({ where: { id: ids[0] } })
      let steak: string | undefined
      for (let i = 0; i < 40 && !steak; i++) {
        const parts = await prisma.client.document.findMany({
          where: { fileKey },
          include: { extractions: { take: 1, orderBy: { createdAt: 'desc' } } },
        })
        steak = parts.find(
          (d) =>
            (d.extractions[0]?.payload as { name?: string })?.name === `E2E Check ${stamp} Steak`,
        )?.id
        if (!steak) await new Promise((r) => setTimeout(r, 250))
      }
      const issues = await check(steak!)
      expect(issues.map(({ code, part, line, field }) => ({ code, part, line, field }))).toEqual([
        { code: 'RECIPE_COMPONENTS_UNCONFIRMED', part: null, line: 0, field: 'rawName' },
        { code: 'UNIT_NOT_A_UNIT', part: 0, line: 0, field: 'unit' },
      ])
    })

    test('a line to taste is kept with no quantity and a size is counted, and the recipe confirms', async () => {
      const name = `E2E Check ${stamp} Fried Eggs`
      const recipe = {
        kind: 'recipe',
        name,
        items: [
          { rawName: 'Eggs', quantity: 2, unit: 'large' },
          { rawName: 'Unsalted Butter', quantity: 1, unit: 'to fry' },
        ],
      }
      const id = await uploaded('recipe', recipe)
      expect(await check(id)).toEqual([
        {
          severity: 'warning',
          code: 'QUANTITY_UNMEASURED',
          message:
            '"to fry": kept with no quantity, so it adds nothing to the cost; give it a quantity and a unit to cost it',
          part: null,
          line: 1,
          field: 'quantity',
        },
      ])
      await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      const made = await prisma.client.recipe.findFirstOrThrow({
        where: { name },
        include: { ingredients: { orderBy: { order: 'asc' }, include: { ingredient: true } } },
      })
      try {
        expect(
          made.ingredients.map((l) => ({
            name: l.ingredient.name,
            quantity: Number(l.quantity),
            unit: l.unit,
            prep: l.prepNote,
          })),
        ).toEqual([
          { name: 'Eggs', quantity: 2, unit: 'ea', prep: 'large' },
          { name: 'Unsalted Butter', quantity: 0, unit: 'kg', prep: 'to fry' },
        ])
      } finally {
        await prisma.client.recipeIngredient.deleteMany({ where: { recipeId: made.id } })
        await prisma.client.recipe.delete({ where: { id: made.id } })
      }
    })

    test('a quantity the paper writes as a choice is pointed out, and a serving word is kept as a note', async () => {
      const name = `E2E Check ${stamp} Chilled Eggs`
      const id = await uploaded('recipe', {
        kind: 'recipe',
        name,
        items: [
          { rawName: 'Eggs', quantity: 2, unit: 'ea', quantityText: '2 or 4' },
          { rawName: 'Unsalted Butter', quantity: 1, unit: 'chilled' },
        ],
      })
      expect(await check(id)).toEqual([
        {
          severity: 'warning',
          code: 'QUANTITY_UNMEASURED',
          message:
            '"chilled": kept with no quantity, so it adds nothing to the cost; give it a quantity and a unit to cost it',
          part: null,
          line: 1,
          field: 'quantity',
        },
        {
          severity: 'warning',
          code: 'QUANTITY_AS_WRITTEN',
          message: 'The paper writes "2 or 4"; 2 is taken, correct it if another is meant',
          part: null,
          line: 0,
          field: 'quantity',
        },
      ])
      await request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      const made = await prisma.client.recipe.findFirstOrThrow({
        where: { name },
        include: { ingredients: { orderBy: { order: 'asc' }, include: { ingredient: true } } },
      })
      try {
        expect(
          made.ingredients.map((l) => ({
            name: l.ingredient.name,
            quantity: Number(l.quantity),
            prep: l.prepNote,
          })),
        ).toEqual([
          { name: 'Eggs', quantity: 2, prep: null },
          { name: 'Unsalted Butter', quantity: 0, prep: 'chilled' },
        ])
      } finally {
        await prisma.client.recipeIngredient.deleteMany({ where: { recipeId: made.id } })
        await prisma.client.recipe.delete({ where: { id: made.id } })
      }
    })

    test('a new name written only to taste is left out, and a new one is counted in the unit a line states', async () => {
      const salt = `E2E Check ${stamp} Smoked Salt`
      const onion = `E2E Check ${stamp} Red Onion`
      const id = await uploaded('recipe', {
        kind: 'recipe',
        name: `E2E Check ${stamp} Salad`,
        items: [
          { rawName: salt, quantity: 1, unit: 'to taste' },
          { rawName: onion, quantity: 1, unit: 'large' },
          { rawName: `${onion}, sliced`, quantity: 1, unit: 'cup' },
        ],
      })
      const issues = await check(id, { createMissing: true })
      expect(issues.map(({ severity, code, line }) => ({ severity, code, line }))).toEqual([
        { severity: 'error', code: 'UNIT_NOT_CONVERTIBLE', line: 1 },
        { severity: 'warning', code: 'LINE_LEFT_OUT', line: 0 },
      ])
      expect(issues[0].message).toContain(`${onion} is new and will be counted in l`)
    })

    test('an invoice says which number is already recorded and which price is far from usual', async () => {
      const number = `E2E-CHECK-${stamp}`
      const vendor = await prisma.client.vendor.findFirstOrThrow({
        where: { organization: { name: 'The Golden Fork Group' } },
      })
      const invoice = await prisma.client.invoice.create({
        data: {
          organizationId: vendor.organizationId,
          vendorId: vendor.id,
          vendorName: vendor.name,
          number,
          status: 'draft',
          invoiceDate: new Date('2026-10-01'),
        },
      })
      try {
        const id = await uploaded('invoice', {
          kind: 'invoice',
          vendorName: vendor.name,
          number,
          items: [
            { rawName: 'Eggs', quantity: 12, unit: 'ea', unitPrice: 0.4 },
            { rawName: 'Unsalted Butter', quantity: 2, unit: 'kg', unitPrice: 20230450 },
          ],
        })
        const issues = await check(id)
        expect(
          issues.map(({ severity, code, line, field }) => ({ severity, code, line, field })),
        ).toEqual([
          { severity: 'error', code: 'INVOICE_ALREADY_RECORDED', line: undefined, field: 'number' },
          { severity: 'warning', code: 'DATE_MISSING', line: undefined, field: 'invoiceDate' },
          { severity: 'warning', code: 'PRICE_FAR_FROM_USUAL', line: 1, field: 'unitPrice' },
        ])
      } finally {
        await prisma.client.invoice.delete({ where: { id: invoice.id } })
      }
    })

    test('an invoice line that would receive no stock is marked, and its conversion is offered', async () => {
      const id = await uploaded('invoice', {
        kind: 'invoice',
        number: `E2E-UNITS-${stamp}`,
        items: [
          { rawName: 'Unsalted Butter', quantity: 1, unit: 'case', unitPrice: 40 },
          { rawName: `E2E Check ${stamp} Delivery Fee`, quantity: 1, unit: 'ea', unitPrice: 5 },
          { rawName: 'Eggs', quantity: 12, unit: 'ea', unitPrice: 0.4 },
        ],
      })
      const issues = await check(id)
      expect(
        issues.map(({ severity, code, line, field }) => ({ severity, code, line, field })),
      ).toEqual([
        { severity: 'warning', code: 'DATE_MISSING', line: undefined, field: 'invoiceDate' },
        { severity: 'warning', code: 'VENDOR_MISSING', line: undefined, field: 'vendorName' },
        { severity: 'error', code: 'UNIT_NOT_CONVERTIBLE', line: 0, field: 'unit' },
        { severity: 'warning', code: 'INVOICE_LINE_UNMAPPED', line: 1, field: 'rawName' },
      ])
      const detail = await request(http)
        .get(`/api/documents/${id}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(200)
      expect((detail.body as { unconverted: { from: string; to: string }[] }).unconverted).toEqual([
        expect.objectContaining({ rawName: 'Unsalted Butter', from: 'case', to: 'kg' }),
      ])
    })

    test('a sales line naming no dish of the location is pointed at before it is lost', async () => {
      const id = await uploaded('sales', {
        kind: 'sales',
        date: '2026-10-01',
        items: [{ menuItemName: `E2E Check ${stamp} Mystery Dish`, quantity: 2, unitPrice: 10 }],
      })
      expect(
        (await check(id)).map(({ severity, code, line, field }) => ({
          severity,
          code,
          line,
          field,
        })),
      ).toEqual([{ severity: 'warning', code: 'DISH_UNMAPPED', line: 0, field: 'menuItemName' }])
    })

    test('a sales report already recorded for its day is an error before it is confirmed', async () => {
      const price = 30 + (stamp % 1000) / 100
      const report = {
        kind: 'sales',
        date: '2026-09-30',
        items: [{ menuItemName: 'Steak Frites', quantity: 1, unitPrice: price }],
      }
      const first = await uploaded('sales', report)
      expect(await check(first)).toEqual([])
      await request(http)
        .post(`/api/documents/${first}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(201)
      try {
        const second = await uploaded('sales', report)
        expect(
          (await check(second)).map(({ severity, code, field }) => ({ severity, code, field })),
        ).toEqual([{ severity: 'error', code: 'SALES_ALREADY_RECORDED', field: 'date' }])
      } finally {
        const sales = await prisma.client.sale.findMany({
          where: { locationId, items: { some: { unitPrice: price } } },
          select: { id: true },
        })
        await prisma.client.saleItem.deleteMany({
          where: { saleId: { in: sales.map((x) => x.id) } },
        })
        await prisma.client.sale.deleteMany({ where: { id: { in: sales.map((x) => x.id) } } })
      }
    })

    test('a menu named like one the person cannot change is an error before it is confirmed', async () => {
      const name = `E2E Check ${stamp} Brunch`
      const org = await prisma.client.organization.findUniqueOrThrow({
        where: { slug: 'golden-fork' },
      })
      const menu = await prisma.client.menu.create({ data: { organizationId: org.id, name } })
      try {
        const id = await uploaded('menu', {
          kind: 'menu',
          name,
          items: [{ name: `E2E Check ${stamp} Toast`, price: 5 }],
        })
        const maria = await login('maria@goldenfork.com')
        const asMaria = (
          await request(http)
            .post(`/api/documents/${id}/check`)
            .set('Cookie', maria)
            .set('X-Location-Id', locationId)
            .send({})
            .expect(200)
        ).body as { issues: Issue[] }
        expect(asMaria.issues.map(({ code, field }) => ({ code, field }))).toEqual([
          { code: 'MENU_NAME_TAKEN', field: 'name' },
        ])
        expect(await check(id)).toEqual([])
      } finally {
        await prisma.client.menu.delete({ where: { id: menu.id } })
      }
    })

    test('a document with nothing read on it is an error before it is confirmed', async () => {
      const id = await uploaded('sales', { kind: 'sales', date: '2026-10-01', items: [] })
      expect((await check(id)).map((i) => i.code)).toEqual(['DOCUMENT_EMPTY'])
    })

    const brief = (issues: Issue[]) =>
      issues.map(({ severity, code, line, field }) => ({ severity, code, line, field }))
    const goldenVendor = () =>
      prisma.client.vendor.findFirstOrThrow({
        where: { organization: { name: 'The Golden Fork Group' } },
      })

    test('an invoice dated in the future is an error, and a paper with no date says it will be today', async () => {
      const vendor = await goldenVendor()
      const lines = [{ rawName: 'Eggs', quantity: 12, unit: 'ea', unitPrice: 0.4 }]
      const paper = {
        kind: 'invoice',
        vendorName: vendor.name,
        number: `E2E-FUTURE-${stamp}`,
        invoiceDate: '2099-01-01',
        items: lines,
      }
      const read = await uploaded('invoice', paper)
      expect(brief(await check(read))).toEqual([
        { severity: 'warning', code: 'DATE_MISSING', line: undefined, field: 'invoiceDate' },
      ])
      const typed = await check(read, { payload: paper })
      expect(brief(typed)).toEqual([
        { severity: 'error', code: 'PAYLOAD_INVALID', line: undefined, field: 'invoiceDate' },
      ])
      expect(typed[0].message).toBe('invoiceDate cannot be in the future')
      const wrong = await check(read, {
        payload: {
          ...paper,
          invoiceDate: undefined,
          items: [{ ...lines[0], quantity: 'a dozen' }],
        },
      })
      expect(brief(wrong)).toEqual([
        { severity: 'error', code: 'PAYLOAD_INVALID', line: 0, field: 'quantity' },
      ])
      const sales = await uploaded('sales', {
        kind: 'sales',
        items: [
          { menuItemName: 'Steak Frites', quantity: 1, unitPrice: 77 + (stamp % 1000) / 100 },
        ],
      })
      expect(brief(await check(sales))).toEqual([
        { severity: 'warning', code: 'DATE_MISSING', line: undefined, field: 'date' },
      ])
    })

    test('a vendor the organization does not have, or none at all, is pointed at before the invoice is recorded', async () => {
      const lines = [{ rawName: 'Eggs', quantity: 12, unit: 'ea', unitPrice: 0.4 }]
      const unknown = await uploaded('invoice', {
        kind: 'invoice',
        vendorName: `E2E Check ${stamp} Fresh Farms`,
        number: `E2E-VENDOR-${stamp}`,
        invoiceDate: '2026-10-01',
        items: lines,
      })
      const said = await check(unknown)
      expect(brief(said)).toEqual([
        { severity: 'warning', code: 'VENDOR_UNKNOWN', line: undefined, field: 'vendorName' },
      ])
      expect(said[0].message).toContain(`E2E Check ${stamp} Fresh Farms is not one of your vendors`)
      const none = await uploaded('invoice', {
        kind: 'invoice',
        number: `E2E-NOVENDOR-${stamp}`,
        invoiceDate: '2026-10-01',
        items: lines,
      })
      expect(brief(await check(none))).toEqual([
        { severity: 'warning', code: 'VENDOR_MISSING', line: undefined, field: 'vendorName' },
      ])
    })

    test('a menu says when a dish keeps the price on file, has no price, or is written twice', async () => {
      const steak = await prisma.client.menuItem.findFirstOrThrow({
        where: {
          name: 'Steak Frites',
          organization: { slug: 'golden-fork' },
          OR: [{ locationId }, { locationId: null }],
        },
      })
      const id = await uploaded('menu', {
        kind: 'menu',
        name: `E2E Check ${stamp} Lunch`,
        items: [
          { name: 'Steak Frites', price: Number(steak.price) + 7 },
          { name: `E2E Check ${stamp} Toast`, price: 0 },
          { name: `E2E Check ${stamp} toast`, price: 4 },
        ],
      })
      expect(brief(await check(id))).toEqual([
        { severity: 'warning', code: 'DISH_PRICE_KEPT', line: 0, field: 'price' },
        { severity: 'warning', code: 'PRICE_MISSING', line: 1, field: 'price' },
        { severity: 'warning', code: 'DISH_REPEATED', line: 2, field: 'name' },
      ])
    })

    test('a sales line sold in part of a portion says it is rounded, and a report with no dish says what it lacks', async () => {
      const id = await uploaded('sales', {
        kind: 'sales',
        date: '2026-10-02',
        items: [
          { menuItemName: 'Steak Frites', quantity: 1.5, unitPrice: 55 + (stamp % 1000) / 100 },
        ],
      })
      const said = await check(id)
      expect(brief(said)).toEqual([
        { severity: 'warning', code: 'QUANTITY_ROUNDED', line: 0, field: 'quantity' },
      ])
      expect(said[0].message).toContain('recorded as 2')
      const empty = await uploaded('sales', { kind: 'sales', date: '2026-10-01', items: [] })
      const none = await check(empty)
      expect(none.map((i) => i.code)).toEqual(['DOCUMENT_EMPTY'])
      expect(none[0].message).toContain('by dish')
    })

    test('an invoice adds the names the catalogue lacks when asked, and receives them', async () => {
      const vendor = await goldenVendor()
      const yuzu = `E2E Check ${stamp} Yuzu Juice`
      const number = `E2E-ADD-${stamp}`
      const id = await uploaded('invoice', {
        kind: 'invoice',
        vendorName: vendor.name,
        number,
        invoiceDate: '2026-10-01',
        items: [
          { rawName: yuzu, quantity: 2, unit: 'l', unitPrice: 12 },
          { rawName: `E2E Check ${stamp} Delivery Fee`, quantity: 1, unit: '', unitPrice: 5 },
        ],
      })
      expect(brief(await check(id))).toEqual([
        { severity: 'warning', code: 'INVOICE_LINE_UNMAPPED', line: 0, field: 'rawName' },
        { severity: 'warning', code: 'INVOICE_LINE_UNMAPPED', line: 1, field: 'rawName' },
      ])
      expect(brief(await check(id, { createMissing: true }))).toEqual([
        { severity: 'warning', code: 'INGREDIENT_ADDED', line: 0, field: 'rawName' },
        { severity: 'warning', code: 'INVOICE_LINE_UNMAPPED', line: 1, field: 'rawName' },
      ])
      try {
        const done = await request(http)
          .post(`/api/documents/${id}/confirm`)
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', locationId)
          .send({ createMissing: true })
          .expect(201)
        expect(done.body).toEqual(expect.objectContaining({ applied: 1, unmapped: 1, added: 1 }))
        const added = await prisma.client.ingredient.findFirstOrThrow({ where: { name: yuzu } })
        expect(added.unit).toBe('l')
        const stock = await prisma.client.ingredientLocationStock.findFirstOrThrow({
          where: { ingredientId: added.id, locationId },
        })
        expect(Number(stock.onHand)).toBe(2)
      } finally {
        const added = await prisma.client.ingredient.findMany({ where: { name: yuzu } })
        const ids = added.map((a) => a.id)
        await prisma.client.inventoryTransaction.deleteMany({
          where: { ingredientId: { in: ids } },
        })
        await prisma.client.ingredientLocationStock.deleteMany({
          where: { ingredientId: { in: ids } },
        })
        await prisma.client.ingredientLocationSettings.deleteMany({
          where: { ingredientId: { in: ids } },
        })
        await prisma.client.ingredientPriceHistory.deleteMany({
          where: { ingredientId: { in: ids } },
        })
        await prisma.client.invoiceItem.deleteMany({ where: { invoice: { number } } })
        await prisma.client.invoice.deleteMany({ where: { number } })
        await prisma.client.vendorProduct.deleteMany({
          where: { name: { contains: `E2E Check ${stamp}` } },
        })
        await prisma.client.ingredientAlias.deleteMany({ where: { ingredientId: { in: ids } } })
        await prisma.client.ingredient.deleteMany({ where: { id: { in: ids } } })
      }
    })
  })

  describe('the units a whole file needs are settled once, in one table', () => {
    const stamp = Date.now()
    const leek = `E2E Units ${stamp} Leek`
    const soup = `E2E Units ${stamp} Leek Soup`
    const gratin = `E2E Units ${stamp} Leek Gratin`
    const fileKeys: string[] = []

    afterAll(async () => {
      const made = await prisma.client.recipe.findMany({
        where: { name: { in: [soup, gratin] } },
        select: { id: true },
      })
      await prisma.client.recipeIngredient.deleteMany({
        where: { recipeId: { in: made.map((r) => r.id) } },
      })
      await prisma.client.recipe.deleteMany({ where: { id: { in: made.map((r) => r.id) } } })
      const butter = await prisma.client.ingredient.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
      })
      await prisma.client.unitConversion.deleteMany({
        where: {
          OR: [{ ingredient: { name: leek } }, { ingredientId: butter.id, fromUnit: 'cup' }],
        },
      })
      await prisma.client.ingredient.deleteMany({ where: { name: leek } })
      await prisma.client.document.deleteMany({ where: { fileKey: { in: fileKeys } } })
    })

    test('a file lists what its lines need, a manager settles it, and every recipe of it confirms', async () => {
      const id = await upload(
        'recipe',
        `units-${stamp}.json`,
        'application/json',
        Buffer.from(
          JSON.stringify([
            {
              kind: 'recipe',
              name: soup,
              items: [
                { rawName: 'Unsalted Butter', quantity: 1, unit: 'cup' },
                { rawName: leek, quantity: 2, unit: 'ea' },
              ],
            },
            {
              kind: 'recipe',
              name: gratin,
              items: [
                { rawName: leek, quantity: 1, unit: 'lb' },
                { rawName: `${leek}, sliced`, quantity: 1, unit: 'cup' },
              ],
            },
          ]),
        ),
      )
      await waitForStatus(id, goldenForkCookie, 'requires_review')
      const { fileKey } = await prisma.client.document.findUniqueOrThrow({ where: { id } })
      fileKeys.push(fileKey)
      let parts: string[] = []
      for (let i = 0; i < 40 && parts.length < 2; i++) {
        parts = (
          await prisma.client.document.findMany({ where: { fileKey }, select: { id: true } })
        ).map((d) => d.id)
        if (parts.length < 2) await new Promise((r) => setTimeout(r, 250))
      }
      const butter = await prisma.client.ingredient.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
      })

      const listed = await request(http)
        .get(`/api/documents/${parts[0]}/file-units`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(200)
      expect(listed.body).toEqual({
        ingredients: [
          {
            key: leek.toLowerCase(),
            name: leek,
            ingredientId: null,
            unit: 'ea',
            unitDimension: 'count',
            choices: ['ea', 'kg', 'l'],
            units: [
              { unit: 'ea', dimension: 'count', lines: 1, reaches: true },
              { unit: 'lb', dimension: 'mass', lines: 1, reaches: false },
              { unit: 'cup', dimension: 'volume', lines: 1, reaches: false },
            ],
          },
          {
            key: butter.id,
            name: 'Unsalted Butter',
            ingredientId: butter.id,
            unit: 'kg',
            unitDimension: 'mass',
            choices: [],
            units: [{ unit: 'cup', dimension: 'volume', lines: 1, reaches: false }],
          },
        ].sort((a, b) => a.name.localeCompare(b.name)),
      })

      const settle = {
        ingredients: [{ name: leek, unit: 'kg' }],
        conversions: [
          { name: leek, fromUnit: 'ea', factor: 0.15 },
          { name: leek, fromUnit: 'cup', factor: 0.09 },
          { ingredientId: butter.id, fromUnit: 'cup', factor: 0.227 },
        ],
      }
      await request(http)
        .post(`/api/documents/${parts[0]}/file-units`)
        .set('Cookie', staffCookie)
        .set('X-Location-Id', locationId)
        .send(settle)
        .expect(403)
      const saved = await request(http)
        .post(`/api/documents/${parts[0]}/file-units`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send(settle)
        .expect(201)
      expect(saved.body).toEqual({ added: 1, recorded: 3 })
      expect(
        (await prisma.client.ingredient.findFirstOrThrow({ where: { name: leek } })).unit,
      ).toBe('kg')
      expect(
        await prisma.client.ingredientLocationSettings.count({
          where: { ingredient: { name: leek } },
        }),
      ).toBe(0)

      const after = await request(http)
        .get(`/api/documents/${parts[0]}/file-units`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(200)
      expect(after.body).toEqual({ ingredients: [] })

      const res = await request(http)
        .post('/api/documents/confirm-many')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ ids: parts })
        .expect(201)
      expect((res.body as { results: { status?: string }[] }).results.map((r) => r.status)).toEqual(
        ['confirmed', 'confirmed'],
      )
    })
  })

  describe('a workbook of recipes is confirmed the way a kitchen writes it', () => {
    const stamp = Date.now()
    const names: string[] = []
    const created: string[] = []

    const uploadRecipes = async (recipes: unknown[]) => {
      const first = await upload(
        'recipe',
        `book-${stamp}.json`,
        'application/json',
        Buffer.from(JSON.stringify(recipes)),
      )
      await waitForStatus(first, goldenForkCookie, 'requires_review')
      const doc = await prisma.client.document.findUniqueOrThrow({ where: { id: first } })
      const siblings = await prisma.client.document.findMany({
        where: { fileKey: doc.fileKey },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      for (const d of siblings) await waitForStatus(d.id, goldenForkCookie, 'requires_review')
      return siblings.map((d) => d.id)
    }

    const confirmMany = (ids: string[], createMissing?: boolean) =>
      request(http)
        .post('/api/documents/confirm-many')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({ ids, ...(createMissing === undefined ? {} : { createMissing }) })

    afterAll(async () => {
      const recipes = await prisma.client.recipe.findMany({
        where: { name: { in: names } },
        select: { id: true },
      })
      const ids = recipes.map((r) => r.id)
      await prisma.client.recipeComponent.deleteMany({
        where: { OR: [{ parentId: { in: ids } }, { componentId: { in: ids } }] },
      })
      await prisma.client.recipe.deleteMany({ where: { id: { in: ids } } })
      await prisma.client.ingredient.deleteMany({ where: { name: { in: created } } })
      await prisma.client.ingredientAlias.deleteMany({ where: { rawName: { in: created } } })
      await prisma.client.document.deleteMany({
        where: { fileName: { startsWith: `book-${stamp}` } },
      })
    })

    const confirmOne = (id: string, body: object = {}) =>
      request(http)
        .post(`/api/documents/${id}/confirm`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send(body)

    test('a component the file writes out arrives inside the recipe that uses it, and is linked to it on confirm', async () => {
      const parent = `E2E Kanpachi ${stamp}`
      const child = `E2E Soy Lime Vinaigrette ${stamp}`
      names.push(parent, child)
      const ids = await uploadRecipes([
        {
          kind: 'recipe',
          name: parent,
          items: [
            { rawName: 'Unsalted Butter', quantity: 100, unit: 'g' },
            { rawName: child.toUpperCase(), quantity: 2, unit: 'oz' },
          ],
        },
        {
          kind: 'recipe',
          name: child,
          portions: 4,
          yieldQty: 16,
          yieldUnit: 'oz',
          items: [{ rawName: 'Unsalted Butter', quantity: 200, unit: 'g' }],
        },
      ])

      expect(ids).toHaveLength(1)
      const detail = await request(http)
        .get(`/api/documents/${ids[0]}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const body = detail.body as {
        unresolved: unknown[]
        extraction: { name: string; subRecipes?: { name: string }[] }
      }
      expect(body.extraction.name).toBe(parent)
      expect(body.extraction.subRecipes?.map((s) => s.name)).toEqual([child])
      expect(body.unresolved).toEqual([])

      const res = await confirmOne(ids[0]).expect(201)
      expect((res.body as { status: string }).status).toBe('confirmed')
      const made = await prisma.client.recipe.findFirstOrThrow({
        where: { name: parent },
        include: { ingredients: true, components: { include: { component: true } } },
      })
      expect(made.ingredients).toHaveLength(1)
      expect(made.components.map((c) => c.component.name)).toEqual([child])
      expect(Number(made.components[0].quantity)).toBe(2)
      const sub = await prisma.client.recipe.findFirstOrThrow({
        where: { name: child },
        include: { ingredients: true },
      })
      expect([sub.portions, Number(sub.yieldAmount), sub.yieldUnit]).toEqual([4, 16, 'oz'])
      expect(sub.ingredients).toHaveLength(1)
      expect(sub.locationId).toBe(made.locationId)

      const [again] = await uploadRecipes([
        {
          kind: 'recipe',
          name: `${parent} Again`,
          items: [{ rawName: child, quantity: 1, unit: 'oz' }],
        },
      ])
      const later = await request(http)
        .get(`/api/documents/${again}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      expect((later.body as { unresolved: unknown[] }).unresolved).toEqual([])
    })

    test('ingredients the catalogue lacks are added only when the person asks, once each and without a price', async () => {
      const recipe = `E2E Chard Greens ${stamp}`
      const chard = `Probe Chard ${stamp}`
      const twine = `Probe Twine ${stamp}`
      names.push(recipe)
      created.push(chard, twine)
      const ids = await uploadRecipes([
        {
          kind: 'recipe',
          name: recipe,
          items: [
            { rawName: chard, quantity: 2, unit: 'cups' },
            { rawName: twine, quantity: 1, unit: 'each' },
            { rawName: chard.toLowerCase(), quantity: 1, unit: 'T' },
          ],
        },
      ])

      const refused = await confirmMany(ids).expect(201)
      const [result] = (refused.body as { results: { error?: string }[] }).results
      expect(result.error).toContain(chard)
      expect(await prisma.client.ingredient.findFirst({ where: { name: chard } })).toBeNull()

      const res = await confirmMany(ids, true).expect(201)
      expect((res.body as { results: unknown[] }).results).toEqual([
        { id: ids[0], status: 'confirmed' },
      ])
      const added = await prisma.client.ingredient.findMany({
        where: { name: { in: [chard, twine], mode: 'insensitive' } },
        orderBy: { name: 'asc' },
      })
      expect(added.map((i) => [i.name, i.unit, Number(i.costPerUnit)])).toEqual([
        [chard, 'l', 0],
        [twine, 'ea', 0],
      ])
      const made = await prisma.client.recipe.findFirstOrThrow({
        where: { name: recipe },
        include: { ingredients: true },
      })
      expect(made.ingredients).toHaveLength(3)
    })

    test('confirming a whole file says which documents it could not confirm and why', async () => {
      const good = `E2E Good Recipe ${stamp}`
      names.push(good)
      const ids = await uploadRecipes([
        {
          kind: 'recipe',
          name: good,
          items: [{ rawName: 'Unsalted Butter', quantity: 1, unit: 'g' }],
        },
        {
          kind: 'recipe',
          name: '',
          items: [{ rawName: 'Unsalted Butter', quantity: 1, unit: 'g' }],
        },
      ])
      const foreign = await prisma.client.document
        .findFirstOrThrow({
          where: { organization: { slug: { not: 'golden-fork' } } },
          select: { id: true },
        })
        .catch(() => ({ id: 'no-such-document' }))

      const res = await confirmMany([...ids, foreign.id, ids[0]]).expect(201)
      expect((res.body as { results: unknown[] }).results).toEqual([
        { id: ids[0], status: 'confirmed' },
        {
          id: ids[1],
          code: 'RECIPE_NAME_REQUIRED',
          error: 'Give the recipe a name before confirming it',
        },
        { id: foreign.id, code: 'DOCUMENT_NOT_FOUND', error: 'Document not found' },
        { id: ids[0], code: 'DOCUMENT_ALREADY_CONFIRMED', error: 'Document is already confirmed' },
      ])
    })

    test('a nested recipe measured by weight or volume needs the yield it is measured against', async () => {
      const parent = `E2E Crudo ${stamp}`
      const child = `E2E Citrus Dressing ${stamp}`
      names.push(parent, child)
      const ids = await uploadRecipes([
        {
          kind: 'recipe',
          name: parent,
          items: [
            { rawName: 'Unsalted Butter', quantity: 100, unit: 'g' },
            { rawName: child, quantity: 2, unit: 'oz' },
          ],
        },
        {
          kind: 'recipe',
          name: child,
          portions: 4,
          items: [{ rawName: 'Unsalted Butter', quantity: 200, unit: 'g' }],
        },
      ])
      expect(ids).toHaveLength(1)
      const refused = await confirmOne(ids[0]).expect(400)
      expect((refused.body as { error: { message: string } }).error.message).toMatch(
        new RegExp(`${child}.*states no yield in oz`),
      )
      expect(await prisma.client.recipe.count({ where: { name: { in: [parent, child] } } })).toBe(0)

      const stored = await prisma.client.extraction.findFirstOrThrow({
        where: { documentId: ids[0] },
        orderBy: { createdAt: 'desc' },
      })
      const reviewed = stored.payload as { subRecipes: Record<string, unknown>[] }
      reviewed.subRecipes[0] = { ...reviewed.subRecipes[0], yieldQty: 32, yieldUnit: 'oz' }
      const retry = await confirmOne(ids[0], { payload: reviewed }).expect(201)
      expect((retry.body as { status: string }).status).toBe('confirmed')
      const dressing = await prisma.client.recipe.findFirstOrThrow({ where: { name: child } })
      const made = await prisma.client.recipe.findFirstOrThrow({
        where: { name: parent },
        include: { components: true },
      })
      expect(made.components.map((c) => [c.unit, Number(c.quantity)])).toEqual([['oz', 2]])
      const card = await request(http)
        .get(`/api/recipes/${made.id}/detail`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const share = (card.body as { components: { cost: number }[] }).components[0].cost
      expect(share).toBeCloseTo(Number(dressing.totalCost) / 16, 2)
    })

    test('a recipe document states a yield the recipe form can save again', async () => {
      const unstated = `E2E Zero Yield ${stamp}`
      const unitless = `E2E Unitless Yield ${stamp}`
      names.push(unstated, unitless)
      const butter = { rawName: 'Unsalted Butter', quantity: 200, unit: 'g' }
      const ids = await uploadRecipes([
        { kind: 'recipe', name: unstated, yieldQty: 0, yieldUnit: 'kg', items: [butter] },
        { kind: 'recipe', name: unitless, yieldQty: 5, items: [butter] },
      ])
      const res = await confirmMany(ids).expect(201)
      expect((res.body as { results: unknown[] }).results).toEqual([
        { id: ids[0], status: 'confirmed' },
        {
          id: ids[1],
          code: 'YIELD_INCOMPLETE',
          error: 'A yield needs both an amount and a unit, or neither',
        },
      ])
      const made = await prisma.client.recipe.findFirstOrThrow({ where: { name: unstated } })
      expect([made.yieldAmount, made.yieldUnit]).toEqual([null, null])
      expect(await prisma.client.recipe.count({ where: { name: unitless } })).toBe(0)
    })

    test('recipes nested three deep arrive as one dish and are created deepest first', async () => {
      const top = `E2E Plated Tartare ${stamp}`
      const middle = `E2E Tartare Base ${stamp}`
      const deepest = `E2E Chili Oil ${stamp}`
      names.push(top, middle, deepest)
      const butter = { rawName: 'Unsalted Butter', quantity: 10, unit: 'g' }
      const ids = await uploadRecipes([
        {
          kind: 'recipe',
          name: top,
          items: [butter, { rawName: middle, quantity: 1, unit: 'portion' }],
        },
        {
          kind: 'recipe',
          name: middle,
          items: [butter, { rawName: deepest, quantity: 1, unit: 'portion' }],
        },
        { kind: 'recipe', name: deepest, items: [butter] },
      ])
      expect(ids).toHaveLength(1)
      await confirmOne(ids[0]).expect(201)
      const made = await prisma.client.recipe.findFirstOrThrow({
        where: { name: middle },
        include: { components: { include: { component: true } } },
      })
      expect(made.components.map((c) => c.component.name)).toEqual([deepest])
    })

    test('a side that is the product itself is made of that product, and the dishes that use it follow', async () => {
      const side = `E2E Chorizo Sausage ${stamp}`
      const plate = `E2E Two Eggs Any Style ${stamp}`
      names.push(side, plate)
      created.push(side)
      const ids = await uploadRecipes([
        { kind: 'recipe', name: plate, items: [{ rawName: side, quantity: 1, unit: 'portion' }] },
        { kind: 'recipe', name: side, items: [{ rawName: side, quantity: 6, unit: 'oz.' }] },
      ])
      expect(ids).toHaveLength(1)
      const res = await confirmMany(ids, true).expect(201)
      expect((res.body as { results: unknown[] }).results).toEqual([
        { id: ids[0], status: 'confirmed' },
      ])
      const product = await prisma.client.ingredient.findFirstOrThrow({ where: { name: side } })
      expect(product.unit).toBe('kg')
      const made = await prisma.client.recipe.findFirstOrThrow({
        where: { name: plate },
        include: { components: { include: { component: true } } },
      })
      expect(made.components.map((c) => c.component.name)).toEqual([side])
    })

    test('a line with no unit is counted when the ingredient is counted, and named when it is not', async () => {
      const counted = `E2E Two Eggs ${stamp}`
      const weighed = `E2E Butter Without Unit ${stamp}`
      names.push(counted, weighed)
      const eggs = await prisma.client.ingredient.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' }, name: 'Eggs' },
      })
      expect(eggs.unit).toBe('ea')
      const ids = await uploadRecipes([
        { kind: 'recipe', name: counted, items: [{ rawName: 'Eggs', quantity: 2, unit: '' }] },
        {
          kind: 'recipe',
          name: weighed,
          items: [{ rawName: 'Unsalted Butter', quantity: 2, unit: ' ' }],
        },
      ])
      const res = await confirmMany(ids).expect(201)
      expect((res.body as { results: unknown[] }).results).toEqual([
        { id: ids[0], status: 'confirmed' },
        {
          id: ids[1],
          code: 'UNIT_NOT_CONVERTIBLE',
          error:
            'Unsalted Butter has no unit (it is counted in kg). Record a unit conversion first, or state the quantity in a unit of the same kind.',
        },
      ])
      const made = await prisma.client.recipe.findFirstOrThrow({
        where: { name: counted },
        include: { ingredients: true },
      })
      expect(made.ingredients.map((i) => i.unit)).toEqual(['ea'])
    })

    test('a sub-recipe that cannot be filed keeps the whole recipe out, and its name never becomes an ingredient', async () => {
      const parent = `E2E Parent Of A Failure ${stamp}`
      const child = `E2E Broken Child ${stamp}`
      names.push(parent)
      created.push(child)
      const ids = await uploadRecipes([
        { kind: 'recipe', name: parent, items: [{ rawName: child, quantity: 1, unit: 'cup' }] },
        {
          kind: 'recipe',
          name: child,
          items: [{ rawName: 'Beef Tenderloin', quantity: 2, unit: 'l' }],
        },
      ])
      expect(ids).toHaveLength(1)
      const res = await confirmMany(ids, true).expect(201)
      const [only] = (res.body as { results: { error?: string }[] }).results
      expect(only.error).toContain('Beef Tenderloin in l rather than kg')
      expect(await prisma.client.ingredient.findFirst({ where: { name: child } })).toBeNull()
      expect(await prisma.client.recipe.count({ where: { name: { in: [parent, child] } } })).toBe(0)
      expect(
        await prisma.client.ingredientAlias.findFirst({
          where: { rawName: { equals: child, mode: 'insensitive' } },
        }),
      ).toBeNull()
    })

    test('a recipe whose ingredients have no price yet says how many, so its cost is not read as final', async () => {
      const recipe = `E2E Partly Priced ${stamp}`
      const fennel = `Probe Fennel ${stamp}`
      const saffron = `Probe Saffron ${stamp}`
      names.push(recipe)
      created.push(fennel, saffron)
      const ids = await uploadRecipes([
        {
          kind: 'recipe',
          name: recipe,
          items: [
            { rawName: 'Unsalted Butter', quantity: 100, unit: 'g' },
            { rawName: fennel, quantity: 200, unit: 'g' },
            { rawName: saffron, quantity: 1, unit: 'g' },
          ],
        },
      ])
      await confirmMany(ids, true).expect(201)
      const list = await request(http)
        .get('/api/recipes')
        .set('Cookie', goldenForkCookie)
        .expect(200)
      const row = (list.body as { name: string; unpriced: number }[]).find((r) => r.name === recipe)
      expect(row?.unpriced).toBe(2)
      const priced = (list.body as { name: string; unpriced: number }[]).find(
        (r) => r.name === 'Marinara Sauce',
      )
      expect(priced?.unpriced).toBe(0)
    })

    test('a line naming how an ingredient is cut reaches the ingredient, and the cut is kept on the line', async () => {
      const recipe = `E2E Prepared Lines ${stamp}`
      const grass = `Probe Lemongrass ${stamp}`
      names.push(recipe)
      created.push(grass)
      const ids = await uploadRecipes([
        {
          kind: 'recipe',
          name: recipe,
          items: [
            { rawName: 'brunoise Unsalted Butter', quantity: 20, unit: 'g' },
            { rawName: `minced ${grass}`, quantity: 10, unit: 'g' },
            { rawName: `${grass}, finely chopped`, quantity: 5, unit: 'g' },
          ],
        },
      ])
      const detail = await request(http)
        .get(`/api/documents/${ids[0]}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      expect(
        (detail.body as { unresolved: { rawName: string }[] }).unresolved.map((u) => u.rawName),
      ).toEqual([`minced ${grass}`, `${grass}, finely chopped`])

      const res = await confirmMany(ids, true).expect(201)
      expect((res.body as { results: unknown[] }).results).toEqual([
        { id: ids[0], status: 'confirmed' },
      ])
      const added = await prisma.client.ingredient.findMany({
        where: { name: { contains: `Lemongrass ${stamp}` }, organization: { slug: 'golden-fork' } },
      })
      expect(added.map((i) => i.name)).toEqual([grass])
      const made = await prisma.client.recipe.findFirstOrThrow({
        where: { name: recipe },
        include: { ingredients: { include: { ingredient: true }, orderBy: { order: 'asc' } } },
      })
      expect(made.ingredients.map((l) => [l.ingredient.name, l.prepNote])).toEqual([
        ['Unsalted Butter', 'brunoise'],
        [grass, 'minced'],
        [grass, 'finely chopped'],
      ])
    })

    test('a recipe the reading found no lines in is not filed as a recipe costing nothing', async () => {
      const empty = `E2E Nothing Read ${stamp}`
      names.push(empty)
      const ids = await uploadRecipes([{ kind: 'recipe', name: empty, items: [] }])
      const res = await confirmMany(ids, true).expect(201)
      expect((res.body as { results: unknown[] }).results).toEqual([
        {
          id: ids[0],
          code: 'RECIPE_INGREDIENTS_REQUIRED',
          error: 'The recipe lists no ingredients; add at least one before confirming it',
        },
      ])
      expect(await prisma.client.recipe.findFirst({ where: { name: empty } })).toBeNull()
    })

    test('an ingredient added from one recipe is held to one kind of unit across its lines', async () => {
      const recipe = `E2E Two Kinds Of Garlic ${stamp}`
      const garlic = `Probe Garlic ${stamp}`
      names.push(recipe)
      created.push(garlic)
      const ids = await uploadRecipes([
        {
          kind: 'recipe',
          name: recipe,
          items: [
            { rawName: garlic, quantity: 20, unit: 'g' },
            { rawName: garlic.toLowerCase(), quantity: 1, unit: 'cup' },
          ],
        },
      ])
      const res = await confirmMany(ids, true).expect(201)
      expect((res.body as { results: unknown[] }).results).toEqual([
        {
          id: ids[0],
          code: 'UNIT_NOT_CONVERTIBLE',
          error: `${garlic} in cup rather than kg. Record a unit conversion first, or state the quantity in a unit of the same kind.`,
        },
      ])
      expect(await prisma.client.recipe.findFirst({ where: { name: recipe } })).toBeNull()
      expect(await prisma.client.ingredient.findFirst({ where: { name: garlic } })).toBeNull()
    })

    test('a file nesting recipes deeper than the editor allows stops at the limit and says so', async () => {
      const chain = Array.from({ length: 7 }, (_, i) => `E2E Level ${i} ${stamp}`)
      names.push(...chain)
      const ids = await uploadRecipes(
        chain.map((name, i) => ({
          kind: 'recipe',
          name,
          items:
            i === chain.length - 1
              ? [{ rawName: 'Unsalted Butter', quantity: 10, unit: 'g' }]
              : [{ rawName: chain[i + 1], quantity: 1, unit: 'portion' }],
        })),
      )
      expect(ids).toHaveLength(1)
      const res = await confirmMany(ids).expect(201)
      const results = (res.body as { results: { status?: string; error?: string }[] }).results
      expect(results).toEqual([
        {
          id: ids[0],
          code: 'RECIPE_NESTING_TOO_DEEP',
          error: 'Nesting too deep: 6 levels (maximum 5)',
        },
      ])
      expect(await prisma.client.recipe.count({ where: { name: { in: chain } } })).toBe(0)
    })

    test('a component two dishes of the file share stays a recipe of its own, confirmed first', async () => {
      const one = `E2E Ramen ${stamp}`
      const two = `E2E Udon ${stamp}`
      const stock = `E2E Dashi ${stamp}`
      names.push(one, two, stock)
      const butter = { rawName: 'Unsalted Butter', quantity: 10, unit: 'g' }
      const ids = await uploadRecipes([
        {
          kind: 'recipe',
          name: one,
          items: [butter, { rawName: stock, quantity: 1, unit: 'portion' }],
        },
        {
          kind: 'recipe',
          name: two,
          items: [butter, { rawName: stock, quantity: 2, unit: 'portion' }],
        },
        { kind: 'recipe', name: stock, items: [butter] },
      ])
      expect(ids).toHaveLength(3)
      const res = await confirmMany(ids).expect(201)
      expect((res.body as { results: unknown[] }).results).toEqual(
        ids.map((id) => ({ id, status: 'confirmed' })),
      )
      const linked = await prisma.client.recipeComponent.count({
        where: { component: { name: stock } },
      })
      expect(linked).toBe(2)
    })

    test('a sub-recipe named like a recipe the kitchen already has is refused, and nothing is filed', async () => {
      const parent = `E2E Poke Bowl ${stamp}`
      names.push(parent)
      const ids = await uploadRecipes([
        {
          kind: 'recipe',
          name: parent,
          items: [{ rawName: 'Marinara Sauce', quantity: 1, unit: 'portion' }],
          subRecipes: [
            {
              name: 'Marinara Sauce',
              items: [{ rawName: 'Unsalted Butter', quantity: 5, unit: 'g' }],
            },
          ],
        },
      ])
      const before = await prisma.client.recipe.count({
        where: { name: 'Marinara Sauce', organization: { slug: 'golden-fork' } },
      })
      const res = await confirmOne(ids[0]).expect(409)
      expect((res.body as { error: { message: string } }).error.message).toContain('Marinara Sauce')
      expect(await prisma.client.recipe.count({ where: { name: parent } })).toBe(0)
      const marinara = { name: 'Marinara Sauce', organization: { slug: 'golden-fork' } }
      expect(await prisma.client.recipe.count({ where: marinara })).toBe(before)
    })

    test('a name inside a sub-recipe that reaches no ingredient is offered for mapping and holds the recipe back', async () => {
      const parent = `E2E Taro Cups ${stamp}`
      const child = `E2E Ponzu ${stamp}`
      const yuzu = `Probe Yuzu ${stamp}`
      names.push(parent, child)
      created.push(yuzu)
      const ids = await uploadRecipes([
        {
          kind: 'recipe',
          name: parent,
          items: [
            { rawName: 'Unsalted Butter', quantity: 10, unit: 'g' },
            { rawName: child, quantity: 1, unit: 'portion' },
          ],
          subRecipes: [{ name: child, items: [{ rawName: yuzu, quantity: 20, unit: 'ml' }] }],
        },
      ])
      const detail = await request(http)
        .get(`/api/documents/${ids[0]}`)
        .set('Cookie', goldenForkCookie)
        .expect(200)
      expect(
        (detail.body as { unresolved: { rawName: string }[] }).unresolved.map((u) => u.rawName),
      ).toEqual([yuzu])
      const res = await confirmOne(ids[0]).expect(400)
      expect((res.body as { error: { message: string } }).error.message).toBe(
        `Map ${yuzu} to an ingredient before confirming this recipe`,
      )
      expect(await prisma.client.recipe.count({ where: { name: { in: [parent, child] } } })).toBe(0)

      const ok = await confirmMany(ids, true).expect(201)
      expect((ok.body as { results: unknown[] }).results).toEqual([
        { id: ids[0], status: 'confirmed' },
      ])
      const sub = await prisma.client.recipe.findFirstOrThrow({
        where: { name: child },
        include: { ingredients: { include: { ingredient: true } } },
      })
      expect(sub.ingredients.map((l) => [l.ingredient.name, l.unit])).toEqual([[yuzu, 'ml']])
    })

    test('the page may send the one document it edited along with the rest', async () => {
      const edited = `E2E Edited In Review ${stamp}`
      names.push(edited)
      const ids = await uploadRecipes([
        {
          kind: 'recipe',
          name: 'As Extracted',
          items: [{ rawName: 'Unsalted Butter', quantity: 1, unit: 'g' }],
        },
      ])
      await request(http)
        .post('/api/documents/confirm-many')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .send({
          ids,
          edited: {
            id: ids[0],
            payload: {
              kind: 'recipe',
              name: edited,
              items: [{ rawName: 'Unsalted Butter', quantity: 1, unit: 'g' }],
            },
          },
        })
        .expect(201)
      expect(await prisma.client.recipe.findFirst({ where: { name: edited } })).not.toBeNull()
    })

    describe('confirming many is held to the same boundaries as confirming one', () => {
      const made: string[] = []
      const planted = async (
        organizationSlug: string,
        locationName: string | null,
        name: string,
      ) => {
        const org = await prisma.client.organization.findUniqueOrThrow({
          where: { slug: organizationSlug },
        })
        const at = locationName
          ? (
              await prisma.client.location.findFirstOrThrow({
                where: { organizationId: org.id, name: locationName },
              })
            ).id
          : null
        const doc = await prisma.client.document.create({
          data: {
            organizationId: org.id,
            locationId: at,
            type: 'recipe',
            fileKey: `e2e-boundary/${name}`,
            fileName: `${name}.json`,
            mimeType: 'application/json',
            size: 1,
            status: 'requires_review',
          },
        })
        await prisma.client.extraction.create({
          data: {
            organizationId: org.id,
            documentId: doc.id,
            payload: {
              kind: 'recipe',
              name,
              items: [{ rawName: `Probe Boundary ${name}`, quantity: 1, unit: 'g' }],
            },
          },
        })
        names.push(name)
        created.push(`Probe Boundary ${name}`)
        made.push(doc.id)
        return doc.id
      }
      const untouched = async (id: string, name: string) => {
        expect((await prisma.client.document.findUniqueOrThrow({ where: { id } })).status).toBe(
          'requires_review',
        )
        expect(await prisma.client.recipe.findFirst({ where: { name } })).toBeNull()
        expect(
          await prisma.client.ingredient.findFirst({ where: { name: `Probe Boundary ${name}` } }),
        ).toBeNull()
      }

      afterAll(async () => {
        await prisma.client.extraction.deleteMany({ where: { documentId: { in: made } } })
        await prisma.client.document.deleteMany({ where: { id: { in: made } } })
      })

      test("another organization's document is not found, and nothing is written in it", async () => {
        const name = `E2E Foreign ${stamp}`
        const id = await planted('bella-cucina', null, name)
        const res = await confirmMany([id], true).expect(201)
        expect((res.body as { results: unknown[] }).results).toEqual([
          { id, code: 'DOCUMENT_NOT_FOUND', error: 'Document not found' },
        ])
        await untouched(id, name)
      })

      test('a manager of one location cannot confirm a document of another', async () => {
        const name = `E2E Airport Only ${stamp}`
        const id = await planted('golden-fork', 'Golden Fork — Airport', name)
        const maria = await login('maria@goldenfork.com')
        const res = await request(http)
          .post('/api/documents/confirm-many')
          .set('Cookie', maria)
          .set('X-Location-Id', locationId)
          .send({ ids: [id], createMissing: true })
          .expect(201)
        expect((res.body as { results: unknown[] }).results).toEqual([
          { id, code: 'DOCUMENT_NOT_FOUND', error: 'Document not found' },
        ])
        await untouched(id, name)
      })

      test('a team member who only reads is refused, and a chef may confirm and add what is missing', async () => {
        const name = `E2E Chef Confirms ${stamp}`
        const id = await planted('golden-fork', 'Golden Fork — Downtown', name)
        const ken = await prisma.client.user.findUniqueOrThrow({
          where: { email: 'ken@goldenfork.com' },
        })
        await prisma.client.user.update({ where: { id: ken.id }, data: { role: 'viewer' } })
        try {
          const viewer = await login('ken@goldenfork.com')
          await request(http)
            .post('/api/documents/confirm-many')
            .set('Cookie', viewer)
            .set('X-Location-Id', locationId)
            .send({ ids: [id], createMissing: true })
            .expect(403)
          await untouched(id, name)
        } finally {
          await prisma.client.user.update({ where: { id: ken.id }, data: { role: ken.role } })
        }
        const chef = await login('ken@goldenfork.com')
        const res = await request(http)
          .post('/api/documents/confirm-many')
          .set('Cookie', chef)
          .set('X-Location-Id', locationId)
          .send({ ids: [id], createMissing: true })
          .expect(201)
        expect((res.body as { results: unknown[] }).results).toEqual([{ id, status: 'confirmed' }])
        const added = await prisma.client.ingredient.findFirstOrThrow({
          where: { name: `Probe Boundary ${name}` },
        })
        expect(added.organizationId).toBe(ken.organizationId)
      })
    })

    test('the request is held to a list of ids and a real yes', async () => {
      await confirmMany([]).expect(400)
      await request(http)
        .post('/api/documents/confirm-many')
        .set('Cookie', goldenForkCookie)
        .send({ ids: ['x'], createMissing: 'false' })
        .expect(400)
      const edited = (value: unknown) =>
        request(http)
          .post('/api/documents/confirm-many')
          .set('Cookie', goldenForkCookie)
          .send({ ids: ['x'], edited: value })
          .expect(400)
      await edited({ id: 7, payload: {} })
      await edited({ id: 'y', payload: {} })
    })
  })

  describe('a file name the storage cannot hold is refused, not thrown', () => {
    test('a very long file name answers 400 naming the problem', async () => {
      const before = await prisma.client.document.count()
      const res = await request(http)
        .post('/api/documents')
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .field('type', 'invoice')
        .attach('file', Buffer.from('Item,Qty,Unit,Unit Price\n'), {
          filename: `${'x'.repeat(300)}.csv`,
          contentType: 'text/csv',
        })
        .expect(400)
      expect((res.body as { error: { message: string } }).error.message).toMatch(/file name/i)
      expect(await prisma.client.document.count()).toBe(before)
    })
  })

  describe('with every location active', () => {
    const sendAll = (cookie: string, type: string, body: object, name: string) =>
      request(http)
        .post('/api/documents')
        .set('Cookie', cookie)
        .field('type', type)
        .attach('file', Buffer.from(JSON.stringify(body)), {
          filename: name,
          contentType: 'application/json',
        })

    test('a recipe is uploaded for the whole organization and confirmed as one', async () => {
      const name = `E2E Everywhere Recipe ${Date.now()}`
      const res = await sendAll(
        goldenForkCookie,
        'recipe',
        {
          kind: 'recipe',
          name,
          portions: 2,
          items: [{ rawName: 'Unsalted Butter', quantity: 0.1, unit: 'kg' }],
        },
        'everywhere.json',
      ).expect(201)
      const id = (res.body as { id: string }).id
      try {
        expect((await prisma.client.document.findUniqueOrThrow({ where: { id } })).locationId).toBe(
          null,
        )
        await waitForStatus(id, goldenForkCookie, 'requires_review')
        await request(http)
          .post(`/api/documents/${id}/confirm`)
          .set('Cookie', goldenForkCookie)
          .expect(201)
        const recipe = await prisma.client.recipe.findFirstOrThrow({ where: { name } })
        expect(recipe.locationId).toBe(null)
        await prisma.client.recipe.delete({ where: { id: recipe.id } })
      } finally {
        await prisma.client.document.deleteMany({ where: { id } })
      }
    })

    test('an invoice or a sales report still needs the location that received it', async () => {
      for (const type of ['invoice', 'sales']) {
        await sendAll(goldenForkCookie, type, { kind: type, items: [] }, `${type}.json`).expect(400)
      }
    })

    test('someone who works at some locations only still chooses one', async () => {
      const maria = await login('maria@goldenfork.com')
      await sendAll(
        maria,
        'menu',
        { kind: 'menu', name: 'Not hers to place', items: [] },
        'menu.json',
      ).expect(400)
    })
  })

  describe('a phrase written where a unit belongs', () => {
    const reviewable = async (name: string, items: object[]) => {
      const id = await upload(
        'recipe',
        'phrase.json',
        'application/json',
        Buffer.from(JSON.stringify({ kind: 'recipe', name, portions: 4, items })),
      )
      await waitForStatus(id, goldenForkCookie, 'requires_review')
      return id
    }

    test('does not become the unit of an ingredient the recipe adds', async () => {
      const stamp = Date.now()
      const oil = `Probe Cashew Oil ${stamp}`
      const id = await reviewable(`E2E Fried ${stamp}`, [
        { rawName: oil, quantity: 1, unit: 'a splash' },
      ])
      try {
        const res = await request(http)
          .post(`/api/documents/${id}/confirm`)
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', locationId)
          .send({ createMissing: true })
          .expect(400)
        expect((res.body as { error: { message: string } }).error.message).toMatch(
          /a splash.*not a unit/i,
        )
        expect(await prisma.client.ingredient.findFirst({ where: { name: oil } })).toBeNull()
      } finally {
        await prisma.client.document.deleteMany({ where: { id } })
      }
    })

    test('is named as not a unit on an ingredient the catalogue has', async () => {
      const stamp = Date.now()
      const id = await reviewable(`E2E Seasoned ${stamp}`, [
        { rawName: 'Unsalted Butter', quantity: 1, unit: 'a handful' },
      ])
      try {
        const res = await request(http)
          .post(`/api/documents/${id}/confirm`)
          .set('Cookie', goldenForkCookie)
          .set('X-Location-Id', locationId)
          .expect(400)
        expect((res.body as { error: { message: string } }).error.message).toMatch(
          /a handful.*not a unit/i,
        )
      } finally {
        await prisma.client.document.deleteMany({ where: { id } })
      }
    })
  })

  test('a recipe line in a unit its ingredient does not convert to is named before confirming, and a conversion clears it', async () => {
    const stamp = Date.now()
    const id = await upload(
      'recipe',
      'cups.json',
      'application/json',
      Buffer.from(
        JSON.stringify({
          kind: 'recipe',
          name: `E2E Buttered ${stamp}`,
          items: [{ rawName: 'Unsalted Butter', quantity: 0.5, unit: 'cups' }],
        }),
      ),
    )
    await waitForStatus(id, goldenForkCookie, 'requires_review')
    const butter = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
    })
    let rule = ''
    try {
      const before = await request(http)
        .get(`/api/documents/${id}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(200)
      expect((before.body as { unconverted: unknown[] }).unconverted).toEqual([
        {
          rawName: 'Unsalted Butter',
          ingredientId: butter.id,
          ingredient: 'Unsalted Butter',
          from: 'cup',
          to: butter.unit,
        },
      ])
      rule = (
        await request(http)
          .post('/api/unit-conversions')
          .set('Cookie', goldenForkCookie)
          .send({ ingredientId: butter.id, fromUnit: 'cup', toUnit: butter.unit, factor: 0.227 })
          .expect(201)
      ).body.id as string
      const after = await request(http)
        .get(`/api/documents/${id}`)
        .set('Cookie', goldenForkCookie)
        .set('X-Location-Id', locationId)
        .expect(200)
      expect((after.body as { unconverted: unknown[] }).unconverted).toEqual([])
    } finally {
      if (rule) await prisma.client.unitConversion.deleteMany({ where: { id: rule } })
      await prisma.client.document.deleteMany({ where: { id } })
    }
  })
})
