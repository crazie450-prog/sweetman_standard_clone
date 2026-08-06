import { expect, test } from '@playwright/test'
import {
  dataRows,
  dialog,
  expectToast,
  onHandOf,
  settled,
  signInAs,
  workAtFirstLocation,
} from '../helpers'

test.describe('Vendors', () => {
  test('a vendor can be created, edited and deleted', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/vendors')
    await settled(page)

    const name = `Audit Vendor ${Date.now()}`
    await page.getByRole('button', { name: 'Add Vendor' }).click()
    await dialog(page).getByLabel('Vendor name').fill(name)
    await dialog(page).getByRole('button', { name: 'Add Vendor' }).click()
    await page.reload()
    await settled(page)
    await expect(dataRows(page).filter({ hasText: name })).toHaveCount(1)

    await dataRows(page).filter({ hasText: name }).getByRole('button', { name: 'Edit' }).click()
    await dialog(page).getByLabel('Vendor name').fill(`${name} renamed`)
    await dialog(page).getByRole('button', { name: 'Save Vendor' }).click()
    await page.reload()
    await settled(page)
    await expect(dataRows(page).filter({ hasText: `${name} renamed` })).toHaveCount(1)

    await dataRows(page)
      .filter({ hasText: `${name} renamed` })
      .getByRole('button', { name: 'Delete' })
      .click()
    await expect(dialog(page)).toContainText('This cannot be undone')
    await dialog(page).getByRole('button', { name: 'Delete' }).click()
    await page.reload()
    await settled(page)
    await expect(dataRows(page).filter({ hasText: name })).toHaveCount(0)
  })

  test('deleting a vendor names how many ingredients lose it', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/vendors')
    await settled(page)

    await dataRows(page).first().getByRole('button', { name: 'Delete' }).click()
    await expect(dialog(page)).toContainText(/\d+ ingredients? will keep their prices/)
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  })

  test('the table carries the last invoice date', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/vendors')
    await settled(page)
    await expect(page.getByRole('columnheader', { name: 'Last invoice' })).toBeVisible()
  })
})

test.describe('Ingredients', () => {
  test('price history records the vendor, the location and the source', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/ingredients')
    await settled(page)

    await dataRows(page)
      .filter({ hasText: 'Beef Tenderloin' })
      .getByRole('button', { name: 'Price history' })
      .click()

    const history = dialog(page)
    await expect(history).toContainText('Price history — Beef Tenderloin')
    for (const column of ['Date', 'Cost / unit', 'Vendor', 'Location', 'Source']) {
      await expect(history).toContainText(new RegExp(column, 'i'))
    }
    await expect(history.locator('tbody tr').first()).toBeVisible()
  })

  test('an ingredient a recipe uses refuses to be deleted', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/ingredients')
    await settled(page)

    await dataRows(page)
      .filter({ hasText: 'Beef Tenderloin' })
      .getByRole('button', { name: 'Delete' })
      .click()
    await dialog(page).getByRole('button', { name: 'Delete' }).click()
    await expectToast(page, /used in recipes and cannot be deleted/i)

    await page.reload()
    await settled(page)
    await expect(dataRows(page).filter({ hasText: 'Beef Tenderloin' })).toHaveCount(1)
  })

  test('a chef may add ingredients but not delete them', async ({ page }) => {
    await signInAs(page, 'staff')
    await page.goto('/ingredients')
    await settled(page)
    await expect(page.getByRole('button', { name: 'Add Ingredient' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0)
  })
})

test.describe('Inventory', () => {
  test('the three movement types land on the stock level', async ({ page }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/inventory')
    await settled(page)

    const start = await onHandOf(page, 'Unsalted Butter')

    const adjust = async (type: string, quantity: string) => {
      await dataRows(page)
        .filter({ hasText: 'Unsalted Butter' })
        .getByRole('button', { name: 'Adjust' })
        .click()
      await dialog(page).getByLabel('Type').selectOption({ label: type })
      await dialog(page)
        .getByLabel(/quantity/i)
        .fill(quantity)
      await dialog(page).getByRole('button', { name: 'Save Adjustment' }).click()
      await expectToast(page, /Stock updated/i)
      await page.waitForTimeout(500)
    }

    await adjust('Physical count', '10')
    expect(await onHandOf(page, 'Unsalted Butter')).toBe(10)

    await adjust('Received', '4')
    expect(await onHandOf(page, 'Unsalted Butter')).toBe(14)

    await adjust('Used', '1.5')
    expect(await onHandOf(page, 'Unsalted Butter')).toBe(12.5)

    await adjust('Physical count', String(start))
    expect(await onHandOf(page, 'Unsalted Butter')).toBe(start)
  })

  test('a negative count says what is wrong with it', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/inventory')
    await settled(page)

    await dataRows(page)
      .filter({ hasText: 'Eggs' })
      .getByRole('button', { name: 'Adjust' })
      .click()
    await dialog(page)
      .getByLabel(/counted quantity/i)
      .fill('-5')
    await dialog(page).getByRole('button', { name: 'Save Adjustment' }).click()
    await expectToast(page, /cannot be negative/i)
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  })

  test('the controls that belong to document processing say so', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/inventory')
    await settled(page)

    for (const [label, message] of [
      ['Reconcile Inventory', /invoice processing/i],
      ['Mobile Count', /not available yet/i],
      ['Find Duplicates', /document processing/i],
    ] as const) {
      await page.getByRole('button', { name: label }).click()
      await expectToast(page, message)
      await page.waitForTimeout(3200)
    }
  })
})
