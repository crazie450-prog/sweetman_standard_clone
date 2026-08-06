import { expect, test } from '@playwright/test'
import { dataRows, locationOptions, settled, signInAs, switchLocation } from '../helpers'

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
    const single = await readOnHand()

    expect(single.length, 'the ingredient catalogue is shared across locations').toBe(
      consolidated.length
    )
    expect(single.join('|'), 'per-location stock must differ from the consolidated view').not.toBe(
      consolidated.join('|')
    )

    await page.reload()
    await settled(page)
    const kept = await page.locator('select[aria-label="Location"] option:checked').textContent()
    expect(kept?.trim()).toBe(options[1])
  })
})
