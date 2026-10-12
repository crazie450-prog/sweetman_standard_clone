import Stripe from 'stripe'
import { BadRequestException } from '@nestjs/common'
import { WebhookRejected } from './billing.provider'
import { signStubEvent, StubBillingProvider } from './stub.provider'
import { mapStripeEvent, StripeBillingProvider, stripeStatus } from './stripe.provider'

describe('StubBillingProvider', () => {
  const secret = 'stub-secret'
  const provider = new StubBillingProvider(secret)

  it('accepts an event signed with the shared secret and reads its fields', () => {
    const body = JSON.stringify({
      id: 'evt_1',
      type: 'payment.failed',
      customerId: 'cus_1',
      status: 'past_due',
      currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    })
    const event = provider.verifyWebhook(Buffer.from(body), signStubEvent(body, secret))
    expect(event).toMatchObject({
      id: 'evt_1',
      type: 'payment.failed',
      customerId: 'cus_1',
      status: 'past_due',
    })
    expect(event.currentPeriodEnd?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('refuses a missing, wrong or tampered signature', () => {
    const body = JSON.stringify({ id: 'evt_2', type: 'subscription.deleted', customerId: 'cus_1' })
    expect(() => provider.verifyWebhook(Buffer.from(body), undefined)).toThrow(WebhookRejected)
    expect(() => provider.verifyWebhook(Buffer.from(body), 'nope')).toThrow(WebhookRejected)
    const signed = signStubEvent(body, secret)
    expect(() => provider.verifyWebhook(Buffer.from(body + ' '), signed)).toThrow(WebhookRejected)
    expect(() =>
      new StubBillingProvider(undefined).verifyWebhook(Buffer.from(body), signed),
    ).toThrow(WebhookRejected)
  })

  it('acknowledges a type it does not know as ignored', () => {
    const body = JSON.stringify({ id: 'evt_3', type: 'customer.renamed', customerId: 'cus_1' })
    expect(provider.verifyWebhook(Buffer.from(body), signStubEvent(body, secret)).type).toBe(
      'ignored',
    )
  })

  it('completes a checkout on the spot and says so', async () => {
    const result = await provider.createCheckout({
      organizationId: 'org_1',
      organizationName: 'Golden Fork',
      ownerEmail: 'owner@example.com',
      customerId: null,
      planId: 'starter',
      quantity: 3,
      successUrl: 'http://localhost/subscription?checkout=success',
      cancelUrl: 'http://localhost/subscription?checkout=canceled',
    })
    expect(result.url).toContain('checkout=success')
    expect(result.completed).toMatchObject({
      type: 'checkout.completed',
      organizationId: 'org_1',
      planId: 'starter',
      status: 'active',
      quantity: 3,
    })
  })
})

describe('Stripe events', () => {
  const prices = { starter: 'price_starter', professional: 'price_pro', enterprise: 'price_ent' }
  const secret = 'whsec_test'
  const stripe = new Stripe('sk_test_placeholder')

  const signed = (payload: object) => {
    const body = JSON.stringify(payload)
    const header = stripe.webhooks.generateTestHeaderString({ payload: body, secret })
    return stripe.webhooks.constructEvent(body, header, secret)
  }

  it('is verified by signature before it is read', () => {
    const body = JSON.stringify({
      id: 'evt_x',
      object: 'event',
      type: 'invoice.paid',
      data: { object: {} },
    })
    const header = stripe.webhooks.generateTestHeaderString({ payload: body, secret })
    expect(() => stripe.webhooks.constructEvent(body, header, 'whsec_other')).toThrow()
  })

  it('maps a completed checkout to the organization it names', () => {
    const event = signed({
      id: 'evt_checkout',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          object: 'checkout.session',
          customer: 'cus_9',
          subscription: 'sub_9',
          client_reference_id: 'org_9',
          metadata: { planId: 'professional' },
        },
      },
    })
    expect(mapStripeEvent(event, prices)).toMatchObject({
      id: 'evt_checkout',
      type: 'checkout.completed',
      customerId: 'cus_9',
      organizationId: 'org_9',
      subscriptionId: 'sub_9',
      planId: 'professional',
      status: 'active',
    })
  })

  it('maps a subscription update to a plan, a status, a period and a quantity', () => {
    const event = signed({
      id: 'evt_sub',
      object: 'event',
      created: 1789990000,
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_9',
          object: 'subscription',
          customer: 'cus_9',
          status: 'past_due',
          items: {
            object: 'list',
            data: [
              {
                id: 'si_1',
                price: { id: 'price_ent' },
                quantity: 4,
                current_period_end: 1790000000,
              },
            ],
          },
        },
      },
    })
    expect(mapStripeEvent(event, prices)).toMatchObject({
      type: 'subscription.updated',
      customerId: 'cus_9',
      subscriptionId: 'sub_9',
      planId: 'enterprise',
      status: 'past_due',
      quantity: 4,
    })
    expect(mapStripeEvent(event, prices).currentPeriodEnd?.getTime()).toBe(1790000000 * 1000)
    expect(mapStripeEvent(event, prices).occurredAt?.getTime()).toBe(1789990000 * 1000)
  })

  it('maps a deleted subscription, a failed and a paid invoice, and shrugs at the rest', () => {
    const deleted = signed({
      id: 'evt_del',
      object: 'event',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_9',
          object: 'subscription',
          customer: 'cus_9',
          status: 'canceled',
          items: { object: 'list', data: [] },
        },
      },
    })
    expect(mapStripeEvent(deleted, prices)).toMatchObject({
      type: 'subscription.deleted',
      status: 'canceled',
    })

    const failed = signed({
      id: 'evt_fail',
      object: 'event',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_1', object: 'invoice', customer: 'cus_9' } },
    })
    expect(mapStripeEvent(failed, prices)).toMatchObject({
      type: 'payment.failed',
      status: 'past_due',
    })

    const paid = signed({
      id: 'evt_paid',
      object: 'event',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_2',
          object: 'invoice',
          customer: 'cus_9',
          period_end: 1780000000,
          parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_9' } },
          lines: {
            object: 'list',
            data: [
              { id: 'il_1', object: 'line_item', period: { start: 1787000000, end: 1789000000 } },
              { id: 'il_2', object: 'line_item', period: { start: 1787000000, end: 1790000000 } },
            ],
          },
        },
      },
    })
    expect(mapStripeEvent(paid, prices)).toMatchObject({
      type: 'payment.paid',
      status: 'active',
      subscriptionId: 'sub_9',
    })
    expect(mapStripeEvent(paid, prices).currentPeriodEnd?.getTime()).toBe(1790000000 * 1000)

    const other = signed({
      id: 'evt_other',
      object: 'event',
      type: 'customer.updated',
      data: { object: { id: 'cus_9', object: 'customer' } },
    })
    expect(mapStripeEvent(other, prices).type).toBe('ignored')
  })

  it('reads a customer sent as an object and names no plan for a price it does not know', () => {
    const event = signed({
      id: 'evt_expanded',
      object: 'event',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_9',
          object: 'subscription',
          customer: { id: 'cus_9', object: 'customer' },
          status: 'active',
          items: { data: [{ price: { id: 'price_unknown' }, quantity: 2 }] },
        },
      },
    })
    expect(mapStripeEvent(event, prices)).toMatchObject({
      type: 'subscription.updated',
      customerId: 'cus_9',
      planId: null,
      quantity: 2,
    })
  })
})

