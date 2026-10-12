import { expect, test } from '@playwright/test'
import { apiGet, apiUrl, dialog, expectToast, settled, signInAs } from '../helpers'

test.describe('A refusal reaches the person in words, whatever its code', () => {
  test('a field the server refuses is named in the toast, every field of it', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.route('**/api/vendors', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Validation failed',
                details: [
                  { field: 'email', message: 'email must be an email' },
                  {
                    field: 'phone',
                    message: 'phone must be shorter than or equal to 40 characters',
                  },
                ],
              },
            },
          })
        : route.continue()
    )
    await page.goto('/vendors')
    await settled(page)
    await page.getByRole('button', { name: 'Add Vendor' }).click()
    await dialog(page).getByLabel('Vendor name').fill(`Refused Vendor ${Date.now()}`)
    await dialog(page).getByRole('button', { name: 'Add Vendor' }).click()
    await expectToast(
      page,
      'email must be an email. phone must be shorter than or equal to 40 characters'
    )
  })

  test('a rule the server holds is told in its own sentence', async ({ page }) => {
    await signInAs(page, 'owner')
    const name = `Twin Vendor ${Date.now()}`
    const first = await page.request.post(apiUrl('/api/vendors'), { data: { name } })
    expect(first.ok()).toBeTruthy()
    const twin = await page.request.post(apiUrl('/api/vendors'), { data: { name } })
    expect(twin.status()).toBe(409)
    const body = (await twin.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toMatch(/^[A-Z_]+$/)

    try {
      await page.goto('/vendors')
      await settled(page)
      await page.getByRole('button', { name: 'Add Vendor' }).click()
      await dialog(page).getByLabel('Vendor name').fill(name)
      await dialog(page).getByRole('button', { name: 'Add Vendor' }).click()
      await expectToast(page, body.error.message)
    } finally {
      const made = (await apiGet<{ id: string; name: string }[]>(page, '/api/vendors')).filter(
        (v) => v.name === name
      )
      for (const v of made) await page.request.delete(apiUrl(`/api/vendors/${v.id}`))
    }
  })
})
