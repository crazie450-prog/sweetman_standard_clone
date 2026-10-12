import { expect, test, type Page } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACCOUNTS,
  apiGet,
  apiUrl,
  dataRows,
  dialog,
  expectToast,
  locationOptions,
  settled,
  signIn,
  signInAs,
  workAtFirstLocation,
  written,
} from '../helpers'

async function revokeInvitations(page: Page, email: string) {
  const pending = await apiGet<{ id: string; email: string }[]>(page, '/api/invitations')
  for (const inv of pending.filter((i) => i.email === email)) {
    await page.request.delete(apiUrl(`/api/invitations/${inv.id}`))
  }
}

test.describe('Team invitations and permissions', () => {
  test('an invitation can be sent, resent and revoked', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/team')
    await settled(page)

    const email = `invitee${Date.now()}@example.com`
    try {
      await page.getByRole('button', { name: 'Invite Member' }).click()
      await dialog(page).getByLabel(/email/i).fill(email)
      await dialog(page).locator('select').first().selectOption({ index: 1 })
      await dialog(page).locator('input[type=checkbox]').first().check()
      await written(page, () =>
        dialog(page)
          .getByRole('button', { name: /send|invite/i })
          .last()
          .click()
      )

      await page.reload()
      await settled(page)
      const row = dataRows(page).filter({ hasText: email })
      await expect(row).toHaveCount(1)
      await expect(row).toContainText('Invited')

      await row.getByRole('button', { name: 'Resend' }).click()
      await expect(dialog(page)).toContainText(/invitation link/i)
      await dialog(page)
        .getByRole('button', { name: /close|done/i })
        .last()
        .click()

      await row.getByRole('button', { name: 'Revoke' }).click()
      await expectToast(page, /revoked/i)
      await page.reload()
      await settled(page)
      await expect(dataRows(page).filter({ hasText: email })).toHaveCount(0)
    } finally {
      await revokeInvitations(page, email)
    }
  })

  test('an invitee opens the link, joins, and lands signed in at their location', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const downtown = (await apiGet<{ id: string; name: string }[]>(page, '/api/properties')).find(
      (l) => l.name.includes('Downtown')
    )!
    const stamp = Date.now()
    const email = `invitee.link.${stamp}@example.com`
    const name = `Link Invitee ${stamp}`
    const made = await page.request.post(apiUrl('/api/invitations'), {
      data: { email, role: 'staff', locationIds: [downtown.id] },
    })
    expect(made.ok()).toBeTruthy()
    const link = new URL(((await made.json()) as { acceptUrl: string }).acceptUrl)
    await page.context().clearCookies()
    try {
      await page.goto(`${link.pathname}${link.search}`)
      await expect(page.getByRole('heading', { name: 'Join The Golden Fork Group' })).toBeVisible()
      await expect(page.getByText('You were invited as Executive Chef')).toBeVisible()
      await expect(page.getByLabel('Email')).toHaveValue(email)
      await page.getByLabel('Your full name').fill(name)
      await page.getByLabel(/^Password/).fill('Link_pass1!')
      await page.getByRole('button', { name: 'Accept Invitation' }).click()
      await page.waitForURL('**/dashboard', { timeout: 15000 })
      await settled(page)
      await expect(page.getByRole('banner')).toContainText(name)
      await expect(page.getByRole('banner')).toContainText('Executive Chef')
      await expect(
        page.getByRole('banner').getByRole('combobox', { name: 'Location' })
      ).toHaveValue(downtown.id)
      const me = await apiGet<{ role: string; locations: { name: string }[] }>(page, '/api/auth/me')
      expect(me.role).toBe('staff')
      expect(me.locations.map((l) => l.name)).toEqual([downtown.name])
      await expect(page.getByText(`${name} joined as Executive Chef`)).toBeVisible()

      await page.context().clearCookies()
      await page.goto(`${link.pathname}${link.search}`)
      await expect(
        page.getByRole('heading', { name: 'This invitation is no longer valid' })
      ).toBeVisible()
      await expect(page.getByText(/used already/)).toBeVisible()
    } finally {
      await page.context().clearCookies()
      await page.request.post(apiUrl('/api/auth/login'), { data: ACCOUNTS.owner })
      const team = await apiGet<{ id: string; email: string }[]>(page, '/api/users')
      const joined = team.find((u) => u.email === email)
      if (joined) await page.request.delete(apiUrl(`/api/users/${joined.id}`))
      await revokeInvitations(page, email)
    }
  })

  test('an administrator hands a member a reset link they can open', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/team')
    await settled(page)

    const row = dataRows(page).filter({ hasText: 'maria@goldenfork.com' })
    await row.getByRole('button', { name: 'Reset password' }).click()
    await expect(dialog(page)).toContainText(/reset link/i)

    const link = await dialog(page).getByLabel('Reset link').inputValue()
    expect(link).toContain('/reset-password?token=')
    await dialog(page)
      .getByRole('button', { name: /close|done/i })
      .last()
      .click()

    const url = new URL(link)
    await page.goto(`${url.pathname}${url.search}`)
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
  })

  test('a double click on a team action sends it once, so the link shown is the one that works', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/team')
    await settled(page)

    let sent = 0
    await page.route('**/api/users/*/password-reset', async (route) => {
      sent += 1
      await new Promise((r) => setTimeout(r, 800))
      await route.continue()
    })
    const row = dataRows(page).filter({ hasText: 'maria@goldenfork.com' })
    await row.getByRole('button', { name: 'Reset password' }).dblclick()
    await expect(dialog(page)).toContainText(/reset link/i)
    await page.waitForTimeout(1200)
    expect(sent).toBe(1)
    await page.unroute('**/api/users/*/password-reset')
  })

  test('the invite dialog offers roles and locations', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/team')
    await settled(page)

    await page.getByRole('button', { name: 'Invite Member' }).click()
    const roles = await dialog(page).locator('select').first().locator('option').allTextContents()
    expect(roles.map((r) => r.trim())).toEqual([
      'Team Member',
      'Executive Chef',
      'Restaurant Manager',
      'Administrator',
    ])
    expect(await dialog(page).locator('input[type=checkbox]').count()).toBeGreaterThan(1)
    await dialog(page)
      .getByRole('button', { name: /cancel/i })
      .click()
  })

  test('a deactivated member stays in the list and is reactivated from it', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/team')
    await settled(page)

    const ken = dataRows(page).filter({ hasText: 'Ken Tanaka' })
    try {
      await ken.getByRole('button', { name: 'Deactivate' }).click()
      await expect(dialog(page)).toContainText(/Reactivate brings them back/i)
      await dialog(page).getByRole('button', { name: 'Deactivate' }).click()
      await expectToast(page, /deactivated/i)

      await expect(ken).toHaveCount(1)
      await expect(ken.getByText('Inactive', { exact: true })).toBeVisible()
      await expect(ken.getByRole('button', { name: 'Edit' })).toHaveCount(0)

      await ken.getByRole('button', { name: 'Reactivate' }).click()
      await expectToast(page, /can sign in again/i)
      await expect(ken.getByText('Active', { exact: true })).toBeVisible()
    } finally {
      const members = await apiGet<{ id: string; email: string; status: string }[]>(
        page,
        '/api/users'
      )
      const row = members.find((m) => m.email === 'ken@goldenfork.com')
      if (row && row.status === 'inactive') {
        await page.request.post(apiUrl(`/api/users/${row.id}/reactivate`))
      }
    }
  })

  test('an owner cannot deactivate themselves', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/team')
    await settled(page)

    const ownRow = dataRows(page).filter({ hasText: 'owner@goldenfork.com' })
    await expect(ownRow.getByRole('button', { name: 'Deactivate' })).toHaveCount(0)
  })
})

