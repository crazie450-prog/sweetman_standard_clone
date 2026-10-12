import { expect, test } from '@playwright/test'
import { apiGet, dataRows, settled, signInAs } from '../helpers'

type DailySale = { date: string; revenue: number; cost: number; profit: number }
type TrendPoint = { date: string; revenue: number }

const money = (text: string) => Number(text.replace(/[^\d.]/g, ''))

test.describe('Dashboard', () => {
  test("today's numbers match the sales the API reports", async ({ page }) => {
    await signInAs(page, 'owner')
    await settled(page)

    const daily = await apiGet<DailySale[]>(page, '/api/sales/daily')
    const today = daily.find((d) => d.date === new Date().toISOString().slice(0, 10))
    test.skip(!today, 'no sale recorded for today on this stand')

    // The KPI values count up on mount, so poll until they settle.
    const kpi = async (label: RegExp) => {
      const text = (await page.getByRole('main').innerText()).replace(/\s+/g, ' ')
      const match = text.match(label)
      return match ? money(match[0]) : 0
    }

    await expect
      .poll(() => kpi(/Today.s Revenue \$[\d,.]+/), { timeout: 15000 })
      .toBeCloseTo(today!.revenue, 1)
    await expect
      .poll(() => kpi(/Today.s Profit \$[\d,.]+/), { timeout: 15000 })
      .toBeCloseTo(today!.profit, 1)
  })

  test('a profit after a day at a loss is shown as a rise', async ({ page }) => {
    await page.route('**/api/dashboard/trends', async (route) => {
      const real = await route.fetch()
      const body = (await real.json()) as { profit: number[] }
      body.profit = [...body.profit.slice(0, -2), -100, 50]
      await route.fulfill({ response: real, json: body })
    })
    await page.route('**/api/dashboard/kpis', async (route) => {
      const real = await route.fetch()
      await route.fulfill({ response: real, json: { ...(await real.json()), todayProfit: 50 } })
    })
    await signInAs(page, 'owner')
    await settled(page)
    await expect(page.getByRole('main')).toContainText('+150.0%')
    await expect(page.getByRole('main')).not.toContainText('-150.0%')
  })

  test('the food cost card says which period it covers', async ({ page }) => {
    await signInAs(page, 'owner')
    await settled(page)
    await expect(page.getByText(/Food Cost % · 30 days/)).toBeVisible()
  })

  test('the revenue trend adds up to the sales table', async ({ page }) => {
    await signInAs(page, 'owner')
    await settled(page)

    const [trend, daily] = await Promise.all([
      apiGet<TrendPoint[]>(page, '/api/analytics/revenue-trend'),
      apiGet<DailySale[]>(page, '/api/sales/daily'),
    ])

    // The trend covers the last 30 days; the sales table covers everything
    // recorded. Compare the days both of them report.
    const days = new Set(trend.map((p) => p.date))
    const trendSum = trend.reduce((s, p) => s + p.revenue, 0)
    const salesSum = daily.filter((d) => days.has(d.date)).reduce((s, d) => s + d.revenue, 0)

    expect(days.size).toBeGreaterThan(0)
    expect(trendSum).toBeCloseTo(salesSum, 2)
  })

  test('the overview counts match the records behind them', async ({ page }) => {
    await signInAs(page, 'owner')
    await settled(page)

    const [recipes, menu, ingredients] = await Promise.all([
      apiGet<unknown[]>(page, '/api/recipes'),
      apiGet<unknown[]>(page, '/api/menu-items'),
      apiGet<unknown[]>(page, '/api/ingredients'),
    ])

    const overview = async () => (await page.getByRole('main').innerText()).replace(/\s+/g, ' ')
    await expect
      .poll(overview, { timeout: 15000 })
      .toContain(`${ingredients.length} Inventory Items`)
    expect(await overview()).toContain(`${menu.length} Menu Items`)
    expect(await overview()).toContain(`${recipes.length} Recipes`)
  })
})

