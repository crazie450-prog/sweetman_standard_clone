import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AppConfig } from '../config/env.validation'
import { PrismaService } from '../prisma/prisma.service'
import { lockKey, serialized, type Serial } from '../common/utils/serialize'
import { requireTenant } from '../tenancy/tenant-context'
import {
  BILLING_PROVIDER,
  WebhookRejected,
  type BillingEvent,
  type BillingProvider,
  type PaidPlanId,
} from './billing.provider'
import { restriction } from './restriction'
import { graceDays } from './subscription.guard'
import type { Prisma } from '../generated/prisma/client'

const PROVIDER_CALL_MS = 20_000

/* ===== The catalogue ===== */

export const BILLING_PLANS = [
  {
    id: 'free',
    name: 'Trial',
    description: 'Every feature, free for the first 14 days',
    monthlyPrice: 0,
    features: ['Every feature', 'No card needed'],
  },
  {
    id: 'starter',
    name: 'Starter',
    description: 'Suited to a single restaurant',
    monthlyPrice: 29,
    features: ['Every feature', 'Suggested for 1 location'],
  },
  {
    id: 'professional',
    name: 'Professional',
    description: 'Suited to a growing restaurant group',
    monthlyPrice: 79,
    features: ['Every feature', 'Suggested for up to 10 locations'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Suited to a large chain',
    monthlyPrice: 199,
    features: ['Every feature', 'Suggested for any number of locations'],
  },
]

/* ===== Service ===== */

@Injectable()
export class BillingService {
  private readonly log = new Logger('Billing')

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
    @Inject(ConfigService) private readonly config: AppConfig,
  ) {}

  private perLocation(): boolean {
    return this.config.get('BILLING_PER_LOCATION', { infer: true }) === 'true'
  }

  private origin(): string {
    return this.config.getOrThrow('FRONTEND_ORIGIN', { infer: true })
  }

  private org(db: Pick<Serial, 'organization'> = this.prisma.client) {
    const ctx = requireTenant()
    return db.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: {
        id: true,
        name: true,
        ownerEmail: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        planId: true,
        currentPeriodEnd: true,
        billingSeats: true,
      },
    })
  }

  private real(id: string | null | undefined): string | null {
    if (!id) return null
    return this.provider.name === 'stripe' && id.startsWith('stub_') ? null : id
  }

  private async activeLocations(organizationId: string): Promise<number> {
    return this.prisma.client.location.count({ where: { organizationId, isActive: true } })
  }

  async plans() {
    const org = await this.org()
    const current = org.subscriptionStatus === 'canceled' ? null : (org.planId ?? 'free')
    return BILLING_PLANS.map((p) => ({ ...p, current: p.id === current }))
  }

  async trialDaysRemaining(): Promise<number> {
    const org = await this.org()
    if (org.subscriptionStatus !== 'trial' || !org.trialEndsAt) return 0
    return Math.max(0, Math.ceil((org.trialEndsAt.getTime() - Date.now()) / 86400000))
  }

  async subscription() {
    const org = await this.org()
    const verdict = restriction(org, new Date(), graceDays(this.config))
    const plan = BILLING_PLANS.find((p) => p.id === (org.planId ?? 'free'))
    return {
      status: org.subscriptionStatus,
      planId: org.planId,
      planName: org.subscriptionStatus === 'canceled' ? null : (plan?.name ?? null),
      trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: org.currentPeriodEnd?.toISOString() ?? null,
      seats: org.billingSeats ?? (await this.activeLocations(org.id)),
      perLocation: this.perLocation(),
      provider: this.provider.name,
      hasCustomer: Boolean(this.real(org.stripeCustomerId)),
      hasSubscription: Boolean(this.real(org.stripeSubscriptionId)),
      restricted: verdict.restricted,
      warning: verdict.warning,
      reason: verdict.reason,
      graceDays: graceDays(this.config),
    }
  }

  async checkout(planId: PaidPlanId) {
    const origin = this.origin()
    const successUrl = `${origin}/subscription?checkout=success`
    const { answer, completed } = await serialized(
      this.prisma.client,
      lockKey('checkout', requireTenant().organizationId),
      async (tx) => {
        const org = await this.org(tx)
        const subscriptionId =
          org.subscriptionStatus === 'canceled' ? null : this.real(org.stripeSubscriptionId)
        if (this.provider.name === 'stripe' && subscriptionId) {
          await this.provider.changePlan(subscriptionId, planId)
          await tx.organization.update({ where: { id: org.id }, data: { planId } })
          return {
            answer: { url: successUrl, provider: this.provider.name, changed: true },
            completed: undefined,
          }
        }
        const quantity = this.perLocation()
          ? Math.max(
              1,
              await tx.location.count({ where: { organizationId: org.id, isActive: true } }),
            )
          : 1
        const result = await this.provider.createCheckout({
          organizationId: org.id,
          organizationName: org.name,
          ownerEmail: org.ownerEmail,
          customerId: this.real(org.stripeCustomerId),
          planId,
          quantity,
          successUrl,
          cancelUrl: `${origin}/subscription?checkout=canceled`,
        })
        if (result.customerId && result.customerId !== org.stripeCustomerId) {
          await tx.organization.update({
            where: { id: org.id },
            data: { stripeCustomerId: result.customerId },
          })
        }
        return {
          answer: { url: result.url, provider: this.provider.name, changed: false },
          completed: result.completed,
        }
      },
      { timeout: PROVIDER_CALL_MS, lockWait: PROVIDER_CALL_MS },
    )
    if (completed) await this.applyEvent(completed)
    return answer
  }

  async portal() {
    const org = await this.org()
    const origin = this.origin()
    return this.provider.createPortal({
      customerId: this.real(org.stripeCustomerId),
      returnUrl: `${origin}/subscription`,
    })
  }

  /* ===== What the provider reports ===== */

  async applyEvent(event: BillingEvent): Promise<{ applied: boolean }> {
    if (event.type === 'ignored') return { applied: false }

    const located = event.organizationId
      ? await this.prisma.client.organization.findUnique({ where: { id: event.organizationId } })
      : event.customerId
        ? await this.prisma.client.organization.findUnique({
            where: { stripeCustomerId: event.customerId },
          })
        : null
    if (!located) {
      this.log.warn(`billing event ${event.id} names no organization we know`)
      return { applied: false }
    }

    return serialized(this.prisma.client, lockKey('billing', located.id), async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: located.id } })
      const seen = await tx.billingEvent.findUnique({ where: { id: event.id } })
      if (seen) return { applied: false }

      const occurredAt = event.occurredAt ?? new Date()
      const record = { id: event.id, organizationId: org.id, type: event.type, occurredAt }
      const onFile = this.real(org.stripeSubscriptionId)
      const anotherSubscription =
        (event.type === 'subscription.updated' || event.type === 'subscription.deleted') &&
        Boolean(event.subscriptionId && onFile && event.subscriptionId !== onFile)
      const superseded = await tx.billingEvent.findFirst({
        where: { organizationId: org.id, occurredAt: { gt: occurredAt } },
        select: { id: true },
      })
      const identityOnly = Boolean(superseded) && event.type === 'checkout.completed'
      if (anotherSubscription || (superseded && !identityOnly)) {
        await tx.billingEvent.create({ data: record })
        return { applied: false }
      }

      const data: Prisma.OrganizationUpdateInput = {}
      switch (event.type) {
        case 'checkout.completed':
          if (event.planId) data.planId = event.planId
          if (event.customerId && !this.real(org.stripeCustomerId)) {
            data.stripeCustomerId = event.customerId
          }
          if (event.subscriptionId) data.stripeSubscriptionId = event.subscriptionId
          if (identityOnly) break
          data.subscriptionStatus = event.status ?? 'active'
          if (event.currentPeriodEnd) data.currentPeriodEnd = event.currentPeriodEnd
          if (event.quantity) data.billingSeats = event.quantity
          break
        case 'subscription.updated':
          if (event.status) data.subscriptionStatus = event.status
          if (event.planId) data.planId = event.planId
          if (event.subscriptionId) data.stripeSubscriptionId = event.subscriptionId
          if (event.status === 'canceled') data.stripeSubscriptionId = null
          if (event.currentPeriodEnd) data.currentPeriodEnd = event.currentPeriodEnd
          if (event.quantity) data.billingSeats = event.quantity
          break
        case 'subscription.deleted':
          data.subscriptionStatus = 'canceled'
          data.planId = null
          data.stripeSubscriptionId = null
          break
        case 'payment.failed':
          data.subscriptionStatus = 'past_due'
          if (!org.currentPeriodEnd) data.currentPeriodEnd = event.currentPeriodEnd ?? occurredAt
          break
        case 'payment.paid':
          data.subscriptionStatus = 'active'
          if (event.currentPeriodEnd) data.currentPeriodEnd = event.currentPeriodEnd
          break
      }

      await tx.billingEvent.create({ data: record })
      await tx.organization.update({ where: { id: org.id }, data })
      return { applied: true }
    })
  }

  handleWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!rawBody)
      throw new BadRequestException({
        code: 'WEBHOOK_BODY_MISSING',
        message: 'The webhook carries no body',
      })
    let event: BillingEvent
    try {
      event = this.provider.verifyWebhook(rawBody, signature)
    } catch (error) {
      if (error instanceof WebhookRejected)
        throw new BadRequestException({ code: 'WEBHOOK_REJECTED', message: error.message })
      throw error
    }
    return this.applyEvent(event)
  }

  async syncSeats(organizationId: string): Promise<void> {
    if (!this.perLocation()) return
    try {
      await serialized(
        this.prisma.client,
        lockKey('seats', organizationId),
        async (tx) => {
          const org = await tx.organization.findUnique({
            where: { id: organizationId },
            select: { stripeSubscriptionId: true },
          })
          const subscriptionId = this.real(org?.stripeSubscriptionId)
          if (!subscriptionId) return
          const seats = Math.max(
            1,
            await tx.location.count({ where: { organizationId, isActive: true } }),
          )
          await this.provider.setQuantity(subscriptionId, seats)
          await tx.organization.update({
            where: { id: organizationId },
            data: { billingSeats: seats },
          })
        },
        { timeout: PROVIDER_CALL_MS, lockWait: PROVIDER_CALL_MS },
      )
    } catch (error) {
      this.log.error(
        `seats for organization ${organizationId} stay at their previous count: ${(error as Error).message}`,
      )
    }
  }
}
