import { test, expect } from '@playwright/test'
import {
  signIn,
  ACCOUNTS,
  workAtFirstLocation,
  dialog,
  expectToast,
  written,
  settled,
  switchLocation,
  dataRows,
  apiGet,
  apiUrl,
  onHandAt,
  apiRows,
} from '../helpers'

test.describe('Document ingestion', () => {
  test('an invoice is uploaded, corrected and confirmed', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible()

    await page.getByLabel('Document type').selectOption('invoice')

    const probe = 'UI Probe Ingredient'
    const fileName = `invoice-${Date.now()}.json`
    const invoice = JSON.stringify({
      kind: 'invoice',
      number: `UI-1-${Date.now()}`,
      items: [{ rawName: probe, quantity: 3, unit: 'kg', unitPrice: 7.5 }],
    })
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(invoice),
    })

    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })

    await row.getByRole('button', { name: 'Review' }).click()
    await expect(dialog(page)).toBeVisible()
    const nameField = dialog(page).locator('tbody input').first()
    await expect(nameField).toHaveValue(probe)
    await nameField.fill(`${probe} (edited)`)

    await dialog(page)
      .getByRole('button', { name: /Confirm/ })
      .click()
    await expectToast(page, /0 lines applied; 1 line matched nothing in the catalogue/)
    // The probe name is not in the catalogue, so the document places none of its lines.
    await expect(row.getByText('Partially Processed')).toBeVisible({ timeout: 15000 })
  })

  test('a price far from what the location pays is pointed out before the invoice is confirmed', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('invoice')

    const fileName = `price-jump-${Date.now()}.json`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number: `UI-JUMP-${Date.now()}`,
          items: [
            { rawName: 'Unsalted Butter', quantity: 2, unit: 'kg', unitPrice: 20230450 },
            { rawName: 'Eggs', quantity: 12, unit: 'ea', unitPrice: 0.4 },
          ],
        })
      ),
    })

    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Review' }).click()

    const jumps = dialog(page).getByRole('region', {
      name: 'Prices far from what this location pays',
    })
    await expect(jumps).toBeVisible()
    await expect(jumps.locator('tbody tr')).toHaveCount(1)
    await expect(jumps.locator('tbody tr')).toContainText('Unsalted Butter')
    await expect(jumps.locator('tbody tr')).toContainText('$20,230,450.00 / kg')

    await dialog(page).locator('tbody tr').first().locator('input').nth(4).fill('9.8')
    await expect(jumps).toHaveCount(0)

    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await row.getByRole('button', { name: 'Delete' }).click()
    await dialog(page).getByRole('button', { name: 'Delete' }).click()
    await expectToast(page, /deleted/i)
    await expect(row).toHaveCount(0)
  })

  test('the review marks what stops a confirm on its own line, and the confirm opens once it is fixed', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('recipe')

    const stamp = Date.now()
    const name = `UI Checked Shortbread ${stamp}`
    const fileName = `checked-${stamp}.json`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'recipe',
          name,
          items: [
            { rawName: 'Unsalted Butter', quantity: 1, unit: 'a handful' },
            { rawName: 'Eggs', quantity: 2, unit: 'ea' },
          ],
        })
      ),
    })
    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Review' }).click()

    const summary = dialog(page).getByRole('region', { name: 'What to fix before confirming' })
    await expect(summary).toContainText('1 thing to fix before this can be confirmed')
    await expect(dialog(page).getByText('"a handful" is not a unit of measure')).toBeVisible()
    await expect(dialog(page).getByRole('button', { name: 'Confirm & Apply' })).toBeDisabled()

    await dialog(page).getByLabel('Unit of Unsalted Butter').selectOption('g')
    await expect(
      dialog(page).getByText('Nothing stops this document from being confirmed.')
    ).toBeVisible()
    await expect(summary).toHaveCount(0)
    await dialog(page).getByRole('button', { name: 'Confirm & Apply' }).click()
    await expect(row.getByText('Confirmed')).toBeVisible({ timeout: 15000 })
    const recipe = (await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')).find(
      (r) => r.name === name
    )!
    expect(recipe).toBeTruthy()
    await page.request.delete(apiUrl(`/api/recipes/${recipe.id}`))
  })

  test('an invoice says what its paper leaves unsaid, and adds the names the catalogue lacks when asked', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    const downtown = await workAtFirstLocation(page)
    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('invoice')

    const stamp = Date.now()
    const yuzu = `UI Yuzu Juice ${stamp}`
    const fileName = `unsaid-${stamp}.json`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          vendorName: `UI Fresh Farms ${stamp}`,
          number: `UI-UNSAID-${stamp}`,
          items: [{ rawName: yuzu, quantity: 2, unit: 'l', unitPrice: 12 }],
        })
      ),
    })
    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Review' }).click()

    await expect(
      dialog(page).getByText(`UI Fresh Farms ${stamp} is not one of your vendors`)
    ).toBeVisible()
    await expect(dialog(page).getByText('No date was read')).toBeVisible()
    await expect(dialog(page).getByText(`${yuzu} is not in the catalogue:`)).toBeVisible()
    await dialog(page)
      .getByLabel(
        'Add the names that reach no ingredient to the catalogue and receive them, at the price on this invoice'
      )
      .check()
    await expect(
      dialog(page).getByText(`${yuzu} is not in the catalogue and will be added, counted in l`)
    ).toBeVisible()
    const confirm = dialog(page).getByRole('button', { name: 'Confirm & Apply' })
    await expect(confirm).toBeEnabled()
    await confirm.click()
    await expectToast(page, /1 new ingredient added/)
    await expect(row.getByText('Confirmed')).toBeVisible({ timeout: 15000 })

    const added = (
      await apiGet<{ id: string; name: string; unit: string }[]>(page, '/api/ingredients')
    ).find((i) => i.name === yuzu)!
    expect(added.unit).toBe('l')
    expect(await onHandAt(page, yuzu, downtown)).toBe(2)
    const headers = { 'X-Location-Id': downtown }
    const counted = await page.request.post(apiUrl('/api/inventory/transactions'), {
      headers,
      data: { ingredientId: added.id, type: 'COUNT', quantity: 0 },
    })
    expect(counted.ok(), 'the stock the invoice added is counted back out').toBeTruthy()
    const archived = await page.request.patch(apiUrl(`/api/ingredients/${added.id}`), {
      data: { isActive: false },
    })
    expect(archived.ok(), 'the added ingredient is archived').toBeTruthy()
  })

  test('a confirmed invoice prices the location that received it, not the others', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    const locations = await apiGet<{ id: string; name: string }[]>(page, '/api/properties')
    const downtown = locations.find((l) => l.name.includes('Downtown'))!.id
    const beef = (await apiGet<{ id: string; name: string }[]>(page, '/api/ingredients')).find(
      (i) => i.name === 'Beef Tenderloin'
    )!.id

    await page.goto('/ingredients')
    await settled(page)

    const beefCost = async () =>
      (
        await dataRows(page)
          .filter({ hasText: 'Beef Tenderloin' })
          .locator('td:nth-child(3)')
          .textContent()
      )?.trim()

    await switchLocation(page, 'Golden Fork — Riverside')
    const elsewhere = await beefCost()

    await switchLocation(page, 'Golden Fork — Downtown')
    const before = await beefCost()
    const stocked = await onHandAt(page, 'Beef Tenderloin', downtown)
    expect(before, 'the seeded price is not the one the invoice states').not.toBe('$61.25')

    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('invoice')
    const fileName = `beef-${Date.now()}.json`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number: `UI-LOC-${Date.now()}`,
          items: [{ rawName: 'Beef Tenderloin', quantity: 4, unit: 'kg', unitPrice: 61.25 }],
        })
      ),
    })

    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Review' }).click()
    await dialog(page)
      .getByRole('button', { name: /Confirm/ })
      .click()
    await expectToast(page, /applied/i)

    await page.goto('/ingredients')
    await settled(page)
    await expect
      .poll(beefCost, { message: 'the receiving location pays what the invoice states' })
      .toBe('$61.25')

    await switchLocation(page, 'Golden Fork — Riverside')
    await expect
      .poll(beefCost, { message: 'the other location keeps its own price' })
      .toBe(elsewhere)

    const headers = { 'X-Location-Id': downtown }
    const priced = await page.request.patch(apiUrl(`/api/ingredients/${beef}`), {
      headers,
      data: { costPerUnit: parseFloat((before ?? '0').replace('$', '')) },
    })
    expect(priced.ok(), 'the seeded price is put back').toBeTruthy()
    const counted = await page.request.post(apiUrl('/api/inventory/transactions'), {
      headers,
      data: { ingredientId: beef, type: 'COUNT', quantity: stocked },
    })
    expect(counted.ok(), 'the stock the invoice added is counted back out').toBeTruthy()
  })

  test('a total typed on a line is the money that line moved', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    const locations = await apiGet<{ id: string; name: string }[]>(page, '/api/properties')
    const downtown = locations.find((l) => l.name.includes('Downtown'))!.id
    const beef = (await apiGet<{ id: string; name: string }[]>(page, '/api/ingredients')).find(
      (i) => i.name === 'Beef Tenderloin'
    )!.id

    await workAtFirstLocation(page)
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
    const before = await beefCost()
    const stocked = await onHandAt(page, 'Beef Tenderloin', downtown)

    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('invoice')
    const fileName = `total-${Date.now()}.json`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number: `UI-TOTAL-${Date.now()}`,
          items: [{ rawName: 'Beef Tenderloin', quantity: 4, unit: 'kg', unitPrice: 61.25 }],
        })
      ),
    })

    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Review' }).click()
    await expect(dialog(page).getByRole('columnheader', { name: 'Total price' })).toBeVisible()

    const line = dialog(page).locator('tbody tr').first()
    await line.locator('input').nth(5).fill('200')
    await dialog(page)
      .getByRole('button', { name: /Confirm/ })
      .click()
    await expectToast(page, /applied/i)

    await page.goto('/ingredients')
    await settled(page)
    await expect
      .poll(beefCost, {
        message: 'the price comes from the total, not from four times the unit price',
      })
      .toBe('$50.00')

    const headers = { 'X-Location-Id': downtown }
    const priced = await page.request.patch(apiUrl(`/api/ingredients/${beef}`), {
      headers,
      data: { costPerUnit: parseFloat((before ?? '0').replace('$', '')) },
    })
    expect(priced.ok(), 'the seeded price is put back').toBeTruthy()
    const counted = await page.request.post(apiUrl('/api/inventory/transactions'), {
      headers,
      data: { ingredientId: beef, type: 'COUNT', quantity: stocked },
    })
    expect(counted.ok(), 'the stock the invoice added is counted back out').toBeTruthy()
  })

  test('a unit price corrected in the review carries the stated total with it', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    const locations = await apiGet<{ id: string; name: string }[]>(page, '/api/properties')
    const downtown = locations.find((l) => l.name.includes('Downtown'))!.id
    const beef = (await apiGet<{ id: string; name: string }[]>(page, '/api/ingredients')).find(
      (i) => i.name === 'Beef Tenderloin'
    )!.id

    await workAtFirstLocation(page)
    await page.goto('/ingredients')
    await settled(page)
    await switchLocation(page, 'Golden Fork — Downtown')
    const beefCost = async () =>
      (
        await dataRows(page)
          .filter({ hasText: 'Beef Tenderloin' })
          .locator('td:nth-child(3)')
          .textContent()
      )?.trim()
    const before = await beefCost()
    const stocked = await onHandAt(page, 'Beef Tenderloin', downtown)

    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('invoice')
    const fileName = `corrected-${Date.now()}.json`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number: `UI-CORRECTED-${Date.now()}`,
          items: [
            { rawName: 'Beef Tenderloin', quantity: 4, unit: 'kg', unitPrice: 50, lineTotal: 200 },
          ],
        })
      ),
    })

    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Review' }).click()
    const line = dialog(page).locator('tbody tr').first()
    await expect(line.locator('input').nth(5)).toHaveValue('200')

    await line.locator('input').nth(4).fill('49,5')
    await expect(line.locator('input').nth(5)).toHaveValue('198')

    const unit = await line
      .locator('input')
      .nth(3)
      .evaluate((el) => el.clientWidth)
    expect(unit, 'the unit field is wide enough to read "kg"').toBeGreaterThanOrEqual(48)
    await dialog(page)
      .getByRole('button', { name: /Confirm/ })
      .click()
    await expectToast(page, /applied/i)

    await page.goto('/ingredients')
    await settled(page)
    await expect
      .poll(beefCost, { message: 'the corrected unit price is the price that lands' })
      .toBe('$49.50')

    const headers = { 'X-Location-Id': downtown }
    const priced = await page.request.patch(apiUrl(`/api/ingredients/${beef}`), {
      headers,
      data: { costPerUnit: parseFloat((before ?? '0').replace('$', '')) },
    })
    expect(priced.ok(), 'the seeded price is put back').toBeTruthy()
    const counted = await page.request.post(apiUrl('/api/inventory/transactions'), {
      headers,
      data: { ingredientId: beef, type: 'COUNT', quantity: stocked },
    })
    expect(counted.ok(), 'the stock the invoice added is counted back out').toBeTruthy()
  })

  test('a failed document says why, and documents split from one file say which part they are', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await settled(page)
    await page.getByLabel('Document type').selectOption('invoice')

    const letter = `letter-${Date.now()}.docx`
    await page.locator('input[type="file"]').setInputFiles({
      name: letter,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('PK not really a document'),
    })
    const failed = page.locator('tbody tr').filter({ hasText: letter })
    await expect(failed.getByText('Failed', { exact: true })).toBeVisible({ timeout: 20000 })
    const listed = await apiRows<{ id: string; file: string; error: string | null }>(
      page,
      '/api/documents'
    )
    const reason = listed.find((d) => d.file === letter)?.error
    expect(reason, 'the failure carries its reason').toBeTruthy()
    await expect(failed.getByTestId('document-error')).toHaveAttribute('title', reason!)

    const pair = `pair-${Date.now()}.json`
    await page.locator('input[type="file"]').setInputFiles({
      name: pair,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify([
          {
            kind: 'invoice',
            number: `PAIR-A-${Date.now()}`,
            items: [{ rawName: 'Flour', quantity: 1, unit: 'kg', unitPrice: 1 }],
          },
          {
            kind: 'invoice',
            number: `PAIR-B-${Date.now()}`,
            items: [{ rawName: 'Sugar', quantity: 1, unit: 'kg', unitPrice: 1 }],
          },
        ])
      ),
    })
    const rows = page.locator('tbody tr').filter({ hasText: pair })
    await expect(rows).toHaveCount(2, { timeout: 20000 })
    await expect(rows.filter({ hasText: 'part 1 of 2' })).toHaveCount(1)
    await expect(rows.filter({ hasText: 'part 2 of 2' })).toHaveCount(1)

    const mine = (await apiRows<{ id: string; file: string }>(page, '/api/documents')).filter(
      (d) => d.file.startsWith(letter) || d.file.startsWith(pair)
    )
    expect(mine).toHaveLength(3)
    for (const d of mine) {
      const removed = await page.request.delete(apiUrl(`/api/documents/${d.id}`))
      expect(removed.ok(), `${d.file} is removed`).toBeTruthy()
    }
  })

  test('a workbook of recipes is confirmed at once, a sub-recipe inside its dish, and what cannot be says why', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await settled(page)
    await page.getByLabel('Document type').selectOption('recipe')

    const stamp = Date.now()
    const book = `book-${stamp}.json`
    const parent = `UI Chard Greens ${stamp}`
    const child = `UI Hearth Broth ${stamp}`
    const probe = `UI Probe Chard ${stamp}`
    await page.locator('input[type="file"]').setInputFiles({
      name: book,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify([
          {
            kind: 'recipe',
            name: parent,
            items: [
              { rawName: probe, quantity: 2, unit: 'cups' },
              { rawName: child, quantity: 1, unit: 'cup' },
            ],
          },
          {
            kind: 'recipe',
            name: child,
            yieldQty: 4,
            yieldUnit: 'cup',
            items: [{ rawName: 'Unsalted Butter', quantity: 50, unit: 'g' }],
          },
          {
            kind: 'recipe',
            name: '',
            items: [{ rawName: 'Unsalted Butter', quantity: 1, unit: 'g' }],
          },
        ])
      ),
    })
    const rows = page.locator('tbody tr').filter({ hasText: book })
    await expect(rows.getByRole('button', { name: 'Review' })).toHaveCount(2, { timeout: 20000 })

    await rows.filter({ hasText: 'part 1 of 2' }).getByRole('button', { name: 'Review' }).click()
    const review = dialog(page)
    const sub = review.getByRole('region', { name: `Sub-recipe ${child}` })
    await expect(sub.getByLabel('Name of the sub-recipe')).toHaveValue(child)
    await expect(sub).toContainText(`Sub-recipe, used in ${parent}`)
    await review.getByLabel(/Add the names that reach no ingredient/).check()
    await review.getByRole('button', { name: 'Confirm all 2 from this file' }).click()

    await expectToast(page, '1 of 2 confirmed')
    const left = dialog(page)
    await expect(left.getByRole('heading', { name: '1 not confirmed' })).toBeVisible()
    await expect(left).toContainText(`${book} (2/2)`)
    await expect(left).toContainText('Give the recipe a name before confirming it')
    await left.getByRole('button', { name: 'Close' }).last().click()
    await expect(rows.getByRole('button', { name: 'Review' })).toHaveCount(1)

    const recipes = await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')
    const made = recipes.find((r) => r.name === parent)
    const nested = recipes.find((r) => r.name === child)
    expect(made, 'the recipe is made').toBeTruthy()
    expect(nested, 'the nested recipe is made').toBeTruthy()
    const card = await apiGet<{ components: { name: string }[] }>(
      page,
      `/api/recipes/${made!.id}/detail`
    )
    expect(card.components.map((c) => c.name)).toEqual([child])
    const ingredients = await apiGet<{ id: string; name: string; unit: string }[]>(
      page,
      '/api/ingredients?includeArchived=true'
    )
    const added = ingredients.find((i) => i.name === probe)
    expect(added?.unit).toBe('l')
    expect(
      ingredients.some((i) => i.name === child),
      'the nested recipe is not taken for an ingredient'
    ).toBe(false)

    await page.goto('/recipes')
    await settled(page)
    await page.getByPlaceholder(/Search recipes by name/).fill(parent)
    await expect(page.getByRole('main')).toContainText('1 ingredient without a price')

    for (const path of [
      `/api/recipes/${made!.id}`,
      `/api/recipes/${nested!.id}`,
      `/api/ingredients/${added!.id}`,
    ]) {
      const removed = await page.request.delete(apiUrl(path))
      expect(removed.ok(), `${path} is removed`).toBeTruthy()
    }
    const waiting = (
      await apiRows<{ id: string; file: string; status: string }>(page, '/api/documents')
    ).filter((d) => d.file.startsWith(book) && d.status === 'requires_review')
    for (const d of waiting) await page.request.delete(apiUrl(`/api/documents/${d.id}`))
  })

  test('a phrase read where a unit belongs is marked, and the line takes a unit from the list', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await settled(page)
    await page.getByLabel('Document type').selectOption('recipe')

    const stamp = Date.now()
    const file = `fried-${stamp}.json`
    const recipe = `UI Fried Taro ${stamp}`
    const oil = `UI Probe Frying Oil ${stamp}`
    await page.locator('input[type="file"]').setInputFiles({
      name: file,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'recipe',
          name: recipe,
          items: [{ rawName: oil, quantity: 1, unit: 'a splash' }],
        })
      ),
    })
    const row = page.locator('tbody tr').filter({ hasText: file })
    await row.getByRole('button', { name: 'Review' }).click({ timeout: 20000 })
    const review = dialog(page)
    const unit = review.getByLabel(`Unit of ${oil}`)
    await expect(unit).toHaveAttribute('aria-invalid', 'true')
    await expect(unit.locator('option:checked')).toHaveText('a splash (as written)')

    await review.getByLabel(/Add the names that reach no ingredient/).check()
    await expect(review.getByText('"a splash" is not a unit of measure')).toBeVisible()
    await expect(review.getByRole('button', { name: 'Confirm & Apply' })).toBeDisabled()

    await unit.selectOption('l')
    await expect(unit).toHaveAttribute('aria-invalid', 'false')
    await written(page, () => review.getByRole('button', { name: 'Confirm & Apply' }).click())

    const ingredients = await apiGet<{ id: string; name: string; unit: string }[]>(
      page,
      '/api/ingredients?includeArchived=true'
    )
    const added = ingredients.find((i) => i.name === oil)
    expect(added?.unit).toBe('l')
    const made = (await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')).find(
      (r) => r.name === recipe
    )
    for (const path of [`/api/recipes/${made!.id}`, `/api/ingredients/${added!.id}`]) {
      expect((await page.request.delete(apiUrl(path))).ok(), `${path} is removed`).toBeTruthy()
    }
  })

  test('a quantity written as a choice is pointed out below its line until the figure is corrected', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await settled(page)
    await page.getByLabel('Document type').selectOption('recipe')

    const file = `choice-${Date.now()}.json`
    await page.locator('input[type="file"]').setInputFiles({
      name: file,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'recipe',
          name: `UI Choice ${file}`,
          items: [{ rawName: 'Eggs', quantity: 2, unit: 'ea', quantityText: '2 or 4' }],
        })
      ),
    })
    const row = page.locator('tbody tr').filter({ hasText: file })
    await row.getByRole('button', { name: 'Review' }).click({ timeout: 20000 })
    const review = dialog(page)
    const note = review.getByText('The paper writes "2 or 4"; 2 is taken')
    await expect(note).toBeVisible()

    const name = await review.getByLabel('Line 1 name').boundingBox()
    const below = await note.boundingBox()
    expect(below!.y - (name!.y + name!.height)).toBeGreaterThanOrEqual(3)

    const quantity = review.locator('tbody tr').first().locator('td').nth(1).locator('input')
    await quantity.fill('4')
    await expect(note).toHaveCount(0)

    await review.getByRole('button', { name: 'Cancel' }).click()
    await row.getByRole('button', { name: 'Delete' }).click()
    await dialog(page).getByRole('button', { name: 'Delete' }).click()
    await expect(row).toHaveCount(0)
  })

  test('a unit with no conversion to its ingredient is converted from the review dialog itself', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await settled(page)
    await page.getByLabel('Document type').selectOption('recipe')

    const stamp = Date.now()
    const file = `cups-${stamp}.json`
    await page.locator('input[type="file"]').setInputFiles({
      name: file,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'recipe',
          name: `UI Buttered ${stamp}`,
          items: [{ rawName: 'Unsalted Butter', quantity: 0.5, unit: 'cups' }],
        })
      ),
    })
    const row = page.locator('tbody tr').filter({ hasText: file })
    await row.getByRole('button', { name: 'Review' }).click({ timeout: 20000 })
    const review = dialog(page)
    const section = review.getByRole('region', { name: 'Units across this file' })
    await expect(section).toContainText('Unsalted Butter')
    try {
      await section.getByLabel(/How many kg one cup of Unsalted Butter is/).fill('0.227')
      await written(page, () =>
        section.getByRole('button', { name: 'Save units for this file' }).click()
      )
      await expectToast(page, /0 ingredients added, 1 conversion recorded for this file/)
      await expect(section).toHaveCount(0)
    } finally {
      const rules = await apiGet<{ id: string; fromUnit: string; ingredient: string | null }[]>(
        page,
        '/api/unit-conversions'
      )
      for (const rule of rules.filter((r) => r.fromUnit === 'cup')) {
        await page.request.delete(apiUrl(`/api/unit-conversions/${rule.id}`))
      }
      const docs = await apiRows<{ id: string; file: string }>(page, '/api/documents')
      for (const d of docs.filter((d) => d.file.startsWith(file))) {
        await page.request.delete(apiUrl(`/api/documents/${d.id}`))
      }
    }
  })

  test('a file of recipes has its units settled in one table, a new ingredient counted as chosen', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await settled(page)
    await page.getByLabel('Document type').selectOption('recipe')

    const stamp = Date.now()
    const file = `leeks-${stamp}.json`
    const leek = `UI Leek ${stamp}`
    const soup = `UI Leek Soup ${stamp}`
    const gratin = `UI Leek Gratin ${stamp}`
    await page.locator('input[type="file"]').setInputFiles({
      name: file,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify([
          { kind: 'recipe', name: soup, items: [{ rawName: leek, quantity: 2, unit: 'ea' }] },
          {
            kind: 'recipe',
            name: gratin,
            items: [
              { rawName: leek, quantity: 1, unit: 'lb' },
              { rawName: `${leek}, sliced`, quantity: 1, unit: 'cup' },
            ],
          },
        ])
      ),
    })
    const rows = page.locator('tbody tr').filter({ hasText: file })
    await expect(rows.getByRole('button', { name: 'Review' })).toHaveCount(2, { timeout: 20000 })
    await rows.first().getByRole('button', { name: 'Review' }).click()
    const review = dialog(page)
    const section = review.getByRole('region', { name: 'Units across this file' })
    await expect(section).toContainText(`${leek}(new)`)
    try {
      await section.getByLabel(`Unit ${leek} is counted in`).selectOption('kg')
      await section.getByLabel(`How many kg one ea of ${leek} is`).fill('0.15')
      await section.getByLabel(`How many kg one cup of ${leek} is`).fill('0.09')
      await written(page, () =>
        section.getByRole('button', { name: 'Save units for this file' }).click()
      )
      await expectToast(page, /1 ingredient added, 2 conversions recorded for this file/)
      await expect(section).toHaveCount(0)
      await expect(
        review.getByText('Nothing stops this document from being confirmed.')
      ).toBeVisible()
      await review.getByRole('button', { name: 'Confirm all 2 from this file' }).click()
      await expect(rows.getByText('Confirmed')).toHaveCount(2, { timeout: 20000 })
      const added = (
        await apiGet<{ id: string; name: string; unit: string }[]>(page, '/api/ingredients')
      ).find((i) => i.name === leek)
      expect(added?.unit).toBe('kg')
    } finally {
      const recipes = await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')
      for (const r of recipes.filter((r) => r.name === soup || r.name === gratin))
        await page.request.delete(apiUrl(`/api/recipes/${r.id}`))
      const rules = await apiGet<{ id: string; ingredient: string | null }[]>(
        page,
        '/api/unit-conversions'
      )
      for (const rule of rules.filter((r) => r.ingredient === leek))
        await page.request.delete(apiUrl(`/api/unit-conversions/${rule.id}`))
      const ingredient = (
        await apiGet<{ id: string; name: string }[]>(page, '/api/ingredients?includeArchived=true')
      ).find((i) => i.name === leek)
      if (ingredient) await page.request.delete(apiUrl(`/api/ingredients/${ingredient.id}`))
      const docs = await apiRows<{ id: string; file: string; status: string }>(
        page,
        '/api/documents'
      )
      for (const d of docs.filter((d) => d.file.startsWith(file) && d.status !== 'confirmed'))
        await page.request.delete(apiUrl(`/api/documents/${d.id}`))
    }
  })

  test('with no location chosen the upload zone explains itself instead of stranding a file', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await settled(page)

    const zone = page.getByRole('button', { name: /Drag & drop|Choose a location/ })
    await expect(zone).toBeEnabled()

    await switchLocation(page, 'All locations')
    await expect(zone).toBeDisabled()
    await expect(zone).toContainText('Choose a location in the header')

    await page.getByLabel('Document type').selectOption('recipe')
    await expect(zone).toBeEnabled()

    await page.goto('/recipes')
    await settled(page)
    await page.getByRole('button', { name: 'Upload recipes' }).click()
    const pageZone = dialog(page).getByRole('button', { name: /Drag|Choose a location/ })
    await expect(pageZone).toBeEnabled()
  })

  test('a price typed in the review dialog is read as typed, not as zero', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('menu')

    const name = `Review Probe ${Date.now()}`
    const fileName = `menu-${Date.now()}.json`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ kind: 'menu', name, price: 9 })),
    })

    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Review' }).click()

    const price = dialog(page).getByLabel('Price of dish 1')
    await expect(price).toHaveValue('9')
    await price.fill('')
    await expect(price, 'an emptied price does not fall back to zero on the screen').toHaveValue('')
    await price.fill('16.5')
    await expect(price, 'the separator is ours, not the browser locale').toHaveValue('16.5')

    await dialog(page)
      .getByRole('button', { name: /Confirm/ })
      .click()
    await expectToast(page, /applied/i)

    const items = await apiGet<{ id: string; name: string; price: number }[]>(
      page,
      '/api/menu-items'
    )
    const created = items.find((i) => i.name === name)
    expect(created, 'the reviewed menu item reached the API').toBeDefined()
    expect(created!.price).toBe(16.5)

    const removed = await page.request.delete(apiUrl(`/api/menu-items/${created!.id}`))
    expect(removed.ok(), 'the probe menu item is removed').toBeTruthy()
    const menu = (await apiGet<{ id: string; name: string }[]>(page, '/api/menus')).find(
      (m) => m.name === fileName.replace(/\.json$/, '')
    )
    if (menu) await page.request.delete(apiUrl(`/api/menus/${menu.id}`))
  })

  test('a menu and a sales report are uploaded from their own pages and found in Documents by type', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    const stamp = Date.now()
    const uploads = [
      {
        screen: '/menus',
        button: 'Upload menu',
        type: 'menu',
        file: `page-menu-${stamp}.json`,
        body: {
          kind: 'menu',
          name: `Page Menu ${stamp}`,
          items: [{ name: `Page Dish ${stamp}`, price: 12 }],
        },
      },
      {
        screen: '/sales',
        button: 'Import sales report',
        type: 'sales',
        file: `page-sales-${stamp}.csv`,
        body: 'Menu Item,Quantity,Unit Price\nSteak Frites,2,34\n',
      },
    ]
    try {
      for (const u of uploads) {
        await page.goto(u.screen)
        await settled(page)
        await page.getByRole('button', { name: u.button }).click()
        await dialog(page)
          .locator('input[type="file"]')
          .setInputFiles({
            name: u.file,
            mimeType: typeof u.body === 'string' ? 'text/csv' : 'application/json',
            buffer: Buffer.from(typeof u.body === 'string' ? u.body : JSON.stringify(u.body)),
          })
        await expectToast(page, /1 file sent for reading/)
        await expect(page).toHaveURL(new RegExp(`${u.screen}$`))
        const line = page.getByRole('status').filter({ hasText: 'waiting for review' })
        await expect(line).toBeVisible({ timeout: 20000 })
        await line.getByRole('link', { name: 'Review in Documents' }).click()
        await expect(page).toHaveURL(new RegExp(`/documents\\?type=${u.type}$`))
        await settled(page)
        await expect(page.getByLabel('Show')).toHaveValue(u.type)
        await expect(page.locator('tbody tr').filter({ hasText: u.file })).toHaveCount(1)
        for (const row of await page.locator('tbody tr').all())
          await expect(row).toContainText(u.type)
      }
    } finally {
      const documents = await apiRows<{ id: string; file: string }>(page, '/api/documents')
      for (const d of documents.filter((x) => uploads.some((u) => x.file === u.file))) {
        await page.request.delete(apiUrl(`/api/documents/${d.id}`))
      }
    }
  })

  test('a menu file is reviewed as one menu: its name, its dishes, one added and one taken out', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('menu')

    const stamp = Date.now()
    const fileName = `E2E Lunch ${stamp}.json`
    const dishes = [`E2E Soup ${stamp}`, `E2E Salad ${stamp}`, `E2E Pie ${stamp}`]
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'menu',
          items: [
            { name: dishes[0], price: 7, section: 'Starters' },
            { name: dishes[1], price: 9 },
          ],
        })
      ),
    })
    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Review' }).click()

    const review = dialog(page)
    await expect(review.getByLabel('Menu name')).toHaveValue(`E2E Lunch ${stamp}`)
    await expect(review.getByLabel('Dish 1', { exact: true })).toHaveValue(dishes[0])
    await expect(review.getByLabel('Section of dish 1')).toHaveValue('Starters')
    await review.getByRole('button', { name: 'Add dish' }).click()
    await review.getByLabel('Dish 3', { exact: true }).fill(dishes[2])
    await review.getByLabel('Price of dish 3').fill('6,5')
    await review.getByRole('button', { name: 'Remove dish' }).nth(1).click()
    await review.getByLabel('Menu name').fill(`E2E Lunch Menu ${stamp}`)
    await review.getByRole('button', { name: /Confirm/ }).click()
    await expectToast(page, /applied/i)

    const menu = (await apiGet<{ id: string; name: string }[]>(page, '/api/menus')).find(
      (m) => m.name === `E2E Lunch Menu ${stamp}`
    )
    expect(menu, 'the reviewed menu reached the API').toBeDefined()
    const full = await apiGet<{ items: { id: string; name: string; price: number }[] }>(
      page,
      `/api/menus/${menu!.id}`
    )
    expect(full.items.map((i) => i.name)).toEqual([dishes[0], dishes[2]])
    expect(full.items[1].price).toBe(6.5)

    await page.request.delete(apiUrl(`/api/menus/${menu!.id}`))
    for (const item of full.items) await page.request.delete(apiUrl(`/api/menu-items/${item.id}`))
  })

  test('a confirmed invoice reaches the vendor it came from', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    const here = await workAtFirstLocation(page)
    const beef = (
      await apiGet<{ id: string; name: string; costPerUnit: number }[]>(page, '/api/ingredients')
    ).find((i) => i.name === 'Beef Tenderloin')!
    const stocked = await onHandAt(page, 'Beef Tenderloin', here)

    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('invoice')

    const number = `UI-VENDOR-${Date.now()}`
    const fileName = `vendor-${Date.now()}.json`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          vendorName: 'Prime Meats Co.',
          number,
          items: [{ rawName: 'Beef Tenderloin', quantity: 1, unit: 'kg', unitPrice: 39.5 }],
        })
      ),
    })

    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Review' }).click()
    await dialog(page)
      .getByRole('button', { name: /Confirm/ })
      .click()
    await expectToast(page, /applied/i)

    await page.goto('/vendors')
    await settled(page)
    const vendorRow = dataRows(page).filter({ hasText: 'Prime Meats Co.' }).first()
    await expect
      .poll(async () => (await vendorRow.locator('td:nth-child(4)').textContent())?.trim())
      .not.toBe('—')

    const invoices = await apiRows<{ id: string; number: string | null }>(page, '/api/invoices')
    const written = invoices.find((i) => i.number === number)
    expect(written, 'the confirmed document left an invoice behind').toBeDefined()
    const kept = await page.request.delete(apiUrl(`/api/invoices/${written!.id}`))
    expect(kept.status(), 'the invoice a confirm left is the record of what it moved').toBe(409)

    const headers = { 'X-Location-Id': here }
    const priced = await page.request.patch(apiUrl(`/api/ingredients/${beef.id}`), {
      headers,
      data: { costPerUnit: beef.costPerUnit },
    })
    expect(priced.ok(), 'the price this location paid is put back').toBeTruthy()
    const counted = await page.request.post(apiUrl('/api/inventory/transactions'), {
      headers,
      data: { ingredientId: beef.id, type: 'COUNT', quantity: stocked },
    })
    expect(counted.ok(), 'the stock the invoice added is counted back out').toBeTruthy()
  })

  test('a document that could not place every line says so and cannot be deleted', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('invoice')

    const fileName = `partial-${Date.now()}.json`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          number: `UI-PARTIAL-${Date.now()}`,
          items: [{ rawName: 'No Such Ingredient Here', quantity: 1, unit: 'kg', unitPrice: 5 }],
        })
      ),
    })

    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Review' }).click()
    await dialog(page)
      .getByRole('button', { name: /Confirm/ })
      .click()
    await expectToast(page, /applied/i)

    await expect(row.getByText('Partially Processed')).toBeVisible({ timeout: 15000 })
    await expect(row.getByRole('button', { name: 'Delete' })).toHaveCount(0)
  })

  test('a sales sheet with a date column is reviewed on the day it states, and the day can be corrected', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('sales')

    const stated = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)
    const fileName = `dated-sales-${Date.now()}.csv`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'text/csv',
      buffer: Buffer.from(`Date,Menu Item,Quantity,Unit Price\n${stated},Dated Probe Dish,2,5\n`),
    })

    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Review' }).click()
    const day = dialog(page).getByLabel('Sales date')
    await expect(day).toHaveValue(stated)
    await expect(day).toHaveAttribute('max', /\d{4}-\d{2}-\d{2}/)

    await dialog(page).getByRole('button', { name: 'Close' }).first().click()
    await row.getByRole('button', { name: 'Delete' }).click()
    await dialog(page).getByRole('button', { name: 'Delete' }).click()
    await expectToast(page, /deleted/i)
  })

  test('one refused file among several says so, and the others are still queued', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('menu')

    const fileName = `kept-${Date.now()}.json`
    await page.locator('input[type="file"]').setInputFiles([
      {
        name: fileName,
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ kind: 'menu', name: `Kept ${Date.now()}`, price: 3 })),
      },
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a document') },
    ])
    await expectToast(page, /1 file sent for reading, 1 file refused\. notes\.txt/)

    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Delete' }).click()
    await dialog(page).getByRole('button', { name: 'Delete' }).click()
    await expectToast(page, /deleted/i)
  })

  test('the file picker offers what the server reads and lets the same file be chosen again', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('menu')
    const picker = page.locator('input[type="file"]')
    await expect(picker).toHaveAttribute('accept', /\.pdf/)
    await expect(picker).toHaveAttribute('accept', /\.xlsx/)
    await expect(picker).not.toHaveAttribute('accept', /\.txt/)
    await expect(page.getByText('HEIC', { exact: true })).toHaveCount(0)

    const fileName = `again-${Date.now()}.json`
    await picker.setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ kind: 'menu', name: `Again ${Date.now()}`, price: 3 })),
    })
    await expectToast(page, /1 file sent for reading/)
    await expect(picker).toHaveValue('')
    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Delete' }).click()
    await dialog(page).getByRole('button', { name: 'Delete' }).click()
    await expectToast(page, /deleted/i)
  })

  test('a document that was never confirmed can be removed from the screen', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await page.getByLabel('Document type').selectOption('menu')

    const fileName = `discard-${Date.now()}.json`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({ kind: 'menu', name: `Discard ${Date.now()}`, price: 3 })
      ),
    })

    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })

    await row.getByRole('button', { name: 'Delete' }).click()
    await dialog(page).getByRole('button', { name: 'Delete' }).click()
    await expectToast(page, /deleted/i)
    await expect(row).toHaveCount(0)
  })
  test('a document waiting for review is announced in the navigation', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    const documents = page.locator('nav a[href="/documents"]').first()
    await expect(documents).toHaveText(/^Documents$/)

    const fileName = `badge-${Date.now()}.json`
    await page.getByLabel('Document type').selectOption('menu')
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ kind: 'menu', name: `Badge ${Date.now()}`, price: 8 })),
    })

    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })

    await page.reload()
    await settled(page)
    await expect(documents).toHaveText(/Documents\s*\d+/)

    await row.getByRole('button', { name: 'Delete' }).click()
    await dialog(page).getByRole('button', { name: 'Delete' }).click()
    await expectToast(page, /deleted/i)
    await expect(documents).toHaveText(/^Documents$/)
  })

  test('four files uploaded after the access token expires keep the session and all arrive', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await page.goto('/documents')
    await settled(page)

    await page.context().clearCookies({ name: 'access_token' })

    const stamp = Date.now()
    const files = ['invoice', 'recipe', 'menu', 'sales'].map((kind) => ({
      name: `expired-${kind}-${stamp}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({ kind: 'menu', name: `Expired ${kind} ${stamp}`, price: 5 })
      ),
    }))
    await page.getByLabel('Document type').selectOption('menu')
    await page.locator('input[type="file"]').setInputFiles(files)

    await expectToast(page, /4 files sent for reading/)
    for (const f of files) {
      await expect(page.locator('tbody tr').filter({ hasText: f.name })).toBeVisible({
        timeout: 15000,
      })
    }

    await page.context().clearCookies({ name: 'access_token' })
    await page.reload()
    await expect(page.locator('tbody tr').filter({ hasText: files[0].name })).toBeVisible()
    await expect(page).toHaveURL(/\/documents$/)

    const listed = await apiRows<{ id: string; file: string }>(page, '/api/documents')
    for (const d of listed.filter((d) => d.file.includes(`-${stamp}.json`))) {
      await expect
        .poll(async () => (await page.request.delete(apiUrl(`/api/documents/${d.id}`))).status(), {
          timeout: 20000,
        })
        .not.toBe(409)
    }
  })
})
