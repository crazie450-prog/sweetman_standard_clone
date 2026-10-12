import { expect, test, type Page } from '@playwright/test'
import {
  apiGet,
  apiUrl,
  dataRows,
  dialog,
  expectToast,
  locationOptions,
  onHandAt,
  recipeCost,
  settled,
  signInAs,
  signOut,
  switchLocation,
} from '../helpers'

test.describe('Entry points', () => {
  test('a signed-in visitor never lands on the sign-in form', async ({ page }) => {
    await signInAs(page, 'owner')

    await page.goto('/')
    await expect(page).toHaveURL(/\/dashboard$/)

    await page.goto('/login')
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('the component gallery stays behind the sign-in', async ({ page }) => {
    await page.goto('/design')
    await expect(page).toHaveURL(/\/login$/, { timeout: 15000 })
  })
})

test.describe('Error monitoring', () => {
  test('with no BugSnag key the browser loads nothing and reports to nobody', async ({ page }) => {
    test.skip(Boolean(process.env.NEXT_PUBLIC_BUGSNAG_API_KEY), 'this build carries a BugSnag key')
    const reached: string[] = []
    page.on('request', (r) => {
      if (/bugsnag/i.test(r.url())) reached.push(r.url())
    })
    await signInAs(page, 'owner')
    await settled(page)
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('probe: unhandled in the browser')
      })
    })
    await page.waitForTimeout(500)
    expect(reached).toEqual([])
  })
})

test.describe('Navigation', () => {
  const GROUPS = [
    'Dashboard',
    'Operations',
    'Recipe Management',
    'Inventory',
    'Analytics & Reports',
    'Settings',
  ]

  async function itemsOf(page: import('@playwright/test').Page, group: string) {
    await page.getByRole('button', { name: group, exact: true }).first().click()
    return (await page.locator('nav a').allTextContents()).map((s) => s.trim()).filter(Boolean)
  }

  test('the settings group narrows with the role', async ({ page }) => {
    await signInAs(page, 'owner')
    await settled(page)
    expect(await itemsOf(page, 'Settings')).toEqual([
      'My Profile',
      'Settings',
      'Team',
      'Property Management',
      'Unit Conversions',
      'Categories',
      'Subscription & Billing',
    ])

    for (const group of GROUPS) {
      expect((await itemsOf(page, group)).length, `group ${group} is empty`).toBeGreaterThan(0)
    }
  })

  test('a chef sees only their own profile under Settings', async ({ page }) => {
    await signInAs(page, 'staff')
    await settled(page)
    expect(await itemsOf(page, 'Settings')).toEqual(['My Profile'])
  })
})

test.describe('The sidebar holds still', () => {
  test('a short page after a scrolled long one leaves the sidebar where it was', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/sales')
    await settled(page)
    await page.mouse.wheel(0, 400)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

    await page.getByRole('link', { name: 'Production', exact: true }).first().click()
    await page.waitForURL('**/production')
    await settled(page)
    const metrics = () =>
      page.evaluate(() => ({
        scrollY: Math.round(window.scrollY),
        overflow: document.documentElement.scrollHeight - window.innerHeight,
        aside: Math.round(document.querySelector('aside')!.getBoundingClientRect().top),
      }))
    await expect.poll(metrics).toEqual({ scrollY: 0, overflow: 0, aside: 12 })

    await page.getByRole('link', { name: 'Sales', exact: true }).first().click()
    await page.waitForURL('**/sales')
    await settled(page)
    expect((await metrics()).aside).toBe(12)
  })
})

test.describe('Role boundaries', () => {
  const BLOCKED = {
    manager: ['/settings', '/subscription', '/admin/organizations'],
    staff: ['/settings', '/team', '/settings/properties', '/subscription', '/admin/organizations'],
  } as const

  for (const [role, routes] of Object.entries(BLOCKED)) {
    test(`${role} is redirected away from the screens above their role`, async ({ page }) => {
      await signInAs(page, role as 'manager' | 'staff')
      for (const route of routes) {
        await page.goto(route)
        await expect(page, `${role} reached ${route}`).toHaveURL(/\/dashboard$/, { timeout: 15000 })
      }
    })
  }

  test('an owner without the platform flag cannot reach the admin area', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/admin/organizations')
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15000 })
  })
})

test.describe('Location axis', () => {
  test('switching location changes the stock, not the catalogue', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/inventory')
    await settled(page)

    const options = await locationOptions(page)
    expect(options.length).toBeGreaterThan(2)

    const readOnHand = async () => {
      const cells = await dataRows(page).locator('td:nth-child(4)').allTextContents()
      return cells.map((c) => c.trim())
    }

    const consolidated = await readOnHand()
    expect(consolidated.length).toBeGreaterThan(0)

    await switchLocation(page, options[1])
    await expect
      .poll(async () => (await readOnHand()).join('|'), {
        message: 'per-location stock must differ from the consolidated view',
      })
      .not.toBe(consolidated.join('|'))
    const single = await readOnHand()

    expect(single.length, 'the ingredient catalogue is shared across locations').toBe(
      consolidated.length
    )

    await page.reload()
    await settled(page)
    const kept = await page.locator('select[aria-label="Location"] option:checked').textContent()
    expect(kept?.trim()).toBe(options[1])
  })
})

