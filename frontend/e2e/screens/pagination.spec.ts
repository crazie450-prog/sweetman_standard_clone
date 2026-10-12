import { expect, test } from '@playwright/test'
import { apiGet, apiUrl, settled, signIn, signInAs, workAtFirstLocation } from '../helpers'

test.describe('Lists that grow are read a page at a time', () => {
  test('draft orders page forward and back, and the pager says where it stands', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const locationId = await workAtFirstLocation(page)
    const here = { 'X-Location-Id': locationId }
    const recommended = await page.request.get(apiUrl('/api/purchasing/recommendations'), {
      headers: here,
    })
    const { rows } = (await recommended.json()) as { rows: { ingredientId: string }[] }
    expect(rows.length, 'the location has something to order').toBeGreaterThan(0)

    const before = (
      (await (
        await page.request.get(apiUrl('/api/purchasing/drafts?limit=1'), { headers: here })
      ).json()) as { pagination: { total: number } }
    ).pagination.total
    const made: string[] = []
    try {
      while (before + made.length <= 50) {
        const res = await page.request.post(apiUrl('/api/purchasing/drafts'), {
          headers: here,
          data: { lines: [{ ingredientId: rows[0].ingredientId, quantity: 1 }] },
        })
        expect(res.ok()).toBeTruthy()
        made.push(...((await res.json()) as { id: string }[]).map((d) => d.id))
      }
      const total = before + made.length

      await page.goto('/purchasing')
      await settled(page)
      const pager = page.getByRole('navigation', { name: 'Draft order pages' })
      await expect(pager).toContainText(`1 to 50 of ${total}`)
      await expect(pager.getByRole('button', { name: 'Previous' })).toBeDisabled()
      const firstPage = await page.locator('tbody tr').count()

      await pager.getByRole('button', { name: 'Next' }).click()
      await expect(pager).toContainText(`51 to ${total} of ${total}`)
      await expect(pager.getByRole('button', { name: 'Next' })).toBeDisabled()

      await pager.getByRole('button', { name: 'Previous' }).click()
      await expect(pager).toContainText(`1 to 50 of ${total}`)
      expect(firstPage).toBeGreaterThanOrEqual(50)
    } finally {
      for (const id of made) {
        await page.request.delete(apiUrl(`/api/purchasing/drafts/${id}`), { headers: here })
      }
    }
  })

  test('choosing a document type asks the server for that type instead of filtering a page', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await settled(page)
    const asked = page.waitForRequest(
      (r) => r.url().includes('/api/documents?') && r.url().includes('type=recipe')
    )
    const counted = page.waitForRequest(
      (r) => r.url().includes('/api/documents/summary') && r.url().includes('type=recipe')
    )
    await page.getByLabel('Show').selectOption('recipe')
    await asked
    await counted
  })

  test('sold items are filtered and sorted by the server across every page', async ({ page }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/sales')
    await settled(page)
    await page.getByRole('tab', { name: 'Individual Sales' }).click()

    const ranged = page.waitForRequest(
      (r) => r.url().includes('/api/sales?') && r.url().includes('minTotal=20')
    )
    await page.getByLabel(/^Min Revenue/).fill('20')
    await ranged

    const sorted = page.waitForRequest(
      (r) => r.url().includes('/api/sales?') && r.url().includes('sort=total')
    )
    await page.getByLabel('Sort by').selectOption('revenue')
    await sorted
  })

  test('the inventory totals on the reports screen cover the whole period, not the page shown', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    const summary = page.waitForResponse(
      (r) => r.url().includes('/api/inventory/transactions/summary') && r.ok()
    )
    await page.goto('/reports')
    await settled(page)
    const totals = (await (await summary).json()) as { received: number; wasted: number }
    const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    await expect(page.getByText(money.format(totals.received)).first()).toBeVisible()
    await expect(page.getByText(money.format(totals.wasted)).first()).toBeVisible()
  })

  test('the admin queue counts every job, not only those on the page', async ({ page }) => {
    await signIn(page, { email: 'platform@nexus.app', password: 'Nexus_dev1' })
    const counts = await apiGet<{ total: number }>(page, '/api/admin/queue/summary')
    await page.goto('/admin/queue')
    await settled(page)
    const card = page.locator('p', { hasText: /^Total jobs$/ }).locator('xpath=../..')
    await expect(card).toContainText(String(counts.total))
  })
})
