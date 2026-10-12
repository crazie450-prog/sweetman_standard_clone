export type BillingEventType =
  | 'checkout.completed'
  | 'subscription.updated'
  | 'subscription.deleted'
  | 'payment.failed'
  | 'payment.paid'
  | 'ignored'

export type SubscriptionState = 'trial' | 'active' | 'past_due' | 'canceled'

export interface BillingEvent {
  id: string
  type: BillingEventType
  customerId: string | null
  organizationId?: string | null
  subscriptionId?: string | null
  planId?: string | null
  status?: SubscriptionState | null
  currentPeriodEnd?: Date | null
  quantity?: number | null
  occurredAt?: Date | null
}

export interface CheckoutRequest {
  organizationId: string
  organizationName: string
  ownerEmail: string
  customerId: string | null
  planId: string
  quantity: number
  successUrl: string
  cancelUrl: string
}

export interface PortalRequest {
  customerId: string | null
  returnUrl: string
}

export interface BillingProvider {
  readonly name: 'stub' | 'stripe'
  createCheckout(
    request: CheckoutRequest,
  ): Promise<{ url: string; customerId: string | null; completed?: BillingEvent }>
  createPortal(request: PortalRequest): Promise<{ url: string }>
  verifyWebhook(rawBody: Buffer, signature: string | undefined): BillingEvent
  setQuantity(subscriptionId: string, quantity: number): Promise<void>
  changePlan(subscriptionId: string, planId: PaidPlanId): Promise<void>
}

export class WebhookRejected extends Error {}

export const BILLING_PROVIDER = Symbol('BILLING_PROVIDER')

export const PLAN_IDS = ['starter', 'professional', 'enterprise'] as const
export type PaidPlanId = (typeof PLAN_IDS)[number]

export function isPaidPlan(value: unknown): value is PaidPlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value)
}