test.describe('Reports', () => {
  test('every tab carries rows and its own totals', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/reports')
    await settled(page)

    for (const tab of [
      'Inventory History',
      'Usage Over Time',
      'Production History',
      'Price Trends',
    ]) {
      await page.getByRole('tab', { name: tab }).click()
      await settled(page)
      expect(await dataRows(page).count(), `${tab} has no rows`).toBeGreaterThan(0)
    }
  })

  test('the peak week is named the way the table names its weeks', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/reports')
    await settled(page)
    await page.getByRole('tab', { name: 'Usage Over Time' }).click()
    await settled(page)

    const periods = await dataRows(page).locator('td:nth-child(1)').allTextContents()
    expect(periods.length).toBeGreaterThan(0)
    const peak = (await page.getByText('Peak Week').locator('../..').innerText()).replace(
      /\s+/g,
      ' '
    )
    expect(peak).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(periods.map((p) => p.trim())).toContain(peak.replace('Peak Week', '').trim())
  })

  test('quantities are printed with their unit', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/reports')
    await settled(page)

    const quantities = await dataRows(page).locator('td:nth-child(5)').allTextContents()
    expect(quantities.length).toBeGreaterThan(0)
    for (const value of quantities) {
      expect(value.trim(), 'a bare number means the unit was dropped').toMatch(/\d\s*\S+/)
    }
  })

  test('the date range narrows the transaction list', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/reports')
    await settled(page)

    await expect(dataRows(page).first()).not.toHaveText(/No transactions/, { timeout: 15000 })
    const before = await dataRows(page).count()
    const dates = page.locator('input[type=date]')
    await dates.first().fill('2000-01-01')
    await dates.last().fill('2000-01-02')
    await settled(page)
    await page.waitForTimeout(800)
    expect(await dataRows(page).count()).toBeLessThan(before)
  })

  test('the period is asked of the server, and a backwards one is named instead', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/reports')
    await settled(page)

    const dates = page.locator('input[type=date]')
    const asked = page.waitForRequest(
      (r) =>
        r.url().includes('/api/inventory/transactions') &&
        r.url().includes('from=2020-03-01') &&
        r.url().includes('to=2020-03-31')
    )
    await dates.first().fill('2020-03-01')
    await dates.last().fill('2020-03-31')
    await asked

    await dates.first().fill('2020-04-15')
    await expect(page.getByText('The period ends before it begins')).toBeVisible()
  })
})

test.describe('Food cost analysis', () => {
  test('theoretical cost and variance are computed and shown by category', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/analytics/food-cost')
    await settled(page)

    await expect(page.getByText('Implied by recipes and sales')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Variance by Category' })).toBeVisible()
    await expect(page.getByText(/Variance analysis arrives with the costing engine/i)).toHaveCount(
      0
    )
  })

  test('the actual cost card, the waste block and the explanation tell one story for the period', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/analytics/food-cost')
    await settled(page)

    const from = await page.getByLabel('From date').inputValue()
    const to = await page.getByLabel('To date').inputValue()
    const report = await apiGet<{ theoreticalCost: number; actualCost: number; wasteCost: number }>(
      page,
      `/api/analytics/food-cost-variance?from=${from}&to=${to}`
    )
    const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    expect(report.actualCost).not.toBeCloseTo(report.theoreticalCost, 2)

    const actualCard = page
      .locator('.lift')
      .filter({ has: page.getByText('Actual Cost', { exact: true }) })
    await expect(actualCard).toContainText(usd(report.actualCost))
    await expect(actualCard).not.toContainText(usd(report.theoreticalCost))

    const waste = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: 'Waste Analysis' }) })
      .last()
    await expect(waste).toContainText(usd(report.wasteCost))

    await expect(page.getByText(/calculated from invoices/i)).toHaveCount(0)

    await page.getByLabel('From date').fill('2026-09-30')
    await page.getByLabel('To date').fill('2026-08-01')
    await expect(waste).toContainText(usd(0))
  })

  test('the report costs the dishes that were sold, standard against actual', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/analytics/food-cost')
    await settled(page)

    await expect(page.getByRole('heading', { name: 'Variance by Dish' })).toBeVisible()
    const dishes = page
      .locator('table')
      .filter({ has: page.getByRole('columnheader', { name: 'Dish' }) })
    await expect(dishes.locator('tbody tr').first()).toBeVisible()

    const from = await page.getByLabel('From date').inputValue()
    const to = await page.getByLabel('To date').inputValue()
    const report = await apiGet<{
      byDish: { name: string; standardCost: number; quantity: number }[]
    }>(page, `/api/analytics/food-cost-variance?from=${from}&to=${to}`)
    const first = report.byDish[0]
    const row = dishes.locator('tbody tr').filter({ hasText: first.name }).first()
    await expect(row).toContainText(String(first.quantity))
    await expect(row).toContainText(
      first.standardCost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    )
  })
})

test.describe('A period on any screen', () => {
  test('one that ends before it begins is named, and an open end is not taken for one', async ({
    page,
  }) => {
    await signInAs(page, 'owner')

    for (const path of ['/sales', '/analytics/food-cost', '/reports']) {
      await page.goto(path)
      await settled(page)
      const dates = page.locator('input[type=date]')
      await dates.first().fill('2020-04-15')
      await dates.nth(1).fill('2020-03-31')
      await expect(page.getByText('The period ends before it begins'), path).toBeVisible()

      await dates.nth(1).fill('')
      await expect(page.getByText('The period ends before it begins'), path).toHaveCount(0)
    }
  })
})
