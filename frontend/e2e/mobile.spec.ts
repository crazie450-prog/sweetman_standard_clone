import { expect, test, type Page } from '@playwright/test'
import {
  ACCOUNTS,
  apiGet,
  apiUrl,
  dataRows,
  dialog,
  expectToast,
  fillCredentials,
  locationOptions,
  onHandOf,
  recipeCost,
  settled,
  signIn,
  switchLocation,
  workAtFirstLocation,
} from './helpers'

// Runs only in the `mobile` project (a phone viewport with touch); see playwright.config.ts.

// The shell clips sideways overflow, so a too-wide element is not scrolled to but cut off;
// the check therefore measures every visible element that no container of its own clips or
// scrolls: a table inside its scrolling card and a decoration inside a clipped card are fine.
async function expectNoHorizontalScroll(page: Page, where: string) {
  await settled(page)
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const clipped = (el: Element) => {
      for (
        let node = el.parentElement;
        node && node.tagName !== 'MAIN';
        node = node.parentElement
      ) {
        if (getComputedStyle(node).overflowX !== 'visible') return true
      }
      return false
    }
    let worst = 0
    for (const el of document.querySelectorAll('main *')) {
      const box = el.getBoundingClientRect()
      if (box.width === 0 || clipped(el)) continue
      worst = Math.max(worst, box.right - width)
    }
    return Math.round(worst)
  })
  expect(overflow, `${where} is cut off by ${overflow}px on the right`).toBeLessThanOrEqual(0)
}

async function openFromDrawer(page: Page, label: string, path: RegExp) {
  await page.getByRole('button', { name: 'Open menu' }).click()
  const drawer = page.locator('aside:visible')
  await expect(drawer).toBeVisible()
  await drawer.getByRole('link', { name: label, exact: true }).click()
  await page.waitForURL(path)
  await expect(drawer).toBeHidden()
  await settled(page)
}

async function expectInsideViewport(page: Page, locator: ReturnType<Page['locator']>) {
  const viewport = page.viewportSize()!
  const box = await locator.boundingBox()
  expect(box, 'the element has no box').not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
}

async function uploadJson(page: Page, fileName: string, payload: unknown) {
  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  })
  const row = page.locator('tbody tr').filter({ hasText: fileName })
  await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
  return row
}

