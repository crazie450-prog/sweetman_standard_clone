import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { ConfigService } from '@nestjs/config'
import { AppModule } from '../src/app.module'
import type { AppConfig } from '../src/config/env.validation'
import { configureApp } from '../src/app-setup'
import { PrismaService } from '../src/prisma/prisma.service'
import { signStubEvent } from '../src/billing/stub.provider'

jest.setTimeout(30000)

describe('Billing (e2e, stub provider)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let http: ReturnType<INestApplication['getHttpServer']>
  let ownerCookie = ''
  let staffCookie = ''
  let platformCookie = ''
  let goldenForkId = ''
  let downtown = ''
  let snapshot: {
    subscriptionStatus: 'trial' | 'active' | 'past_due' | 'canceled'
    trialEndsAt: Date | null
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
    planId: string | null
    currentPeriodEnd: Date | null
    billingSeats: number | null
  }
  let secret: string
  const createdCategories: string[] = []

  const login = async (email: string): Promise<string> => {
    const res = await request(http)
      .post('/api/auth/login')
      .send({ email, password: 'Nexus_dev1' })
      .expect(200)
    const raw = res.headers['set-cookie']
    const cookies = Array.isArray(raw) ? raw : [raw]
    return cookies.map((c) => c.split(';')[0]).join('; ')
  }

  const webhook = (event: Record<string, unknown>, signed = true) => {
    const body = JSON.stringify(event)
    const req = request(http).post('/api/billing/webhook').set('Content-Type', 'application/json')
    if (signed) req.set('stripe-signature', signStubEvent(body, secret))
    return req.send(body)
  }

  const status = async () =>
    (await prisma.client.organization.findUniqueOrThrow({ where: { id: goldenForkId } }))
      .subscriptionStatus

  const tryWrite = (cookie: string, name: string) =>
    request(http)
      .post('/api/categories')
      .set('Cookie', cookie)
      .set('X-Location-Id', downtown)
      .send({ name, kind: 'ingredient' })

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication({ rawBody: true })
    configureApp(app)
    await app.init()
    secret = app.get<AppConfig>(ConfigService).get('BILLING_WEBHOOK_SECRET', { infer: true }) ?? ''
    expect(secret).toBeTruthy()
    http = app.getHttpServer()
    prisma = app.get(PrismaService)

    const org = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'golden-fork' },
    })
    goldenForkId = org.id
    snapshot = {
      subscriptionStatus: org.subscriptionStatus,
      trialEndsAt: org.trialEndsAt,
      stripeCustomerId: org.stripeCustomerId,
      stripeSubscriptionId: org.stripeSubscriptionId,
      planId: org.planId,
      currentPeriodEnd: org.currentPeriodEnd,
      billingSeats: org.billingSeats,
    }
    downtown = (
      await prisma.client.location.findFirstOrThrow({
        where: { organizationId: org.id, name: { contains: 'Downtown' } },
      })
    ).id
    ownerCookie = await login('owner@goldenfork.com')
    staffCookie = await login('ken@goldenfork.com')
    platformCookie = await login('platform@nexus.app')
  })

  afterAll(async () => {
    await prisma.client.billingEvent.deleteMany({ where: { organizationId: goldenForkId } })
    await prisma.client.organization.update({ where: { id: goldenForkId }, data: snapshot })
    await prisma.client.category.deleteMany({ where: { id: { in: createdCategories } } })
    await app.close()
  })

  test('the seeded organization is on trial and nothing is refused', async () => {
    const res = await request(http)
      .get('/api/billing/subscription')
      .set('Cookie', ownerCookie)
      .expect(200)
    expect(res.body).toMatchObject({
      status: 'trial',
      planId: null,
      planName: 'Trial',
      provider: 'stub',
      restricted: false,
      warning: false,
    })
    const plans = await request(http)
      .get('/api/billing/plans')
      .set('Cookie', ownerCookie)
      .expect(200)
    expect((plans.body as { id: string; current: boolean }[]).find((p) => p.current)?.id).toBe(
      'free',
    )
  })

  test('the plans promise no limit or feature the product does not hold to', async () => {
    const plans = (
      await request(http).get('/api/billing/plans').set('Cookie', ownerCookie).expect(200)
    ).body as { id: string; description: string; features: string[] }[]
    for (const plan of plans) {
      for (const text of [plan.description, ...plan.features]) {
        expect(text).not.toMatch(
          /\b\d+ (users?|recipes|MB)\b|unlimited (users|recipes)|^\d+ locations?$/i,
        )
        expect(text).not.toMatch(/waste tracking|recipe import|analytics|multi-location|support/i)
      }
      expect(plan.features).toContain('Every feature')
    }
  })

  test('a checkout is an owner decision; on the stub it completes at once', async () => {
    await request(http)
      .post('/api/billing/checkout')
      .set('Cookie', staffCookie)
      .send({ planId: 'starter' })
      .expect(403)
    await request(http)
      .post('/api/billing/checkout')
      .set('Cookie', ownerCookie)
      .send({ planId: 'gold' })
      .expect(400)

    const res = await request(http)
      .post('/api/billing/checkout')
      .set('Cookie', ownerCookie)
      .send({ planId: 'starter' })
      .expect(201)
    expect((res.body as { url: string }).url).toContain('/subscription?checkout=success')

    const sub = await request(http)
      .get('/api/billing/subscription')
      .set('Cookie', ownerCookie)
      .expect(200)
    expect(sub.body).toMatchObject({
      status: 'active',
      planId: 'starter',
      planName: 'Starter',
      hasCustomer: true,
      hasSubscription: true,
      restricted: false,
    })
    const plans = await request(http)
      .get('/api/billing/plans')
      .set('Cookie', ownerCookie)
      .expect(200)
    expect((plans.body as { id: string; current: boolean }[]).find((p) => p.current)?.id).toBe(
      'starter',
    )
    expect(
      await prisma.client.billingEvent.count({ where: { organizationId: goldenForkId } }),
    ).toBe(1)
  })

  test('the portal needs a real provider', async () => {
    await request(http).post('/api/billing/portal').set('Cookie', ownerCookie).expect(400)
  })

  test('a webhook is refused without a valid signature and acknowledged when unknown', async () => {
    await webhook({ id: 'evt_unsigned', type: 'subscription.deleted' }, false).expect(400)
    await request(http)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'not-a-signature')
      .send('{"id":"evt_bad"}')
      .expect(400)
    expect(await status()).toBe('active')

    const unknown = await webhook({
      id: 'evt_unknown_type',
      type: 'customer.renamed',
      customerId: `stub_cus_${goldenForkId}`,
    }).expect(200)
    expect(unknown.body).toEqual({ applied: false })
    expect(await status()).toBe('active')
  })

  test('a failed payment marks the account past due but keeps it writing inside the grace period', async () => {
    const res = await webhook({
      id: 'evt_failed_1',
      type: 'payment.failed',
      customerId: `stub_cus_${goldenForkId}`,
    }).expect(200)
    expect(res.body).toEqual({ applied: true })
    expect(await status()).toBe('past_due')

    const sub = await request(http)
      .get('/api/billing/subscription')
      .set('Cookie', ownerCookie)
      .expect(200)
    expect(sub.body).toMatchObject({ status: 'past_due', restricted: false, warning: true })

    const written = await tryWrite(ownerCookie, `Billing probe ${Date.now()}`).expect(201)
    createdCategories.push((written.body as { id: string }).id)
  })

  test('past the grace period changes are refused with 402 while reading and billing stay open', async () => {
    await prisma.client.organization.update({
      where: { id: goldenForkId },
      data: { currentPeriodEnd: new Date(Date.now() - 30 * 86400000) },
    })

    const refused = await tryWrite(ownerCookie, `Billing probe ${Date.now()}`).expect(402)
    expect((refused.body as { error: { message: string } }).error.message).toMatch(
      /Subscription page/,
    )
    await request(http).get('/api/categories').set('Cookie', ownerCookie).expect(200)
    await request(http).get('/api/billing/subscription').set('Cookie', ownerCookie).expect(200)
    await request(http)
      .patch('/api/organizations/current')
      .set('Cookie', ownerCookie)
      .send({ phone: '+1 555 0100' })
      .expect(200)
    await request(http)
      .post('/api/billing/checkout')
      .set('Cookie', ownerCookie)
      .send({ planId: 'professional' })
      .expect(201)

    expect(await status()).toBe('active')
    const written = await tryWrite(ownerCookie, `Billing probe ${Date.now()}`).expect(201)
    createdCategories.push((written.body as { id: string }).id)
  })

  test('the same event delivered twice changes nothing twice', async () => {
    const event = {
      id: 'evt_twice',
      type: 'subscription.updated',
      customerId: `stub_cus_${goldenForkId}`,
      status: 'active',
      planId: 'enterprise',
      quantity: 2,
    }
    expect((await webhook(event).expect(200)).body).toEqual({ applied: true })
    expect((await webhook(event).expect(200)).body).toEqual({ applied: false })
    expect(await prisma.client.billingEvent.count({ where: { id: 'evt_twice' } })).toBe(1)
    const org = await prisma.client.organization.findUniqueOrThrow({ where: { id: goldenForkId } })
    expect(org.planId).toBe('enterprise')
    expect(org.billingSeats).toBe(2)
  })

  test('a canceled subscription closes the account; a platform administrator is untouched', async () => {
    await webhook({
      id: 'evt_deleted',
      type: 'subscription.deleted',
      customerId: `stub_cus_${goldenForkId}`,
    }).expect(200)
    expect(await status()).toBe('canceled')

    await tryWrite(ownerCookie, `Billing probe ${Date.now()}`).expect(402)
    const plans = await request(http)
      .get('/api/billing/plans')
      .set('Cookie', ownerCookie)
      .expect(200)
    expect((plans.body as { current: boolean }[]).some((p) => p.current)).toBe(false)

    await request(http)
      .post(`/api/admin/queue/${'nothing'}/retry`)
      .set('Cookie', platformCookie)
      .expect(404)
  })

  test('an event about a customer nobody knows is acknowledged and changes nobody', async () => {
    const before = await status()
    const res = await webhook({
      id: 'evt_stranger',
      type: 'subscription.updated',
      customerId: 'cus_stranger',
      status: 'active',
    }).expect(200)
    expect(res.body).toEqual({ applied: false })
    expect(await status()).toBe(before)
    expect(await prisma.client.billingEvent.count({ where: { id: 'evt_stranger' } })).toBe(0)
  })

  test('an expired trial is closed the same way, and reactivation reopens it', async () => {
    await prisma.client.organization.update({
      where: { id: goldenForkId },
      data: {
        subscriptionStatus: 'trial',
        trialEndsAt: new Date(Date.now() - 86400000),
        planId: null,
      },
    })
    await tryWrite(ownerCookie, `Billing probe ${Date.now()}`).expect(402)

    await webhook({
      id: 'evt_back',
      type: 'subscription.updated',
      customerId: `stub_cus_${goldenForkId}`,
      status: 'active',
      planId: 'starter',
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
    }).expect(200)
    const written = await tryWrite(ownerCookie, `Billing probe ${Date.now()}`).expect(201)
    createdCategories.push((written.body as { id: string }).id)
  })

  test('an event about a subscription other than the one on file changes nothing', async () => {
    await prisma.client.organization.update({
      where: { id: goldenForkId },
      data: {
        subscriptionStatus: 'active',
        planId: 'starter',
        stripeSubscriptionId: `stub_sub_${goldenForkId}`,
      },
    })
    const res = await webhook({
      id: 'evt_replaced_deleted',
      type: 'subscription.deleted',
      customerId: `stub_cus_${goldenForkId}`,
      subscriptionId: 'stub_sub_replaced',
    }).expect(200)
    expect(res.body).toEqual({ applied: false })
    expect(await status()).toBe('active')
    expect(await prisma.client.billingEvent.count({ where: { id: 'evt_replaced_deleted' } })).toBe(
      1,
    )
  })

  test('an event older than one already applied is recorded and changes nothing', async () => {
    const now = Date.now()
    const paid = await webhook({
      id: 'evt_paid_later',
      type: 'payment.paid',
      customerId: `stub_cus_${goldenForkId}`,
      created: new Date(now).toISOString(),
    }).expect(200)
    expect(paid.body).toEqual({ applied: true })

    const late = await webhook({
      id: 'evt_failed_earlier',
      type: 'payment.failed',
      customerId: `stub_cus_${goldenForkId}`,
      created: new Date(now - 3600000).toISOString(),
    }).expect(200)
    expect(late.body).toEqual({ applied: false })
    expect(await status()).toBe('active')
    expect(await prisma.client.billingEvent.count({ where: { id: 'evt_failed_earlier' } })).toBe(1)
  })

  test('two events arriving together: the older one, written last, still changes nothing', async () => {
    const now = Date.now() + 7200000
    const before = await prisma.client.organization.findUniqueOrThrow({
      where: { id: goldenForkId },
    })
    await prisma.client.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION e2e_slow_event() RETURNS trigger AS $$
      BEGIN
        IF NEW."id" = 'evt_failed_slow' THEN PERFORM pg_sleep(1); END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`)
    await prisma.client.$executeRawUnsafe(
      `CREATE TRIGGER e2e_slow_event BEFORE INSERT ON "BillingEvent" FOR EACH ROW EXECUTE FUNCTION e2e_slow_event()`,
    )
    try {
      await Promise.all([
        webhook({
          id: 'evt_failed_slow',
          type: 'payment.failed',
          customerId: `stub_cus_${goldenForkId}`,
          created: new Date(now - 3600000).toISOString(),
        }).expect(200),
        webhook({
          id: 'evt_paid_fast',
          type: 'payment.paid',
          customerId: `stub_cus_${goldenForkId}`,
          created: new Date(now).toISOString(),
        }).expect(200),
      ])
      expect(await status()).toBe('active')
    } finally {
      await prisma.client.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS e2e_slow_event ON "BillingEvent"',
      )
      await prisma.client.$executeRawUnsafe('DROP FUNCTION IF EXISTS e2e_slow_event()')
      await prisma.client.billingEvent.deleteMany({
        where: { id: { in: ['evt_failed_slow', 'evt_paid_fast'] } },
      })
      await prisma.client.organization.update({
        where: { id: goldenForkId },
        data: {
          subscriptionStatus: before.subscriptionStatus,
          currentPeriodEnd: before.currentPeriodEnd,
        },
      })
    }
  })

  test('a checkout that completes after the payment it started still records what was bought', async () => {
    await setBilling({
      subscriptionStatus: 'trial',
      planId: null,
      stripeSubscriptionId: null,
      stripeCustomerId: `stub_cus_${goldenForkId}`,
    })
    const now = Date.now()
    const periodEnd = new Date(now + 30 * 86400000)
    const paid = await webhook({
      id: 'evt_first_invoice_paid',
      type: 'payment.paid',
      customerId: `stub_cus_${goldenForkId}`,
      currentPeriodEnd: periodEnd.toISOString(),
      created: new Date(now).toISOString(),
    }).expect(200)
    expect(paid.body).toEqual({ applied: true })

    const bought = await webhook({
      id: 'evt_checkout_delivered_late',
      type: 'checkout.completed',
      customerId: `stub_cus_${goldenForkId}`,
      subscriptionId: 'stub_sub_bought',
      planId: 'professional',
      created: new Date(now - 1000).toISOString(),
    }).expect(200)
    expect(bought.body).toEqual({ applied: true })
    const org = await prisma.client.organization.findUniqueOrThrow({ where: { id: goldenForkId } })
    expect(org.planId).toBe('professional')
    expect(org.stripeSubscriptionId).toBe('stub_sub_bought')
    expect(org.subscriptionStatus).toBe('active')
    expect(org.currentPeriodEnd?.toISOString()).toBe(periodEnd.toISOString())
  })

  test('a subscription the provider reports as canceled is no longer the one on file', async () => {
    await setBilling({
      subscriptionStatus: 'active',
      planId: 'starter',
      stripeSubscriptionId: 'stub_sub_bought',
      stripeCustomerId: `stub_cus_${goldenForkId}`,
    })
    await webhook({
      id: 'evt_updated_to_canceled',
      type: 'subscription.updated',
      customerId: `stub_cus_${goldenForkId}`,
      subscriptionId: 'stub_sub_bought',
      status: 'canceled',
    }).expect(200)
    const org = await prisma.client.organization.findUniqueOrThrow({ where: { id: goldenForkId } })
    expect(org.subscriptionStatus).toBe('canceled')
    expect(org.stripeSubscriptionId).toBeNull()
  })

  test('a failed payment with no paid period on record starts the grace period from the failure', async () => {
    await prisma.client.organization.update({
      where: { id: goldenForkId },
      data: { subscriptionStatus: 'active', currentPeriodEnd: null },
    })
    await webhook({
      id: 'evt_failed_no_period',
      type: 'payment.failed',
      customerId: `stub_cus_${goldenForkId}`,
    }).expect(200)

    const org = await prisma.client.organization.findUniqueOrThrow({ where: { id: goldenForkId } })
    expect(org.subscriptionStatus).toBe('past_due')
    expect(Math.abs((org.currentPeriodEnd?.getTime() ?? 0) - Date.now())).toBeLessThan(60000)
    const sub = await request(http)
      .get('/api/billing/subscription')
      .set('Cookie', ownerCookie)
      .expect(200)
    expect(sub.body).toMatchObject({ restricted: false, warning: true })
  })
  const setBilling = (data: Record<string, unknown>) =>
    prisma.client.organization.update({ where: { id: goldenForkId }, data })

  test('a checkout names a paid plan: the trial is not for sale, and neither is anything else', async () => {
    for (const body of [{ planId: 'free' }, { planId: 'gold' }, {}]) {
      await request(http)
        .post('/api/billing/checkout')
        .set('Cookie', ownerCookie)
        .send(body)
        .expect(400)
    }
  })

  test('a closed account still signs in, reads, and changes its own organization settings', async () => {
    await setBilling({ subscriptionStatus: 'canceled', planId: null })
    await login('owner@goldenfork.com')
    await request(http)
      .get('/api/vendors')
      .set('Cookie', ownerCookie)
      .set('X-Location-Id', downtown)
      .expect(200)
    const current = await request(http)
      .get('/api/organizations/current')
      .set('Cookie', ownerCookie)
      .expect(200)
    const target = (current.body as { foodCostTargetPct: number }).foodCostTargetPct
    await request(http)
      .patch('/api/organizations/current')
      .set('Cookie', ownerCookie)
      .send({ foodCostTargetPct: target })
      .expect((r) => expect(r.status).not.toBe(402))
    await request(http)
      .post('/api/auth/change-password')
      .set('Cookie', ownerCookie)
      .send({ currentPassword: 'not-the-password-1', newPassword: 'Another_pass_1' })
      .expect((r) => expect(r.status).not.toBe(402))
  })

  test('a member below the owner sees why changes are refused but cannot pay', async () => {
    await setBilling({ subscriptionStatus: 'canceled', planId: null })
    const res = await request(http)
      .get('/api/billing/subscription')
      .set('Cookie', staffCookie)
      .expect(200)
    expect(res.body).toMatchObject({ status: 'canceled', restricted: true, planName: null })
    expect((res.body as { reason: string }).reason).toMatch(/Subscription page/)
    await request(http)
      .post('/api/billing/checkout')
      .set('Cookie', staffCookie)
      .send({ planId: 'starter' })
      .expect(403)
  })

  test('the trial counts whole days left, and none once the plan is paid', async () => {
    await setBilling({
      subscriptionStatus: 'trial',
      trialEndsAt: new Date(Date.now() + 36 * 3600000),
    })
    const trial = await request(http)
      .get('/api/billing/trial')
      .set('Cookie', ownerCookie)
      .expect(200)
    expect(trial.body).toBe(2)
    await setBilling({ subscriptionStatus: 'active', planId: 'starter' })
    const paid = await request(http)
      .get('/api/billing/trial')
      .set('Cookie', ownerCookie)
      .expect(200)
    expect(paid.body).toBe(0)
  })

  test('an update carries seats and period, and a plan the catalogue does not know leaves the plan alone', async () => {
    await setBilling({
      subscriptionStatus: 'active',
      planId: 'starter',
      stripeCustomerId: `stub_cus_${goldenForkId}`,
      stripeSubscriptionId: `stub_sub_${goldenForkId}`,
    })
    const periodEnd = new Date(Date.now() + 40 * 86400000)
    await webhook({
      id: `evt_seats_${Date.now()}`,
      type: 'subscription.updated',
      customerId: `stub_cus_${goldenForkId}`,
      subscriptionId: `stub_sub_${goldenForkId}`,
      status: 'active',
      planId: 'gold',
      quantity: 4,
      currentPeriodEnd: periodEnd.toISOString(),
    }).expect(200)
    const org = await prisma.client.organization.findUniqueOrThrow({ where: { id: goldenForkId } })
    expect(org.planId).toBe('starter')
    expect(org.billingSeats).toBe(4)
    expect(org.currentPeriodEnd?.toISOString()).toBe(periodEnd.toISOString())
  })

  test('a payment that goes through reopens a past-due account and moves its period on', async () => {
    await setBilling({
      subscriptionStatus: 'past_due',
      stripeCustomerId: `stub_cus_${goldenForkId}`,
      currentPeriodEnd: new Date(Date.now() - 30 * 86400000),
    })
    await tryWrite(ownerCookie, `Billing probe ${Date.now()}`).expect(402)
    const periodEnd = new Date(Date.now() + 30 * 86400000)
    await webhook({
      id: `evt_paid_${Date.now()}`,
      type: 'payment.paid',
      customerId: `stub_cus_${goldenForkId}`,
      currentPeriodEnd: periodEnd.toISOString(),
    }).expect(200)
    const org = await prisma.client.organization.findUniqueOrThrow({ where: { id: goldenForkId } })
    expect(org.subscriptionStatus).toBe('active')
    expect(org.currentPeriodEnd?.toISOString()).toBe(periodEnd.toISOString())
    const written = await tryWrite(ownerCookie, `Billing probe ${Date.now()}`).expect(201)
    createdCategories.push((written.body as { id: string }).id)
  })
  test('the release that enforces subscriptions gives an already ended trial fourteen more days, and nobody else anything', async () => {
    const sql = readFileSync(
      join(__dirname, '../prisma/migrations/20260915120000_billing_hardening/migration.sql'),
      'utf8',
    )
    const extension = sql.slice(sql.indexOf('UPDATE "Organization"'))
    expect(extension).toMatch(/interval '14 days'/)

    const bella = await prisma.client.organization.findUniqueOrThrow({
      where: { slug: 'bella-cucina' },
    })
    const ended = new Date(Date.now() - 40 * 86400000)
    const running = new Date(Date.now() + 5 * 86400000)
    try {
      await prisma.client.organization.update({
        where: { id: bella.id },
        data: { subscriptionStatus: 'trial', trialEndsAt: ended },
      })
      await setBilling({ subscriptionStatus: 'active', trialEndsAt: ended })

      const started = Date.now()
      await prisma.client.$executeRawUnsafe(extension)

      const extended = await prisma.client.organization.findUniqueOrThrow({
        where: { id: bella.id },
      })
      const days = ((extended.trialEndsAt as Date).getTime() - started) / 86400000
      expect(days).toBeGreaterThan(13.9)
      expect(days).toBeLessThan(14.1)
      const paying = await prisma.client.organization.findUniqueOrThrow({
        where: { id: goldenForkId },
      })
      expect(paying.trialEndsAt?.toISOString()).toBe(ended.toISOString())

      await prisma.client.organization.update({
        where: { id: bella.id },
        data: { trialEndsAt: running },
      })
      await prisma.client.$executeRawUnsafe(extension)
      const untouched = await prisma.client.organization.findUniqueOrThrow({
        where: { id: bella.id },
      })
      expect(untouched.trialEndsAt?.toISOString()).toBe(running.toISOString())
    } finally {
      await prisma.client.organization.update({
        where: { id: bella.id },
        data: { subscriptionStatus: bella.subscriptionStatus, trialEndsAt: bella.trialEndsAt },
      })
    }
  })
})
