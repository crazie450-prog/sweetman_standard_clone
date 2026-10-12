import { expect, test } from '@playwright/test'
import {
  apiGet,
  apiUrl,
  dataRows,
  dialog,
  expectToast,
  onHandOf,
  settled,
  signInAs,
  workAtFirstLocation,
} from '../helpers'

test.describe('The waste list in a dark theme', () => {
  test.use({ colorScheme: 'dark' })

  test('the ingredient picked out of the waste list stays readable', async ({ page }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/waste')
    await settled(page)

    const row = page.getByRole('button', { name: /San Marzano Tomatoes/ })
    await row.click()
    const contrast = await row.evaluate((el) => {
      const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      const luminance = (colour: string) => {
        const [r, g, b] = colour
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map((n) => channel(Number(n) / 255))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const style = getComputedStyle(el)
      let behind = style.backgroundColor
      for (
        let node = el as HTMLElement | null;
        node && /, 0\)$/.test(behind);
        node = node.parentElement
      ) {
        behind = getComputedStyle(node).backgroundColor
      }
      const [light, dark] = [luminance(style.color), luminance(behind)].sort((a, b) => b - a)
      return (light + 0.05) / (dark + 0.05)
    })
    expect(contrast).toBeGreaterThan(3)
  })
})

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

  test('a waste entry clicked twice while it is being sent is logged once', async ({ page }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    let posted = 0
    await page.route('**/api/waste', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      posted++
      await new Promise((r) => setTimeout(r, 1500))
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' })
    })

    await page.goto('/waste')
    await settled(page)
    await page.getByRole('button', { name: /San Marzano Tomatoes/ }).click()
    await page.getByLabel('Quantity').fill('0.1')
    await page.getByLabel('Reason').selectOption({ index: 1 })
    const logIt = page.getByRole('button', { name: 'Log Waste' })
    await logIt.click()
    await logIt.click({ timeout: 1000 }).catch(() => {})
    await page.waitForTimeout(2000)

    expect(posted).toBe(1)
  })

  test('waste is logged for the day it happened', async ({ page }) => {
    await signInAs(page, 'owner')
    const locationId = await workAtFirstLocation(page)
    const happened = new Date(Date.now() - 2 * 24 * 3600 * 1000)
    const asTyped = happened.toISOString().slice(0, 10)
    const asShown = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${asTyped}T12:00:00Z`))

    await page.goto('/waste')
    await settled(page)
    await page.getByRole('button', { name: /San Marzano Tomatoes/ }).click()
    await page.getByLabel('Quantity').fill('0.4')
    await page.getByLabel('Reason').selectOption({ index: 1 })
    await page.getByLabel('Date').fill(asTyped)
    await page.getByRole('button', { name: 'Log Waste' }).click()
    await expectToast(page, /Waste logged/i)

    const logged = page
      .locator('tbody tr')
      .filter({ hasText: 'San Marzano Tomatoes' })
      .filter({ hasText: '0.4 kg' })
      .first()
    await expect(logged).toContainText(asShown)

    const ingredients = await page.request.get(apiUrl('/api/ingredients'))
    const id = ((await ingredients.json()) as { id: string; name: string }[]).find(
      (i) => i.name === 'San Marzano Tomatoes'
    )!.id
    await page.request.post(apiUrl('/api/inventory/transactions'), {
      headers: { 'X-Location-Id': locationId },
      data: { ingredientId: id, type: 'RECEIVE', quantity: 0.4 },
    })
  })

  test('waste is logged only once a location is chosen', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.evaluate(() => window.localStorage.removeItem('nexus.locationId'))
    await page.goto('/waste')
    await settled(page)
    await expect(page.getByText('No Location Chosen')).toBeVisible()
    await expect(page.getByRole('button', { name: /Heavy Cream/ })).toBeDisabled()
    await workAtFirstLocation(page)
    await page.reload()
    await settled(page)
    await expect(page.getByRole('button', { name: /Heavy Cream/ })).toBeEnabled()
  })

  test('waste refuses an entry without a reason', async ({ page }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/waste')
    await settled(page)
    await page.getByRole('button', { name: /Heavy Cream/ }).click()
    await page.getByLabel('Quantity').fill('1')
    await page.getByRole('button', { name: 'Log Waste' }).click()
    await expectToast(page, /quantity and reason/i)
  })

  test('the waste list offers stock rather than price', async ({ page }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/waste')
    await settled(page)

    const row = page.getByRole('button', { name: /San Marzano Tomatoes/ })
    await expect(row).toContainText(/in stock/)
    await expect(row).not.toContainText(/\$/)
  })

  test('waste beyond the stock on hand cannot be logged', async ({ page }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/waste')
    await settled(page)

    await page.getByRole('button', { name: /San Marzano Tomatoes/ }).click()
    const available = await onHandOf(page, 'San Marzano Tomatoes')
    await page.getByLabel('Quantity').fill(String(available + 10))
    await page.getByLabel('Reason').selectOption({ index: 1 })
    await expect(page.getByRole('button', { name: 'Log Waste' })).toBeDisabled()
    await expect(page.getByRole('alert').filter({ hasText: /in stock/i })).toBeVisible()
  })

  test('the cap follows the unit chosen, so grams are measured against kilograms on hand', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/waste')
    await settled(page)

    await page.getByRole('button', { name: /San Marzano Tomatoes/ }).click()
    const hint = await page.getByText(/^Available: [\d.]+ kg$/).textContent()
    const available = Number(hint!.match(/[\d.]+/)![0])
    expect(available).toBeGreaterThan(0)
    await page.getByLabel('Unit').selectOption('g')
    await expect(page.getByText(`Available: ${Math.round(available * 1000)} g`)).toBeVisible()
    await page.getByLabel('Reason').selectOption({ index: 1 })

    await page.getByLabel('Quantity').fill(String(available * 1000 + 1))
    await expect(page.getByRole('button', { name: 'Log Waste' })).toBeDisabled()
    await page.getByLabel('Quantity').fill(String(available * 1000))
    await expect(page.getByRole('button', { name: 'Log Waste' })).toBeEnabled()
  })

  test('a sale and a batch are recorded only once a location is chosen', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.evaluate(() => window.localStorage.removeItem('nexus.locationId'))
    await page.goto('/sales')
    await settled(page)
    await expect(page.getByRole('button', { name: '+ Record New Sale' })).toBeDisabled()
    await expect(page.getByText(/Choose a location in the header to record a sale/)).toBeVisible()
    await page.goto('/production')
    await settled(page)
    await expect(page.getByRole('button', { name: 'Record Batch' })).toBeDisabled()
    await workAtFirstLocation(page)
    await page.reload()
    await settled(page)
    await expect(page.getByRole('button', { name: 'Record Batch' })).toBeEnabled()
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
    await dialog(page)
      .getByRole('button', { name: /record|save/i })
      .last()
      .click()
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
    await expect(dataRows(page)).not.toHaveCount(0)
    const rowsBefore = await dataRows(page).count()

    await page.getByRole('button', { name: /Record Batch/i }).click()
    await dialog(page).locator('select').first().selectOption({ index: 1 })
    await dialog(page)
      .getByLabel(/quantity/i)
      .fill('2')
    const cook = `Probe Cook ${Date.now()}`
    await dialog(page).getByLabel('Made by').fill(cook)
    await dialog(page)
      .getByRole('button', { name: /record|save/i })
      .last()
      .click()
    await expectToast(page, /batch recorded/i)

    await page.reload()
    await settled(page)
    await expect(dataRows(page)).toHaveCount(rowsBefore + 1, { timeout: 15000 })
    await expect(dataRows(page).filter({ hasText: cook })).toHaveCount(1)
    expect(await onHandOf(page, 'Eggs')).toBeCloseTo(before, 2)
  })
})

test.describe('Screens waiting for document processing', () => {
  test('a prep list that only ever says it is coming is not offered', async ({ page }) => {
    await signInAs(page, 'owner')
    await settled(page)
    await expect(page.locator('a[href="/prep-list"]')).toHaveCount(0)
    const response = await page.goto('/prep-list')
    expect(response?.status()).toBe(404)
  })

  test('no screen offers a control that only answers "not available yet"', async ({ page }) => {
    await signInAs(page, 'owner')
    const offered: [string, string][] = [
      ['/sales', 'Export'],
      ['/sales', 'Columns'],
      ['/inventory', 'Reconcile Inventory'],
      ['/inventory', 'Mobile Count'],
      ['/inventory', 'Find Duplicates'],
      ['/recipes', 'Find Duplicates'],
      ['/components', 'Find Duplicates'],
    ]
    for (const [route, label] of offered) {
      await page.goto(route)
      await settled(page)
      await expect(
        page.getByRole('button', { name: label, exact: true }),
        `${label} on ${route}`
      ).toHaveCount(0)
    }

    await page.goto('/settings')
    await settled(page)
    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add Conversion' })).toHaveCount(0)
  })
})

test.describe('Sales screen', () => {
  test('the sales count follows the chosen period like the cards beside it', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/sales')
    await settled(page)
    await expect(page.getByText("Today's Sales", { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Last 30 Days' }).click()
    await settled(page)
    const month = await page
      .locator('.lift')
      .filter({ has: page.getByText('Sales', { exact: true }) })
      .textContent()
    await page.getByRole('button', { name: 'Last 7 Days' }).click()
    await settled(page)
    await expect
      .poll(() =>
        page
          .locator('.lift')
          .filter({ has: page.getByText('Sales', { exact: true }) })
          .textContent()
      )
      .not.toBe(month)
  })

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
    const revenues = (await dataRows(page).locator('td:nth-child(3)').allTextContents())
      .map((t) => Number(t.replace(/[^\d.]/g, '')))
      .sort((a, b) => a - b)
    const median = revenues[Math.floor(revenues.length / 2)]
    await page.getByLabel('Min Revenue ($)').fill(String(median))
    await page.waitForTimeout(800)
    const filtered = await dataRows(page).count()
    expect(filtered).toBeLessThan(month)
    expect(filtered).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Clear Filters' }).click()
    await page.waitForTimeout(800)
    expect(await dataRows(page).count()).toBe(month)
  })

  test('the food cost filter keeps a day whose printed share is the bound', async ({ page }) => {
    await page.route(
      (url) => url.pathname === '/api/sales/daily',
      async (route) => {
        const real = await route.fetch()
        const body = (await real.json()) as { revenue: number; cost: number; profit: number }[]
        Object.assign(body[0], { revenue: 100, cost: 30.04, profit: 69.96 })
        await route.fulfill({ response: real, json: body })
      }
    )
    await signInAs(page, 'owner')
    await page.goto('/sales')
    await settled(page)
    await page.getByRole('button', { name: 'Last 30 Days' }).click()
    await settled(page)
    const probe = dataRows(page).filter({ hasText: '$30.04' })
    await expect(probe).toContainText('30.0%')

    await page.getByLabel('Max Food Cost (%)').fill('30')
    await expect(probe).toHaveCount(1)
    await page.getByLabel('Min Food Cost (%)').fill('30')
    await page.getByLabel('Max Food Cost (%)').fill('')
    await expect(probe).toHaveCount(1)
  })

  test('a sale of two and a half dishes is refused, not recorded as two', async ({ page }) => {
    const recorded: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/sales')
        recorded.push(r.url())
    })
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/sales')
    await settled(page)
    await page.getByRole('button', { name: '+ Record New Sale' }).click()
    const form = dialog(page)
    await form.getByLabel('Menu Item').selectOption({ index: 1 })
    await form.getByLabel('Quantity').fill('2.5')
    await form.getByRole('button', { name: 'Record Sale' }).click()
    await expectToast(page, /Quantity is a whole number/)
    await expect(form).toBeVisible()
    expect(recorded).toHaveLength(0)
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

test.describe('Days in a browser west of UTC', () => {
  test.use({ timezoneId: 'America/Los_Angeles' })

  const evening = () => {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 5, 0, 0))
  }
  const localDay = (at: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(at)
  const shown = (day: string) =>
    new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${day}T12:00:00Z`))

  test('a waste entry starts on the day the person is living in', async ({ page }) => {
    const at = evening()
    await page.clock.setFixedTime(at)
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/waste')
    await settled(page)
    await page.getByRole('button', { name: /San Marzano Tomatoes/ }).click()
    await expect(page.getByLabel('Date')).toHaveValue(localDay(at))
  })

  test('a day the server names is printed as that day', async ({ page }) => {
    await signInAs(page, 'owner')
    const days = await apiGet<{ date: string }[]>(page, '/api/sales/daily')
    await page.goto('/sales')
    await settled(page)
    await page.getByRole('button', { name: 'Last 90 Days' }).click()
    await settled(page)
    await expect(dataRows(page).first()).toBeVisible()
    const first = (await dataRows(page).first().locator('td').first().textContent())?.trim()
    const newest = days
      .map((d) => d.date)
      .filter((d) => d <= localDay(new Date()))
      .sort((a, b) => b.localeCompare(a))[0]
    expect(first).toBe(shown(newest))
  })
})

