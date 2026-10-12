import { expect, test } from '@playwright/test'
import { apiGet, apiUrl, settled, signIn } from '../helpers'

test.describe('A new organization signs itself up', () => {
  test('the form creates the organization, signs its owner in, and an address already taken is told so', async ({
    page,
  }) => {
    const stamp = Date.now()
    const organization = `Signup Probe ${stamp}`
    const email = `signup.${stamp}@example.com`
    const fill = async () => {
      await page.getByLabel('Organization name').fill(organization)
      await page.getByLabel('Your full name').fill('Signup Owner')
      await page.getByLabel('Email').fill(email)
      await page.getByLabel('Password').fill('Signup_pass1')
      await page.getByRole('button', { name: 'Create Organization' }).click()
    }

    try {
      await page.goto('/signup')
      await expect(page.getByRole('heading', { name: 'Create your organization' })).toBeVisible()
      await fill()
      await page.waitForURL('**/dashboard', { timeout: 15000 })
      await settled(page)
      await expect(page.getByRole('banner')).toContainText('Signup Owner')
      const me = await apiGet<{ role: string; organizationName: string }>(page, '/api/auth/me')
      expect(me.role).toBe('owner')
      expect(me.organizationName).toBe(organization)

      await page.context().clearCookies()
      await page.goto('/signup')
      await fill()
      await expect(page.getByText('An account with this email already exists.')).toBeVisible()
      await expect(page).toHaveURL(/\/signup$/)
    } finally {
      await page.context().clearCookies()
      await signIn(page, { email: 'platform@nexus.app', password: 'Nexus_dev1' })
      const found = await apiGet<{ data: { id: string; name: string; isActive: boolean }[] }>(
        page,
        `/api/admin/organizations?q=${encodeURIComponent(organization)}`
      )
      for (const org of found.data.filter((o) => o.name === organization && o.isActive)) {
        await page.request.patch(apiUrl(`/api/admin/organizations/${org.id}`), {
          data: { isActive: false },
        })
      }
    }
  })

  test('a refusal other than a taken address names what the server found', async ({ page }) => {
    const reason = 'organizationName should not be empty'
    await page.route('**/api/auth/register', (route) =>
      route.fulfill({
        status: 400,
        json: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: [{ field: 'organizationName', message: reason }],
          },
        },
      })
    )
    await page.goto('/signup')
    await page.getByLabel('Organization name').fill('Probe')
    await page.getByLabel('Your full name').fill('Signup Owner')
    await page.getByLabel('Email').fill('signup.refused@example.com')
    await page.getByLabel('Password').fill('Signup_pass1')
    await page.getByRole('button', { name: 'Create Organization' }).click()
    await expect(page.getByText(reason)).toBeVisible()
    await expect(page).toHaveURL(/\/signup$/)
  })
})
