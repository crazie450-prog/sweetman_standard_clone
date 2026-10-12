import { expect, test } from '@playwright/test'
import {
  ACCOUNTS,
  dataRows,
  expectNoErrorState,
  fillCredentials,
  recordCount,
  settled,
  signIn,
  signOut,
} from './helpers'

test.describe('Authentication', () => {
  test('a seeded owner signs in and reaches the dashboard', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('a wrong password is refused and keeps the user on the form', async ({ page }) => {
    await page.goto('/login')
    await fillCredentials(page, ACCOUNTS.owner.email, 'definitely-not-the-password')
    await page.getByRole('button', { name: 'Sign In' }).click()
    await expect(page.getByText(/incorrect email or password/i)).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('a sign-in the server refuses with a reason shows that reason', async ({ page }) => {
    const reason = 'This organization has been deactivated; contact Nexus support to restore access'
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 403,
        json: { error: { code: 'ORGANIZATION_DEACTIVATED', message: reason } },
      })
    )
    await page.goto('/login')
    await fillCredentials(page, ACCOUNTS.owner.email, ACCOUNTS.owner.password)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await expect(page.getByText(reason)).toBeVisible()
    await expect(page.getByText('Incorrect email or password.')).toHaveCount(0)
  })

  test('a sign-in that fails for any other reason does not blame the password', async ({
    page,
  }) => {
    let answer: 'unreachable' | 'broken' | 'refused' = 'unreachable'
    await page.route('**/api/auth/login', (route) =>
      answer === 'unreachable'
        ? route.abort('connectionrefused')
        : answer === 'broken'
          ? route.fulfill({
              status: 500,
              json: {
                error: {
                  code: 'INTERNAL_SERVER_ERROR',
                  message: 'Something went wrong on our side; try again in a moment',
                },
              },
            })
          : route.fulfill({
              status: 401,
              json: {
                error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
              },
            })
    )
    await page.goto('/login')
    await fillCredentials(page, ACCOUNTS.owner.email, ACCOUNTS.owner.password)
    const signIn = page.getByRole('button', { name: 'Sign In' })

    await signIn.click()
    await expect(page.getByText('Could not sign in. Try again.')).toBeVisible()
    await expect(page.getByText('Incorrect email or password.')).toHaveCount(0)

    answer = 'broken'
    await signIn.click()
    await expect(
      page.getByText('Something went wrong on our side; try again in a moment')
    ).toBeVisible()
    await expect(page.getByText('Incorrect email or password.')).toHaveCount(0)

    answer = 'refused'
    await signIn.click()
    await expect(page.getByText('Incorrect email or password.')).toBeVisible()
  })

  test('an unauthenticated visitor cannot reach an application screen', async ({ page }) => {
    await page.goto('/recipes').catch(() => {})
    await expect(page).toHaveURL(/\/login$/, { timeout: 20000 })
  })
})

test.describe('Screens carry data from the API', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
  })

  test('the dashboard shows figures rather than placeholders', async ({ page }) => {
    await expect(page.getByText('Food Cost %')).toBeVisible()
    await expect(page.getByText("Today's Revenue")).toBeVisible()
    await expectNoErrorState(page)
  })

  const listScreens = [
    { path: '/recipes', heading: 'Recipes' },
    { path: '/inventory', heading: 'Inventory Management' },
    { path: '/vendors', heading: 'Vendor Management' },
    { path: '/menu', heading: 'Menu Management' },
    { path: '/team', heading: 'Team' },
  ]

  for (const screen of listScreens) {
    test(`${screen.path} lists records loaded from the backend`, async ({ page }) => {
      await page.goto(screen.path)
      await expect(page.getByRole('heading', { name: screen.heading, level: 1 })).toBeVisible()
      await expect.poll(() => recordCount(page), { timeout: 15000 }).toBeGreaterThan(0)
      await expectNoErrorState(page)
    })
  }
})

test.describe('Deep links', () => {
  test('a recipe carried in the URL opens the menu-item form with that recipe', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await page.goto('/recipes')
    await page.getByRole('link', { name: 'Beef Wellington' }).first().click()
    await page.getByRole('link', { name: /add to menu item/i }).click()
    await page.waitForURL(/\/menu\?recipe=/)
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const recipeSelect = dialog
      .getByRole('combobox')
      .filter({ has: page.getByRole('option', { name: 'Beef Wellington' }) })
    await expect(recipeSelect).toHaveValue(/.+/)
  })
})

test.describe('Quantities keep their unit', () => {
  test('the inventory history prints a quantity with its measurement unit', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    await page.goto('/reports')
    await settled(page)
    await expect.poll(() => dataRows(page).count(), { timeout: 15000 }).toBeGreaterThan(0)
    await expect(dataRows(page).first().locator('td').nth(4)).toHaveText(/\d+(\.\d+)?\s+\S+/)
  })
})

test.describe('Tenants and locations stay apart', () => {
  test('two organizations see different vendors', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    await page.goto('/vendors')
    await settled(page)
    await expect.poll(() => dataRows(page).count(), { timeout: 15000 }).toBeGreaterThan(0)
    const goldenFork = await dataRows(page).allInnerTexts()

    await signOut(page)

    await signIn(page, ACCOUNTS.otherTenant)
    await page.goto('/vendors')
    await settled(page)
    await expect.poll(() => dataRows(page).count(), { timeout: 15000 }).toBeGreaterThan(0)
    const bellaCucina = await dataRows(page).allInnerTexts()

    expect(goldenFork.length).toBeGreaterThan(0)
    expect(bellaCucina.length).toBeGreaterThan(0)
    for (const row of bellaCucina) {
      expect(goldenFork).not.toContain(row)
    }
  })

  test('a manager is offered only the location they are assigned to', async ({ page }) => {
    await signIn(page, ACCOUNTS.manager)
    const switcher = page.getByRole('combobox', { name: 'Location' })
    await expect(switcher).toBeVisible()
    await expect(switcher.getByRole('option', { name: /golden fork/i })).toHaveCount(1)
  })

  test('an owner is offered every location of the organization', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    const switcher = page.getByRole('combobox', { name: 'Location' })
    await expect(switcher.getByRole('option', { name: /golden fork/i })).toHaveCount(3)
  })
})
