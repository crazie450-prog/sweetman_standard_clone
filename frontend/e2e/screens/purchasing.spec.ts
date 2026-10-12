import { expect, test } from '@playwright/test'
import {
  ACCOUNTS,
  apiGet,
  apiUrl,
  dialog,
  expectToast,
  settled,
  signInAs,
  signOut,
  workAtFirstLocation,
  apiRows,
} from '../helpers'

test.describe('Purchasing', () => {
  test('quantity fields say which ingredient they order, and approving is not painted as a deletion', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/purchasing')
    await settled(page)
    await expect(page.getByLabel(/^Quantity of /).first()).toBeVisible()

    await page.getByRole('button', { name: 'Create draft orders' }).click()
    await expectToast(page, /draft order/i)
    const row = page.locator('tbody tr').filter({ hasText: 'Draft' }).first()
    await row.getByRole('button', { name: 'Open' }).click()
    const window = dialog(page)
    await expect(window.getByLabel(/^Quantity of /).first()).toBeVisible()
    await window.getByRole('button', { name: 'Approve' }).click()
    const confirm = dialog(page).last().getByRole('button', { name: 'Approve' })
    await expect(confirm).toBeVisible()
    await expect(confirm).not.toHaveClass(/bg-danger/)
    await dialog(page).last().getByRole('button', { name: 'Cancel' }).click()
  })

  test('a recommendation is drawn from what the location sold and becomes a draft a manager approves', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/purchasing')
    await settled(page)

    await expect(page.getByRole('heading', { name: 'Purchasing' })).toBeVisible()
    const beef = page.locator('tbody tr').filter({ hasText: 'Beef Tenderloin' }).first()
    await expect(beef).toBeVisible({ timeout: 15000 })
    await expect(beef).toContainText(/from sales/)
    await expect(beef).toContainText('Prime Meats Co.')

    // Keep only the beef line, so exactly one draft is created for one vendor.
    const boxes = page.getByRole('checkbox', { name: /^Order / })
    const count = await boxes.count()
    for (let i = 0; i < count; i++) {
      const box = boxes.nth(i)
      const name = await box.getAttribute('aria-label')
      if (name !== 'Order Beef Tenderloin') await box.uncheck()
    }
    // Earlier runs leave their approved orders in place: an approved order cannot be deleted.
    const approvedRows = () =>
      page
        .locator('tbody tr')
        .filter({ hasText: 'Prime Meats Co.' })
        .filter({ hasText: 'Approved' })
    const approvedBefore = await approvedRows().count()

    await page.getByRole('button', { name: 'Create draft orders' }).click()
    await expectToast(page, /draft order created/i)

    const row = page.locator('tbody tr').filter({ hasText: 'Prime Meats Co.' }).filter({
      hasText: 'Draft',
    })
    await expect(row.first()).toBeVisible()
    await row.first().getByRole('button', { name: 'Open' }).click()

    const window = dialog(page)
    await expect(window).toContainText('Beef Tenderloin')
    await expect(window).toContainText(/moves no stock|stock still arrives/i)
    await window.getByRole('button', { name: 'Approve' }).click()
    await expect(dialog(page).last()).toContainText(/no stock moves/i)
    await dialog(page).last().getByRole('button', { name: 'Approve' }).click()
    await expectToast(page, /approved/i)
    await expect(window.getByText('Approved', { exact: true })).toBeVisible()
    await window.getByRole('button', { name: 'Close' }).last().click()

    await expect(approvedRows()).toHaveCount(approvedBefore + 1)
  })

  test('with every location active the screen asks for one', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.evaluate(() => window.localStorage.removeItem('nexus.locationId'))
    await page.goto('/purchasing')
    await settled(page)
    await expect(page.getByText('Choose a location in the header')).toBeVisible()
  })

  test('a chef prepares draft orders but does not approve them', async ({ page }) => {
    await signInAs(page, 'staff')
    await workAtFirstLocation(page)
    await page.goto('/purchasing')
    await settled(page)
    await expect(page.getByRole('button', { name: 'Create draft orders' })).toBeVisible()

    const approved = page.locator('tbody tr').filter({ hasText: 'Approved' }).first()
    if ((await approved.count()) === 0) return
    await approved.getByRole('button', { name: 'Open' }).click()
    await expect(dialog(page).getByRole('button', { name: 'Approve' })).toHaveCount(0)
    await expect(dialog(page).getByRole('button', { name: 'Delete' })).toHaveCount(0)
  })

  test('creating drafts clears the choice, and a read-only member sees a draft without editing it', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/purchasing')
    await settled(page)
    await expect(
      page.locator('tbody tr').filter({ hasText: 'Beef Tenderloin' }).first()
    ).toBeVisible({
      timeout: 15000,
    })

    const boxes = page.getByRole('checkbox', { name: /^Order / })
    const count = await boxes.count()
    for (let i = 0; i < count; i++) {
      const box = boxes.nth(i)
      if ((await box.getAttribute('aria-label')) !== 'Order Beef Tenderloin') await box.uncheck()
    }
    const drafts = page
      .locator('tbody tr')
      .filter({ hasText: 'Prime Meats Co.' })
      .filter({ hasText: 'Draft' })
    const draftsBefore = await drafts.count()
    const create = page.getByRole('button', { name: 'Create draft orders' })
    await create.click()
    await expectToast(page, /draft order created/i)
    await expect(drafts).toHaveCount(draftsBefore + 1)
    await expect(create).toBeDisabled()

    const draftsList = await apiRows<{ id: string; status: string; vendorName: string | null }>(
      page,
      '/api/purchasing/drafts'
    )
    const created = draftsList.find(
      (d) => d.status === 'draft' && d.vendorName === 'Prime Meats Co.'
    )
    expect(created).toBeDefined()
    const members = await apiGet<{ id: string; email: string; role: string }[]>(page, '/api/users')
    const ken = members.find((m) => m.email === ACCOUNTS.staff.email)
    expect(ken).toBeDefined()
    const setKen = async (role: string) => {
      const res = await page.request.patch(apiUrl(`/api/users/${ken!.id}`), { data: { role } })
      expect(res.ok(), `PATCH role → ${res.status()}`).toBeTruthy()
    }

    await setKen('viewer')
    try {
      await signOut(page)
      await signInAs(page, 'staff')
      await workAtFirstLocation(page)
      await page.goto('/purchasing')
      await settled(page)
      await expect(page.getByRole('button', { name: 'Create draft orders' })).toHaveCount(0)
      await page
        .locator('tbody tr')
        .filter({ hasText: 'Prime Meats Co.' })
        .filter({ hasText: 'Draft' })
        .first()
        .getByRole('button', { name: 'Open' })
        .click()
      const window = dialog(page)
      await expect(window).toContainText('Beef Tenderloin')
      await expect(window.getByRole('button', { name: 'Save' })).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Remove' })).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Approve' })).toHaveCount(0)
      await expect(window.getByRole('textbox', { name: 'Note' })).not.toBeEditable()
    } finally {
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toHaveCount(0)
      await signOut(page)
      await signInAs(page, 'owner')
      await setKen('staff')
      await page.request.delete(apiUrl(`/api/purchasing/drafts/${created!.id}`))
    }
  })
  test('recalculating offers the new suggestions, not the quantities chosen for the old ones', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/purchasing')
    await settled(page)
    const rows = page
      .locator('tbody')
      .first()
      .locator('tr')
      .filter({ has: page.getByRole('checkbox') })
    await expect(rows.first()).toBeVisible({ timeout: 15000 })

    const suggestedOf = async (row: ReturnType<typeof rows.nth>) =>
      Number((await row.locator('td').nth(5).innerText()).trim().split(/\s+/)[0])
    const before = await suggestedOf(rows.first())

    await page.getByLabel('Days to cover').fill('8')
    await page.getByRole('button', { name: 'Recalculate' }).click()
    await expect.poll(() => suggestedOf(rows.first()), { timeout: 15000 }).not.toBe(before)

    const count = await rows.count()
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i)
      const suggested = await suggestedOf(row)
      await expect(row.getByRole('textbox')).toHaveValue(String(suggested))
    }
  })

  test('a period of fourteen and a half days is refused, not counted as fifteen', async ({
    page,
  }) => {
    const asked: string[] = []
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/purchasing/recommendations') asked.push(r.url())
    })
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/purchasing')
    await settled(page)
    const before = asked.length

    await page.getByLabel('Days of history').fill('14.5')
    await page.getByRole('button', { name: 'Recalculate' }).click()
    await expectToast(page, /whole days/)
    expect(asked.slice(before).filter((u) => u.includes('days=15'))).toHaveLength(0)
  })
})