test.describe('A laptop-wide window keeps the action column in view', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  for (const screen of ['/inventory', '/vendors', '/menu']) {
    test(`${screen} shows its Actions column without scrolling the table sideways`, async ({
      page,
    }) => {
      await signInAs(page, 'owner')
      await page.goto(screen)
      await settled(page)
      await expect.poll(() => dataRows(page).count(), { timeout: 15000 }).toBeGreaterThan(0)

      const header = page.getByRole('columnheader', { name: 'Actions' }).first()
      const card = page.locator('main .overflow-x-auto').filter({ has: header })
      const headerBox = (await header.boundingBox())!
      const cardBox = (await card.boundingBox())!
      expect(
        headerBox.x + headerBox.width,
        `${screen}: the Actions column is cut off`
      ).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1)
      const action = dataRows(page).first().getByRole('button').last()
      const actionBox = (await action.boundingBox())!
      expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1)
    })
  }
})

test.describe('Screens promise only what the product does', () => {
  test("the header date is the visitor's today, not the day the application was built", async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-10-05T12:00:00'))
    await signInAs(page, 'owner')
    await page.goto('/dashboard')
    await settled(page)
    await expect(page.locator('header').getByText('Mon, Oct 5')).toBeVisible()
  })

  test('the trial is stated by its end date, not measured against a length it does not have', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/settings')
    await settled(page)
    const subscription = await apiGet<{ status: string }>(page, '/api/billing/subscription')
    if (subscription.status === 'trial')
      await expect(page.getByText(/days left · ends/)).toBeVisible()
    await expect(page.getByText(/trial days used/i)).toHaveCount(0)
  })

  test('password recovery does not promise a link it cannot vouch for', async ({ page }) => {
    await page.goto('/reset-password')
    await expect(page.getByText(/reset link is generated/i)).toHaveCount(0)
    await page.getByLabel('Email').fill('nobody@example.com')
    await page.getByRole('button', { name: 'Send Reset Link' }).click()
    await expect(page.getByText(/administrator of your organization can reset/i)).toBeVisible()
    await expect(page.getByText(/not connected yet/i)).toHaveCount(0)
  })

  test('the food-cost target can be cleared and retyped without turning into zero', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const before = await apiGet<{ foodCostTargetPct: number }>(page, '/api/organizations/current')
    await page.goto('/settings')
    await settled(page)
    const field = page.getByLabel('Target food cost %')
    await expect(field).toHaveValue(String(before.foodCostTargetPct))
    await field.fill('')
    await expect(field).toHaveValue('')
    await page.getByRole('button', { name: /Save/ }).first().click()
    await expect(page.getByText(/between 1 and 100/)).toBeVisible()
    expect(
      (await apiGet<{ foodCostTargetPct: number }>(page, '/api/organizations/current'))
        .foodCostTargetPct
    ).toBe(before.foodCostTargetPct)
    await field.fill('33,5')
    await page.getByRole('button', { name: /Save/ }).first().click()
    await expectToast(page, /saved/i)
    try {
      expect(
        (await apiGet<{ foodCostTargetPct: number }>(page, '/api/organizations/current'))
          .foodCostTargetPct
      ).toBe(33.5)
    } finally {
      await page.request.patch(apiUrl('/api/organizations/current'), {
        data: { foodCostTargetPct: before.foodCostTargetPct },
      })
    }
  })

  test('purchasing names deliveries among what it reads', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/purchasing')
    await settled(page)
    await expect(page.getByText(/sold, used, wasted and received/)).toBeVisible()
  })
})