test.describe('A phone runs the core workflows', () => {
  test('login: the form fits the screen and the shell opens as a drawer', async ({ page }) => {
    await page.goto('/login')
    await expectNoHorizontalScroll(page, 'the sign-in form')
    await fillCredentials(page, ACCOUNTS.owner.email, ACCOUNTS.owner.password)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await page.waitForURL('**/dashboard')
    await expectNoHorizontalScroll(page, 'the dashboard')

    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeHidden()

    await page.getByRole('button', { name: 'Open menu' }).click()
    const drawer = page.locator('aside:visible')
    await expect(drawer.getByRole('link', { name: 'Inventory', exact: true })).toBeVisible()
    await page.mouse.click(400, 500)
    await expect(drawer).toBeHidden()
  })

  test('location selection: the header switch changes the stock on hand', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    await openFromDrawer(page, 'Inventory', /\/inventory$/)
    await expectInsideViewport(page, page.getByRole('combobox', { name: 'Location' }))

    const options = await locationOptions(page)
    expect(options.length).toBeGreaterThan(2)
    const readOnHand = async () =>
      (await dataRows(page).locator('td:nth-child(4)').allTextContents()).map((c) => c.trim())

    await switchLocation(page, options[1])
    const first = await readOnHand()
    expect(first.length).toBeGreaterThan(0)

    await switchLocation(page, options[2])
    await expect
      .poll(async () => (await readOnHand()).join('|'), { timeout: 15000 })
      .not.toBe(first.join('|'))

    await page.reload()
    await settled(page)
    const kept = await page.locator('select[aria-label="Location"] option:checked').textContent()
    expect(kept?.trim()).toBe(options[2])
  })

  test('invoice upload: a file is uploaded, reviewed and confirmed from the phone', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await openFromDrawer(page, 'Documents', /\/documents$/)
    await expectNoHorizontalScroll(page, 'the documents screen')

    await page.getByLabel('Document type').selectOption('invoice')
    const stamp = Date.now()
    const probe = `Phone Probe Ingredient ${stamp}`
    const row = await uploadJson(page, `phone-invoice-${stamp}.json`, {
      kind: 'invoice',
      number: `PHONE-${stamp}`,
      items: [{ rawName: probe, quantity: 2, unit: 'kg', unitPrice: 4 }],
    })

    await row.getByRole('button', { name: 'Review' }).click()
    const review = dialog(page)
    await expect(review).toBeVisible()
    await expectInsideViewport(page, review)
    const nameField = review.locator('tbody input').first()
    await expect(nameField).toHaveValue(probe)
    await expectInsideViewport(page, review.getByRole('button', { name: /Confirm/ }))

    await review.getByRole('button', { name: /Confirm/ }).click()
    await expectToast(page, /applied/i)
    await expect(row.getByText('Partially Processed')).toBeVisible({ timeout: 15000 })
  })

  test('recipe and menu upload: both files reach review and are confirmed', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    const stamp = Date.now()

    await openFromDrawer(page, 'Recipes', /\/recipes$/)
    await page.getByRole('button', { name: 'Upload recipes' }).click()
    await expectInsideViewport(page, dialog(page))
    const recipeName = `Phone Recipe ${stamp}`
    await dialog(page)
      .locator('input[type="file"]')
      .setInputFiles({
        name: `phone-recipe-${stamp}.json`,
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify({
            kind: 'recipe',
            name: recipeName,
            portions: 4,
            items: [{ rawName: 'San Marzano Tomatoes', quantity: 1, unit: 'kg' }],
          })
        ),
      })
    await expectToast(page, /sent for reading/)
    await openFromDrawer(page, 'Documents', /\/documents$/)
    const recipeRow = page.locator('tbody tr').filter({ hasText: `phone-recipe-${stamp}.json` })
    await expect(recipeRow.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await recipeRow.getByRole('button', { name: 'Review' }).click()
    await expectInsideViewport(page, dialog(page))
    await dialog(page)
      .getByRole('button', { name: /Confirm/ })
      .click()
    await expect(recipeRow.getByText('Confirmed')).toBeVisible({ timeout: 15000 })
    expect(await recipeCost(page, recipeName)).toBeGreaterThan(0)

    await page.getByLabel('Document type').selectOption('menu')
    const dishName = `Phone Dish ${stamp}`
    const menuRow = await uploadJson(page, `phone-menu-${stamp}.json`, {
      kind: 'menu',
      name: dishName,
      price: 18,
      section: 'Mains',
    })
    await menuRow.getByRole('button', { name: 'Review' }).click()
    await dialog(page)
      .getByRole('button', { name: /Confirm/ })
      .click()
    await expect(menuRow.getByText('Confirmed')).toBeVisible({ timeout: 15000 })
    const dishes = await apiGet<{ id: string; name: string }[]>(page, '/api/menu-items')
    const dish = dishes.find((d) => d.name === dishName)
    expect(dish, 'the menu file created no dish').toBeDefined()

    const recipes = await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')
    const recipe = recipes.find((r) => r.name === recipeName)!
    expect((await page.request.delete(apiUrl(`/api/menu-items/${dish!.id}`))).ok()).toBeTruthy()
    expect((await page.request.delete(apiUrl(`/api/recipes/${recipe.id}`))).ok()).toBeTruthy()
    const menu = (await apiGet<{ id: string; name: string }[]>(page, '/api/menus')).find(
      (m) => m.name === `phone-menu-${stamp}`
    )
    expect(menu, 'the menu file created its menu').toBeDefined()
    expect((await page.request.delete(apiUrl(`/api/menus/${menu!.id}`))).ok()).toBeTruthy()
  })

  test('waste tracking: an entry is logged from the phone and the stock moves', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    const locationId = await workAtFirstLocation(page)
    const before = await onHandOf(page, 'San Marzano Tomatoes')

    await openFromDrawer(page, 'Waste Entry', /\/waste$/)
    await expectNoHorizontalScroll(page, 'the waste screen')
    await page.getByRole('button', { name: /San Marzano Tomatoes/ }).click()
    await page.getByLabel('Quantity').fill('0.5')
    await page.getByLabel('Reason').selectOption({ index: 1 })
    const submit = page.getByRole('button', { name: 'Log Waste' })
    await submit.scrollIntoViewIfNeeded()
    await expectInsideViewport(page, submit)
    await submit.click()
    await expectToast(page, /Waste logged/i)
    expect(await onHandOf(page, 'San Marzano Tomatoes')).toBeCloseTo(before - 0.5, 2)

    const ingredients = await apiGet<{ id: string; name: string }[]>(page, '/api/ingredients')
    const id = ingredients.find((i) => i.name === 'San Marzano Tomatoes')!.id
    await page.request.post(apiUrl('/api/inventory/transactions'), {
      headers: { 'X-Location-Id': locationId },
      data: { ingredientId: id, type: 'RECEIVE', quantity: 0.5 },
    })
    expect(await onHandOf(page, 'San Marzano Tomatoes')).toBeCloseTo(before, 2)
  })

  test('inventory review: the table scrolls inside its card and the adjust dialog fits', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await openFromDrawer(page, 'Inventory', /\/inventory$/)
    await expect.poll(() => dataRows(page).count(), { timeout: 15000 }).toBeGreaterThan(0)
    await expectNoHorizontalScroll(page, 'the inventory screen')

    const adjust = dataRows(page).first().getByRole('button', { name: 'Adjust' })
    await adjust.scrollIntoViewIfNeeded()
    await adjust.click()
    const window = dialog(page)
    await expect(window).toBeVisible()
    await expectInsideViewport(page, window)
    await expectInsideViewport(page, window.getByRole('button', { name: 'Save Adjustment' }))
    await window.getByRole('button', { name: 'Cancel' }).click()
    await expect(window).toBeHidden()
  })

  test('on a phone the action column scrolls with the row instead of covering it', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await openFromDrawer(page, 'Inventory', /\/inventory$/)
    await expect.poll(() => dataRows(page).count(), { timeout: 15000 }).toBeGreaterThan(0)
    const position = await dataRows(page)
      .first()
      .locator('td')
      .last()
      .evaluate((el) => getComputedStyle(el).position)
    expect(position).toBe('static')
  })

  test('the admin header keeps its tabs on one row and the exit link beside them', async ({
    page,
  }) => {
    await signIn(page, { email: 'platform@nexus.app', password: 'Nexus_dev1' })
    await page.goto('/admin/organizations')
    await settled(page)
    const brand = (await page.getByText('Nexus Platform Admin').boundingBox())!
    const exit = (await page.getByRole('link', { name: 'Exit admin' }).boundingBox())!
    const queue = (await page.getByRole('link', { name: 'Processing Queue' }).boundingBox())!
    expect(Math.abs(exit.y - brand.y)).toBeLessThan(brand.height)
    expect(queue.height).toBeLessThan(40)
  })

  test('an empty table says so inside the screen, not past its edge', async ({ page }) => {
    await signIn(page, { email: 'platform@nexus.app', password: 'Nexus_dev1' })
    await page.goto('/admin/users')
    await settled(page)
    const message = page.getByText('Type part of an email or a name to search.')
    await expect(message).toBeVisible()
    const box = (await message.boundingBox())!
    const width = page.viewportSize()!.width
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
  })

  test('sales upload: a sales file is confirmed from the phone', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)
    await openFromDrawer(page, 'Documents', /\/documents$/)
    await page.getByLabel('Document type').selectOption('sales')

    const stamp = Date.now()
    const row = await uploadJson(page, `phone-sales-${stamp}.json`, {
      kind: 'sales',
      date: '2026-09-10',
      items: [
        {
          menuItemName: 'Beef Wellington (for two)',
          quantity: 1,
          unitPrice: 62 + (stamp % 1000) / 100,
        },
      ],
    })
    await row.getByRole('button', { name: 'Review' }).click()
    await expectInsideViewport(page, dialog(page))
    await dialog(page)
      .getByRole('button', { name: /Confirm/ })
      .click()
    await expectToast(page, /applied/i)
    await expect(row.getByText('Confirmed')).toBeVisible({ timeout: 15000 })
  })

  test('basic report review: reports and food-cost analysis read on a phone', async ({ page }) => {
    await signIn(page, ACCOUNTS.owner)
    await workAtFirstLocation(page)

    await openFromDrawer(page, 'Reports', /\/reports$/)
    await expect(
      page.getByRole('heading', { name: 'Comprehensive Reports & Analytics', level: 1 })
    ).toBeVisible()
    await expectNoHorizontalScroll(page, 'the reports screen')
    for (const tab of ['Production History', 'Price Trends', 'Inventory History']) {
      await page.getByRole('tab', { name: tab }).click()
      await settled(page)
      await expectNoHorizontalScroll(page, `the ${tab} tab`)
    }
    expect(await dataRows(page).count()).toBeGreaterThan(0)

    await openFromDrawer(page, 'Food Cost Analysis', /\/analytics\/food-cost$/)
    await expect(page.getByRole('heading', { name: 'Food Cost Analysis', level: 1 })).toBeVisible()
    await expect(page.getByText('Theoretical Cost')).toBeVisible()
    await expectNoHorizontalScroll(page, 'the food-cost screen')
  })
})
