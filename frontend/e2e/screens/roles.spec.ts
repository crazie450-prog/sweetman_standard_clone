import { expect, test, type Page } from '@playwright/test'
import {
  ACCOUNTS,
  apiUrl,
  dataRows,
  dialog,
  expectToast,
  onHandOf,
  settled,
  signIn,
  signInAs,
  workAtFirstLocation,
  written,
} from '../helpers'

/* ===== Navigation ===== */

const NAV_ITEMS = { owner: 25, manager: 23, staff: 17 }

function railGroups(page: Page) {
  return page
    .locator('button[aria-label]')
    .filter({ hasNot: page.locator('svg[data-icon]') })
    .and(page.locator('button[title]'))
}

async function groupNames(page: Page): Promise<string[]> {
  const labels = await railGroups(page).evaluateAll((els) =>
    els.map((e) => e.getAttribute('aria-label') ?? '')
  )
  return labels.filter((l) => l && !/toggle|collapse|expand|sign out|logout/i.test(l))
}

for (const role of ['owner', 'manager', 'staff'] as const) {
  test(`every navigation item a ${role} sees leads where it says`, async ({ page }) => {
    await signInAs(page, role)
    await settled(page)

    const groups = await groupNames(page)
    expect(groups.length, 'the rail shows every group').toBe(6)

    let visited = 0
    for (const group of groups) {
      await page.locator(`button[aria-label="${group}"]`).click()
      const hrefs = await page
        .locator('nav a[href]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''))

      for (const href of hrefs) {
        // Following a link switches the shown group to the active one.
        await page.locator(`button[aria-label="${group}"]`).click()
        await page.locator(`nav a[href="${href}"]`).first().click()
        await expect(page, `${group} → ${href}`).toHaveURL(new RegExp(`${href}$`))
        visited++
      }
    }

    expect(visited, `a ${role} sees ${NAV_ITEMS[role]} navigation items`).toBe(NAV_ITEMS[role])
  })
}

/* ===== Writing under a role, not only seeing the button ===== */

test.describe('What a manager may write', () => {
  test('a manager creates a vendor and removes it again', async ({ page }) => {
    await signInAs(page, 'manager')
    await page.goto('/vendors')
    await settled(page)

    const name = `Audit Vendor ${Date.now()}`
    await page.getByRole('button', { name: 'Add Vendor' }).click()
    await dialog(page).getByLabel('Name').fill(name)
    await written(page, () => dialog(page).getByRole('button', { name: 'Add Vendor' }).click())

    await page.reload()
    await settled(page)
    await expect(dataRows(page).filter({ hasText: name })).toHaveCount(1)

    const created = await page.request.get(apiUrl('/api/vendors'))
    expect((await created.json()).some((v: { name: string }) => v.name === name)).toBeTruthy()

    await dataRows(page).filter({ hasText: name }).getByRole('button', { name: 'Delete' }).click()
    await written(page, () => dialog(page).getByRole('button', { name: 'Delete' }).click())
    await page.reload()
    await settled(page)
    await expect(dataRows(page).filter({ hasText: name })).toHaveCount(0)
  })

  test('a manager invites below their role, to their own location, and runs only that team', async ({
    page,
  }) => {
    await signInAs(page, 'manager')
    await page.goto('/team')
    await settled(page)

    await expect(dataRows(page).filter({ hasText: 'Ken Tanaka' }).getByRole('button')).toHaveCount(
      0
    )
    await expect(dataRows(page).filter({ hasText: 'Alex Morgan' }).getByRole('button')).toHaveCount(
      0
    )

    await page.getByRole('button', { name: 'Invite Member' }).click()
    const roles = await dialog(page).getByLabel('Role').locator('option').allTextContents()
    expect(roles).toEqual(['Team Member', 'Executive Chef'])
    await expect(dialog(page).getByRole('checkbox')).toHaveCount(1)
    await expect(dialog(page).getByLabel('Golden Fork — Downtown')).toBeVisible()

    const email = `manager-invite-${Date.now()}@example.com`
    await dialog(page).getByLabel('Email').fill(email)
    await dialog(page).getByLabel('Golden Fork — Downtown').check()
    await dialog(page).getByRole('button', { name: 'Send Invite' }).click()
    await expect(
      page.getByRole('dialog').filter({ hasText: 'Share the invitation link' })
    ).toBeVisible()
    await page.keyboard.press('Escape')

    const invited = dataRows(page).filter({ hasText: email })
    await expect(invited).toContainText('Golden Fork — Downtown')
    await invited.getByRole('button', { name: 'Revoke' }).click()
    await expect(invited).toHaveCount(0)
  })
})

test.describe('What a chef may write', () => {
  test('a chef adds an ingredient but cannot delete it', async ({ page, browser }) => {
    await signInAs(page, 'staff')
    await page.goto('/ingredients')
    await settled(page)

    const name = `Audit Ingredient ${Date.now()}`
    await page.getByRole('button', { name: 'Add Ingredient' }).click()
    await dialog(page).getByLabel('Name').fill(name)
    await dialog(page).getByLabel('Cost per unit').fill('4.25')
    const created = page.waitForResponse(
      (r) => r.url().endsWith('/api/ingredients') && r.request().method() === 'POST'
    )
    await dialog(page).getByRole('button', { name: 'Add Ingredient' }).click()
    expect((await created).ok(), 'the ingredient is created').toBeTruthy()

    await page.reload()
    await settled(page)
    const row = dataRows(page).filter({ hasText: name })
    await expect(row).toHaveCount(1)
    await expect(
      row.getByRole('button', { name: 'Delete' }),
      'deleting needs a manager'
    ).toHaveCount(0)

    const cleanup = await browser.newContext()
    const ownerPage = await cleanup.newPage()
    await signIn(ownerPage, ACCOUNTS.owner)
    const list = await ownerPage.request.get(apiUrl('/api/ingredients'))
    const id = ((await list.json()) as { id: string; name: string }[]).find(
      (i) => i.name === name
    )!.id
    expect((await ownerPage.request.delete(apiUrl(`/api/ingredients/${id}`))).ok()).toBeTruthy()
    await cleanup.close()
  })

  test('a chef logs waste and the stock moves', async ({ page }) => {
    await signInAs(page, 'staff')
    const locationId = await workAtFirstLocation(page)
    const before = await onHandOf(page, 'Heavy Cream 33%')

    await page.goto('/waste')
    await settled(page)
    await page.getByRole('button', { name: /Heavy Cream/ }).click()
    await page.getByLabel('Quantity').fill('0.5')
    await page.getByLabel('Reason').selectOption({ index: 1 })
    await page.getByRole('button', { name: 'Log Waste' }).click()
    await expectToast(page, /Waste logged/i)

    expect(await onHandOf(page, 'Heavy Cream 33%')).toBeCloseTo(before - 0.5, 2)

    const list = await page.request.get(apiUrl('/api/ingredients'))
    const id = ((await list.json()) as { id: string; name: string }[]).find(
      (i) => i.name === 'Heavy Cream 33%'
    )!.id
    await page.request.post(apiUrl('/api/inventory/transactions'), {
      headers: { 'X-Location-Id': locationId },
      data: { ingredientId: id, type: 'RECEIVE', quantity: 0.5 },
    })
    expect(await onHandOf(page, 'Heavy Cream 33%')).toBeCloseTo(before, 2)
  })

  test('a chef is offered no vendor management', async ({ page }) => {
    await signInAs(page, 'staff')
    await page.goto('/vendors')
    await settled(page)

    await expect(page.getByRole('button', { name: 'Add Vendor' })).toHaveCount(0)
    expect(await dataRows(page).count(), 'vendors stay readable').toBeGreaterThan(0)
  })
})
