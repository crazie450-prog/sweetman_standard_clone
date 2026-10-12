import { BadRequestException } from '@nestjs/common'
import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  isPaidPlan,
  WebhookRejected,
  type BillingEvent,
  type BillingProvider,
  type CheckoutRequest,
  type PortalRequest,
} from './billing.provider'

export function signStubEvent(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

export class StubBillingProvider implements BillingProvider {
  readonly name = 'stub' as const

  constructor(private readonly secret: string | undefined) {}

  async createCheckout(request: CheckoutRequest) {
    const customerId = request.customerId ?? `stub_cus_${request.organizationId}`
    const completed: BillingEvent = {
      id: `stub_evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'checkout.completed',
      customerId,
      organizationId: request.organizationId,
      subscriptionId: `stub_sub_${request.organizationId}`,
      planId: request.planId,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
      quantity: request.quantity,
      occurredAt: new Date(),
    }
    return { url: request.successUrl, customerId, completed }
  }

  createPortal(_request: PortalRequest): Promise<{ url: string }> {
    throw new BadRequestException({
      code: 'BILLING_PROVIDER_NOT_CONNECTED',
      message: 'No billing provider is connected; the plan is changed on this page instead',
    })
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): BillingEvent {
    if (!this.secret) throw new WebhookRejected('No webhook secret is configured')
    if (!signature) throw new WebhookRejected('The webhook carries no signature')
    const expected = Buffer.from(signStubEvent(rawBody.toString('utf8'), this.secret))
    const presented = Buffer.from(signature)
    if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
      throw new WebhookRejected('The webhook signature does not match')
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>
    } catch {
      throw new WebhookRejected('The webhook body is not JSON')
    }
    const id = typeof parsed.id === 'string' ? parsed.id : ''
    if (!id) throw new WebhookRejected('The event has no id')

    const type = parsed.type
    const known = [
      'checkout.completed',
      'subscription.updated',
      'subscription.deleted',
      'payment.failed',
      'payment.paid',
    ]
    const period =
      typeof parsed.currentPeriodEnd === 'string' ? new Date(parsed.currentPeriodEnd) : null
    const created = typeof parsed.created === 'string' ? new Date(parsed.created) : null
    return {
      id,
      type:
        typeof type === 'string' && known.includes(type)
          ? (type as BillingEvent['type'])
          : 'ignored',
      customerId: typeof parsed.customerId === 'string' ? parsed.customerId : null,
      subscriptionId: typeof parsed.subscriptionId === 'string' ? parsed.subscriptionId : null,
      planId: isPaidPlan(parsed.planId) ? parsed.planId : null,
      status:
        parsed.status === 'trial' ||
        parsed.status === 'active' ||
        parsed.status === 'past_due' ||
        parsed.status === 'canceled'
          ? parsed.status
          : null,
      currentPeriodEnd: period && !Number.isNaN(period.getTime()) ? period : null,
      quantity: typeof parsed.quantity === 'number' ? parsed.quantity : null,
      occurredAt: created && !Number.isNaN(created.getTime()) ? created : new Date(),
    }
  }

  async setQuantity(): Promise<void> {}

  async changePlan(): Promise<void> {}
}
