import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'
import {
  apiGet,
  apiUrl,
  dataRows,
  dialog,
  expectToast,
  onHandAt,
  onHandOf,
  settled,
  signInAs,
  switchLocation,
  workAtFirstLocation,
  apiRows,
  written,
} from '../helpers'

test.describe('Vendors', () => {
  test('a vendor can be created, edited and deleted', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/vendors')
    await settled(page)

    const name = `Audit Vendor ${Date.now()}`
    await page.getByRole('button', { name: 'Add Vendor' }).click()
    await dialog(page).getByLabel('Vendor name').fill(name)
    await written(page, () => dialog(page).getByRole('button', { name: 'Add Vendor' }).click())
    await page.reload()
    await settled(page)
    await expect(dataRows(page).filter({ hasText: name })).toHaveCount(1)

    await dataRows(page).filter({ hasText: name }).getByRole('button', { name: 'Edit' }).click()
    await dialog(page).getByLabel('Vendor name').fill(`${name} renamed`)
    await dialog(page).getByLabel('Phone').fill('555 0100')
    await written(page, () => dialog(page).getByRole('button', { name: 'Save Vendor' }).click())
    await page.reload()
    await settled(page)
    const renamed = dataRows(page).filter({ hasText: `${name} renamed` })
    await expect(renamed).toHaveCount(1)
    await expect(renamed).toContainText('555 0100')

    await renamed.getByRole('button', { name: 'Edit' }).click()
    await dialog(page).getByLabel('Phone').fill('')
    await written(page, () => dialog(page).getByRole('button', { name: 'Save Vendor' }).click())
    await page.reload()
    await settled(page)
    await expect(dataRows(page).filter({ hasText: `${name} renamed` })).not.toContainText(
      '555 0100'
    )

    await dataRows(page)
      .filter({ hasText: `${name} renamed` })
      .getByRole('button', { name: 'Delete' })
      .click()
    await expect(dialog(page)).toContainText('This cannot be undone')
    await written(page, () => dialog(page).getByRole('button', { name: 'Delete' }).click())
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

  test('a vendor lists the invoices it sent, and a chef may read them', async ({ page }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/vendors')
    await settled(page)

    const invoiced = dataRows(page).filter({ hasText: 'Mediterraneo Imports' })
    await expect(invoiced).toBeVisible()
    await invoiced.getByRole('button', { name: 'Invoices' }).click()
    const list = dialog(page)
    await expect(list.getByText('MI-2026-0714')).toBeVisible()
    await expect(list.getByText('Confirmed', { exact: true })).toBeVisible()
    await expect(list.getByRole('columnheader', { name: 'Total' })).toBeVisible()
    await list.getByRole('button', { name: 'Close', exact: true }).last().click()

    await page.getByLabel('Active only').uncheck()
    const bare = dataRows(page).filter({ hasText: '—' }).first()
    await bare.getByRole('button', { name: 'Invoices' }).click()
    await expect(dialog(page).getByText('No invoices yet')).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Close', exact: true }).last().click()

    await page.getByRole('button', { name: 'Logout' }).click()
    await expect(page).toHaveURL(/login/)
    await signInAs(page, 'staff')
    await page.goto('/vendors')
    await settled(page)
    await dataRows(page).first().getByRole('button', { name: 'Invoices' }).click()
    await expect(dialog(page).getByRole('heading', { name: /Invoices from/ })).toBeVisible()
    await expect(dataRows(page).first().getByRole('button', { name: 'Edit' })).toHaveCount(0)
  })

  test('the spend card draws the invoices the same screen counts', async ({ page }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/vendors')
    await settled(page)

    await page.getByRole('tab', { name: 'Analytics' }).click()
    const card = page
      .locator('div')
      .filter({ hasText: /^Spend over time/ })
      .last()
    await expect(card.getByRole('img', { name: /Trend of 6 points/ })).toBeVisible()
    await expect(card).not.toContainText('No invoices yet')
  })
})

test.describe('Ingredients', () => {
  test('the list narrows to one category', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/ingredients')
    await settled(page)
    const all = await dataRows(page).count()
    await page.getByLabel('Show only').selectOption('Dairy')
    const names = await dataRows(page).locator('td:first-child').allTextContents()
    expect(names.length).toBeGreaterThan(0)
    expect(names.length).toBeLessThan(all)
    expect(names.join(' ')).toContain('Unsalted Butter')
    expect(names.join(' ')).not.toContain('Beef Tenderloin')
  })

  test('price history records the vendor, the location and the source', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/ingredients')
    await settled(page)

    await dataRows(page)
      .filter({ hasText: 'Beef Tenderloin' })
      .getByRole('button', { name: 'Price history' })
      .click()

    const history = dialog(page)
    await expect(history).toContainText('Price history: Beef Tenderloin')
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
    await expectToast(page, /cannot be deleted; archive it instead/i)

    await page.reload()
    await settled(page)
    await expect(dataRows(page).filter({ hasText: 'Beef Tenderloin' })).toHaveCount(1)
  })

  test('an archived ingredient keeps its history and stops being offered', async ({ page }) => {
    await signInAs(page, 'owner')
    const probe = `Archive Probe ${Date.now()}`

    await page.goto('/ingredients')
    await settled(page)
    await page.getByRole('button', { name: 'Add Ingredient' }).click()
    await dialog(page).getByRole('button', { name: 'Add Ingredient' }).click()
    await expectToast(page, /are required/i)
    const plate = page
      .locator('[role="status"]')
      .filter({ hasText: /are required/i })
      .locator('span')
      .first()
    const box = (await plate.boundingBox())!
    const pixel = await page.screenshot({
      clip: { x: box.x + box.width / 2, y: box.y + box.height / 2, width: 1, height: 1 },
    })
    const { data } = await sharp(pixel).raw().toBuffer({ resolveWithObject: true })
    expect(data[0], 'the toast is dimmed under the open dialog').toBeGreaterThan(160)
    await dialog(page).getByLabel('Name').fill(probe)
    await dialog(page).getByLabel('Base unit').selectOption('kg')
    await dialog(page).getByLabel('Cost per unit').fill('4')
    await dialog(page).getByRole('button', { name: 'Add Ingredient' }).click()
    await expectToast(page, /added/i)

    const row = dataRows(page).filter({ hasText: probe })
    await expect(row).toHaveCount(1)

    await page.goto('/recipes/new')
    await settled(page)
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByLabel('Ingredient').first()).toContainText(probe)

    await page.goto('/ingredients')
    await settled(page)
    await row.getByRole('button', { name: 'Archive' }).click()
    await dialog(page).getByRole('button', { name: 'Archive' }).click()
    await expectToast(page, /archived/i)
    await expect(row.getByText('Archived', { exact: true })).toBeVisible()

    await page.goto('/recipes/new')
    await settled(page)
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByLabel('Ingredient').first()).not.toContainText(probe)

    await page.goto('/ingredients')
    await settled(page)
    await row.getByRole('button', { name: 'Restore' }).click()
    await expectToast(page, /restored/i)
    await page.reload()
    await settled(page)
    await expect(row.getByText('Archived', { exact: true })).toHaveCount(0)

    await row.getByRole('button', { name: 'Delete' }).click()
    await dialog(page).getByRole('button', { name: 'Delete' }).click()
    await expectToast(page, /deleted/i)
  })

  test('a chef may add ingredients but not delete them', async ({ page }) => {
    await signInAs(page, 'staff')
    await page.goto('/ingredients')
    await settled(page)
    await expect(page.getByRole('button', { name: 'Add Ingredient' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0)
  })

  test('the form says which fields are shared and which belong to the location', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/ingredients')
    await settled(page)

    const openBeef = async () =>
      dataRows(page)
        .filter({ hasText: 'Beef Tenderloin' })
        .getByRole('button', { name: 'Edit' })
        .click()

    await switchLocation(page, 'All locations')
    await openBeef()
    await expect(dialog(page)).toContainText('Shared by the whole organization')
    await expect(dialog(page)).toContainText('Organization defaults')
    await expect(dialog(page).getByLabel('Vendor SKU')).toHaveCount(0)
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()

    await switchLocation(page, 'Golden Fork — Airport')
    await openBeef()
    await expect(dialog(page)).toContainText('Shared by the whole organization')
    await expect(dialog(page)).toContainText('Golden Fork — Airport only')
    await expect(dialog(page)).toContainText('Every other location keeps what it had')
    await expect(dialog(page).getByLabel('Vendor SKU')).toHaveValue('AIR-BEEF-01')
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  })

  const beefId = async (page: Page) => {
    const rows = await apiGet<{ id: string; name: string }[]>(page, '/api/ingredients')
    return rows.find((i) => i.name === 'Beef Tenderloin')!.id
  }

  test('a cost written at one location leaves the other locations alone', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/ingredients')
    await settled(page)

    const beefCost = async () =>
      (
        await dataRows(page)
          .filter({ hasText: 'Beef Tenderloin' })
          .locator('td:nth-child(3)')
          .textContent()
      )?.trim()

    await switchLocation(page, 'Golden Fork — Downtown')
    await page.reload()
    await settled(page)
    const downtownBefore = await beefCost()

    await switchLocation(page, 'Golden Fork — Airport')
    await dataRows(page)
      .filter({ hasText: 'Beef Tenderloin' })
      .getByRole('button', { name: 'Edit' })
      .click()
    await dialog(page).getByLabel('Cost per unit').fill('44.44')
    await dialog(page).getByRole('button', { name: 'Save Ingredient' }).click()
    await expectToast(page, /Ingredient updated/i)
    await page.reload()
    await settled(page)
    expect(await beefCost()).toBe('$44.44')

    await switchLocation(page, 'Golden Fork — Downtown')
    await expect
      .poll(beefCost, { message: 'the other location keeps its own cost' })
      .toBe(downtownBefore)

    const airport = await apiGet<{ id: string; name: string }[]>(page, '/api/properties')
    const restored = await page.request.patch(apiUrl(`/api/ingredients/${await beefId(page)}`), {
      headers: { 'X-Location-Id': airport.find((l) => l.name.includes('Airport'))!.id },
      data: { costPerUnit: 41.2 },
    })
    expect(restored.ok(), 'the seeded price is put back').toBeTruthy()
  })

  test('editing a shared field at a location leaves what the location inherits alone', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/ingredients')
    await settled(page)
    const rows = await apiGet<{ id: string; name: string; sku: string | null }[]>(
      page,
      '/api/ingredients'
    )
    const butter = rows.find((i) => i.name === 'Unsalted Butter')!
    const riverside = (await apiGet<{ id: string; name: string }[]>(page, '/api/properties')).find(
      (l) => l.name.includes('Riverside')
    )!
    const inherited = async () =>
      (
        await apiGet<{ locations: { locationId: string; ownSettings: boolean }[] }>(
          page,
          `/api/ingredients/${butter.id}/locations`
        )
      ).locations.find((l) => l.locationId === riverside.id)!.ownSettings
    const history = async () =>
      (
        await apiGet<{ pagination: { total: number } }>(
          page,
          `/api/ingredients/${butter.id}/price-history`
        )
      ).pagination.total
    expect(await inherited()).toBe(false)
    const recordsBefore = await history()

    await switchLocation(page, riverside.name)
    await dataRows(page)
      .filter({ hasText: 'Unsalted Butter' })
      .getByRole('button', { name: 'Edit' })
      .click()
    await dialog(page).getByLabel('SKU', { exact: true }).fill(`PROBE-${Date.now()}`)
    await dialog(page).getByRole('button', { name: 'Save Ingredient' }).click()
    await expectToast(page, /Ingredient updated/i)

    try {
      expect(await inherited(), 'the location still inherits the shared cost and vendor').toBe(
        false
      )
      expect(await history(), 'no price was recorded').toBe(recordsBefore)
    } finally {
      await page.request.patch(apiUrl(`/api/ingredients/${butter.id}`), {
        data: { sku: butter.sku ?? '' },
      })
    }
  })

  test('a cleared reorder level is saved as none', async ({ page }) => {
    await signInAs(page, 'owner')
    const name = `Probe Reorder ${Date.now()}`
    const made = await page.request.post(apiUrl('/api/ingredients'), {
      data: { name, unit: 'kg', costPerUnit: 1, reorderLevel: 5 },
    })
    expect(made.ok()).toBeTruthy()
    const { id } = (await made.json()) as { id: string }
    try {
      await page.goto('/ingredients')
      await settled(page)
      await switchLocation(page, 'All locations')
      await dataRows(page).filter({ hasText: name }).getByRole('button', { name: 'Edit' }).click()
      await dialog(page).getByLabel('Reorder level').fill('')
      await dialog(page).getByRole('button', { name: 'Save Ingredient' }).click()
      await expectToast(page, /Ingredient updated/i)
      const rows = await apiGet<{ id: string; reorderLevel: number }[]>(page, '/api/ingredients')
      expect(rows.find((i) => i.id === id)?.reorderLevel).toBe(0)
    } finally {
      await page.request.delete(apiUrl(`/api/ingredients/${id}`))
    }
  })

  test('all locations shows the shared ingredient with a consolidated row', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/ingredients')
    await settled(page)
    await switchLocation(page, 'All locations')

    await dataRows(page)
      .filter({ hasText: 'Beef Tenderloin' })
      .getByRole('button', { name: 'Locations' })
      .click()

    const across = dialog(page)
    await expect(across).toContainText('Across locations: Beef Tenderloin')
    for (const column of [
      'Location',
      'Vendor',
      'Vendor SKU',
      'Cost / unit',
      'On hand',
      'Reorder',
    ]) {
      await expect(across).toContainText(new RegExp(column, 'i'))
    }
    const total = across.locator('tbody tr').last()
    await expect(total).toContainText('Total / Range')
    await expect(total).toContainText(/\d+ vendors?/)
    const active = await apiGet<unknown[]>(page, '/api/properties')
    await expect(across.locator('tbody tr')).toHaveCount(active.length + 1)
  })

  test('choosing all locations survives a page load', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/ingredients')
    await settled(page)
    await switchLocation(page, 'All locations')

    await page.goto('/ingredients')
    await settled(page)
    const kept = await page.locator('select[aria-label="Location"] option:checked').textContent()
    expect(kept?.trim(), 'the header still says all locations').toBe('All locations')
    expect(
      await page.evaluate(() => window.localStorage.getItem('nexus.locationId')),
      'and no location was pinned behind the header'
    ).toBe('')
  })
})

