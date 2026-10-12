import { BadRequestException } from '@nestjs/common'
import Stripe from 'stripe'
import {
  isPaidPlan,
  WebhookRejected,
  type BillingEvent,
  type BillingProvider,
  type CheckoutRequest,
  type PaidPlanId,
  type PortalRequest,
  type SubscriptionState,
} from './billing.provider'

export interface StripeConfig {
  secretKey: string
  webhookSecret: string
  prices: Record<string, string | undefined>
}

export function stripeStatus(status: string): SubscriptionState {
  if (status === 'trialing') return 'trial'
  if (status === 'active') return 'active'
  if (status === 'past_due' || status === 'unpaid' || status === 'incomplete') return 'past_due'
  return 'canceled'
}

function planFromPrice(
  prices: Record<string, string | undefined>,
  priceId: string | null | undefined,
): string | null {
  if (!priceId) return null
  for (const [plan, id] of Object.entries(prices)) if (id === priceId) return plan
  return null
}

const idOf = (value: unknown): string | null => {
  if (typeof value === 'string') return value
  if (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string'
  ) {
    return value.id
  }
  return null
}

const secondsToDate = (seconds: unknown): Date | null =>
  typeof seconds === 'number' ? new Date(seconds * 1000) : null

function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const onItem = sub.items.data[0]?.current_period_end
  if (typeof onItem === 'number') return secondsToDate(onItem)
  return 'current_period_end' in sub ? secondsToDate(sub.current_period_end) : null
}

function invoiceSubscription(invoice: Stripe.Invoice): string | null {
  const viaParent = idOf(invoice.parent?.subscription_details?.subscription)
  if (viaParent) return viaParent
  return 'subscription' in invoice ? idOf(invoice.subscription) : null
}

function invoicePeriodEnd(invoice: Stripe.Invoice): Date | null {
  const ends = (invoice.lines?.data ?? [])
    .map((line) => line.period?.end)
    .filter((end): end is number => typeof end === 'number')
  return ends.length ? secondsToDate(Math.max(...ends)) : null
}

export function mapStripeEvent(
  event: Stripe.Event,
  prices: Record<string, string | undefined>,
): BillingEvent {
  const base = {
    id: event.id,
    customerId: null as string | null,
    occurredAt: new Date(event.created * 1000),
  }
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      return {
        ...base,
        type: 'checkout.completed',
        customerId: idOf(session.customer),
        organizationId: session.client_reference_id ?? null,
        subscriptionId: idOf(session.subscription),
        planId: isPaidPlan(session.metadata?.planId) ? session.metadata.planId : null,
        status: 'active',
      }
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object
      const item = sub.items.data[0]
      const deleted = event.type === 'customer.subscription.deleted'
      return {
        ...base,
        type: deleted ? 'subscription.deleted' : 'subscription.updated',
        customerId: idOf(sub.customer),
        subscriptionId: sub.id,
        planId: planFromPrice(prices, item?.price?.id),
        status: deleted ? 'canceled' : stripeStatus(sub.status),
        currentPeriodEnd: subscriptionPeriodEnd(sub),
        quantity: item?.quantity ?? null,
      }
    }
    case 'invoice.payment_failed':
    case 'invoice.paid': {
      const invoice = event.data.object
      const paid = event.type === 'invoice.paid'
      return {
        ...base,
        type: paid ? 'payment.paid' : 'payment.failed',
        customerId: idOf(invoice.customer),
        subscriptionId: invoiceSubscription(invoice),
        status: paid ? 'active' : 'past_due',
        currentPeriodEnd: paid ? invoicePeriodEnd(invoice) : null,
      }
    }
    default:
      return { ...base, type: 'ignored' }
  }
}

export class StripeBillingProvider implements BillingProvider {
  readonly name = 'stripe' as const
  private readonly stripe: Stripe

  constructor(private readonly config: StripeConfig) {
    this.stripe = new Stripe(config.secretKey)
  }

  async createCheckout(request: CheckoutRequest) {
    const price = this.config.prices[request.planId]
    if (!price) {
      throw new BadRequestException({
        code: 'PLAN_PRICE_MISSING',
        message: `No price is configured for the ${request.planId} plan`,
      })
    }
    let customerId = request.customerId
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: request.ownerEmail,
        name: request.organizationName,
        metadata: { organizationId: request.organizationId },
      })
      customerId = customer.id
    }
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: request.organizationId,
      line_items: [{ price, quantity: request.quantity }],
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      metadata: { organizationId: request.organizationId, planId: request.planId },
      subscription_data: { metadata: { organizationId: request.organizationId } },
    })
    if (!session.url)
      throw new BadRequestException({
        code: 'CHECKOUT_URL_MISSING',
        message: 'The billing provider returned no checkout URL',
      })
    return { url: session.url, customerId }
  }

  async createPortal(request: PortalRequest) {
    if (!request.customerId) {
      throw new BadRequestException({
        code: 'BILLING_CUSTOMER_MISSING',
        message: 'There is no billing customer for this organization yet',
      })
    }
    const session = await this.stripe.billingPortal.sessions.create({
      customer: request.customerId,
      return_url: request.returnUrl,
    })
    return { url: session.url }
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): BillingEvent {
    if (!signature) throw new WebhookRejected('The webhook carries no signature')
    let event: Stripe.Event
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.config.webhookSecret)
    } catch (error) {
      throw new WebhookRejected((error as Error).message)
    }
    return mapStripeEvent(event, this.config.prices)
  }

  async setQuantity(subscriptionId: string, quantity: number): Promise<void> {
    const sub = await this.stripe.subscriptions.retrieve(subscriptionId)
    const item = sub.items.data[0]
    if (!item) return
    await this.stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, quantity }],
      proration_behavior: 'create_prorations',
    })
  }

  async changePlan(subscriptionId: string, planId: PaidPlanId): Promise<void> {
    const price = this.config.prices[planId]
    if (!price)
      throw new BadRequestException({
        code: 'PLAN_PRICE_MISSING',
        message: `No price is configured for the ${planId} plan`,
      })
    const sub = await this.stripe.subscriptions.retrieve(subscriptionId)
    const item = sub.items.data[0]
    if (!item)
      throw new BadRequestException({
        code: 'SUBSCRIPTION_PLAN_MISSING',
        message: 'The subscription on file carries no plan to change',
      })
    await this.stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, price }],
      proration_behavior: 'create_prorations',
      metadata: { ...sub.metadata, planId },
    })
  }
}
