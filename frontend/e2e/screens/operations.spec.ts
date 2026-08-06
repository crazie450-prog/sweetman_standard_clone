import { expect, test } from '@playwright/test'
import {
  apiUrl,
  dataRows,
  dialog,
  expectToast,
  onHandOf,
  settled,
  signInAs,
  workAtFirstLocation,
} from '../helpers'

test.describe('What moves stock', () => {
  test('waste reduces the stock it names', async ({ page }) => {
    await signInAs(page, 'owner')
    const locationId = await workAtFirstLocation(page)
    const before = await onHandOf(page, 'San Marzano Tomatoes')

    await page.goto('/waste')
    await settled(page)
    await page.getByRole('button', { name: /San Marzano Tomatoes/ }).click()
    await page.getByLabel('Quantity').fill('1.5')
    await page.getByLabel('Reason').selectOption({ index: 1 })
    await page.getByRole('button', { name: 'Log Waste' }).click()
    await expectToast(page, /Waste logged/i)

    expect(await onHandOf(page, 'San Marzano Tomatoes')).toBeCloseTo(before - 1.5, 2)

    const ingredients = await page.request.get(apiUrl('/api/ingredients'))
    const id = ((await ingredients.json()) as { id: string; name: string }[]).find(
      (i) => i.name === 'San Marzano Tomatoes'
    )!.id
    await page.request.post(apiUrl('/api/inventory/transactions'), {
      headers: { 'X-Location-Id': locationId },
      data: { ingredientId: id, type: 'RECEIVE', quantity: 1.5 },
    })
    expect(await onHandOf(page, 'San Marzano Tomatoes')).toBeCloseTo(before, 2)
  })

  test('waste refuses an entry without a reason', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/waste')
    await settled(page)
    await page.getByRole('button', { name: /Heavy Cream/ }).click()
    await page.getByLabel('Quantity').fill('1')
    await page.getByRole('button', { name: 'Log Waste' }).click()
    await expectToast(page, /quantity and reason/i)
  })

  test('a sale is recorded without touching stock', async ({ page }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    const before = await onHandOf(page, 'Beef Tenderloin')

    await page.goto('/sales')
    await settled(page)
    await page.getByRole('button', { name: /Record New Sale/i }).click()
    await dialog(page).locator('select').first().selectOption({ index: 1 })
    await dialog(page)
      .getByLabel(/quantity/i)
      .fill('1')
    await dialog(page).getByRole('button', { name: /record|save/i }).last().click()
    await expectToast(page, /Sale recorded/i)

    expect(
      await onHandOf(page, 'Beef Tenderloin'),
      'sales do not deduct stock until the costing engine ships'
    ).toBeCloseTo(before, 2)
  })

  test('a production batch is recorded without touching stock', async ({ page }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    const before = await onHandOf(page, 'Eggs')

    await page.goto('/production')
    await settled(page)
    const rowsBefore = await dataRows(page).count()

    await page.getByRole('button', { name: /Record Batch/i }).click()
    await dialog(page).locator('select').first().selectOption({ index: 1 })
    await dialog(page)
      .getByLabel(/quantity/i)
      .fill('2')
    await dialog(page).getByRole('button', { name: /record|save/i }).last().click()
    await expectToast(page, /batch recorded/i)

    await page.reload()
    await settled(page)
    await expect(dataRows(page)).toHaveCount(rowsBefore + 1, { timeout: 15000 })
    expect(await onHandOf(page, 'Eggs')).toBeCloseTo(before, 2)
  })
})

test.describe('Screens waiting for document processing', () => {
  test('the prep list explains why it is empty', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/prep-list')
    await settled(page)
    await page.getByRole('button', { name: 'Generate Prep List' }).click()
    await expect(page.locator('tbody')).toContainText(/arrive with the costing engine/i)
  })

  test('documents, pull sheets and sales exports announce themselves', async ({ page }) => {
    await signInAs(page, 'owner')

    await page.goto('/pull-sheets')
    await settled(page)
    await page.getByRole('button', { name: 'New Pull Sheet' }).first().click()
    await expectToast(page, /not available yet/i)
    await page.waitForTimeout(3200)

    await page.goto('/sales')
    await settled(page)
    await page.getByRole('button', { name: 'Export' }).click()
    await expectToast(page, /CSV export is not available yet/i)
    await page.waitForTimeout(3200)
    await page.getByRole('button', { name: 'Columns' }).click()
    await expectToast(page, /Column settings are not available yet/i)
  })

  test('the order guide import will not start without a file', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/import/order-guides')
    await settled(page)
    await expect(page.getByRole('button', { name: /Upload and Analyze/i })).toBeDisabled()
  })
})

test.describe('Sales screen', () => {
  test('period presets and filters narrow the table', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/sales')
    await settled(page)

    await page.getByRole('button', { name: 'Last 30 Days' }).click()
    await settled(page)
    const month = await dataRows(page).count()
    expect(month).toBeGreaterThan(7)

    await page.getByRole('button', { name: 'Last 7 Days' }).click()
    await settled(page)
    expect(await dataRows(page).count()).toBeLessThanOrEqual(8)

    await page.getByRole('button', { name: 'Last 30 Days' }).click()
    await settled(page)
    await page.getByLabel('Min Revenue ($)').fill('900')
    await page.waitForTimeout(800)
    const filtered = await dataRows(page).count()
    expect(filtered).toBeLessThan(month)

    await page.getByRole('button', { name: 'Clear Filters' }).click()
    await page.waitForTimeout(800)
    expect(await dataRows(page).count()).toBe(month)
  })

  test('individual sales list the item behind every line', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/sales')
    await settled(page)
    await page.getByRole('tab', { name: 'Individual Sales' }).click()
    await settled(page)

    await expect(page.getByRole('columnheader', { name: 'Menu Item' })).toBeVisible()
    expect(await dataRows(page).count()).toBeGreaterThan(0)
  })
})
