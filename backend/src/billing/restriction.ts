import type { SubscriptionState } from './billing.provider'

export interface BillingRecord {
  subscriptionStatus: SubscriptionState
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
}

export interface Restriction {
  restricted: boolean
  warning: boolean
  reason: string | null
}

const DAY = 86400000

export function restriction(org: BillingRecord, now: Date, graceDays: number): Restriction {
  if (org.subscriptionStatus === 'canceled') {
    return {
      restricted: true,
      warning: false,
      reason:
        'The subscription was canceled. Everything can still be read; changes are refused until a plan is chosen on the Subscription page.',
    }
  }
  if (org.subscriptionStatus === 'trial') {
    if (org.trialEndsAt && org.trialEndsAt.getTime() < now.getTime()) {
      return {
        restricted: true,
        warning: false,
        reason:
          'The trial has ended. Everything can still be read; changes are refused until a plan is chosen on the Subscription page.',
      }
    }
    return { restricted: false, warning: false, reason: null }
  }
  if (org.subscriptionStatus === 'past_due') {
    if (!org.currentPeriodEnd) {
      return {
        restricted: true,
        warning: false,
        reason:
          'The last payment failed and no paid period is on record. Everything can still be read; changes are refused until the payment goes through on the Subscription page.',
      }
    }
    const deadline = org.currentPeriodEnd.getTime() + graceDays * DAY
    if (deadline < now.getTime()) {
      return {
        restricted: true,
        warning: false,
        reason:
          'The last payment failed and the grace period has passed. Everything can still be read; changes are refused until the payment goes through on the Subscription page.',
      }
    }
    return {
      restricted: false,
      warning: true,
      reason: `The last payment failed. Changes keep working for ${graceDays} days after the paid period; update the payment method on the Subscription page.`,
    }
  }
  return { restricted: false, warning: false, reason: null }
}