test.describe('Locations', () => {
  test('a location is created, archived and restored', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/settings/properties')
    await settled(page)

    const name = `Audit Location ${Date.now()}`
    try {
      await page.getByRole('button', { name: /Add Property/i }).click()
      await dialog(page).getByLabel('Property name').fill(name)
      await written(page, () =>
        dialog(page).getByRole('button', { name: 'Create Property' }).click()
      )
      await page.reload()
      await settled(page)

      // The nearest ancestor that owns buttons is the card for this location.
      const card = () =>
        page.getByRole('heading', { name, exact: true }).locator('xpath=ancestor::*[.//button][1]')

      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
      await expect.poll(() => locationOptions(page), { timeout: 15000 }).toContain(name)

      await card().getByRole('button', { name: 'Archive' }).click()
      await expect(dialog(page)).toBeVisible()
      await written(page, () => dialog(page).getByRole('button', { name: 'Archive' }).click())
      await page.reload()
      await settled(page)

      await expect(card().getByText('Archived')).toBeVisible()
      await expect
        .poll(() => locationOptions(page), {
          message: 'an archived location cannot be switched to',
          timeout: 15000,
        })
        .not.toContain(name)

      await written(page, () => card().getByRole('button', { name: 'Restore' }).click())
      await page.reload()
      await settled(page)
      await expect.poll(() => locationOptions(page), { timeout: 15000 }).toContain(name)

      await card().getByRole('button', { name: 'Archive' }).click()
      await dialog(page).getByRole('button', { name: 'Archive' }).click()
      await expect(card().getByText('Archived')).toBeVisible()
    } finally {
      const made = await apiGet<{ id: string; name: string; isActive: boolean }[]>(
        page,
        '/api/locations'
      )
      for (const l of made.filter((l) => l.name === name && l.isActive)) {
        await page.request.delete(apiUrl(`/api/locations/${l.id}`))
      }
    }
  })
})