test.describe('Inventory', () => {
  test('a movement is offered only once a location is chosen', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.evaluate(() => window.localStorage.removeItem('nexus.locationId'))
    await page.goto('/inventory')
    await settled(page)
    await expect(page.getByText(/Choose a location in the header to record/)).toBeVisible()
    const adjust = dataRows(page).first().getByRole('button', { name: 'Adjust' })
    await expect(adjust).toBeDisabled()
    await workAtFirstLocation(page)
    await page.reload()
    await settled(page)
    await expect(dataRows(page).first().getByRole('button', { name: 'Adjust' })).toBeEnabled()
  })

  test('the three movement types land on the stock level', async ({ page }) => {
    await signInAs(page, 'owner')
    const locationId = await workAtFirstLocation(page)
    await page.goto('/inventory')
    await settled(page)

    const startHere = await onHandAt(page, 'Unsalted Butter', locationId)

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
    const counted = await onHandOf(page, 'Unsalted Butter')
    const elsewhere = counted - 10
    expect(
      elsewhere,
      'a count reports this location plus whatever the others hold'
    ).toBeGreaterThanOrEqual(0)

    await adjust('Received', '4')
    expect(await onHandOf(page, 'Unsalted Butter')).toBeCloseTo(counted + 4, 3)

    await adjust('Used', '1.5')
    expect(await onHandOf(page, 'Unsalted Butter')).toBeCloseTo(counted + 2.5, 3)

    await adjust('Physical count', String(startHere))
    expect(await onHandAt(page, 'Unsalted Butter', locationId)).toBeCloseTo(startHere, 3)
  })

  test('a delivery received by hand records what it cost', async ({ page }) => {
    await signInAs(page, 'owner')
    const locationId = await workAtFirstLocation(page)
    await page.goto('/inventory')
    await settled(page)

    const startHere = await onHandAt(page, 'Unsalted Butter', locationId)
    const [butter] = (
      await apiGet<{ id: string; name: string }[]>(page, '/api/ingredients')
    ).filter((i) => i.name === 'Unsalted Butter')
    const receipts = async () =>
      (
        await apiRows<{ id: string; costPerUnit: number; source: string }>(
          page,
          `/api/ingredients/${butter.id}/price-history`
        )
      ).filter((r) => r.source === 'receipt')
    const before = new Set((await receipts()).map((r) => r.id))

    const row = dataRows(page).filter({ hasText: 'Unsalted Butter' })
    await row.getByRole('button', { name: 'Adjust' }).click()
    await expect(dialog(page).getByLabel('Total cost')).toHaveCount(0)
    await dialog(page).getByLabel('Type').selectOption({ label: 'Received' })
    await dialog(page)
      .getByLabel(/quantity/i)
      .fill('4')
    await dialog(page).getByLabel('Total cost').fill('18')
    await dialog(page).getByRole('button', { name: 'Save Adjustment' }).click()
    await expectToast(page, /Stock updated/i)

    const added = (await receipts()).filter((r) => !before.has(r.id))
    expect(added.map((r) => r.costPerUnit)).toEqual([4.5])

    await row.getByRole('button', { name: 'Adjust' }).click()
    await dialog(page)
      .getByLabel(/counted quantity/i)
      .fill(String(startHere))
    await dialog(page).getByRole('button', { name: 'Save Adjustment' }).click()
    await expectToast(page, /Stock updated/i)
  })

  test('a negative count says what is wrong with it', async ({ page }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/inventory')
    await settled(page)

    await dataRows(page).filter({ hasText: 'Eggs' }).getByRole('button', { name: 'Adjust' }).click()
    await dialog(page)
      .getByLabel(/counted quantity/i)
      .fill('-5')
    await dialog(page).getByRole('button', { name: 'Save Adjustment' }).click()
    await expectToast(page, /cannot be negative/i)
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  })
})
