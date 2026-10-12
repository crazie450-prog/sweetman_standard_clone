import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import * as argon2 from 'argon2'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app-setup'
import { PrismaService } from '../src/prisma/prisma.service'
import { recalcOrganizationWith } from '../src/costing/costing.service'
import { lockKey } from '../src/common/utils/serialize'
import { DocumentsWorker } from '../src/modules/documents/documents.queue'

// Two identical requests arriving at once: exactly one may move stock or change a record.

describe('Concurrent writes (e2e)', () => {
  let app: INestApplication
  let http: ReturnType<INestApplication['getHttpServer']>
  let prisma: PrismaService
  let cookie = ''
  let locationId = ''
  const stamp = Date.now()

  const login = async (email: string): Promise<string> => {
    const res = await request(http)
      .post('/api/auth/login')
      .send({ email, password: 'Nexus_dev1' })
      .expect(200)
    const raw = res.headers['set-cookie']
    const cookies = Array.isArray(raw) ? raw : [raw]
    return cookies.map((c) => c.split(';')[0]).join('; ')
  }
  const here = () => ({ Cookie: cookie, 'X-Location-Id': locationId })

  const waitForStatus = async (id: string, target: string): Promise<string> => {
    for (let i = 0; i < 40; i++) {
      const res = await request(http).get(`/api/documents/${id}`).set(here()).expect(200)
      const status = (res.body as { status: string }).status
      if (status === target || status === 'failed') return status
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error(`document ${id} never reached ${target}`)
  }

  const stockOf = async (ingredientId: string) =>
    Number(
      (
        await prisma.client.ingredientLocationStock.findUniqueOrThrow({
          where: { ingredientId_locationId: { ingredientId, locationId } },
        })
      ).onHand,
    )
  const setStock = async (ingredientId: string, onHand: number) => {
    await prisma.client.ingredientLocationStock.update({
      where: { ingredientId_locationId: { ingredientId, locationId } },
      data: { onHand },
    })
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication({ rawBody: true })
    configureApp(app)
    await app.init()
    http = app.getHttpServer()
    prisma = app.get(PrismaService)
    cookie = await login('owner@goldenfork.com')
    const location = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Downtown' },
    })
    locationId = location.id
  })

  afterAll(async () => {
    await app.close()
  })

  test('two recipes nested in each other at once: one is refused, no circle is left behind', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    for (let round = 0; round < 3; round++) {
      const make = (name: string) =>
        prisma.client.recipe.create({
          data: {
            organizationId: org.id,
            locationId,
            name: `${name} ${stamp}-${round}`,
            portions: 1,
          },
        })
      const [a, b] = await Promise.all([make('Probe Circle A'), make('Probe Circle B')])
      try {
        const nest = (parent: string, component: string) =>
          request(http)
            .post(`/api/recipes/${parent}/components`)
            .set(here())
            .send({ componentId: component, quantity: 1, unit: 'portion' })
        const answers = (await Promise.all([nest(a.id, b.id), nest(b.id, a.id)]))
          .map((r) => r.status)
          .sort()
        expect(answers).toEqual([201, 400])
        const edges = await prisma.client.recipeComponent.count({
          where: { parentId: { in: [a.id, b.id] } },
        })
        expect(edges).toBe(1)
      } finally {
        await prisma.client.recipeComponent.deleteMany({
          where: { parentId: { in: [a.id, b.id] } },
        })
        await prisma.client.recipe.deleteMany({ where: { id: { in: [a.id, b.id] } } })
      }
    }
  })

  test('a recipe moved to another kitchen while a recipe here takes it in: it never ends up where it cannot be used', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const airport = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Airport' },
    })
    for (let round = 0; round < 3; round++) {
      const [shared, parent] = await Promise.all([
        prisma.client.recipe.create({
          data: {
            organizationId: org.id,
            locationId: null,
            name: `Probe Moving ${stamp}-${round}`,
            portions: 1,
          },
        }),
        prisma.client.recipe.create({
          data: {
            organizationId: org.id,
            locationId,
            name: `Probe Taking ${stamp}-${round}`,
            portions: 1,
          },
        }),
      ])
      try {
        await Promise.all([
          request(http)
            .patch(`/api/recipes/${shared.id}`)
            .set({ Cookie: cookie })
            .send({ locationId: airport.id }),
          request(http)
            .post(`/api/recipes/${parent.id}/components`)
            .set(here())
            .send({ componentId: shared.id, quantity: 1, unit: 'portion' }),
        ])
        const moved = (await prisma.client.recipe.findUniqueOrThrow({ where: { id: shared.id } }))
          .locationId
        const taken = await prisma.client.recipeComponent.count({
          where: { parentId: parent.id, componentId: shared.id },
        })
        expect(moved === airport.id && taken === 1).toBe(false)
      } finally {
        await prisma.client.recipeComponent.deleteMany({ where: { parentId: parent.id } })
        await prisma.client.recipe.deleteMany({ where: { id: { in: [shared.id, parent.id] } } })
      }
    }
  })

  test('a recipe moved to another kitchen while a dish here is built on it: it never ends up where it cannot be served', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const airport = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Airport' },
    })
    for (let round = 0; round < 3; round++) {
      const shared = await prisma.client.recipe.create({
        data: {
          organizationId: org.id,
          locationId: null,
          name: `Probe Moving Dish ${stamp}-${round}`,
          portions: 1,
        },
      })
      const dish = `Probe Built Dish ${stamp}-${round}`
      try {
        await Promise.all([
          request(http)
            .patch(`/api/recipes/${shared.id}`)
            .set({ Cookie: cookie })
            .send({ locationId: airport.id }),
          request(http)
            .post('/api/menu-items')
            .set(here())
            .send({
              name: dish,
              price: 10,
              locationId,
              recipes: [{ recipeId: shared.id, portions: 1 }],
            }),
        ])
        const moved = (await prisma.client.recipe.findUniqueOrThrow({ where: { id: shared.id } }))
          .locationId
        const built = await prisma.client.menuItemRecipe.count({ where: { recipeId: shared.id } })
        expect(moved === airport.id && built === 1).toBe(false)
      } finally {
        await prisma.client.menuItem.deleteMany({ where: { name: dish } })
        await prisma.client.recipe.delete({ where: { id: shared.id } })
      }
    }
  })

  test('a menu narrowed to another kitchen while a dish here is placed on it: the dish is never on a menu its kitchen does not serve', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const airport = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Golden Fork — Airport' },
    })
    for (let round = 0; round < 3; round++) {
      const [menu, dish] = await Promise.all([
        prisma.client.menu.create({
          data: { organizationId: org.id, name: `Probe Narrowing ${stamp}-${round}` },
        }),
        prisma.client.menuItem.create({
          data: {
            organizationId: org.id,
            locationId,
            name: `Probe Placed ${stamp}-${round}`,
            price: 10,
          },
        }),
      ])
      try {
        await Promise.all([
          request(http)
            .patch(`/api/menus/${menu.id}`)
            .set({ Cookie: cookie })
            .send({ locationIds: [airport.id] }),
          request(http)
            .patch(`/api/menu-items/${dish.id}`)
            .set(here())
            .send({ menuIds: [menu.id] }),
        ])
        const served = await prisma.client.menuOnLocation.findMany({ where: { menuId: menu.id } })
        const placed = await prisma.client.menuItemOnMenu.count({
          where: { menuId: menu.id, menuItemId: dish.id },
        })
        const narrowed = served.length === 1 && served[0].locationId === airport.id
        expect(narrowed && placed === 1).toBe(false)
      } finally {
        await prisma.client.menu.delete({ where: { id: menu.id } })
        await prisma.client.menuItem.delete({ where: { id: dish.id } })
      }
    }
  })

  test('two confirms of one invoice at once: one applies, one is refused, stock moves once', async () => {
    const butter = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
    })
    const before = await stockOf(butter.id)
    const beforeTotal = Number(butter.onHand)
    const number = `CONC-${stamp}`
    const upload = await request(http)
      .post('/api/documents')
      .set(here())
      .field('type', 'invoice')
      .attach(
        'file',
        Buffer.from(
          JSON.stringify({
            kind: 'invoice',
            number,
            items: [{ rawName: 'Unsalted Butter', quantity: 1, unit: butter.unit, unitPrice: 9.5 }],
          }),
        ),
        { filename: 'concurrent.json', contentType: 'application/json' },
      )
      .expect(201)
    const id = (upload.body as { id: string }).id
    expect(await waitForStatus(id, 'requires_review')).toBe('requires_review')

    const results = await Promise.all([
      request(http).post(`/api/documents/${id}/confirm`).set(here()),
      request(http).post(`/api/documents/${id}/confirm`).set(here()),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])

    expect(await stockOf(butter.id)).toBeCloseTo(before + 1, 3)
    const invoices = await prisma.client.invoice.count({ where: { number } })
    expect(invoices).toBe(1)

    await prisma.client.inventoryTransaction.deleteMany({ where: { notes: `Invoice ${number}` } })
    await prisma.client.invoice.deleteMany({ where: { number } })
    await prisma.client.document.deleteMany({ where: { id } })
    await prisma.client.ingredientPriceHistory.deleteMany({
      where: { ingredientId: butter.id, source: 'receipt', recordedAt: { gte: new Date(stamp) } },
    })
    await setStock(butter.id, before)
    await prisma.client.ingredient.update({
      where: { id: butter.id },
      data: { onHand: beforeTotal },
    })
  })

  test('a confirm cut off before it finished returns the document to review instead of leaving it stuck', async () => {
    const upload = await request(http)
      .post('/api/documents')
      .set(here())
      .field('type', 'invoice')
      .attach(
        'file',
        Buffer.from(
          JSON.stringify({
            kind: 'invoice',
            number: `CUT-${stamp}`,
            items: [{ rawName: 'Unsalted Butter', quantity: 1, unit: 'kg', unitPrice: 9.5 }],
          }),
        ),
        { filename: 'cut-off.json', contentType: 'application/json' },
      )
      .expect(201)
    const id = (upload.body as { id: string }).id
    try {
      expect(await waitForStatus(id, 'requires_review')).toBe('requires_review')
      await prisma.client.document.update({
        where: { id },
        data: { status: 'processing', updatedAt: new Date(Date.now() - 10 * 60_000) },
      })

      expect(await app.get(DocumentsWorker).releaseStaleConfirms()).toBeGreaterThanOrEqual(1)
      expect((await prisma.client.document.findUniqueOrThrow({ where: { id } })).status).toBe(
        'requires_review',
      )

      await prisma.client.document.update({ where: { id }, data: { status: 'processing' } })
      await app.get(DocumentsWorker).releaseStaleConfirms()
      expect((await prisma.client.document.findUniqueOrThrow({ where: { id } })).status).toBe(
        'processing',
      )
    } finally {
      await prisma.client.document.deleteMany({ where: { id } })
    }
  })

  test('two waste entries for the last of a stock at once: one is recorded, the shelf never goes below zero', async () => {
    const eggs = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Eggs' },
    })
    const before = await stockOf(eggs.id)
    const beforeTotal = Number(eggs.onHand)
    await setStock(eggs.id, 1)

    const results = await Promise.all([
      request(http)
        .post('/api/waste')
        .set(here())
        .send({ ingredientId: eggs.id, quantity: 1, reason: 'other' }),
      request(http)
        .post('/api/waste')
        .set(here())
        .send({ ingredientId: eggs.id, quantity: 1, reason: 'other' }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([201, 400])
    expect(await stockOf(eggs.id)).toBe(0)

    await prisma.client.wasteEntry.deleteMany({ where: { ingredientId: eggs.id, reason: 'other' } })
    await prisma.client.inventoryTransaction.deleteMany({
      where: { ingredientId: eggs.id, type: 'WASTE', createdAt: { gte: new Date(stamp) } },
    })
    await setStock(eggs.id, before)
    await prisma.client.ingredient.update({ where: { id: eggs.id }, data: { onHand: beforeTotal } })
  })

  test('two retries of one failed document at once: one is queued, the other answers 409', async () => {
    const upload = await request(http)
      .post('/api/documents')
      .set(here())
      .field('type', 'invoice')
      .attach(
        'file',
        Buffer.from(JSON.stringify({ kind: 'invoice', number: `RETRY-${stamp}`, items: [] })),
        { filename: 'retry.json', contentType: 'application/json' },
      )
      .expect(201)
    const id = (upload.body as { id: string }).id
    expect(await waitForStatus(id, 'requires_review')).toBe('requires_review')
    await prisma.client.document.update({
      where: { id },
      data: { status: 'failed', error: 'made to fail for the test' },
    })

    const results = await Promise.all([
      request(http).post(`/api/documents/${id}/retry`).set(here()),
      request(http).post(`/api/documents/${id}/retry`).set(here()),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])

    expect(await waitForStatus(id, 'requires_review')).toBe('requires_review')
    expect(await prisma.client.extraction.count({ where: { documentId: id } })).toBe(2)
    await prisma.client.document.delete({ where: { id } })
  })

  test('two approvals of one draft order at once: one is recorded, the other answers 409', async () => {
    const beef = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Beef Tenderloin' },
    })
    const created = await request(http)
      .post('/api/purchasing/drafts')
      .set(here())
      .send({ days: 30, horizon: 60, lines: [{ ingredientId: beef.id, quantity: 2 }] })
      .expect(201)
    const drafts = created.body as { id: string }[]
    expect(drafts).toHaveLength(1)
    const draftId = drafts[0].id

    const results = await Promise.all([
      request(http).post(`/api/purchasing/drafts/${draftId}/approve`).set(here()),
      request(http).post(`/api/purchasing/drafts/${draftId}/approve`).set(here()),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])

    const draft = await prisma.client.purchaseDraft.findUniqueOrThrow({ where: { id: draftId } })
    expect(draft.status).toBe('approved')
    await prisma.client.purchaseDraft.delete({ where: { id: draftId } })
  })

  test('two rules that each keep a recipe line costed, removed at once: one of them stays', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const butter = await prisma.client.ingredient.findFirstOrThrow({
      where: { organizationId: org.id, name: 'Unsalted Butter' },
    })
    for (let round = 0; round < 3; round++) {
      const recipe = await prisma.client.recipe.create({
        data: {
          organizationId: org.id,
          name: `Race rules ${stamp}-${round}`,
          ingredients: {
            create: [{ ingredientId: butter.id, quantity: 1, unit: 'tub', order: 0 }],
          },
        },
      })
      const [shared, own] = await Promise.all([
        prisma.client.unitConversion.create({
          data: { organizationId: org.id, fromUnit: 'tub', toUnit: butter.unit, factor: 2 },
        }),
        prisma.client.unitConversion.create({
          data: {
            organizationId: org.id,
            ingredientId: butter.id,
            fromUnit: 'tub',
            toUnit: butter.unit,
            factor: 2,
          },
        }),
      ])
      const results = await Promise.all(
        [shared, own].map((r) => request(http).delete(`/api/unit-conversions/${r.id}`).set(here())),
      )
      const left = await prisma.client.unitConversion.count({
        where: { id: { in: [shared.id, own.id] } },
      })
      await prisma.client.unitConversion.deleteMany({ where: { id: { in: [shared.id, own.id] } } })
      await prisma.client.recipe.delete({ where: { id: recipe.id } })
      expect(results.map((r) => r.status).sort()).toEqual([200, 400])
      expect(left).toBe(1)
    }
  })

  test('a recipe line written in a unit while its only rule is removed: never both', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const butter = await prisma.client.ingredient.findFirstOrThrow({
      where: { organizationId: org.id, name: 'Unsalted Butter' },
    })
    for (let round = 0; round < 5; round++) {
      const recipe = await prisma.client.recipe.create({
        data: { organizationId: org.id, name: `Race line ${stamp}-${round}` },
      })
      const rule = await prisma.client.unitConversion.create({
        data: { organizationId: org.id, fromUnit: 'tub', toUnit: butter.unit, factor: 2 },
      })
      const [written, removed] = await Promise.all([
        request(http)
          .patch(`/api/recipes/${recipe.id}`)
          .set(here())
          .send({ ingredients: [{ ingredientId: butter.id, quantity: 1, unit: 'tub' }] }),
        request(http).delete(`/api/unit-conversions/${rule.id}`).set(here()),
      ])
      const lines = await prisma.client.recipeIngredient.count({ where: { recipeId: recipe.id } })
      const kept = await prisma.client.unitConversion.count({ where: { id: rule.id } })
      await prisma.client.unitConversion.deleteMany({ where: { id: rule.id } })
      await prisma.client.recipe.delete({ where: { id: recipe.id } })
      expect([
        [200, 400, 1, 1],
        [400, 200, 0, 0],
      ]).toContainEqual([written.status, removed.status, lines, kept])
    }
  })

  test("an ingredient's unit changed while a recipe line is written in the old one: never both", async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    for (let round = 0; round < 5; round++) {
      const [ingredient, recipe] = await Promise.all([
        prisma.client.ingredient.create({
          data: { organizationId: org.id, name: `Race unit ${stamp}-${round}`, unit: 'kg' },
        }),
        prisma.client.recipe.create({
          data: { organizationId: org.id, name: `Race unit recipe ${stamp}-${round}` },
        }),
      ])
      const [line, unit] = await Promise.all([
        request(http)
          .patch(`/api/recipes/${recipe.id}`)
          .set(here())
          .send({ ingredients: [{ ingredientId: ingredient.id, quantity: 100, unit: 'g' }] }),
        request(http).patch(`/api/ingredients/${ingredient.id}`).set(here()).send({ unit: 'l' }),
      ])
      const lines = await prisma.client.recipeIngredient.count({ where: { recipeId: recipe.id } })
      const now = (
        await prisma.client.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } })
      ).unit
      await prisma.client.recipe.delete({ where: { id: recipe.id } })
      await prisma.client.ingredient.delete({ where: { id: ingredient.id } })
      expect([
        [200, 400, 1, 'kg'],
        [400, 200, 0, 'l'],
      ]).toContainEqual([line.status, unit.status, lines, now])
    }
  })

  test("a dish moved to one location while another location's sales name is mapped to it: never both", async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const elsewhere = await prisma.client.location.findFirstOrThrow({
      where: { organizationId: org.id, id: { not: locationId }, isActive: true },
    })
    for (let round = 0; round < 5; round++) {
      const [dish, alias] = await Promise.all([
        prisma.client.menuItem.create({
          data: { organizationId: org.id, name: `Race dish ${stamp}-${round}`, price: 10 },
        }),
        prisma.client.menuItemAlias.create({
          data: {
            organizationId: org.id,
            locationId: elsewhere.id,
            rawName: `RACE DISH ${stamp}-${round}`,
          },
        }),
      ])
      const [moved, mapped] = await Promise.all([
        request(http)
          .patch(`/api/menu-items/${dish.id}`)
          .set('Cookie', cookie)
          .send({ locationId }),
        request(http)
          .post(`/api/documents/menu-item-aliases/${alias.id}`)
          .set('Cookie', cookie)
          .send({ menuItemId: dish.id }),
      ])
      const placed = (await prisma.client.menuItem.findUniqueOrThrow({ where: { id: dish.id } }))
        .locationId
      const reads = (
        await prisma.client.menuItemAlias.findUniqueOrThrow({ where: { id: alias.id } })
      ).menuItemId
      await prisma.client.menuItemAlias.delete({ where: { id: alias.id } })
      await prisma.client.menuItem.delete({ where: { id: dish.id } })
      expect([
        [200, 400, locationId, null],
        [400, 201, null, dish.id],
      ]).toContainEqual([moved.status, mapped.status, placed, reads])
    }
  })

  test('an invitation accepted and revoked at once ends one way: a member and accepted, or no one and revoked', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    for (let round = 0; round < 5; round++) {
      const email = `race-${stamp}-${round}@test.nexus`
      const invitation = await prisma.client.invitation.create({
        data: {
          organizationId: org.id,
          email,
          token: `race-${stamp}-${round}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      })
      const [accepted, revoked] = await Promise.all([
        request(http)
          .post(`/api/invitations/${invitation.token}/accept`)
          .send({ fullName: 'Race Member', password: 'Race_pass1' }),
        request(http).delete(`/api/invitations/${invitation.id}`).set(here()),
      ])
      const member = await prisma.client.user.findUnique({ where: { email } })
      const status = (
        await prisma.client.invitation.findUniqueOrThrow({ where: { id: invitation.id } })
      ).status
      if (member) await prisma.client.user.delete({ where: { id: member.id } })
      await prisma.client.invitation.delete({ where: { id: invitation.id } })
      const outcome = [accepted.status, revoked.status, Boolean(member), status]
      expect([
        [200, 404, true, 'accepted'],
        [404, 200, false, 'revoked'],
      ]).toContainEqual(outcome)
    }
  })

  test('an invitation revoked while it is being sent again: no fresh link goes out for a revoked invitation', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const invitation = await prisma.client.invitation.create({
      data: {
        organizationId: org.id,
        email: `race-resend-${stamp}@test.nexus`,
        token: `race-resend-${stamp}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })
    const original = prisma.client.invitation.findUnique.bind(prisma.client.invitation)
    const read = jest.spyOn(prisma.client.invitation, 'findUnique').mockImplementationOnce((async (
      args: Parameters<typeof original>[0],
    ) => {
      const seen = await original(args)
      await prisma.client.invitation.update({
        where: { id: invitation.id },
        data: { status: 'revoked' },
      })
      return seen
    }) as never)
    try {
      const resent = await request(http)
        .post(`/api/invitations/${invitation.id}/resend`)
        .set(here())
      const after = await prisma.client.invitation.findUniqueOrThrow({
        where: { id: invitation.id },
      })
      expect([resent.status, after.status, after.token]).toEqual([
        404,
        'revoked',
        `race-resend-${stamp}`,
      ])
    } finally {
      read.mockRestore()
      await prisma.client.invitation.delete({ where: { id: invitation.id } })
    }
  })

  test('two counts and a use of one shelf at once: the movements add up to what the shelf holds', async () => {
    const butter = await prisma.client.ingredient.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, name: 'Unsalted Butter' },
    })
    const before = await stockOf(butter.id)
    const total = butter.onHand
    const since = new Date()
    try {
      for (let round = 0; round < 5; round++) {
        await setStock(butter.id, 10)
        const start = await prisma.client.inventoryTransaction.findMany({
          where: { ingredientId: butter.id, locationId, createdAt: { gte: since } },
          select: { id: true },
        })
        const move = (type: string, quantity: number) =>
          request(http)
            .post('/api/inventory/transactions')
            .set(here())
            .send({ ingredientId: butter.id, type, quantity })
        const results = await Promise.all([move('COUNT', 6), move('COUNT', 7), move('USE', 1)])
        expect(results.map((r) => r.status)).toEqual([201, 201, expect.any(Number)])
        const moved = await prisma.client.inventoryTransaction.findMany({
          where: {
            ingredientId: butter.id,
            locationId,
            createdAt: { gte: since },
            id: { notIn: start.map((s) => s.id) },
          },
          select: { quantity: true },
        })
        const sum = moved.reduce((a, m) => a + Number(m.quantity), 0)
        expect(Number((10 + sum).toFixed(3))).toBe(await stockOf(butter.id))
      }
    } finally {
      await prisma.client.inventoryTransaction.deleteMany({
        where: { ingredientId: butter.id, locationId, createdAt: { gte: since } },
      })
      await setStock(butter.id, before)
      await prisma.client.ingredient.update({ where: { id: butter.id }, data: { onHand: total } })
    }
  })

  test('two edits of one draft order at once, each removing a different line: the order keeps one', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const [first, second] = await prisma.client.ingredient.findMany({
      where: { organizationId: org.id },
      orderBy: { name: 'asc' },
      take: 2,
    })
    for (let round = 0; round < 3; round++) {
      const draft = await prisma.client.purchaseDraft.create({
        data: {
          organizationId: org.id,
          locationId,
          days: 28,
          horizon: 7,
          lines: {
            create: [first, second].map((i) => ({
              ingredientId: i.id,
              quantity: 1,
              unit: i.unit,
              unitPrice: 1,
              suggested: 1,
              onHand: 0,
            })),
          },
        },
      })
      const remove = (ingredientId: string) =>
        request(http)
          .patch(`/api/purchasing/drafts/${draft.id}`)
          .set(here())
          .send({ lines: [{ ingredientId, quantity: 0 }] })
      const results = await Promise.all([remove(first.id), remove(second.id)])
      const left = await prisma.client.purchaseDraftLine.count({ where: { draftId: draft.id } })
      await prisma.client.purchaseDraft.delete({ where: { id: draft.id } })
      expect(results.map((r) => r.status).sort()).toEqual([200, 400])
      expect(left).toBe(1)
    }
  })

  describe('two identical creates at once: one record, one refusal', () => {
    const pair = async (send: () => request.Test) => {
      const results = await Promise.all([send(), send()])
      return results.map((r) => r.status).sort()
    }

    test('an invitation to one email', async () => {
      const email = `race-${stamp}@example.com`
      const body = { email, role: 'staff', locationIds: [] }
      try {
        expect(
          await pair(() => request(http).post('/api/invitations').set(here()).send(body)),
        ).toEqual([201, 409])
        expect(await prisma.client.invitation.count({ where: { email } })).toBe(1)
      } finally {
        await prisma.client.invitation.deleteMany({ where: { email } })
      }
    })

    test('a recipe of the whole organization under one name', async () => {
      const name = `Race Recipe ${stamp}`
      const body = { name, portions: 1, ingredients: [] }
      try {
        expect(await pair(() => request(http).post('/api/recipes').set(here()).send(body))).toEqual(
          [201, 409],
        )
        expect(await prisma.client.recipe.count({ where: { name } })).toBe(1)
      } finally {
        await prisma.client.recipe.deleteMany({ where: { name } })
      }
    })

    test('a conversion rule of the whole organization for one pair of units', async () => {
      const body = { fromUnit: 'dozen', toUnit: 'g', factor: 50 }
      try {
        expect(
          await pair(() => request(http).post('/api/unit-conversions').set(here()).send(body)),
        ).toEqual([201, 400])
        expect(
          await prisma.client.unitConversion.count({ where: { fromUnit: 'dozen', toUnit: 'g' } }),
        ).toBe(1)
      } finally {
        await prisma.client.unitConversion.deleteMany({ where: { fromUnit: 'dozen', toUnit: 'g' } })
      }
    })

    test('two conversion rules changed into one pair of units', async () => {
      const units = ['ea', 'cup', 'dozen']
      try {
        const ids: string[] = []
        for (const fromUnit of units.slice(0, 2)) {
          const res = await request(http)
            .post('/api/unit-conversions')
            .set(here())
            .send({ fromUnit, toUnit: 'g', factor: 10 })
            .expect(201)
          ids.push((res.body as { id: string }).id)
        }
        const results = await Promise.all(
          ids.map((id) =>
            request(http)
              .patch(`/api/unit-conversions/${id}`)
              .set(here())
              .send({ fromUnit: 'dozen' }),
          ),
        )
        expect(results.map((r) => r.status).sort()).toEqual([200, 400])
        expect(
          await prisma.client.unitConversion.count({ where: { fromUnit: 'dozen', toUnit: 'g' } }),
        ).toBe(1)
      } finally {
        await prisma.client.unitConversion.deleteMany({
          where: { fromUnit: { in: units }, toUnit: 'g' },
        })
      }
    })

    test('a sales name parked for every location', async () => {
      const rawName = `Race Alias ${stamp}`
      try {
        expect(
          await pair(() =>
            request(http)
              .post('/api/documents/menu-item-aliases')
              .set({ Cookie: cookie })
              .send({ rawName }),
          ),
        ).toEqual([201, 409])
        expect(await prisma.client.menuItemAlias.count({ where: { rawName } })).toBe(1)
      } finally {
        await prisma.client.menuItemAlias.deleteMany({ where: { rawName } })
      }
    })

    test('a vendor product under one name spelled two ways', async () => {
      const vendor = await prisma.client.vendor.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' } },
      })
      const names = [`Race Product ${stamp}`, `RACE PRODUCT ${stamp}`]
      try {
        const results = await Promise.all(
          names.map((name) =>
            request(http)
              .post('/api/vendor-products')
              .set(here())
              .send({ vendorId: vendor.id, name }),
          ),
        )
        expect(results.map((r) => r.status).sort()).toEqual([201, 409])
        expect(
          await prisma.client.vendorProduct.count({
            where: { vendorId: vendor.id, name: { in: names } },
          }),
        ).toBe(1)
      } finally {
        await prisma.client.vendorProduct.deleteMany({
          where: { vendorId: vendor.id, name: { in: names } },
        })
      }
    })

    test('an ingredient name parked under two spellings', async () => {
      const names = [`Race Wording ${stamp}`, `RACE WORDING ${stamp}`]
      try {
        const results = await Promise.all(
          names.map((rawName) =>
            request(http)
              .post('/api/documents/ingredient-aliases')
              .set({ Cookie: cookie })
              .send({ rawName }),
          ),
        )
        expect(results.map((r) => r.status).sort()).toEqual([201, 409])
        expect(
          await prisma.client.ingredientAlias.count({ where: { rawName: { in: names } } }),
        ).toBe(1)
      } finally {
        await prisma.client.ingredientAlias.deleteMany({ where: { rawName: { in: names } } })
      }
    })

    test('two products of one vendor carrying one code', async () => {
      const vendor = await prisma.client.vendor.findFirstOrThrow({
        where: { organization: { slug: 'golden-fork' } },
      })
      const sku = `RACE-${stamp}`
      const names = [`Race Coded ${stamp} A`, `Race Coded ${stamp} B`]
      try {
        const results = await Promise.all(
          names.map((name) =>
            request(http)
              .post('/api/vendor-products')
              .set(here())
              .send({ vendorId: vendor.id, name, sku }),
          ),
        )
        expect(results.map((r) => r.status).sort()).toEqual([201, 409])
        expect(
          await prisma.client.vendorProduct.count({ where: { vendorId: vendor.id, sku } }),
        ).toBe(1)
      } finally {
        await prisma.client.vendorProduct.deleteMany({
          where: { vendorId: vendor.id, name: { in: names } },
        })
      }
    })

    describe('one name spelled two ways, sent at once', () => {
      const spellings = (base: string) => [`${base} ${stamp}`, `${base.toUpperCase()} ${stamp}`]
      const cases = [
        {
          path: '/api/vendors',
          base: 'Race Vendor',
          body: {},
          count: (names: string[]) =>
            prisma.client.vendor.count({ where: { name: { in: names } } }),
          clean: (names: string[]) =>
            prisma.client.vendor.deleteMany({ where: { name: { in: names } } }),
        },
        {
          path: '/api/categories',
          base: 'Race Category',
          body: { kind: 'ingredient' },
          count: (names: string[]) =>
            prisma.client.category.count({ where: { name: { in: names } } }),
          clean: (names: string[]) =>
            prisma.client.category.deleteMany({ where: { name: { in: names } } }),
        },
        {
          path: '/api/menus',
          base: 'Race Menu',
          body: {},
          count: (names: string[]) => prisma.client.menu.count({ where: { name: { in: names } } }),
          clean: (names: string[]) =>
            prisma.client.menu.deleteMany({ where: { name: { in: names } } }),
        },
        {
          path: '/api/locations',
          base: 'Race Location',
          body: {},
          count: (names: string[]) =>
            prisma.client.location.count({ where: { name: { in: names } } }),
          clean: (names: string[]) =>
            prisma.client.location.deleteMany({ where: { name: { in: names } } }),
        },
        {
          path: '/api/ingredients',
          base: 'Race Ingredient',
          body: { unit: 'kg', costPerUnit: 1 },
          count: (names: string[]) =>
            prisma.client.ingredient.count({ where: { name: { in: names } } }),
          clean: async (names: string[]) => {
            const ids = (
              await prisma.client.ingredient.findMany({
                where: { name: { in: names } },
                select: { id: true },
              })
            ).map((i) => i.id)
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
            await prisma.client.ingredient.deleteMany({ where: { id: { in: ids } } })
          },
        },
      ]
      for (const c of cases) {
        test(c.path, async () => {
          const names = spellings(c.base)
          try {
            const results = await Promise.all(
              names.map((name) =>
                request(http)
                  .post(c.path)
                  .set({ Cookie: cookie })
                  .send({ ...c.body, name }),
              ),
            )
            expect(results.map((r) => r.status).sort()).toEqual([201, 409])
            expect(await c.count(names)).toBe(1)
          } finally {
            await c.clean(names)
          }
        })
      }
    })

    test('a dish of the whole organization under one name', async () => {
      const name = `Race Dish ${stamp}`
      const body = { name, price: 5 }
      try {
        expect(
          await pair(() => request(http).post('/api/menu-items').set(here()).send(body)),
        ).toEqual([201, 409])
        expect(await prisma.client.menuItem.count({ where: { name } })).toBe(1)
      } finally {
        await prisma.client.menuItem.deleteMany({ where: { name } })
      }
    })
  })

  test('two copies of one sales report confirmed at once: one is recorded, the other is refused', async () => {
    const dish = await prisma.client.menuItem.findFirstOrThrow({
      where: { organization: { slug: 'golden-fork' }, locationId: null, isActive: true },
      select: { name: true },
    })
    const date = '2026-08-05'
    const day = { gte: new Date(`${date}T00:00:00+14:00`), lte: new Date(`${date}T23:59:59-12:00`) }
    const report = Buffer.from(
      JSON.stringify({
        kind: 'sales',
        date,
        items: [{ menuItemName: dish.name, quantity: 3, unitPrice: 11 }],
      }),
    )
    const ids: string[] = []
    try {
      for (const name of ['copy-a.json', 'copy-b.json']) {
        const upload = await request(http)
          .post('/api/documents')
          .set(here())
          .field('type', 'sales')
          .attach('file', report, { filename: name, contentType: 'application/json' })
          .expect(201)
        ids.push((upload.body as { id: string }).id)
      }
      for (const id of ids)
        expect(await waitForStatus(id, 'requires_review')).toBe('requires_review')

      const results = await Promise.all(
        ids.map((id) => request(http).post(`/api/documents/${id}/confirm`).set(here())),
      )
      expect(results.map((r) => r.status).sort()).toEqual([201, 409])
      expect(await prisma.client.sale.count({ where: { locationId, date: day } })).toBe(1)
    } finally {
      await prisma.client.sale.deleteMany({ where: { locationId, date: day } })
      await prisma.client.document.deleteMany({ where: { id: { in: ids } } })
    }
  })

  describe('two documents naming one record two ways, confirmed at once', () => {
    const confirmBoth = async (type: string, payloads: object[]) => {
      const ids: string[] = []
      for (const [i, payload] of payloads.entries()) {
        const upload = await request(http)
          .post('/api/documents')
          .set(here())
          .field('type', type)
          .attach('file', Buffer.from(JSON.stringify(payload)), {
            filename: `race-${i}.json`,
            contentType: 'application/json',
          })
          .expect(201)
        ids.push((upload.body as { id: string }).id)
      }
      for (const id of ids)
        expect(await waitForStatus(id, 'requires_review')).toBe('requires_review')
      const results = await Promise.all(
        ids.map((id) => request(http).post(`/api/documents/${id}/confirm`).set(here())),
      )
      return { ids, statuses: results.map((r) => r.status).sort() }
    }

    test('a recipe', async () => {
      const names = [`Race Doc Recipe ${stamp}`, `RACE DOC RECIPE ${stamp}`]
      let ids: string[] = []
      try {
        const sent = await confirmBoth(
          'recipe',
          names.map((name) => ({
            kind: 'recipe',
            name,
            portions: 1,
            items: [{ rawName: 'Unsalted Butter', quantity: 0.1, unit: 'kg' }],
          })),
        )
        ids = sent.ids
        expect(sent.statuses).toEqual([201, 409])
        expect(await prisma.client.recipe.count({ where: { name: { in: names } } })).toBe(1)
      } finally {
        await prisma.client.recipe.deleteMany({ where: { name: { in: names } } })
        await prisma.client.document.deleteMany({ where: { id: { in: ids } } })
      }
    })

    test('a dish', async () => {
      const dishes = [`Race Doc Dish ${stamp}`, `RACE DOC DISH ${stamp}`]
      const menus = dishes.map((_, i) => `Race Doc Menu ${i} ${stamp}`)
      let ids: string[] = []
      try {
        const sent = await confirmBoth(
          'menu',
          dishes.map((name, i) => ({ kind: 'menu', name: menus[i], items: [{ name, price: 5 }] })),
        )
        ids = sent.ids
        expect(sent.statuses).toEqual([201, 201])
        expect(await prisma.client.menuItem.count({ where: { name: { in: dishes } } })).toBe(1)
      } finally {
        await prisma.client.menuItemOnMenu.deleteMany({ where: { menu: { name: { in: menus } } } })
        await prisma.client.menuOnLocation.deleteMany({ where: { menu: { name: { in: menus } } } })
        await prisma.client.menu.deleteMany({ where: { name: { in: menus } } })
        await prisma.client.menuItem.deleteMany({ where: { name: { in: dishes } } })
        await prisma.client.document.deleteMany({ where: { id: { in: ids } } })
      }
    })
  })

  test('the last two active locations archived at once: one stays open', async () => {
    const bella = await login('owner@bellacucina.com')
    const main = await prisma.client.location.findFirstOrThrow({
      where: { name: 'Bella Cucina — Main' },
    })
    const second = await request(http)
      .post('/api/locations')
      .set({ Cookie: bella })
      .send({ name: `Race Second ${stamp}` })
      .expect(201)
    const secondId = (second.body as { id: string }).id
    try {
      const results = await Promise.all(
        [main.id, secondId].map((id) =>
          request(http).delete(`/api/locations/${id}`).set({ Cookie: bella }),
        ),
      )
      expect(results.map((r) => r.status).sort()).toEqual([200, 400])
      expect(
        await prisma.client.location.count({
          where: { organizationId: main.organizationId, isActive: true },
        }),
      ).toBe(1)
    } finally {
      await prisma.client.location.update({ where: { id: main.id }, data: { isActive: true } })
      await prisma.client.location.delete({ where: { id: secondId } })
    }
  })

  test('a recalculation of costs waits for the one already running', async () => {
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const line = await prisma.client.recipeIngredient.findFirstOrThrow({
      where: { recipe: { organizationId: org.id } },
      include: { ingredient: true },
    })
    const original = Number(line.ingredient.costPerUnit)
    let release = () => {}
    const released = new Promise<void>((resolve) => (release = resolve))
    let taken = () => {}
    const holding = new Promise<void>((resolve) => (taken = resolve))
    const running = prisma.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey('recalc', org.id)}))`
        taken()
        await released
      },
      { timeout: 20000 },
    )
    try {
      await holding
      await prisma.client.ingredient.update({
        where: { id: line.ingredientId },
        data: { costPerUnit: original + 1 },
      })
      let finished = false
      const waiting = recalcOrganizationWith(prisma.client, org.id).then((changed) => {
        finished = true
        return changed
      })
      await new Promise((resolve) => setTimeout(resolve, 1000))
      expect(finished).toBe(false)
      release()
      await running
      expect(await waiting).toBeGreaterThan(0)
    } finally {
      release()
      await running.catch(() => undefined)
      await prisma.client.ingredient.update({
        where: { id: line.ingredientId },
        data: { costPerUnit: original },
      })
      await recalcOrganizationWith(prisma.client, org.id)
    }
  })

  test('a write that waits too long for another answers 409 to try again, not 500', async () => {
    const org = await prisma.client.organization.findFirstOrThrow({
      where: { slug: 'golden-fork' },
    })
    const name = `Busy Vendor ${stamp}`
    let release = () => {}
    const released = new Promise<void>((resolve) => (release = resolve))
    let taken = () => {}
    const holding = new Promise<void>((resolve) => (taken = resolve))
    const running = prisma.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey('vendor', org.id, name)}))`
        taken()
        await released
      },
      { timeout: 30000 },
    )
    try {
      await holding
      const started = Date.now()
      const res = await request(http).post('/api/vendors').set({ Cookie: cookie }).send({ name })
      expect(res.status).toBe(409)
      expect(String(res.body.error.message)).toMatch(/try again/i)
      expect(Date.now() - started).toBeLessThan(5000)
      expect(await prisma.client.vendor.count({ where: { name } })).toBe(0)
    } finally {
      release()
      await running.catch(() => undefined)
      await prisma.client.vendor.deleteMany({ where: { name } })
    }
  }, 40000)

  test('a sign-in with the old password while the password is replaced leaves no session behind', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const email = `race-signin-${stamp}@test.nexus`
    const user = await prisma.client.user.create({
      data: {
        organizationId: org.id,
        email,
        fullName: 'Race Sign In',
        role: 'staff',
        hashedPassword: await argon2.hash('Old_pass1'),
      },
    })
    const replaced = await argon2.hash('New_pass1')
    const original = prisma.client.user.findUnique.bind(prisma.client.user)
    const read = jest.spyOn(prisma.client.user, 'findUnique').mockImplementationOnce((async (
      args: Parameters<typeof original>[0],
    ) => {
      const seen = await original(args)
      await prisma.client.$transaction([
        prisma.client.user.update({ where: { id: user.id }, data: { hashedPassword: replaced } }),
        prisma.client.userSession.deleteMany({ where: { userId: user.id } }),
      ])
      return seen
    }) as never)
    try {
      const signedIn = await request(http)
        .post('/api/auth/login')
        .send({ email, password: 'Old_pass1' })
      const sessions = await prisma.client.userSession.count({ where: { userId: user.id } })
      expect([signedIn.status, sessions]).toEqual([401, 0])
    } finally {
      read.mockRestore()
      await prisma.client.userSession.deleteMany({ where: { userId: user.id } })
      await prisma.client.user.delete({ where: { id: user.id } })
    }
  }, 30000)

  test('a password change made with the old password while it is reset does not undo the reset', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const email = `race-change-${stamp}@test.nexus`
    const user = await prisma.client.user.create({
      data: {
        organizationId: org.id,
        email,
        fullName: 'Race Change',
        role: 'staff',
        hashedPassword: await argon2.hash('Nexus_dev1'),
      },
    })
    const session = await login(email)
    const reset = await argon2.hash('Reset_pass1')
    const original = prisma.client.user.findUniqueOrThrow.bind(prisma.client.user)
    const read = jest.spyOn(prisma.client.user, 'findUniqueOrThrow').mockImplementationOnce((async (
      args: Parameters<typeof original>[0],
    ) => {
      const seen = await original(args)
      await prisma.client.$transaction([
        prisma.client.user.update({ where: { id: user.id }, data: { hashedPassword: reset } }),
        prisma.client.userSession.deleteMany({ where: { userId: user.id } }),
      ])
      return seen
    }) as never)
    try {
      const changed = await request(http)
        .post('/api/auth/change-password')
        .set('Cookie', session)
        .send({ currentPassword: 'Nexus_dev1', newPassword: 'Taken_over1' })
      const stored = await prisma.client.user.findUniqueOrThrow({ where: { id: user.id } })
      expect([changed.status, await argon2.verify(stored.hashedPassword, 'Reset_pass1')]).toEqual([
        401,
        true,
      ])
    } finally {
      read.mockRestore()
      await prisma.client.userSession.deleteMany({ where: { userId: user.id } })
      await prisma.client.user.delete({ where: { id: user.id } })
    }
  }, 30000)

  test('an email change made with the old password while it is reset is refused', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const email = `race-email-${stamp}@test.nexus`
    const user = await prisma.client.user.create({
      data: {
        organizationId: org.id,
        email,
        fullName: 'Race Email',
        role: 'staff',
        hashedPassword: await argon2.hash('Nexus_dev1'),
      },
    })
    const session = await login(email)
    const reset = await argon2.hash('Reset_pass1')
    const original = prisma.client.user.findUniqueOrThrow.bind(prisma.client.user)
    const read = jest.spyOn(prisma.client.user, 'findUniqueOrThrow').mockImplementationOnce((async (
      args: Parameters<typeof original>[0],
    ) => {
      const seen = await original(args)
      await prisma.client.$transaction([
        prisma.client.user.update({ where: { id: user.id }, data: { hashedPassword: reset } }),
        prisma.client.userSession.deleteMany({ where: { userId: user.id } }),
      ])
      return seen
    }) as never)
    try {
      const changed = await request(http)
        .patch('/api/auth/me')
        .set('Cookie', session)
        .send({ email: `taken-over-${stamp}@test.nexus`, currentPassword: 'Nexus_dev1' })
      const stored = await prisma.client.user.findUniqueOrThrow({ where: { id: user.id } })
      expect([changed.status, stored.email]).toEqual([401, email])
    } finally {
      read.mockRestore()
      await prisma.client.userSession.deleteMany({ where: { userId: user.id } })
      await prisma.client.user.delete({ where: { id: user.id } })
    }
  }, 30000)

  test('wrong passwords sent at once each count toward the lockout', async () => {
    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    const email = `race-lockout-${stamp}@test.nexus`
    const user = await prisma.client.user.create({
      data: {
        organizationId: org.id,
        email,
        fullName: 'Race Lockout',
        role: 'staff',
        hashedPassword: await argon2.hash('Nexus_dev1'),
      },
    })
    try {
      await Promise.all(
        Array.from({ length: 5 }, () =>
          request(http).post('/api/auth/login').send({ email, password: 'Wrong_pass1' }),
        ),
      )
      const counted = await prisma.client.user.findUniqueOrThrow({ where: { id: user.id } })
      expect([counted.failedLoginAttempts, counted.lockoutUntil !== null]).toEqual([5, true])
    } finally {
      await prisma.client.user.delete({ where: { id: user.id } })
    }
  }, 30000)

  test('one reset link used twice at once sets one password', async () => {
    const { createHash } = await import('node:crypto')
    const raw = `e2e-twice-${Date.now()}`
    const ken = await prisma.client.user.findUniqueOrThrow({
      where: { email: 'ken@goldenfork.com' },
    })
    await prisma.client.user.update({
      where: { id: ken.id },
      data: {
        passwordResetToken: createHash('sha256').update(raw).digest('hex'),
        passwordResetExpires: new Date(Date.now() + 600000),
      },
    })
    try {
      const results = await Promise.all(
        ['Twice_one1', 'Twice_two2'].map((password) =>
          request(http).post('/api/auth/reset-password').send({ token: raw, password }),
        ),
      )
      expect(results.map((r) => r.status).sort()).toEqual([200, 401])
    } finally {
      await prisma.client.user.update({
        where: { id: ken.id },
        data: {
          hashedPassword: ken.hashedPassword,
          passwordResetToken: null,
          passwordResetExpires: null,
        },
      })
    }
  })

  test('a second tab refreshing with the token the first tab just rotated stays signed in, and so does the first', async () => {
    const jarOf = (res: request.Response) => {
      const raw = res.headers['set-cookie']
      return (Array.isArray(raw) ? raw : [raw]).map((c) => c.split(';')[0]).join('; ')
    }
    const login = await request(http)
      .post('/api/auth/login')
      .send({ email: 'maria@goldenfork.com', password: 'Nexus_dev1' })
      .expect(200)
    const before = jarOf(login)
    const first = await request(http).get('/api/auth/refresh').set('Cookie', before).expect(200)
    const second = await request(http).get('/api/auth/refresh').set('Cookie', before)
    expect(second.status).toBe(200)
    expect(String(second.headers['set-cookie'])).not.toMatch(/refresh_token=/)
    await request(http).get('/api/auth/me').set('Cookie', jarOf(second)).expect(200)
    await request(http).get('/api/auth/refresh').set('Cookie', jarOf(first)).expect(200)
  })

  test('two refreshes of one session at once: one rotates it, the other is only given access', async () => {
    const login = await request(http)
      .post('/api/auth/login')
      .send({ email: 'maria@goldenfork.com', password: 'Nexus_dev1' })
      .expect(200)
    const raw = login.headers['set-cookie']
    const jar = (Array.isArray(raw) ? raw : [raw]).map((c) => c.split(';')[0]).join('; ')
    const results = await Promise.all(
      [0, 1].map(() => request(http).get('/api/auth/refresh').set('Cookie', jar)),
    )
    expect(results.map((r) => r.status)).toEqual([200, 200])
    const rotations = results.filter((r) =>
      String(r.headers['set-cookie']).includes('refresh_token='),
    )
    expect(rotations).toHaveLength(1)
    const won = rotations[0]
    const next = won.headers['set-cookie']
    const kept = (Array.isArray(next) ? next : [next]).map((c) => c.split(';')[0]).join('; ')
    await request(http).get('/api/auth/refresh').set('Cookie', kept).expect(200)
  })
})