test.describe('A screen shows what was written elsewhere', () => {
  const open = async (page: Page, group: string, item: string) => {
    await page.getByRole('button', { name: group, exact: true }).first().click()
    await page.getByRole('link', { name: item, exact: true }).first().click()
    await settled(page)
  }

  test('the recipe list follows an ingredient price changed on the ingredients screen', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/dashboard')
    await settled(page)
    await open(page, 'Recipe Management', 'Recipes')
    const portions = (
      await apiGet<{ name: string; portions: number }[]>(page, '/api/recipes')
    ).find((r) => r.name === 'Duxelles')!.portions
    const perPortion = async () => ((await recipeCost(page, 'Duxelles')) / portions).toFixed(2)
    const before = await perPortion()

    const setMushroomPrice = async (value: string) => {
      await open(page, 'Inventory', 'Ingredients')
      await dataRows(page)
        .filter({ hasText: 'Button Mushrooms' })
        .getByRole('button', { name: 'Edit' })
        .click()
      await dialog(page)
        .getByLabel(/cost per unit/i)
        .fill(value)
      await dialog(page).getByRole('button', { name: /save/i }).click()
      await expectToast(page, /saved|updated/i)
    }
    try {
      await setMushroomPrice('12.80')
      const after = await perPortion()
      expect(after).not.toBe(before)
      await open(page, 'Recipe Management', 'Recipes')
      await expect(page.getByRole('main')).toContainText(`$${after}`)
      await expect(page.getByRole('main')).not.toContainText(`$${before}`)
    } finally {
      await setMushroomPrice('6.40')
    }
  })

  test('the inventory screen follows an invoice confirmed on the documents screen', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/dashboard')
    await settled(page)
    const locations = await apiGet<{ id: string; name: string }[]>(page, '/api/locations')
    const downtown = locations.find((l) => /Downtown/.test(l.name))!
    await switchLocation(page, downtown.name)
    await open(page, 'Inventory', 'Inventory')
    const before = await onHandAt(page, 'Unsalted Butter', downtown.id)

    await open(page, 'Operations', 'Documents')
    const fileName = `follow-${Date.now()}.json`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          kind: 'invoice',
          vendor: 'Dairy Direct',
          number: `FOLLOW-${Date.now()}`,
          items: [{ rawName: 'Unsalted Butter', quantity: 0.5, unit: 'kg', unitPrice: 9.5 }],
        })
      ),
    })
    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Review' }).click()
    await dialog(page)
      .getByRole('button', { name: /^Confirm/ })
      .click()
    await expectToast(page, /1 line applied|applied/i)
    await expect
      .poll(() => onHandAt(page, 'Unsalted Butter', downtown.id))
      .toBeCloseTo(before + 0.5, 2)

    await open(page, 'Inventory', 'Inventory')
    await expect(dataRows(page).filter({ hasText: 'Unsalted Butter' }).first()).toContainText(
      `${before + 0.5} kg`
    )
  })
})

test.describe('Two tabs', () => {
  test("choosing a location in one tab does not send the other tab's work there", async ({
    page,
    context,
  }) => {
    await signInAs(page, 'owner')
    await switchLocation(page, 'Golden Fork — Downtown')
    const downtown = await page.evaluate(() => window.localStorage.getItem('nexus.locationId'))

    const other = await context.newPage()
    await other.goto('/inventory')
    await settled(other)
    await switchLocation(other, 'Golden Fork — Airport')
    await other.close()

    await expect(page.getByRole('combobox', { name: 'Location' })).toHaveValue(downtown ?? '')
    const sent = page.waitForRequest(
      (r) => r.url().includes('/api/') && r.method() === 'GET' && r.url().includes('/inventory')
    )
    await page.getByRole('button', { name: 'Inventory', exact: true }).first().click()
    await page.getByRole('link', { name: 'Inventory', exact: true }).first().click()
    expect((await sent).headers()['x-location-id']).toBe(downtown)
  })
})

test.describe('The currency an organization keeps', () => {
  test('every figure follows it, however late the organization answers', async ({ page }) => {
    await page.route(
      (url) => url.pathname === '/api/organizations/current',
      async (route) => {
        if (route.request().method() !== 'GET') return route.continue()
        const real = await route.fetch()
        const body = { ...(await real.json()), currency: 'EUR' }
        await new Promise((r) => setTimeout(r, 2500))
        await route.fulfill({ response: real, json: body })
      }
    )
    await signInAs(page, 'owner')
    await page.goto('/menu')
    await settled(page)
    const prices = page.locator('tbody tr').first()
    await expect(prices).toContainText('$', { timeout: 10000 })
    await expect(prices).toContainText('€', { timeout: 10000 })
    await expect(prices).not.toContainText('$')
  })
})

test.describe('Settings say what each preference does', () => {
  test('the currency is named as applied, and no format is offered that nothing applies', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/settings')
    await settled(page)
    const main = page.getByRole('main')
    await expect(main).toContainText('Amounts are shown in this currency')
    await expect(main).not.toContainText('render in US English and USD')
    await expect(page.getByText('Date Format', { exact: true })).toHaveCount(0)
  })
})

test.describe('A remembered location', () => {
  test('one this account can no longer reach is let go instead of locking every screen', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const all = await apiGet<{ id: string; name: string }[]>(page, '/api/locations')
    const airport = all.find((l) => /Airport/.test(l.name))!
    await signOut(page)

    await signInAs(page, 'manager')
    await page.evaluate((id) => window.localStorage.setItem('nexus.locationId', id), airport.id)
    await page.goto('/inventory')
    await settled(page)

    await expect(page.getByRole('combobox', { name: 'Location' })).toHaveValue(/.+/)
    await expect(dataRows(page).first()).toBeVisible()
    expect(await page.evaluate(() => window.localStorage.getItem('nexus.locationId'))).not.toBe(
      airport.id
    )
  })
})

test.describe('A screen that fails to draw', () => {
  test('says so inside the application and offers a way on', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.route('**/api/inventory', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"unexpected":true}' })
    )

    await page.goto('/inventory')

    await expect(page.getByText('This screen could not be shown')).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('navigation').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()

    await page.unroute('**/api/inventory')
    await page.getByRole('link', { name: 'Go to Dashboard' }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
  })
})
