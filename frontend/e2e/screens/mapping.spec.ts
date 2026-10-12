import { test, expect } from '@playwright/test'
import {
  signIn,
  ACCOUNTS,
  workAtFirstLocation,
  dialog,
  expectToast,
  settled,
  apiGet,
  apiUrl,
} from '../helpers'

test.describe('Ingredient mapping', () => {
  test('a name a document reached no ingredient by waits here until it is mapped', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('invoice')

    const rawName = `Vendor Wording ${Date.now()}`
    const fileName = `park-${Date.now()}.json`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number: `UI-MAP-${Date.now()}`,
          items: [{ rawName, quantity: 1, unit: 'kg', unitPrice: 6 }],
        })
      ),
    })

    const document = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(document.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await document.getByRole('button', { name: 'Review' }).click()
    await dialog(page)
      .getByRole('button', { name: /Confirm/ })
      .click()
    await expectToast(page, /applied/i)
    await expect(document.getByText('Partially Processed')).toBeVisible({ timeout: 15000 })

    await page.goto('/ingredients/mapping')
    await settled(page)
    const row = page.locator('tbody tr').filter({ hasText: rawName })
    await expect(row).toBeVisible()
    await expect(row.getByText('Unmapped')).toBeVisible()
    await expect(row.locator('td').nth(1)).toHaveText('1')

    await row.locator('select').selectOption({ label: 'Unsalted Butter' })
    await expectToast(page, /Unsalted Butter/)

    await page.reload()
    await settled(page)
    await expect(row.getByText('Unmapped')).toHaveCount(0)
    await expect(row.locator('select')).not.toHaveValue('')

    await row.getByRole('button', { name: 'Remove' }).click()
    await dialog(page).getByRole('button', { name: 'Remove' }).click()
    await expectToast(page, /removed/i)
    await expect(row).toHaveCount(0)
  })

  test('a name can be recorded before any document carries it', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/ingredients/mapping')
    await settled(page)

    const rawName = `Known Wording ${Date.now()}`
    await page.getByRole('button', { name: '+ Add Name' }).first().click()
    await dialog(page).getByLabel('Name on documents').fill(rawName)
    await dialog(page).getByLabel('Reads as').selectOption({ label: 'All-Purpose Flour' })
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    await expectToast(page, /added/i)

    const row = page.locator('tbody tr').filter({ hasText: rawName })
    await expect(row).toBeVisible()
    await expect(row.getByText('Unmapped')).toHaveCount(0)
    await expect(row.locator('td').nth(1)).toHaveText('—')

    await row.getByRole('button', { name: 'Remove' }).click()
    await dialog(page).getByRole('button', { name: 'Remove' }).click()
    await expectToast(page, /removed/i)
    await expect(row).toHaveCount(0)
  })
  test('a mapped name keeps naming its ingredient after that ingredient is archived', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)

    const ingredients = await apiGet<{ id: string; name: string }[]>(page, '/api/ingredients')
    const target = ingredients.find((i) => i.name === 'San Marzano Tomatoes')!
    const rawName = `Archived Reading ${Date.now()}`

    await page.goto('/ingredients/mapping')
    await settled(page)
    await page.getByRole('button', { name: '+ Add Name' }).first().click()
    await dialog(page).getByLabel('Name on documents').fill(rawName)
    await dialog(page).getByLabel('Reads as').selectOption({ label: target.name })
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    await expectToast(page, /added/i)

    const archived = await page.request.patch(apiUrl(`/api/ingredients/${target.id}`), {
      data: { isActive: false },
    })
    expect(archived.ok(), 'the ingredient is archived').toBeTruthy()

    const row = page.locator('tbody tr').filter({ hasText: rawName })
    try {
      await page.reload()
      await settled(page)
      await expect(row.getByText('Unmapped')).toHaveCount(0)
      await expect(row.locator('select')).toHaveValue(target.id)
    } finally {
      await page.request.patch(apiUrl(`/api/ingredients/${target.id}`), {
        data: { isActive: true },
      })
      await page.reload()
      await settled(page)
      await row.getByRole('button', { name: 'Remove' }).click()
      await dialog(page).getByRole('button', { name: 'Remove' }).click()
      await expectToast(page, /removed/i)
    }
  })
})

test.describe('Sales mapping', () => {
  test('a dish name a sales file reached no menu item by waits here until it is mapped', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('sales')

    const rawName = `POS WORDING ${Date.now()}`
    const fileName = `sales-park-${Date.now()}.json`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'sales',
          date: '2026-09-03',
          items: [{ menuItemName: rawName, quantity: 1, unitPrice: 12 }],
        })
      ),
    })

    const document = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(document.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await document.getByRole('button', { name: 'Review' }).click()
    await dialog(page)
      .getByRole('button', { name: /Confirm/ })
      .click()
    await expectToast(page, /applied/i)

    await page.goto('/menu/mapping')
    await settled(page)
    const row = page.locator('tbody tr').filter({ hasText: rawName })
    await expect(row).toBeVisible()
    await expect(row.getByText('Unmapped')).toBeVisible()

    await row.locator('select').selectOption({ index: 1 })
    await expectToast(page, /now reads as/i)

    await page.reload()
    await settled(page)
    await expect(row.getByText('Unmapped')).toHaveCount(0)

    await row.getByRole('button', { name: 'Remove' }).click()
    await dialog(page).getByRole('button', { name: 'Remove' }).click()
    await expectToast(page, /removed/i)
    await expect(row).toHaveCount(0)
  })
})

test.describe('Sales mapping follows the location a name was parked at', () => {
  test('a name parked at Downtown is offered no dish sold only at the airport', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    const locations = await apiGet<{ id: string; name: string }[]>(page, '/api/properties')
    const airport = locations.find((l) => l.name.includes('Airport'))!
    const downtown = locations.find((l) => l.name.includes('Downtown'))!
    const stamp = Date.now()
    const dish = await page.request.post(apiUrl('/api/menu-items'), {
      data: { name: `Probe Airport Burger ${stamp}`, price: 9, locationId: airport.id },
    })
    expect(dish.ok()).toBeTruthy()
    const dishId = ((await dish.json()) as { id: string }).id
    const rawName = `PROBE DOWNTOWN NAME ${stamp}`
    const parked = await page.request.post(apiUrl('/api/documents/menu-item-aliases'), {
      headers: { 'X-Location-Id': downtown.id },
      data: { rawName },
    })
    expect(parked.ok()).toBeTruthy()
    const aliasId = ((await parked.json()) as { id: string }).id
    try {
      await page.evaluate(() => window.localStorage.removeItem('nexus.locationId'))
      await page.goto('/menu/mapping')
      await settled(page)
      const row = page.locator('tbody tr').filter({ hasText: rawName })
      await expect(row).toContainText('Golden Fork — Downtown')
      const offered = await row.locator('select option').allTextContents()
      expect(offered).toContain('Steak Frites')
      expect(offered).not.toContain(`Probe Airport Burger ${stamp}`)
    } finally {
      await page.request.delete(apiUrl(`/api/documents/menu-item-aliases/${aliasId}`))
      await page.request.delete(apiUrl(`/api/menu-items/${dishId}`))
    }
  })
})
