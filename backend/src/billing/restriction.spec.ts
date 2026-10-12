import { restriction } from './restriction'

const now = new Date('2026-09-14T12:00:00Z')
const days = (n: number) => new Date(now.getTime() + n * 86400000)

describe('restriction', () => {
  it('leaves a running trial and an active subscription alone', () => {
    expect(
      restriction(
        { subscriptionStatus: 'trial', trialEndsAt: days(3), currentPeriodEnd: null },
        now,
        7,
      ),
    ).toEqual({ restricted: false, warning: false, reason: null })
    expect(
      restriction(
        { subscriptionStatus: 'active', trialEndsAt: null, currentPeriodEnd: days(20) },
        now,
        7,
      ),
    ).toEqual({ restricted: false, warning: false, reason: null })
  })

  it('closes an expired trial and a canceled subscription', () => {
    expect(
      restriction(
        { subscriptionStatus: 'trial', trialEndsAt: days(-1), currentPeriodEnd: null },
        now,
        7,
      ).restricted,
    ).toBe(true)
    expect(
      restriction(
        { subscriptionStatus: 'canceled', trialEndsAt: null, currentPeriodEnd: days(5) },
        now,
        7,
      ).restricted,
    ).toBe(true)
  })

  it('warns while a failed payment is inside the grace period, then closes', () => {
    const inside = restriction(
      { subscriptionStatus: 'past_due', trialEndsAt: null, currentPeriodEnd: days(-3) },
      now,
      7,
    )
    expect(inside).toMatchObject({ restricted: false, warning: true })
    expect(inside.reason).toContain('7 days')

    const outside = restriction(
      { subscriptionStatus: 'past_due', trialEndsAt: null, currentPeriodEnd: days(-8) },
      now,
      7,
    )
    expect(outside).toMatchObject({ restricted: true, warning: false })
  })

  it('closes a past-due account with no paid period on record, since no grace can be counted from it', () => {
    const verdict = restriction(
      { subscriptionStatus: 'past_due', trialEndsAt: null, currentPeriodEnd: null },
      now,
      7,
    )
    expect(verdict).toMatchObject({ restricted: true, warning: false })
    expect(verdict.reason).toMatch(/no paid period/)
  })
  it('keeps a failed payment writing until the very end of its grace period, and none with no grace', () => {
    const endsNow = { subscriptionStatus: 'past_due' as const, trialEndsAt: null }
    expect(restriction({ ...endsNow, currentPeriodEnd: days(-7) }, now, 7)).toMatchObject({
      restricted: false,
      warning: true,
    })
    expect(
      restriction({ ...endsNow, currentPeriodEnd: new Date(days(-7).getTime() - 1) }, now, 7)
        .restricted,
    ).toBe(true)
    expect(restriction({ ...endsNow, currentPeriodEnd: days(-1) }, now, 0).restricted).toBe(true)
  })

  it('treats a trial with no end date as running, and ignores a period on an active subscription', () => {
    expect(
      restriction(
        { subscriptionStatus: 'trial', trialEndsAt: null, currentPeriodEnd: null },
        now,
        7,
      ).restricted,
    ).toBe(false)
    expect(
      restriction(
        { subscriptionStatus: 'active', trialEndsAt: days(-30), currentPeriodEnd: days(-30) },
        now,
        7,
      ),
    ).toEqual({ restricted: false, warning: false, reason: null })
  })

  it('names the Subscription page in every refusal and every warning', () => {
    const verdicts = [
      restriction(
        { subscriptionStatus: 'canceled', trialEndsAt: null, currentPeriodEnd: null },
        now,
        7,
      ),
      restriction(
        { subscriptionStatus: 'trial', trialEndsAt: days(-1), currentPeriodEnd: null },
        now,
        7,
      ),
      restriction(
        { subscriptionStatus: 'past_due', trialEndsAt: null, currentPeriodEnd: null },
        now,
        7,
      ),
      restriction(
        { subscriptionStatus: 'past_due', trialEndsAt: null, currentPeriodEnd: days(-1) },
        now,
        7,
      ),
    ]
    for (const v of verdicts) expect(v.reason).toMatch(/Subscription page/)
  })
})