describe('Stripe events in the shape an account on an API version before 2025-03-31 sends', () => {
  const prices = { starter: 'price_starter', professional: 'price_pro', enterprise: 'price_ent' }
  const secret = 'whsec_test'
  const stripe = new Stripe('sk_test_placeholder')
  const signed = (payload: object) => {
    const body = JSON.stringify(payload)
    const header = stripe.webhooks.generateTestHeaderString({ payload: body, secret })
    return stripe.webhooks.constructEvent(body, header, secret)
  }

  it('reads the period from the subscription itself when the items carry none', () => {
    const event = signed({
      id: 'evt_old_sub',
      object: 'event',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_9',
          object: 'subscription',
          customer: 'cus_9',
          status: 'active',
          current_period_end: 1790000000,
          items: {
            object: 'list',
            data: [{ id: 'si_1', price: { id: 'price_pro' }, quantity: 2 }],
          },
        },
      },
    })
    const mapped = mapStripeEvent(event, prices)
    expect(mapped).toMatchObject({
      type: 'subscription.updated',
      planId: 'professional',
      quantity: 2,
    })
    expect(mapped.currentPeriodEnd?.getTime()).toBe(1790000000 * 1000)
  })

  it('reads the subscription an invoice belongs to from its old top-level field', () => {
    const event = signed({
      id: 'evt_old_inv',
      object: 'event',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_1', object: 'invoice', customer: 'cus_9', subscription: 'sub_9' } },
    })
    expect(mapStripeEvent(event, prices)).toMatchObject({
      type: 'payment.failed',
      status: 'past_due',
      subscriptionId: 'sub_9',
    })
  })
})