test.describe('Days in a browser east of the restaurant', () => {
  test.use({ timezoneId: 'Asia/Tokyo' })

  const tokyoNoon = () => {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 0, 0))
  }
  const dayAt = (at: Date, zone: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(at)

  test('the forms start on the restaurant day and offer nothing later', async ({ page }) => {
    const at = tokyoNoon()
    const restaurant = dayAt(at, 'America/New_York')
    expect(dayAt(at, 'Asia/Tokyo'), 'the person is a day ahead').not.toBe(restaurant)
    await page.clock.setFixedTime(at)
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)

    await page.goto('/waste')
    await settled(page)
    await page.getByRole('button', { name: /San Marzano Tomatoes/ }).click()
    await expect(page.getByLabel('Date')).toHaveValue(restaurant)
    await expect(page.getByLabel('Date')).toHaveAttribute('max', restaurant)

    await page.goto('/sales')
    await settled(page)
    await page.getByRole('button', { name: '+ Record New Sale' }).click()
    await expect(dialog(page).getByLabel('Date')).toHaveValue(restaurant)
    await expect(dialog(page).getByLabel('Date')).toHaveAttribute('max', restaurant)
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()

    await page.goto('/production')
    await settled(page)
    await page.getByRole('button', { name: 'Record Batch' }).first().click()
    await expect(dialog(page).getByLabel('Date')).toHaveValue(restaurant)
    await expect(dialog(page).getByLabel('Date')).toHaveAttribute('max', restaurant)
  })
})

test.describe('A period that starts from today', () => {
  test.use({ timezoneId: 'America/New_York' })

  const key = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

  test('the last thirty days end on the day the screen is opened, not the day the app was', async ({
    page,
  }) => {
    const now = new Date()
    const lateEvening = new Date(`${key(now)}T23:50:00-04:00`)
    await page.clock.install({ time: new Date(lateEvening.getTime() - 86400000) })
    await signInAs(page, 'owner')
    await page.goto('/sales')
    await settled(page)
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
    await page.waitForURL(/dashboard/)
    await settled(page)

    await page.clock.fastForward('00:20:00')
    const today = key(new Date(lateEvening.getTime() - 86400000 + 20 * 60000))
    await page.getByRole('button', { name: 'Operations', exact: true }).click()
    await page.getByRole('link', { name: 'Sales', exact: true }).first().click()
    await page.waitForURL(/sales/)
    await settled(page)
    await expect(page.getByRole('textbox', { name: 'To', exact: true })).toHaveValue(today)
    const from = new Date(`${today}T12:00:00Z`)
    from.setUTCDate(from.getUTCDate() - 29)
    await expect(page.getByRole('textbox', { name: 'From', exact: true })).toHaveValue(
      from.toISOString().slice(0, 10)
    )
  })
})
