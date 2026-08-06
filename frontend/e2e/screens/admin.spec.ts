import { expect, test } from '@playwright/test'
import { dataRows, dialog, expectToast, locationOptions, settled, signIn, signInAs } from '../helpers'

test.describe('Team invitations and permissions', () => {
  test('an invitation can be sent, resent and revoked', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/team')
    await settled(page)

    const email = `invitee${Date.now()}@example.com`
    await page.getByRole('button', { name: 'Invite Member' }).click()
    await dialog(page).getByLabel(/email/i).fill(email)
    await dialog(page).locator('select').first().selectOption({ index: 1 })
    await dialog(page).locator('input[type=checkbox]').first().check()
    await dialog(page).getByRole('button', { name: /send|invite/i }).last().click()

    await page.reload()
    await settled(page)
    const row = dataRows(page).filter({ hasText: email })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Invited')

    await row.getByRole('button', { name: 'Resend' }).click()
    await expect(dialog(page)).toContainText(/invitation link/i)
    await dialog(page).getByRole('button', { name: /close|done/i }).last().click()

    await row.getByRole('button', { name: 'Revoke' }).click()
    await expectToast(page, /revoked/i)
    await page.reload()
    await settled(page)
    await expect(dataRows(page).filter({ hasText: email })).toHaveCount(0)
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
    await dialog(page).getByRole('button', { name: /cancel/i }).click()
  })

  test('deactivating a member asks first and says it is one-way', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/team')
    await settled(page)

    await dataRows(page)
      .filter({ hasText: 'Ken Tanaka' })
      .getByRole('button', { name: 'Deactivate' })
      .click()
    await expect(dialog(page)).toContainText(/new invitation brings them back/i)
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()

    await expect(dataRows(page).filter({ hasText: 'Ken Tanaka' })).toHaveCount(1)
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
    await page.getByRole('button', { name: /Add Property/i }).click()
    await dialog(page).getByLabel('Property name').fill(name)
    await dialog(page).getByRole('button', { name: 'Create Property' }).click()
    await page.reload()
    await settled(page)

    // The nearest ancestor that owns buttons is the card for this location.
    const card = () =>
      page.getByRole('heading', { name, exact: true }).locator('xpath=ancestor::*[.//button][1]')

    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    await expect.poll(() => locationOptions(page), { timeout: 15000 }).toContain(name)

    await card().getByRole('button', { name: 'Archive' }).click()
    await expect(dialog(page)).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Archive' }).click()
    await page.reload()
    await settled(page)

    await expect(card().getByText('Archived')).toBeVisible()
    await expect
      .poll(() => locationOptions(page), {
        message: 'an archived location cannot be switched to',
        timeout: 15000,
      })
      .not.toContain(name)

    await card().getByRole('button', { name: 'Restore' }).click()
    await page.reload()
    await settled(page)
    await expect.poll(() => locationOptions(page), { timeout: 15000 }).toContain(name)

    await card().getByRole('button', { name: 'Archive' }).click()
    await dialog(page).getByRole('button', { name: 'Archive' }).click()
  })
})

test.describe('Subscription', () => {
  test('the trial is counted from the record, and Stripe says it is not here yet', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/subscription')
    await settled(page)

    await expect(page.getByText(/Trial Active: \d+ days remaining/)).toBeVisible()
    await page.getByRole('button', { name: /Upgrade to Starter/ }).click()
    await expectToast(page, /Changing the plan is not available yet/i)
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
})