test.describe('Subscription', () => {
  const secret =
    process.env.BILLING_WEBHOOK_SECRET ??
    (() => {
      try {
        const env = readFileSync(join(__dirname, '../../../backend/.env'), 'utf8')
        return env.match(/^BILLING_WEBHOOK_SECRET=(.+)$/m)?.[1]?.trim() ?? ''
      } catch {
        return ''
      }
    })()
  const apiUrl = process.env.E2E_API_URL ?? 'http://localhost:8000'

  const sendEvent = async (page: Page, event: Record<string, unknown>) => {
    const body = JSON.stringify(event)
    const signature = createHmac('sha256', secret).update(body).digest('hex')
    const res = await page.request.post(`${apiUrl}/api/billing/webhook`, {
      data: body,
      headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
    })
    expect(res.status(), 'the webhook is accepted').toBe(200)
  }

  test('a plan is chosen on the page, and the status card says what the account is on', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/subscription')
    await settled(page)

    await expect(
      page.getByText(/Trial|Starter plan|Professional plan|Enterprise plan/).first()
    ).toBeVisible()
    const target = page.getByRole('button', { name: /Upgrade to Starter|Downgrade to Starter/ })
    if (await target.count()) {
      await target.click()
      await expectToast(page, /plan is recorded/i)
    }
    await expect(page.getByText('Starter plan')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Current Plan' })).toHaveCount(1)
    await expect(page.getByText(/Next payment/)).toHaveCount(0)
    await expect(page.getByText(/Period ends/)).toBeVisible()

    await page.goto('/settings')
    await settled(page)
    await expect(page.getByText(/next payment/i)).toHaveCount(0)
    await expect(page.getByText(/period ends/i)).toBeVisible()
  })

  test('a canceled subscription is announced everywhere and refuses a change, then comes back', async ({
    page,
  }) => {
    test.skip(!secret, 'BILLING_WEBHOOK_SECRET is not set for the browser run')
    await signInAs(page, 'owner')
    const org = await apiGet<{ id: string }>(page, '/api/organizations/current')

    const restore = () =>
      sendEvent(page, {
        id: `evt_ui_back_${Date.now()}`,
        type: 'subscription.updated',
        customerId: `stub_cus_${org.id}`,
        status: 'active',
        planId: 'starter',
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
      })

    await sendEvent(page, {
      id: `evt_ui_${Date.now()}`,
      type: 'subscription.deleted',
      customerId: `stub_cus_${org.id}`,
    })
    try {
      await page.goto('/ingredients')
      await settled(page)
      await expect(
        page.getByRole('status').filter({ hasText: /subscription was canceled/i })
      ).toBeVisible()
      await page.getByRole('button', { name: /Add Ingredient/i }).click()
      await dialog(page).getByLabel(/^Name/).fill(`Billing probe ${Date.now()}`)
      await dialog(page)
        .getByLabel(/Cost per unit/)
        .fill('1')
      await dialog(page).getByRole('button', { name: 'Add Ingredient' }).click()
      // The banner and the toast both carry the sentence; the refusal is the second one.
      await expect(
        page.locator('[role="status"]').filter({ hasText: /changes are refused/i })
      ).toHaveCount(2)
      await expect(dialog(page)).toBeVisible()
      await page.keyboard.press('Escape')
    } finally {
      await restore()
    }
    await page.reload()
    await settled(page)
    await expect(
      page.getByRole('status').filter({ hasText: /subscription was canceled/i })
    ).toHaveCount(0)
  })
})

