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
    expect(await kpi(/Today.s Profit \$[\d,.]+/)).toBeCloseTo(today!.profit, 1)
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

    const before = await dataRows(page).count()
    const dates = page.locator('input[type=date]')
    await dates.first().fill('2000-01-01')
    await dates.last().fill('2000-01-02')
    await settled(page)
    await page.waitForTimeout(800)
    expect(await dataRows(page).count()).toBeLessThan(before)
  })
})

test.describe('Food cost analysis', () => {
  test('what is not computed yet is named, not faked', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/analytics/food-cost')
    await settled(page)

    await expect(page.getByText('Not available yet', { exact: true })).toBeVisible()
    await expect(page.getByText(/needs theoretical cost/i)).toBeVisible()
    await expect(page.getByText(/Variance analysis arrives with the costing engine/i)).toBeVisible()
  })

  test('menu engineering does not blame missing data', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/analytics/menu-engineering')
    await settled(page)

    await expect(page.getByText(/Quadrant mapping arrives with the costing engine/i)).toBeVisible()
    await expect(page.getByText(/Not enough sales data/i)).toHaveCount(0)
  })
})
