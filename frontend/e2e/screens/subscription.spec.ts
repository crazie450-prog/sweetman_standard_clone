import { expect, test, type Page } from '@playwright/test'
import { expectToast, settled, signIn, signInAs } from '../helpers'

const PLANS = [
  { id: 'free', name: 'Trial', description: 'Trial', monthlyPrice: 0, features: [] },
  { id: 'starter', name: 'Starter', description: 'Starter', monthlyPrice: 29, features: [] },
  { id: 'professional', name: 'Professional', description: 'Pro', monthlyPrice: 79, features: [] },
  { id: 'enterprise', name: 'Enterprise', description: 'Ent', monthlyPrice: 199, features: [] },
]

const inFuture = new Date(Date.now() + 20 * 86400000).toISOString()

async function asStripe(
  page: Page,
  subscription: Record<string, unknown>,
  current: string,
  checkoutAnswer: (planId: string) => Record<string, unknown>
) {
  const asked: Record<string, unknown>[] = []
  await page.route('**/api/billing/subscription', (route) =>
    route.fulfill({
      json: {
        status: 'active',
        planId: current,
        planName: PLANS.find((p) => p.id === current)?.name ?? null,
        trialEndsAt: null,
        currentPeriodEnd: inFuture,
        seats: 3,
        perLocation: true,
        provider: 'stripe',
        hasCustomer: true,
        hasSubscription: true,
        restricted: false,
        warning: false,
        reason: null,
        graceDays: 7,
        ...subscription,
      },
    })
  )
  await page.route('**/api/billing/plans', (route) =>
    route.fulfill({ json: PLANS.map((p) => ({ ...p, current: p.id === current })) })
  )
  await page.route('**/api/billing/checkout', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    asked.push(body)
    await route.fulfill({ json: checkoutAnswer(body.planId as string) })
  })
  return asked
}

test.describe('Subscription with a real payment provider', () => {
  test('a paying account switches plan on its subscription and manages billing in the portal', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const asked = await asStripe(page, {}, 'starter', () => ({
      url: 'http://localhost:3000/subscription?checkout=success',
      provider: 'stripe',
      changed: true,
    }))
    await page.route('**/api/billing/portal', (route) =>
      route.fulfill({ json: { url: `${new URL(page.url()).origin}/subscription?from=portal` } })
    )
    await page.goto('/subscription')
    await settled(page)

    await expect(page.getByText('Starter plan')).toBeVisible()
    await expect(page.getByText(/Next payment/)).toBeVisible()
    await expect(page.getByText(/3 locations billed/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Upgrade to|^Downgrade to/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Current Plan' })).toHaveCount(1)

    await page.getByRole('button', { name: 'Switch to Professional' }).click()
    await expectToast(page, /changed on the current subscription/i)
    expect(asked).toEqual([{ planId: 'professional' }])

    await page.getByRole('button', { name: 'Manage billing' }).click()
    await page.waitForURL(/from=portal/)
  })

  test('an account with no subscription is sent to the provider checkout, and told how it came back', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const origin = new URL(page.url()).origin
    await asStripe(
      page,
      {
        status: 'trial',
        planName: 'Trial',
        hasSubscription: false,
        hasCustomer: false,
        trialEndsAt: inFuture,
        currentPeriodEnd: null,
      },
      'free',
      () => ({
        url: `${origin}/subscription?checkout=success`,
        provider: 'stripe',
        changed: false,
      })
    )
    await page.goto('/subscription')
    await settled(page)

    await expect(page.getByRole('button', { name: 'Manage billing' })).toHaveCount(0)
    await expect(page.getByText(/No payment provider is connected/)).toHaveCount(0)
    await page.getByRole('button', { name: 'Upgrade to Starter' }).click()
    await page.waitForURL(/\/subscription$/)
    await expectToast(page, /Checkout complete/)

    await page.goto('/subscription?checkout=canceled')
    await expectToast(page, /Checkout was canceled/)
  })

  test('the page offers only the price the checkout charges, and comes back to a clean address', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const origin = new URL(page.url()).origin
    const asked = await asStripe(page, { hasSubscription: false }, 'free', () => ({
      url: `${origin}/subscription?checkout=canceled`,
      provider: 'stripe',
      changed: false,
    }))
    await page.goto('/subscription')
    await settled(page)

    await expect(page.getByRole('tab', { name: /Yearly/ })).toHaveCount(0)
    await expect(page.getByText(/Save \d+%/)).toHaveCount(0)
    for (const price of ['$29', '$79', '$199']) await expect(page.getByText(price)).toBeVisible()
    await page.getByRole('button', { name: 'Upgrade to Starter' }).click()
    await expect.poll(() => asked.length).toBe(1)
    expect(asked[0]).toEqual({ planId: 'starter' })
    await expectToast(page, /Checkout was canceled/)
    await expect(page).toHaveURL(/\/subscription$/)
  })
})

test.describe('The subscription link on Settings', () => {
  test('an administrator is told who manages it instead of being sent to a page that bounces', async ({
    page,
  }) => {
    await signIn(page, { email: 'platform@nexus.app', password: 'Nexus_dev1' })
    await page.goto('/settings')
    await settled(page)
    await expect(page.getByText('Usage & Subscription')).toBeVisible()
    await expect(page.getByRole('link', { name: /Manage Subscription/ })).toHaveCount(0)
    await expect(page.getByText('The owner manages the subscription.')).toBeVisible()
  })

  test('the owner is offered the link', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/settings')
    await settled(page)
    await expect(page.getByRole('link', { name: /Manage Subscription/ })).toBeVisible()
  })
})
