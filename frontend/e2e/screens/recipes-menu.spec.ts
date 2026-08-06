import { expect, test } from '@playwright/test'
import { apiGet, dataRows, dialog, expectToast, recipeCost, settled, signInAs } from '../helpers'

type MenuItem = { name: string; cost: number; price: number }

test.describe('Recipe costing', () => {
  test('an ingredient price reaches the sub-recipe, the parent and the menu item', async ({
    page,
  }) => {
    await signInAs(page, 'owner')

    const menuCost = async (name: string) =>
      (await apiGet<MenuItem[]>(page, '/api/menu-items')).find((m) => m.name === name)?.cost

    const before = {
      sub: await recipeCost(page, 'Duxelles'),
      parent: await recipeCost(page, 'Beef Wellington'),
      menu: await menuCost('Beef Wellington (for two)'),
    }

    const setMushroomPrice = async (value: string) => {
      await page.goto('/ingredients')
      await settled(page)
      await dataRows(page)
        .filter({ hasText: 'Button Mushrooms' })
        .getByRole('button', { name: 'Edit' })
        .click()
      await dialog(page)
        .getByLabel(/cost per unit/i)
        .fill(value)
      await dialog(page).getByRole('button', { name: /save/i }).click()
      await page.waitForTimeout(1500)
    }

    await setMushroomPrice('12.80')

    const after = {
      sub: await recipeCost(page, 'Duxelles'),
      parent: await recipeCost(page, 'Beef Wellington'),
      menu: await menuCost('Beef Wellington (for two)'),
    }

    expect(after.sub, 'the sub-recipe must be recosted').toBeGreaterThan(before.sub)
    expect(after.parent, 'the parent recipe must follow').toBeGreaterThan(before.parent)
    expect(after.menu!, 'the menu item must follow').toBeGreaterThan(before.menu!)

    await setMushroomPrice('6.40')
    expect(await recipeCost(page, 'Duxelles')).toBeCloseTo(before.sub, 2)
    expect(await recipeCost(page, 'Beef Wellington')).toBeCloseTo(before.parent, 2)
  })

  test('a circular sub-recipe is refused', async ({ page }) => {
    await signInAs(page, 'owner')
    const recipes = await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')
    const duxelles = recipes.find((r) => r.name === 'Duxelles')!

    await page.goto(`/recipes/${duxelles.id}`)
    await settled(page)
    await page.getByRole('button', { name: /Add sub-recipe/i }).click()
    await dialog(page).locator('select').first().selectOption({ label: 'Beef Wellington' })
    await dialog(page).locator('input').first().fill('1')
    await dialog(page).getByRole('button', { name: /add|save/i }).last().click()

    await expectToast(page, /circular recipe relationship/i)
  })

  test('removing a sub-recipe asks first and names the consequence', async ({ page }) => {
    await signInAs(page, 'owner')
    const recipes = await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')
    const wellington = recipes.find((r) => r.name === 'Beef Wellington')!

    await page.goto(`/recipes/${wellington.id}`)
    await settled(page)
    await page.getByRole('button', { name: 'Remove' }).first().click()

    await expect(dialog(page)).toContainText(/recosted without it/i)
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('link', { name: 'Duxelles' })).toBeVisible()
  })

  test('a recipe used by a menu item refuses to be deleted', async ({ page }) => {
    await signInAs(page, 'owner')
    const recipes = await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')
    const steak = recipes.find((r) => r.name === 'Steak Frites')!

    await page.goto(`/recipes/${steak.id}`)
    await settled(page)
    await page.getByRole('button', { name: 'Delete' }).first().click()
    await dialog(page).getByRole('button', { name: 'Delete' }).click()

    await expectToast(page, /cannot be deleted/i)
    await expect(page).toHaveURL(new RegExp(`/recipes/${steak.id}$`))
  })

  test('the card adds up: ingredients plus nested recipes equal the total', async ({ page }) => {
    await signInAs(page, 'owner')
    const recipes = await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')
    const wellington = recipes.find((r) => r.name === 'Beef Wellington')!

    await page.goto(`/recipes/${wellington.id}`)
    await settled(page)

    const screen = (await page.getByRole('main').innerText()).replace(/\s+/g, ' ')
    const total = Number(screen.match(/Total cost \$([\d,.]+)/)![1].replace(/,/g, ''))

    const subtotalRows = page.locator('tr').filter({ hasText: 'Subtotal' })
    expect(await subtotalRows.count(), 'ingredients and nested recipes each carry a subtotal').toBe(
      2
    )
    let sum = 0
    for (const row of await subtotalRows.all()) {
      const cells = await row.locator('td').allTextContents()
      const amount = cells.filter((c) => /\d/.test(c)).pop()
      sum += Number((amount ?? '0').replace(/[^\d.]/g, ''))
    }

    expect(sum).toBeCloseTo(total, 1)
  })
})

test.describe('Menu items', () => {
  test('a composite item combines recipes, portions, price and both percentages', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/menu')
    await settled(page)

    for (const column of ['Margin %', 'Food cost %']) {
      await expect(page.getByRole('columnheader', { name: column })).toBeVisible()
    }

    const name = `Audit Plate ${Date.now()}`
    await page.getByRole('button', { name: /New Menu Item/i }).click()
    await dialog(page).getByLabel(/^Name/).fill(name)
    await dialog(page).getByLabel(/Selling price/).fill('50')
    await dialog(page).getByLabel('Location').selectOption({ index: 1 })
    await dialog(page).locator('select').last().selectOption({ label: 'Steak Frites' })
    await dialog(page).getByRole('button', { name: /save|create/i }).last().click()
    await expectToast(page, /Menu item created/i)

    await page.reload()
    await settled(page)
    const row = dataRows(page).filter({ hasText: name })
    await expect(row).toHaveCount(1)

    const cells = await row.locator('td').allTextContents()
    const price = Number(cells[3].replace(/[^\d.]/g, ''))
    const cost = Number(cells[4].replace(/[^\d.]/g, ''))
    const marginPct = Number(cells[6].replace(/[^\d.]/g, ''))
    const foodCostPct = Number(cells[7].replace(/[^\d.]/g, ''))

    expect(marginPct + foodCostPct).toBeCloseTo(100, 0)
    expect(foodCostPct).toBeCloseTo((cost / price) * 100, 0)

    await row.getByRole('button', { name: 'Delete' }).click()
    await expect(dialog(page)).toContainText('The recipes themselves stay')
    await dialog(page).getByRole('button', { name: 'Delete' }).click()
    await page.reload()
    await settled(page)
    await expect(dataRows(page).filter({ hasText: name })).toHaveCount(0)
  })
})