test.describe('Platform administration', () => {
  test('a platform administrator sees every tenant', async ({ page }) => {
    await signIn(page, { email: 'platform@nexus.app', password: 'Nexus_dev1' })

    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/organizations$/)
    await settled(page)

    expect(await dataRows(page).count()).toBeGreaterThan(1)
    await expect(page.getByRole('columnheader', { name: 'Organization' })).toBeVisible()

    await page.goto('/admin/queue')
    await settled(page)
    await expect(page.getByRole('heading', { name: 'Processing Queue' })).toBeVisible()
  })

  test('the queue screen reports the queue itself, delayed jobs included', async ({ page }) => {
    await signIn(page, { email: 'platform@nexus.app', password: 'Nexus_dev1' })
    await page.goto('/admin/queue')
    await settled(page)

    await expect(page.getByText('Delayed', { exact: true })).toBeVisible()
    await expect(page.getByText(/\d+ running, \d+ waiting/)).toBeVisible()
    await expect(page.getByText('The background queue is not answering')).toHaveCount(0)
  })

  test('the services screen says what each outside service runs on, and shows no key', async ({
    page,
  }) => {
    await signIn(page, { email: 'platform@nexus.app', password: 'Nexus_dev1' })
    await page.goto('/admin/queue')
    await settled(page)
    await page.getByRole('link', { name: 'Services', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/services$/)
    await settled(page)

    await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible()
    for (const service of [
      'Document reading',
      'File storage',
      'Email',
      'Subscription billing',
      'Error monitoring',
    ]) {
      await expect(page.getByRole('row', { name: new RegExp(service) })).toBeVisible()
    }
    const billing = page.getByRole('row', { name: /Subscription billing/ })
    await expect(billing).toContainText('No key')
    await expect(billing).toContainText('nothing is charged')
    await expect(page.locator('main')).not.toContainText(/sk_(test|live)_|whsec_/)
  })

  test('the job window carries that document, takes a correction and maps a name', async ({
    browser,
  }) => {
    const tenant = await browser.newContext()
    const tenantPage = await tenant.newPage()
    await signIn(tenantPage, ACCOUNTS.owner)
    await workAtFirstLocation(tenantPage)
    await tenantPage.goto('/documents')
    await tenantPage.getByLabel('Document type').selectOption('invoice')

    const stamp = Date.now()
    const vendor = `Probe Vendor ${stamp}`
    const rawName = `Probe Admin Wording ${stamp}`
    const fileName = `admin-ui-${stamp}.json`
    await tenantPage.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          vendorName: vendor,
          number: `UI-ADMIN-${stamp}`,
          items: [{ rawName, quantity: 1, unit: 'kg', unitPrice: 4 }],
        })
      ),
    })
    const uploaded = tenantPage.locator('tbody tr').filter({ hasText: fileName })
    await expect(uploaded.getByText('Requires Review')).toBeVisible({ timeout: 20000 })

    const admin = await browser.newContext()
    const adminPage = await admin.newPage()
    await signIn(adminPage, { email: 'platform@nexus.app', password: 'Nexus_dev1' })
    await adminPage.goto('/admin/queue')
    await settled(adminPage)

    const job = adminPage.locator('tbody tr').filter({ hasText: fileName })
    await job.getByRole('button', { name: 'Details' }).click()
    const window = dialog(adminPage)

    // The values belong to this document, not to a sample printed for every job.
    await expect(window.getByLabel('Vendor')).toHaveValue(vendor)

    await window.getByLabel('Invoice number').fill('CORRECTED-BY-ADMIN')
    await window.getByRole('button', { name: 'Save corrections' }).click()
    await expectToast(adminPage, /Corrections saved/i)

    await window.getByRole('button', { name: 'Close' }).last().click()
    await job.getByRole('button', { name: 'Details' }).click()
    await expect(window.getByLabel('Invoice number')).toHaveValue('CORRECTED-BY-ADMIN')

    const unresolved = window.locator('tbody tr').filter({ hasText: rawName })
    await expect(unresolved).toBeVisible()
    await unresolved.locator('select').selectOption({ label: 'Unsalted Butter' })
    await expectToast(adminPage, /mapped/i)
    await expect(unresolved).toHaveCount(0)

    await tenantPage.goto('/ingredients/mapping')
    await settled(tenantPage)
    const alias = tenantPage.locator('tbody tr').filter({ hasText: rawName })
    await alias.getByRole('button', { name: 'Remove' }).click()
    await dialog(tenantPage).getByRole('button', { name: 'Remove' }).click()
    await expectToast(tenantPage, /removed/i)

    await tenantPage.goto('/documents')
    await settled(tenantPage)
    const row = tenantPage.locator('tbody tr').filter({ hasText: fileName })
    await row.getByRole('button', { name: 'Delete' }).click()
    await dialog(tenantPage).getByRole('button', { name: 'Delete' }).click()
    await expectToast(tenantPage, /deleted/i)

    await tenant.close()
    await admin.close()
  })

  test('the job window corrects a whole menu: its name and its dishes', async ({ browser }) => {
    const tenant = await browser.newContext()
    const tenantPage = await tenant.newPage()
    await signIn(tenantPage, ACCOUNTS.owner)
    await workAtFirstLocation(tenantPage)
    await tenantPage.goto('/documents')
    await tenantPage.getByLabel('Document type').selectOption('menu')

    const stamp = Date.now()
    const fileName = `admin-menu-${stamp}.json`
    await tenantPage.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'menu',
          name: `Probe Lunch ${stamp}`,
          items: [
            { name: `Probe Soup ${stamp}`, price: 7, section: 'Starters' },
            { name: `Probe Stew ${stamp}`, price: 15, section: 'Mains' },
          ],
        })
      ),
    })
    const uploaded = tenantPage.locator('tbody tr').filter({ hasText: fileName })
    await expect(uploaded.getByText('Requires Review')).toBeVisible({ timeout: 20000 })

    const admin = await browser.newContext()
    const adminPage = await admin.newPage()
    await signIn(adminPage, { email: 'platform@nexus.app', password: 'Nexus_dev1' })
    await adminPage.goto('/admin/queue')
    await settled(adminPage)

    const job = adminPage.locator('tbody tr').filter({ hasText: fileName })
    await job.getByRole('button', { name: 'Details' }).click()
    const window = dialog(adminPage)

    await expect(window.getByLabel('Menu name')).toHaveValue(`Probe Lunch ${stamp}`)
    await expect(window.getByLabel('Dish 2', { exact: true })).toHaveValue(`Probe Stew ${stamp}`)

    await window.getByLabel('Menu name').fill(`Probe Dinner ${stamp}`)
    await window.getByRole('button', { name: 'Remove dish' }).first().click()
    await window.getByRole('button', { name: 'Add dish' }).click()
    await window.getByLabel('Dish 2', { exact: true }).fill(`Probe Tart ${stamp}`)
    await window.getByLabel('Price of dish 2').fill('6')
    await window.getByRole('button', { name: 'Save corrections' }).click()
    await expectToast(adminPage, /Corrections saved/i)

    await window.getByRole('button', { name: 'Close' }).last().click()
    await job.getByRole('button', { name: 'Details' }).click()
    await expect(window.getByLabel('Menu name')).toHaveValue(`Probe Dinner ${stamp}`)
    await expect(window.getByLabel('Dish 1', { exact: true })).toHaveValue(`Probe Stew ${stamp}`)
    await expect(window.getByLabel('Dish 2', { exact: true })).toHaveValue(`Probe Tart ${stamp}`)
    await expect(window.getByLabel('Price of dish 2')).toHaveValue('6')
    await expect(window.getByLabel('Dish 3', { exact: true })).toHaveCount(0)

    await tenantPage.goto('/documents')
    await settled(tenantPage)
    const row = tenantPage.locator('tbody tr').filter({ hasText: fileName })
    await row.getByRole('button', { name: 'Delete' }).click()
    await dialog(tenantPage).getByRole('button', { name: 'Delete' }).click()
    await expectToast(tenantPage, /deleted/i)

    await tenant.close()
    await admin.close()
  })

  test('an organization opens from its row with its locations, members and subscription', async ({
    page,
  }) => {
    await signIn(page, { email: 'platform@nexus.app', password: 'Nexus_dev1' })
    await page.goto('/admin/organizations')
    await settled(page)

    const listed = page.locator('tbody tr').filter({ hasText: 'The Golden Fork Group' })
    await expect(page.getByRole('columnheader', { name: 'Plan' })).toBeVisible()
    await expect(listed).toContainText(/Trial|Starter|Professional|Enterprise/)
    await expect(listed).toContainText(/Trial ends|Period ends/)

    await page.getByRole('link', { name: 'The Golden Fork Group' }).click()
    await expect(page).toHaveURL(/\/admin\/organizations\/[a-z0-9]+$/)
    await settled(page)

    await expect(page.getByRole('heading', { name: 'The Golden Fork Group' })).toBeVisible()
    await expect(page.getByText('Subscription', { exact: true })).toBeVisible()
    await expect(page.getByText('Plan', { exact: true })).toBeVisible()
    await expect(page.getByText('Billed locations', { exact: true })).toBeVisible()
    await expect(page.getByText(/^(Trial ends|Period ends) /)).toBeVisible()
    await expect(page.getByRole('cell', { name: /Golden Fork — Airport/ })).toBeVisible()
    // The closed reset-link dialogs carry the emails too, so read the rows, not the page.
    await expect(page.locator('tbody tr').filter({ hasText: 'ken@goldenfork.com' })).toHaveCount(1)

    // The owner is deactivated with the organization, never on their own.
    const ownerRow = page.locator('tbody tr').filter({ hasText: 'owner@goldenfork.com' })
    await expect(ownerRow).toHaveCount(1)
    await expect(ownerRow.getByRole('button', { name: 'Deactivate' })).toHaveCount(0)
    await expect(ownerRow.getByRole('button', { name: 'Reset password' })).toBeVisible()
  })

  test('deactivating an organization asks first and names the consequence', async ({ page }) => {
    await signIn(page, { email: 'platform@nexus.app', password: 'Nexus_dev1' })
    await page.goto('/admin/organizations')
    await settled(page)
    await page.getByRole('link', { name: 'The Golden Fork Group' }).click()
    await settled(page)

    await page.getByRole('button', { name: 'Deactivate organization' }).click()
    await expect(dialog(page)).toContainText(/signed out immediately/i)
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()

    await expect(page.getByRole('button', { name: 'Deactivate organization' })).toBeVisible()
  })

  test('an account is found across organizations and can be deactivated and brought back', async ({
    page,
  }) => {
    await signIn(page, { email: 'platform@nexus.app', password: 'Nexus_dev1' })
    await page.goto('/admin/users')
    await settled(page)

    await page.getByLabel('Search users').fill('ken@goldenfork')
    const row = page.locator('tbody tr').filter({ hasText: 'ken@goldenfork.com' })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('The Golden Fork Group')
    await expect(row.getByText('Active', { exact: true })).toBeVisible()

    await row.getByRole('button', { name: 'Deactivate' }).click()
    await expect(dialog(page)).toContainText(/cannot sign in until/i)
    await dialog(page).getByRole('button', { name: 'Deactivate' }).click()
    await expectToast(page, /deactivated/i)
    await expect(row.getByText('Deactivated', { exact: true })).toBeVisible()

    await row.getByRole('button', { name: 'Reactivate' }).click()
    await expectToast(page, /can sign in again/i)
    await expect(row.getByText('Active', { exact: true })).toBeVisible()
  })

  test('a reset link is handed to the administrator when no mail provider is connected', async ({
    page,
  }) => {
    await signIn(page, { email: 'platform@nexus.app', password: 'Nexus_dev1' })
    await page.goto('/admin/users')
    await settled(page)

    await page.getByLabel('Search users').fill('maria@goldenfork')
    const row = page.locator('tbody tr').filter({ hasText: 'maria@goldenfork.com' })
    await row.getByRole('button', { name: 'Reset password' }).click()
    await expect(dialog(page)).toContainText(/reset link/i)
    expect(await dialog(page).getByLabel('Reset link').inputValue()).toContain(
      '/reset-password?token='
    )
    await dialog(page).getByRole('button', { name: 'Close' }).last().click()
  })
})

test.describe('A property keeps what its form says', () => {
  test('a cleared address and phone are cleared on the server too', async ({ page }) => {
    await signInAs(page, 'owner')
    const name = `Audit Cleared ${Date.now()}`
    const made = await page.request.post(apiUrl('/api/locations'), {
      data: { name, address: '1 Pier Road', phone: '555-0100' },
    })
    expect(made.ok()).toBeTruthy()
    const { id } = (await made.json()) as { id: string }
    try {
      await page.goto('/settings/properties')
      await settled(page)
      const card = () =>
        page.getByRole('heading', { name, exact: true }).locator('xpath=ancestor::*[.//button][1]')
      await expect(card()).toContainText('1 Pier Road')
      await card().getByRole('button', { name: 'Edit' }).click()
      await dialog(page).getByLabel('Address').fill('')
      await dialog(page).getByLabel('Phone').fill('')
      await dialog(page).getByRole('button', { name: 'Save Property' }).click()
      await expectToast(page, /Property updated/)
      await page.reload()
      await settled(page)
      await expect(card()).not.toContainText('1 Pier Road')
      await expect(card()).not.toContainText('555-0100')
    } finally {
      await page.request.delete(apiUrl(`/api/locations/${id}`))
    }
  })
})
