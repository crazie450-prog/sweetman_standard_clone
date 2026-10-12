import { HttpException, type ExecutionContext } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import type { PrismaService } from '../prisma/prisma.service'
import { graceDays, SubscriptionGuard } from './subscription.guard'
import { configWith } from '../../test/config'

type Org = { subscriptionStatus: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null }

const DAY = 86400000
const closed: Org = { subscriptionStatus: 'canceled', trialEndsAt: null, currentPeriodEnd: null }
const tenant = { organizationId: 'org-1', userId: 'u-1', isPlatformAdmin: false }

function setup(org: Org | null, isPublic = false, grace = '7') {
  const findUnique = jest.fn().mockResolvedValue(org)
  const prisma = { client: { organization: { findUnique } } } as unknown as PrismaService
  const reflector = { getAllAndOverride: () => isPublic } as unknown as Reflector
  const guard = new SubscriptionGuard(reflector, prisma, configWith({ BILLING_GRACE_DAYS: grace }))
  const run = (req: Record<string, unknown>) =>
    guard.canActivate({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext)
  return { run, findUnique }
}

describe('SubscriptionGuard', () => {
  it('refuses a write from a closed account with 402 and the reason', async () => {
    const { run } = setup(closed)
    const refusal = await run({ method: 'POST', path: '/api/vendors', tenant }).catch((e) => e)
    expect(refusal).toBeInstanceOf(HttpException)
    expect((refusal as HttpException).getStatus()).toBe(402)
    expect((refusal as HttpException).message).toMatch(/canceled/)
  })

  it('lets every read through without asking the database', async () => {
    const { run, findUnique } = setup(closed)
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      await expect(run({ method, path: '/api/vendors', tenant })).resolves.toBe(true)
    }
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('keeps the way back open: billing, sign-in, the organization itself and the admin panel', async () => {
    const { run, findUnique } = setup(closed)
    for (const path of [
      '/api/billing/checkout',
      '/api/auth/change-password',
      '/api/organizations/current',
      '/api/admin/organizations/x',
    ]) {
      await expect(run({ method: 'POST', path, tenant })).resolves.toBe(true)
    }
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('does not stand in the way of a public route, an anonymous request or a platform administrator', async () => {
    await expect(
      setup(closed, true).run({ method: 'POST', path: '/api/billing/webhook' }),
    ).resolves.toBe(true)
    await expect(setup(closed).run({ method: 'POST', path: '/api/vendors' })).resolves.toBe(true)
    await expect(
      setup(closed).run({
        method: 'POST',
        path: '/api/vendors',
        tenant: { ...tenant, isPlatformAdmin: true },
      }),
    ).resolves.toBe(true)
  })

  it('refuses a write under a path that only begins like an open one', async () => {
    const { run } = setup(closed)
    await expect(
      run({ method: 'PATCH', path: '/api/organizations/other', tenant }),
    ).rejects.toBeInstanceOf(HttpException)
  })

  it('reads the grace period from the configuration when it judges a failed payment', async () => {
    const lapsed: Org = {
      subscriptionStatus: 'past_due',
      trialEndsAt: null,
      currentPeriodEnd: new Date(Date.now() - 3 * DAY),
    }
    await expect(
      setup(lapsed, false, '7').run({ method: 'POST', path: '/api/vendors', tenant }),
    ).resolves.toBe(true)
    await expect(
      setup(lapsed, false, '2').run({ method: 'POST', path: '/api/vendors', tenant }),
    ).rejects.toBeInstanceOf(HttpException)
  })

  it('passes an organization it cannot find to the handlers that answer for it', async () => {
    await expect(setup(null).run({ method: 'POST', path: '/api/vendors', tenant })).resolves.toBe(
      true,
    )
  })
})

describe('graceDays', () => {
  it('defaults to a week and takes a stated number of days, zero included', () => {
    expect(graceDays(configWith({ BILLING_GRACE_DAYS: undefined }))).toBe(7)
    expect(graceDays(configWith({ BILLING_GRACE_DAYS: '0' }))).toBe(0)
    expect(graceDays(configWith({ BILLING_GRACE_DAYS: '30' }))).toBe(30)
  })

  it('refuses to start on a value that is not a period', () => {
    expect(() => configWith({ BILLING_GRACE_DAYS: 'soon' })).toThrow(/BILLING_GRACE_DAYS/)
    expect(() => configWith({ BILLING_GRACE_DAYS: '-1' })).toThrow(/BILLING_GRACE_DAYS/)
  })
})
