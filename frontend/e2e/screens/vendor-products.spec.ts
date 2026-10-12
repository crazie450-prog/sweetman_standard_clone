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
  apiRows,
} from '../helpers'

test.describe('Vendor products', () => {
  test('a name an invoice from a known vendor reached no ingredient by waits in that catalogue', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('invoice')

    const rawName = `DD WORDING ${Date.now()}`
    const fileName = `vendor-park-${Date.now()}.json`
    const number = `UI-VP-${Date.now()}`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number,
          vendorName: 'Dairy Direct',
          items: [{ rawName, sku: 'DD-9999', quantity: 1, unit: 'kg', unitPrice: 6 }],
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

    await page.goto('/vendors/products')
    await settled(page)
    await page.getByLabel('Vendor').first().selectOption({ label: 'Dairy Direct' })

    const row = page.locator('tbody tr').filter({ hasText: rawName })
    await expect(row).toBeVisible()
    await expect(row.getByText('Unmapped', { exact: true })).toBeVisible()
    await expect(row.locator('td').nth(0)).toHaveText('Dairy Direct')
    await expect(row.locator('td').nth(2)).toHaveText('DD-9999')

    await row.locator('select').selectOption({ label: 'Unsalted Butter' })
    await expectToast(page, /Unsalted Butter/)

    await page.reload()
    await settled(page)
    await page.getByLabel('Vendor').first().selectOption({ label: 'Dairy Direct' })
    await expect(row.getByText('Unmapped', { exact: true })).toHaveCount(0)

    await row.getByRole('button', { name: 'Remove' }).click()
    await dialog(page).getByRole('button', { name: 'Remove' }).click()
    await expectToast(page, /removed/i)
    await expect(row).toHaveCount(0)

    const invoices = await apiRows<{ id: string; number: string | null }>(page, '/api/invoices')
    const written = invoices.find((i) => i.number === number)
    const kept = await page.request.delete(apiUrl(`/api/invoices/${written!.id}`))
    expect(kept.status(), 'the invoice a confirm left is the record of what it moved').toBe(409)
  })

  test('two vendors may sell a product of the same name, one vendor may not', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/vendors/products')
    await settled(page)

    const name = `Shared Wording ${Date.now()}`
    const add = async (vendor: string) => {
      await page.getByRole('button', { name: '+ Add Product' }).first().click()
      await dialog(page).getByLabel('Vendor').selectOption({ label: vendor })
      await dialog(page).getByLabel('Product name').fill(name)
      await dialog(page).getByRole('button', { name: 'Save' }).click()
    }

    await add('Dairy Direct')
    await expectToast(page, /added/i)
    await add('Prime Meats Co.')
    await expectToast(page, /added/i)
    await add('Dairy Direct')
    await expectToast(page, /already sells/i)
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()

    const rows = page.locator('tbody tr').filter({ hasText: name })
    await expect(rows).toHaveCount(2)

    for (const vendor of ['Dairy Direct', 'Prime Meats Co.']) {
      const row = rows.filter({ hasText: vendor })
      await row.getByRole('button', { name: 'Remove' }).click()
      await dialog(page).getByRole('button', { name: 'Remove' }).click()
      await expectToast(page, /removed/i)
    }
    await expect(rows).toHaveCount(0)
  })

  test('a product keeps naming the ingredient it maps to after that ingredient is archived', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)

    const ingredients = await apiGet<{ id: string; name: string }[]>(page, '/api/ingredients')
    const target = ingredients.find((i) => i.name === 'Button Mushrooms')!

    const name = `Archived Basis ${Date.now()}`
    await page.goto('/vendors/products')
    await settled(page)
    await page.getByRole('button', { name: '+ Add Product' }).first().click()
    await dialog(page).getByLabel('Vendor').selectOption({ label: 'Dairy Direct' })
    await dialog(page).getByLabel('Product name').fill(name)
    await dialog(page).getByLabel('Received as').selectOption({ label: target.name })
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    await expectToast(page, /added/i)

    const archived = await page.request.patch(apiUrl(`/api/ingredients/${target.id}`), {
      data: { isActive: false },
    })
    expect(archived.ok(), 'the ingredient is archived').toBeTruthy()

    try {
      await page.reload()
      await settled(page)
      const row = page.locator('tbody tr').filter({ hasText: name })
      await expect(row.getByText('Unmapped', { exact: true })).toHaveCount(0)
      await expect(row.locator('select')).toHaveValue(target.id)
    } finally {
      await page.request.patch(apiUrl(`/api/ingredients/${target.id}`), {
        data: { isActive: true },
      })
      const row = page.locator('tbody tr').filter({ hasText: name })
      await page.reload()
      await settled(page)
      await row.getByRole('button', { name: 'Remove' }).click()
      await dialog(page).getByRole('button', { name: 'Remove' }).click()
      await expectToast(page, /removed/i)
    }
  })

  test('a product the vendor stopped selling is marked inactive and back again', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    const vendors = await apiGet<{ id: string; name: string }[]>(page, '/api/vendors')
    const vendor = vendors.find((v) => v.name === 'Dairy Direct')!
    const name = `Probe Seasonal ${Date.now()}`
    const res = await page.request.post(apiUrl('/api/vendor-products'), {
      data: { name, vendorId: vendor.id },
    })
    expect(res.ok()).toBeTruthy()
    const { id } = (await res.json()) as { id: string }
    const active = async () =>
      (await apiGet<{ id: string; isActive: boolean }[]>(page, '/api/vendor-products')).find(
        (p) => p.id === id
      )?.isActive
    try {
      await page.goto('/vendors/products')
      await settled(page)
      const row = page.locator('tbody tr').filter({ hasText: name })
      await expect(row.getByText('Inactive', { exact: true })).toHaveCount(0)

      await row.getByRole('button', { name: 'Deactivate' }).click()
      await expectToast(page, new RegExp(`${name} is inactive`))
      await expect(row.getByText('Inactive', { exact: true })).toBeVisible()
      expect(await active()).toBe(false)

      await row.getByRole('button', { name: 'Activate', exact: true }).click()
      await expectToast(page, new RegExp(`${name} is active again`))
      await expect(row.getByText('Inactive', { exact: true })).toHaveCount(0)
      expect(await active()).toBe(true)
    } finally {
      await page.request.delete(apiUrl(`/api/vendor-products/${id}`))
    }
  })

  test('the vendors screen counts products and ingredients apart', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/vendors')
    await settled(page)

    const row = page.locator('tbody tr').filter({ hasText: 'Dairy Direct' })
    await expect(row.locator('td').nth(2)).toHaveText('2')
    await expect(row.locator('td').nth(3)).toHaveText('3')
  })
})
