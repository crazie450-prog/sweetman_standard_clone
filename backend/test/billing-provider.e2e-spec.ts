import { BadRequestException, INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { ConfigService } from '@nestjs/config'
import { configWith } from './config'
import { configureApp } from '../src/app-setup'
import { PrismaService } from '../src/prisma/prisma.service'
import {
  BILLING_PROVIDER,
  type BillingEvent,
  type BillingProvider,
} from '../src/billing/billing.provider'

jest.setTimeout(30000)

describe('Billing (e2e, a real provider over records the stub wrote)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let http: ReturnType<INestApplication['getHttpServer']>
  let ownerCookie = ''
  let goldenForkId = ''
  let snapshot: {
    subscriptionStatus: 'trial' | 'active' | 'past_due' | 'canceled'
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
    planId: string | null
    billingSeats: number | null
  }
  const createdLocations: string[] = []

  const calls: { method: string; args: unknown[] }[] = []
  let seatsFail = false
  let seatsHeld: Promise<void> | null = null
  let checkoutHeld: Promise<void> | null = null
  const customersToCreate: string[] = []
  let nextEvent: BillingEvent | null = null
  const called = (method: string) => calls.filter((c) => c.method === method)

  const provider: BillingProvider = {
    name: 'stripe',
    createCheckout: async (req) => {
      calls.push({ method: 'createCheckout', args: [req] })
      const customerId = req.customerId ?? customersToCreate.shift() ?? 'cus_real'
      const held = checkoutHeld
      checkoutHeld = null
      if (held) await held
      return { url: 'https://checkout.example/session', customerId }
    },
    createPortal: (req) => {
      calls.push({ method: 'createPortal', args: [req] })
      if (!req.customerId) {
        return Promise.reject(
          new BadRequestException('There is no billing customer for this organization yet'),
        )
      }
      return Promise.resolve({ url: 'https://portal.example/session' })
    },
    verifyWebhook: () => {
      if (!nextEvent) throw new Error('not used here')
      return nextEvent
    },
    setQuantity: async (...args) => {
      calls.push({ method: 'setQuantity', args })
      const held = seatsHeld
      seatsHeld = null
      if (held) await held
      if (seatsFail) throw new Error('provider unreachable')
    },
    changePlan: (...args) => {
      calls.push({ method: 'changePlan', args })
      return Promise.resolve()
    },
  }

  const addLocation = async () => {
    const res = await request(http)
      .post('/api/locations')
      .set('Cookie', ownerCookie)
      .send({ name: `Seat probe ${Date.now()}` })
      .expect(201)
    const id = (res.body as { id: string }).id
    createdLocations.push(id)
    return id
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(configWith({ BILLING_PER_LOCATION: 'true' }))
      .overrideProvider(BILLING_PROVIDER)
      .useValue(provider)
      .compile()
    app = moduleRef.createNestApplication({ rawBody: true })
    configureApp(app)
    await app.init()
    http = app.getHttpServer()
    prisma = app.get(PrismaService)

    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    goldenForkId = org.id
    snapshot = {
      subscriptionStatus: org.subscriptionStatus,
      stripeCustomerId: org.stripeCustomerId,
      stripeSubscriptionId: org.stripeSubscriptionId,
      planId: org.planId,
      billingSeats: org.billingSeats,
    }
    const login = await request(http)
      .post('/api/auth/login')
      .send({ email: 'owner@goldenfork.com', password: 'Nexus_dev1' })
      .expect(200)
    const raw = login.headers['set-cookie']
    ownerCookie = (Array.isArray(raw) ? raw : [raw]).map((c) => c.split(';')[0]).join('; ')
  })

  afterAll(async () => {
    await prisma.client.billingEvent.deleteMany({ where: { organizationId: goldenForkId } })
    await prisma.client.location.deleteMany({ where: { id: { in: createdLocations } } })
    await prisma.client.organization.update({ where: { id: goldenForkId }, data: snapshot })
    await app.close()
  })

  beforeEach(() => {
    calls.length = 0
    seatsFail = false
    seatsHeld = null
    checkoutHeld = null
    customersToCreate.length = 0
    nextEvent = null
  })

  test('identifiers the stub left behind never reach the provider', async () => {
    await prisma.client.organization.update({
      where: { id: goldenForkId },
      data: {
        subscriptionStatus: 'active',
        planId: 'starter',
        stripeCustomerId: `stub_cus_${goldenForkId}`,
        stripeSubscriptionId: `stub_sub_${goldenForkId}`,
      },
    })

    const sub = await request(http)
      .get('/api/billing/subscription')
      .set('Cookie', ownerCookie)
      .expect(200)
    expect(sub.body).toMatchObject({
      provider: 'stripe',
      hasCustomer: false,
      hasSubscription: false,
    })

    await request(http).post('/api/billing/portal').set('Cookie', ownerCookie).expect(400)
    expect(called('createPortal')[0].args[0]).toMatchObject({ customerId: null })

    await addLocation()
    expect(called('setQuantity')).toHaveLength(0)

    const checkout = await request(http)
      .post('/api/billing/checkout')
      .set('Cookie', ownerCookie)
      .send({ planId: 'professional' })
      .expect(201)
    expect(checkout.body).toMatchObject({ url: 'https://checkout.example/session', changed: false })
    expect(called('createCheckout')[0].args[0]).toMatchObject({ customerId: null })
    expect(called('changePlan')).toHaveLength(0)
    const org = await prisma.client.organization.findUniqueOrThrow({ where: { id: goldenForkId } })
    expect(org.stripeCustomerId).toBe('cus_real')
  })

  test('with a subscription on file a plan change updates it instead of opening a second one', async () => {
    await prisma.client.organization.update({
      where: { id: goldenForkId },
      data: { stripeSubscriptionId: 'sub_real', planId: 'starter' },
    })

    const res = await request(http)
      .post('/api/billing/checkout')
      .set('Cookie', ownerCookie)
      .send({ planId: 'enterprise' })
      .expect(201)
    expect(res.body).toMatchObject({ changed: true })
    expect((res.body as { url: string }).url).toContain('/subscription?checkout=success')
    expect(called('createCheckout')).toHaveLength(0)
    expect(called('changePlan')[0].args).toEqual(['sub_real', 'enterprise'])
    const org = await prisma.client.organization.findUniqueOrThrow({ where: { id: goldenForkId } })
    expect(org.planId).toBe('enterprise')
  })

  test('a provider that cannot be reached does not turn a saved location into an error', async () => {
    seatsFail = true
    const before = await prisma.client.organization.findUniqueOrThrow({
      where: { id: goldenForkId },
    })

    const id = await addLocation()
    expect(called('setQuantity')[0].args[0]).toBe('sub_real')
    expect(await prisma.client.location.count({ where: { id } })).toBe(1)
    const after = await prisma.client.organization.findUniqueOrThrow({
      where: { id: goldenForkId },
    })
    expect(after.billingSeats).toBe(before.billingSeats)
  })
  const deliver = (event: BillingEvent) => {
    nextEvent = event
    return request(http)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=1,v1=verified-by-the-fake')
      .send(JSON.stringify({ id: event.id }))
      .expect(200)
  }

  test('seats follow the active locations when the provider answers', async () => {
    await prisma.client.organization.update({
      where: { id: goldenForkId },
      data: { subscriptionStatus: 'active', stripeSubscriptionId: 'sub_real' },
    })
    const id = await addLocation()
    const active = await prisma.client.location.count({
      where: { organizationId: goldenForkId, isActive: true },
    })
    expect(called('setQuantity')[0].args).toEqual(['sub_real', active])
    expect(
      (await prisma.client.organization.findUniqueOrThrow({ where: { id: goldenForkId } }))
        .billingSeats,
    ).toBe(active)

    await request(http).delete(`/api/locations/${id}`).set('Cookie', ownerCookie).expect(200)
    expect(called('setQuantity')[1].args).toEqual(['sub_real', active - 1])
    expect(
      (await prisma.client.organization.findUniqueOrThrow({ where: { id: goldenForkId } }))
        .billingSeats,
    ).toBe(active - 1)
  })

  test('a slow answer about the seats does not overwrite a newer count', async () => {
    await prisma.client.organization.update({
      where: { id: goldenForkId },
      data: { subscriptionStatus: 'active', stripeSubscriptionId: 'sub_real' },
    })
    let release = () => {}
    seatsHeld = new Promise<void>((resolve) => (release = resolve))
    const first = addLocation()
    while (called('setQuantity').length === 0) await new Promise((r) => setTimeout(r, 20))
    await addLocation()
    release()
    await first
    const active = await prisma.client.location.count({
      where: { organizationId: goldenForkId, isActive: true },
    })
    const sent = called('setQuantity').map((c) => c.args[1])
    const recorded = (
      await prisma.client.organization.findUniqueOrThrow({ where: { id: goldenForkId } })
    ).billingSeats
    expect([sent[sent.length - 1], recorded]).toEqual([active, active])
  })

  test('two checkouts started at once open them for one billing customer', async () => {
    await prisma.client.organization.update({
      where: { id: goldenForkId },
      data: { subscriptionStatus: 'trial', stripeCustomerId: null, stripeSubscriptionId: null },
    })
    customersToCreate.push('cus_first', 'cus_second')
    let release = () => {}
    checkoutHeld = new Promise<void>((resolve) => (release = resolve))
    const checkout = () =>
      request(http)
        .post('/api/billing/checkout')
        .set('Cookie', ownerCookie)
        .send({ planId: 'professional' })
        .then((res) => res)
    const first = checkout()
    while (called('createCheckout').length === 0) await new Promise((r) => setTimeout(r, 20))
    const second = checkout()
    await new Promise((r) => setTimeout(r, 300))
    release()
    await Promise.all([first, second])
    const recorded = (
      await prisma.client.organization.findUniqueOrThrow({ where: { id: goldenForkId } })
    ).stripeCustomerId
    const asked = called('createCheckout').map(
      (c) => (c.args[0] as { customerId: string | null }).customerId,
    )
    expect([asked, recorded]).toEqual([[null, 'cus_first'], 'cus_first'])
  })

  test('a completed checkout replaces a stub customer with the real one, and never a real one', async () => {
    await prisma.client.organization.update({
      where: { id: goldenForkId },
      data: { subscriptionStatus: 'trial', stripeCustomerId: `stub_cus_${goldenForkId}` },
    })
    await deliver({
      id: `evt_real_checkout_${Date.now()}`,
      type: 'checkout.completed',
      organizationId: goldenForkId,
      customerId: 'cus_from_stripe',
      subscriptionId: 'sub_from_stripe',
      planId: 'professional',
      status: 'active',
      occurredAt: new Date(),
    })
    let org = await prisma.client.organization.findUniqueOrThrow({ where: { id: goldenForkId } })
    expect(org).toMatchObject({
      subscriptionStatus: 'active',
      stripeCustomerId: 'cus_from_stripe',
      stripeSubscriptionId: 'sub_from_stripe',
      planId: 'professional',
    })

    await deliver({
      id: `evt_second_checkout_${Date.now()}`,
      type: 'checkout.completed',
      organizationId: goldenForkId,
      customerId: 'cus_somebody_else',
      subscriptionId: 'sub_from_stripe',
      status: 'active',
      occurredAt: new Date(Date.now() + 1000),
    })
    org = await prisma.client.organization.findUniqueOrThrow({ where: { id: goldenForkId } })
    expect(org.stripeCustomerId).toBe('cus_from_stripe')
  })

  test('a canceled subscription on file is replaced by a new checkout, not changed', async () => {
    await prisma.client.organization.update({
      where: { id: goldenForkId },
      data: {
        subscriptionStatus: 'canceled',
        planId: null,
        stripeCustomerId: 'cus_real',
        stripeSubscriptionId: 'sub_gone',
      },
    })
    const res = await request(http)
      .post('/api/billing/checkout')
      .set('Cookie', ownerCookie)
      .send({ planId: 'starter' })
      .expect(201)
    expect(res.body).toMatchObject({ changed: false, url: 'https://checkout.example/session' })
    expect(called('changePlan')).toHaveLength(0)
    expect(called('createCheckout')).toHaveLength(1)
  })

  test('a webhook with no body is refused before the provider is asked', async () => {
    await request(http).post('/api/billing/webhook').set('stripe-signature', 't=1,v1=x').expect(400)
  })
})