describe('stripeStatus', () => {
  it('reads every Stripe subscription status as one of the four the product knows', () => {
    expect(stripeStatus('trialing')).toBe('trial')
    expect(stripeStatus('active')).toBe('active')
    for (const owing of ['past_due', 'unpaid', 'incomplete'])
      expect(stripeStatus(owing)).toBe('past_due')
    for (const ended of ['canceled', 'incomplete_expired', 'paused', 'something_new']) {
      expect(stripeStatus(ended)).toBe('canceled')
    }
  })
})

describe('StripeBillingProvider, against a client that records what it is asked', () => {
  const prices = { starter: 'price_starter', professional: 'price_pro', enterprise: undefined }
  const secret = 'whsec_test'
  const real = new Stripe('sk_test_placeholder')

  function build(sub: { items: { data: { id: string }[] }; metadata: Record<string, string> }) {
    const client = {
      customers: { create: jest.fn().mockResolvedValue({ id: 'cus_new' }) },
      checkout: {
        sessions: {
          create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.test/s' }),
        },
      },
      billingPortal: {
        sessions: { create: jest.fn().mockResolvedValue({ url: 'https://portal.stripe.test/p' }) },
      },
      subscriptions: {
        retrieve: jest.fn().mockResolvedValue(sub),
        update: jest.fn().mockResolvedValue({}),
      },
      webhooks: real.webhooks,
    }
    const provider = new StripeBillingProvider({
      secretKey: 'sk_test_placeholder',
      webhookSecret: secret,
      prices,
    })
    ;(provider as unknown as { stripe: typeof client }).stripe = client
    return { provider, client }
  }
  const withItem = { items: { data: [{ id: 'si_1' }] }, metadata: { organizationId: 'org-1' } }
  const request = {
    organizationId: 'org-1',
    organizationName: 'Golden Fork',
    ownerEmail: 'owner@goldenfork.com',
    customerId: null,
    planId: 'starter',
    quantity: 3,
    successUrl: 'https://app/ok',
    cancelUrl: 'https://app/no',
  }

  it('creates the customer once, then a subscription checkout that names the organization and the seats', async () => {
    const { provider, client } = build(withItem)
    await expect(provider.createCheckout(request)).resolves.toEqual({
      url: 'https://checkout.stripe.test/s',
      customerId: 'cus_new',
    })
    expect(client.customers.create).toHaveBeenCalledWith({
      email: 'owner@goldenfork.com',
      name: 'Golden Fork',
      metadata: { organizationId: 'org-1' },
    })
    expect(client.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_new',
        client_reference_id: 'org-1',
        line_items: [{ price: 'price_starter', quantity: 3 }],
        metadata: { organizationId: 'org-1', planId: 'starter' },
      }),
    )

    await provider.createCheckout({ ...request, customerId: 'cus_known' })
    expect(client.customers.create).toHaveBeenCalledTimes(1)
    expect(client.checkout.sessions.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ customer: 'cus_known' }),
    )
  })

  it('refuses a plan with no price and a session with no URL before sending anyone anywhere', async () => {
    const { provider, client } = build(withItem)
    await expect(
      provider.createCheckout({ ...request, planId: 'enterprise' }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(client.customers.create).not.toHaveBeenCalled()

    client.checkout.sessions.create.mockResolvedValueOnce({ url: null })
    await expect(provider.createCheckout(request)).rejects.toThrow(/no checkout URL/)
  })

  it('opens the portal only for a customer it has', async () => {
    const { provider, client } = build(withItem)
    await expect(
      provider.createPortal({ customerId: null, returnUrl: 'https://app' }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      provider.createPortal({ customerId: 'cus_1', returnUrl: 'https://app' }),
    ).resolves.toEqual({
      url: 'https://portal.stripe.test/p',
    })
    expect(client.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'https://app',
    })
  })

  it('reads a webhook only when Stripe signed it with the configured secret', () => {
    const { provider } = build(withItem)
    const body = JSON.stringify({
      id: 'evt_signed',
      object: 'event',
      created: 1789990000,
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_1' } },
    })
    const header = real.webhooks.generateTestHeaderString({ payload: body, secret })
    expect(provider.verifyWebhook(Buffer.from(body), header)).toMatchObject({
      id: 'evt_signed',
      type: 'payment.failed',
      customerId: 'cus_1',
    })
    expect(() => provider.verifyWebhook(Buffer.from(body), undefined)).toThrow(WebhookRejected)
    const forged = real.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_other' })
    expect(() => provider.verifyWebhook(Buffer.from(body), forged)).toThrow(WebhookRejected)
    expect(() =>
      provider.verifyWebhook(Buffer.from(body.replace('cus_1', 'cus_2')), header),
    ).toThrow(WebhookRejected)
  })

  it('changes the seats on the subscription item with proration, and leaves an empty subscription alone', async () => {
    const { provider, client } = build(withItem)
    await provider.setQuantity('sub_1', 4)
    expect(client.subscriptions.update).toHaveBeenCalledWith('sub_1', {
      items: [{ id: 'si_1', quantity: 4 }],
      proration_behavior: 'create_prorations',
    })

    const empty = build({ items: { data: [] }, metadata: {} })
    await empty.provider.setQuantity('sub_1', 4)
    expect(empty.client.subscriptions.update).not.toHaveBeenCalled()
  })

  it('changes the plan on the existing item, keeping what the subscription already carried', async () => {
    const { provider, client } = build(withItem)
    await provider.changePlan('sub_1', 'professional')
    expect(client.subscriptions.update).toHaveBeenCalledWith('sub_1', {
      items: [{ id: 'si_1', price: 'price_pro' }],
      proration_behavior: 'create_prorations',
      metadata: { organizationId: 'org-1', planId: 'professional' },
    })

    await expect(provider.changePlan('sub_1', 'enterprise')).rejects.toThrow(/No price/)
    const empty = build({ items: { data: [] }, metadata: {} })
    await expect(empty.provider.changePlan('sub_1', 'starter')).rejects.toThrow(/carries no plan/)
    expect(client.subscriptions.update).toHaveBeenCalledTimes(1)
  })
})

describe('StubBillingProvider, what it refuses to read', () => {
  const secret = 'stub-secret'
  const provider = new StubBillingProvider(secret)
  const sign = (body: string) => signStubEvent(body, secret)

  it('refuses a signed body that is not JSON or names no event id, and works without a secret nowhere', () => {
    expect(() => provider.verifyWebhook(Buffer.from('not json'), sign('not json'))).toThrow(
      /not JSON/,
    )
    const noId = JSON.stringify({ type: 'payment.paid' })
    expect(() => provider.verifyWebhook(Buffer.from(noId), sign(noId))).toThrow(/no id/)
    expect(() =>
      new StubBillingProvider(undefined).verifyWebhook(Buffer.from(noId), sign(noId)),
    ).toThrow(/No webhook secret/)
  })
})
