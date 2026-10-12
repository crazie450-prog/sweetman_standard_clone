import { expect, test, type Page } from '@playwright/test'
import {
  apiGet,
  apiUrl,
  dataRows,
  dialog,
  expectToast,
  recipeCost,
  settled,
  signInAs,
  switchLocation,
  workAtFirstLocation,
  written,
} from '../helpers'

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

  test('the sub-recipe picker offers no recipe that would close a loop, and counts in portions', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const recipes = await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')
    const duxelles = recipes.find((r) => r.name === 'Duxelles')!

    await page.goto(`/recipes/${duxelles.id}`)
    await settled(page)
    await page.getByRole('button', { name: /Add sub-recipe/i }).click()
    const offered = await dialog(page).getByLabel('Sub-recipe').locator('option').allTextContents()
    expect(offered, 'Beef Wellington is built on Duxelles').not.toContain('Beef Wellington')
    expect(offered).not.toContain('Duxelles')
    expect(offered).toContain('Marinara Sauce')
    await expect(dialog(page).getByLabel('Unit')).toHaveValue('portion')
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  })

  test('a sub-recipe is offered by the portion unless it states what a batch makes', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const recipes = await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')
    const steak = recipes.find((r) => r.name === 'Steak Frites')!

    await page.goto(`/recipes/${steak.id}`)
    await settled(page)
    await page.getByRole('button', { name: /Add sub-recipe/i }).click()
    const unit = dialog(page).getByLabel('Unit')
    await dialog(page).getByLabel('Sub-recipe').selectOption({ label: 'Marinara Sauce' })
    expect(await unit.locator('option').allTextContents(), 'Marinara states no yield').toEqual([
      'Portion',
    ])
    await expect(dialog(page).getByText(/states no yield/)).toBeVisible()

    await dialog(page).getByLabel('Sub-recipe').selectOption({ label: 'Duxelles' })
    const offered = await unit.locator('option').allTextContents()
    expect(offered, 'Duxelles yields 2.7 kg').toContain('Kilogram (kg)')
    expect(offered).toContain('Portion')
    expect(offered, 'a volume does not reach a weight').not.toContain('Litre (l)')
    await expect(dialog(page).getByText(/A batch makes 2.7 kg/)).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()

    await page.getByRole('button', { name: /^Edit/ }).first().click()
    await expect(dialog(page).getByLabel('Batch yield')).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  })

  test('the sub-recipe picker leaves out what is already in the recipe', async ({ page }) => {
    await signInAs(page, 'owner')
    const recipes = await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')
    const wellington = recipes.find((r) => r.name === 'Beef Wellington')!

    await page.goto(`/recipes/${wellington.id}`)
    await settled(page)
    await page.getByRole('button', { name: /Add sub-recipe/i }).click()
    const offered = await dialog(page).getByLabel('Sub-recipe').locator('option').allTextContents()
    expect(offered, 'Duxelles is already in it').not.toContain('Duxelles')
    expect(offered, 'Crêpes are already in it').not.toContain('Crêpes')
    expect(offered).toContain('Marinara Sauce')
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  })

  test('the Remove button of a nested recipe stays in view at a laptop width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await signInAs(page, 'owner')
    const recipes = await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')
    const wellington = recipes.find((r) => r.name === 'Beef Wellington')!

    await page.goto(`/recipes/${wellington.id}`)
    await settled(page)
    const remove = page.getByRole('button', { name: 'Remove' }).first()
    await expect(remove).toBeVisible()
    const frame = remove.locator('xpath=ancestor::div[contains(@class, "overflow-x-auto")][1]')
    const [button, box] = await Promise.all([remove.boundingBox(), frame.boundingBox()])
    expect(button!.x + button!.width, 'the button is cut off on the right').toBeLessThanOrEqual(
      box!.x + box!.width + 1
    )
    expect(button!.x, 'the button is cut off on the left').toBeGreaterThanOrEqual(box!.x - 1)
  })

  for (const width of [1280, 1440]) {
    test(`the cost of a nested recipe is not covered by its actions at ${width} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await signInAs(page, 'owner')
      const recipes = await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')
      const wellington = recipes.find((r) => r.name === 'Beef Wellington')!

      await page.goto(`/recipes/${wellington.id}`)
      await settled(page)
      const rows = page.getByRole('button', { name: 'Remove' }).locator('xpath=ancestor::tr[1]')
      await expect(rows).toHaveCount(2)
      for (const row of await rows.all()) {
        const cells = row.locator('td')
        const cost = await cells.nth(2).boundingBox()
        const actions = await cells.nth(3).boundingBox()
        expect(cost!.x + cost!.width, 'the actions column covers the cost').toBeLessThanOrEqual(
          actions!.x + 1
        )
      }
    })
  }

  test('a recipe without its own target is judged against the organization target, on its card as in the list', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const beef = (await apiGet<{ id: string; name: string }[]>(page, '/api/ingredients')).find(
      (i) => i.name === 'Beef Tenderloin'
    )!
    const recipe = await page.request.post(apiUrl('/api/recipes'), {
      data: {
        name: 'Probe Target Card',
        portions: 1,
        ingredients: [{ ingredientId: beef.id, quantity: 0.1, unit: 'kg' }],
      },
    })
    expect(recipe.ok()).toBeTruthy()
    const recipeId = ((await recipe.json()) as { id: string }).id
    const dish = await page.request.post(apiUrl('/api/menu-items'), {
      data: { name: 'Probe Target Dish', price: 1, recipes: [{ recipeId, portions: 1 }] },
    })
    expect(dish.ok()).toBeTruthy()
    const dishId = ((await dish.json()) as { id: string }).id
    try {
      await page.goto(`/recipes/${recipeId}`)
      await settled(page)
      await expect(page.getByText(/organization target 30%/)).toBeVisible()
      await expect(page.getByText(/recipe target/)).toHaveCount(0)

      await page.goto('/recipes')
      await settled(page)
      await page.getByRole('button', { name: 'Table view' }).click()
      await expect(dataRows(page).filter({ hasText: 'Probe Target Card' })).toContainText(
        'Uncategorized'
      )
      await expect(page.getByRole('button', { name: 'Show drafts' })).toHaveCount(0)
    } finally {
      await page.request.delete(apiUrl(`/api/menu-items/${dishId}`))
      await page.request.delete(apiUrl(`/api/recipes/${recipeId}`))
    }
  })

  test('a dish given away has no food-cost share to print', async ({ page }) => {
    await signInAs(page, 'owner')
    const beef = (await apiGet<{ id: string; name: string }[]>(page, '/api/ingredients')).find(
      (i) => i.name === 'Beef Tenderloin'
    )!
    const recipe = await page.request.post(apiUrl('/api/recipes'), {
      data: {
        name: 'Probe Free Taste',
        portions: 1,
        ingredients: [{ ingredientId: beef.id, quantity: 0.1, unit: 'kg' }],
      },
    })
    expect(recipe.ok()).toBeTruthy()
    const recipeId = ((await recipe.json()) as { id: string }).id
    const dish = await page.request.post(apiUrl('/api/menu-items'), {
      data: { name: 'Probe Free Taste Dish', price: 0, recipes: [{ recipeId, portions: 1 }] },
    })
    expect(dish.ok()).toBeTruthy()
    const dishId = ((await dish.json()) as { id: string }).id
    try {
      await page.goto('/menu')
      await settled(page)
      const row = dataRows(page).filter({ hasText: 'Probe Free Taste Dish' })
      await expect(row).toBeVisible()
      await expect(row).not.toContainText('%')
    } finally {
      await page.request.delete(apiUrl(`/api/menu-items/${dishId}`))
      await page.request.delete(apiUrl(`/api/recipes/${recipeId}`))
    }
  })

  test('the wizard refuses a line whose quantity is missing instead of dropping it', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/recipes/new')
    await settled(page)
    await page.getByLabel('Recipe name').fill('Probe Unfilled Line')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Ingredient').selectOption({ label: 'Eggs' })
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Create Recipe' }).click()
    await expect(page.getByText(/Line 1 needs a quantity/)).toBeVisible()
    await expect(page).toHaveURL(/\/recipes\/new$/)
    await expect(page.getByLabel('Ingredient')).toHaveValue(/./)
  })

  test('the ingredient list on a recipe line is searched and grouped by category', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/recipes/new')
    await settled(page)
    await page.getByLabel('Recipe name').fill('Probe Searched Line')
    await page.getByRole('button', { name: 'Continue' }).click()
    const picker = page.getByLabel('Ingredient')
    const all = await picker.locator('option:not([value=""])').count()
    expect(await picker.locator('optgroup').count()).toBeGreaterThan(1)

    await page.getByLabel('Type to narrow the list below').fill('unsalted')
    await expect(picker.locator('option:not([value=""])')).toHaveText(['Unsalted Butter'])
    await expect(page.getByText(`1 of ${all} shown`)).toBeVisible()
    await picker.selectOption({ label: 'Unsalted Butter' })

    await page.getByLabel('Type to narrow the list below').fill('dairy')
    const dairy = await picker.locator('option:not([value=""])').allTextContents()
    expect(dairy).toContain('Unsalted Butter')
    expect(dairy.length).toBeLessThan(all)

    await page.getByLabel('Type to narrow the list below').fill('no such thing')
    await expect(picker).toHaveValue(/./)
    await expect(picker.locator('option[disabled]')).toHaveText('Nothing matches "no such thing"')
  })

  test('an ingredient the catalogue lacks is added from the recipe without leaving it', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const name = `Probe Yuzu Kosho ${Date.now()}`
    await page.goto('/recipes/new')
    await settled(page)
    await page.getByLabel('Recipe name').fill('Probe New Ingredient Line')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: '+ New ingredient' }).click()
    const form = dialog(page)
    await form.getByLabel('Name').fill(name)
    await form.getByLabel('Base unit').selectOption('g')
    await form.getByRole('button', { name: 'Add and use' }).click()
    await expectToast(page, `${name} added to the ingredients`)

    await expect(page).toHaveURL(/\/recipes\/new$/)
    await expect(page.getByLabel('Recipe name')).toHaveCount(0)
    const picker = page.getByLabel('Ingredient')
    await expect(picker.locator('option:checked')).toHaveText(name)
    await expect(page.getByLabel('Unit', { exact: true })).toHaveValue('g')

    const made = (
      await apiGet<{ id: string; name: string; unit: string; costPerUnit: number }[]>(
        page,
        '/api/ingredients'
      )
    ).find((i) => i.name === name)
    expect(made?.unit).toBe('g')
    expect(made?.costPerUnit).toBe(0)
    await page.request.delete(apiUrl(`/api/ingredients/${made!.id}`))
  })

  test('a conversion recorded on a recipe lets that recipe state the unit', async ({ page }) => {
    await signInAs(page, 'owner')
    const butter = (
      await apiGet<{ id: string; name: string; unit: string; costPerUnit: number }[]>(
        page,
        '/api/ingredients'
      )
    ).find((i) => i.name === 'Unsalted Butter')!
    expect(butter.unit).toBe('kg')
    const created = await page.request.post(apiUrl('/api/recipes'), {
      data: {
        name: `Probe Cup Butter ${Date.now()}`,
        portions: 1,
        ingredients: [{ ingredientId: butter.id, quantity: 1, unit: 'kg' }],
      },
    })
    expect(created.ok()).toBe(true)
    const recipe = (await created.json()) as { id: string; name: string }

    try {
      await page.goto(`/recipes/${recipe.id}`)
      await settled(page)
      const unitOfLine = async () => {
        await page.getByRole('button', { name: 'Edit Recipe' }).click()
        const options = await dialog(page)
          .getByLabel('Unit', { exact: true })
          .locator('option')
          .evaluateAll((all) => all.map((o) => (o as HTMLOptionElement).value))
        await dialog(page).getByRole('button', { name: 'Cancel' }).click()
        return options
      }
      expect(await unitOfLine()).not.toContain('cup')

      await expect(page.getByRole('button', { name: '+ Add conversion' })).toBeVisible()
      await page.getByRole('button', { name: '+ Add conversion' }).click()
      const form = dialog(page)
      await form.getByLabel('Applies to').selectOption({ label: 'Unsalted Butter' })
      await form.getByLabel('From unit').selectOption('cup')
      await form.getByLabel('To unit').selectOption('kg')
      await form.getByLabel('Factor').fill('0.2')
      await form.getByRole('button', { name: 'Save' }).click()
      await expectToast(page, `Conversion saved for ${recipe.name}`)

      const card = page.locator('section, div').filter({
        has: page.getByRole('heading', { name: 'Unit conversions in this recipe' }),
      })
      await expect(card.getByRole('cell', { name: 'Unsalted Butter' }).first()).toBeVisible()
      expect(await unitOfLine()).toContain('cup')

      await page.getByRole('button', { name: 'Edit Recipe' }).click()
      await dialog(page).getByLabel('Unit', { exact: true }).selectOption('cup')
      await dialog(page).getByRole('button', { name: 'Save Recipe' }).click()
      await expectToast(page, 'Recipe saved')
      await expect
        .poll(async () => (await apiGet<{ cost: number }>(page, `/api/recipes/${recipe.id}`)).cost)
        .toBeCloseTo(0.2 * butter.costPerUnit, 4)
    } finally {
      await page.request.delete(apiUrl(`/api/recipes/${recipe.id}`))
    }
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
    const read = async () => (await page.getByRole('main').innerText()).replace(/\s+/g, ' ')
    await expect.poll(read, { timeout: 15000 }).toMatch(/Total cost \$\d/)

    const screen = await read()
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

test.describe('Where a recipe is cooked', () => {
  test('a recipe names its location, and a manager moves it to another', async ({ page }) => {
    await signInAs(page, 'owner')
    const locations = await apiGet<{ id: string; name: string }[]>(page, '/api/locations')
    const downtown = locations.find((l) => l.name === 'Golden Fork — Downtown')!
    const airport = locations.find((l) => l.name === 'Golden Fork — Airport')!
    const name = `Probe Kitchen Recipe ${Date.now()}`
    const res = await page.request.post(apiUrl('/api/recipes'), {
      data: { name, portions: 2, locationId: downtown.id },
    })
    expect(res.ok()).toBeTruthy()
    const { id } = (await res.json()) as { id: string }
    try {
      await page.goto('/recipes')
      await settled(page)
      await page.getByPlaceholder(/Search recipes by name/).fill(name)
      await expect(page.getByText(`${downtown.name} ·`, { exact: false }).first()).toBeVisible()

      await page.goto(`/recipes/${id}`)
      await settled(page)
      await expect(page.getByText(new RegExp(`· ${downtown.name} ·`))).toBeVisible()

      await page.getByRole('button', { name: 'Edit Recipe' }).click()
      await dialog(page).getByLabel('Location').selectOption({ label: airport.name })
      await dialog(page).getByRole('button', { name: 'Save Recipe' }).click()
      await expectToast(page, /Recipe saved/i)
      await expect(page.getByText(new RegExp(`· ${airport.name} ·`))).toBeVisible()
    } finally {
      await page.request.delete(apiUrl(`/api/recipes/${id}`))
    }
  })

  test('a manager of one location is not offered a move the server refuses', async ({ page }) => {
    await signInAs(page, 'owner')
    const downtown = (await apiGet<{ id: string; name: string }[]>(page, '/api/locations')).find(
      (l) => l.name === 'Golden Fork — Downtown'
    )!
    const shared = (await apiGet<{ id: string; location: unknown }[]>(page, '/api/recipes')).find(
      (r) => r.location === null
    )!
    const res = await page.request.post(apiUrl('/api/recipes'), {
      data: { name: `Probe Manager Kitchen ${Date.now()}`, portions: 2, locationId: downtown.id },
    })
    expect(res.ok()).toBeTruthy()
    const { id } = (await res.json()) as { id: string }
    try {
      await page.context().clearCookies()
      await signInAs(page, 'manager')
      await page.goto(`/recipes/${id}`)
      await settled(page)
      await page.getByRole('button', { name: 'Edit Recipe' }).click()
      await expect(dialog(page).getByLabel('Recipe name')).toBeVisible()
      await expect(dialog(page).getByLabel('Location')).toHaveCount(0)
      await page.keyboard.press('Escape')

      await page.goto(`/recipes/${shared.id}`)
      await settled(page)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Edit Recipe' }),
        'a recipe every location shares'
      ).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
    } finally {
      await page.context().clearCookies()
      await signInAs(page, 'owner')
      await page.request.delete(apiUrl(`/api/recipes/${id}`))
    }
  })

  test('a chef edits a recipe of their own location without being offered its location', async ({
    page,
  }) => {
    await signInAs(page, 'staff')
    const mine = (
      await apiGet<{ locations: { id: string }[] }>(page, '/api/auth/me')
    ).locations.map((l) => l.id)
    const res = await page.request.post(apiUrl('/api/recipes'), {
      data: { name: `Probe Chef Kitchen ${Date.now()}`, portions: 2, locationId: mine[0] },
    })
    expect(res.ok()).toBeTruthy()
    const { id } = (await res.json()) as { id: string }
    try {
      await page.goto(`/recipes/${id}`)
      await settled(page)
      await page.getByRole('button', { name: 'Edit Recipe' }).click()
      await expect(dialog(page).getByLabel('Recipe name')).toBeVisible()
      await expect(dialog(page).getByLabel('Location')).toHaveCount(0)
    } finally {
      await page.keyboard.press('Escape')
      await page.context().clearCookies()
      await signInAs(page, 'owner')
      await page.request.delete(apiUrl(`/api/recipes/${id}`))
    }
  })
})

test.describe('Categories are made where they are chosen', () => {
  const pickNew = async (page: Page, name: string) => {
    await dialog(page)
      .getByLabel('Category', { exact: true })
      .selectOption({ label: '+ New category' })
    await dialog(page).getByPlaceholder('New category name').fill(name)
    await dialog(page).getByRole('button', { name: 'Add', exact: true }).click()
    const field = dialog(page).getByLabel('Category', { exact: true })
    await expect(field.locator('option:checked')).toHaveText(name)
    await expect(dialog(page).getByPlaceholder('New category name')).toHaveCount(0)
  }

  const removeCategory = async (page: Page, kind: string, name: string) => {
    const rows = await apiGet<{ id: string; name: string }[]>(page, `/api/categories?kind=${kind}`)
    const made = rows.find((c) => c.name === name)
    if (made) await page.request.delete(apiUrl(`/api/categories/${made.id}`))
  }

  test('a manager adds a menu category from the dish form', async ({ page }) => {
    await signInAs(page, 'owner')
    const name = `Probe Section ${Date.now()}`
    try {
      await page.goto('/menu')
      await settled(page)
      await page.getByRole('button', { name: /New Menu Item/i }).click()
      await pickNew(page, name)
    } finally {
      await removeCategory(page, 'menu', name)
    }
  })

  test('a manager adds a recipe category from the recipe form', async ({ page }) => {
    await signInAs(page, 'owner')
    const recipe = (await apiGet<{ id: string }[]>(page, '/api/recipes'))[0]
    const name = `Probe Course ${Date.now()}`
    try {
      await page.goto(`/recipes/${recipe.id}`)
      await settled(page)
      await page.getByRole('button', { name: 'Edit Recipe' }).click()
      await pickNew(page, name)
    } finally {
      await removeCategory(page, 'recipe', name)
    }
  })

  test('a chef adds an ingredient category from the ingredient form', async ({ page }) => {
    await signInAs(page, 'staff')
    const name = `Probe Shelf Kind ${Date.now()}`
    try {
      await page.goto('/ingredients')
      await settled(page)
      await page.getByRole('button', { name: /Add Ingredient/i }).click()
      await pickNew(page, name)
    } finally {
      await page.context().clearCookies()
      await signInAs(page, 'owner')
      await removeCategory(page, 'ingredient', name)
    }
  })

  test('a category is added and deleted on its own page, and what it filed stays', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const name = `Probe Shelf ${Date.now()}`
    await page.goto('/settings/categories')
    await settled(page)
    const recipes = page.getByRole('region', { name: 'Recipes' })
    await recipes.getByPlaceholder('New category name').fill(name)
    await recipes.getByRole('button', { name: 'Add', exact: true }).click()
    await expectToast(page, new RegExp(`${name} added`))

    const [category] = (
      await apiGet<{ id: string; name: string }[]>(page, '/api/categories?kind=recipe')
    ).filter((c) => c.name === name)
    const made = await page.request.post(apiUrl('/api/recipes'), {
      data: { name: `Probe Shelved ${Date.now()}`, portions: 1, categoryId: category.id },
    })
    expect(made.ok()).toBeTruthy()
    const { id } = (await made.json()) as { id: string }
    try {
      await page.reload()
      await settled(page)
      const row = recipes.getByRole('listitem').filter({ hasText: name })
      await expect(row).toContainText('1 recipe')
      await row.getByRole('button', { name: 'Delete' }).click()
      await expect(dialog(page)).toContainText('1 record stays where it is, without a category')
      await dialog(page)
        .getByRole('button', { name: /delete/i })
        .click()
      await expectToast(page, new RegExp(`${name} deleted`))
      await expect(row).toHaveCount(0)

      const kept = await apiGet<{ categoryId: string | null }>(page, `/api/recipes/${id}/detail`)
      expect(kept.categoryId).toBeNull()
    } finally {
      await page.request.delete(apiUrl(`/api/recipes/${id}`))
      await removeCategory(page, 'recipe', name)
    }
  })

  test('a chef adds a category from the recipe form, and the page to rename or delete one is not theirs', async ({
    page,
  }) => {
    await signInAs(page, 'staff')
    const mine = (
      await apiGet<{ locations: { id: string }[] }>(page, '/api/auth/me')
    ).locations.map((l) => l.id)
    const recipe = (await (
      await page.request.post(apiUrl('/api/recipes'), {
        data: { name: `Probe Chef Course Dish ${Date.now()}`, portions: 1, locationId: mine[0] },
      })
    ).json()) as { id: string }
    const name = `Probe Chef Course ${Date.now()}`
    try {
      await page.goto(`/recipes/${recipe.id}`)
      await settled(page)
      await page.getByRole('button', { name: 'Edit Recipe' }).click()
      await pickNew(page, name)
      await page.keyboard.press('Escape')
      await page.goto('/settings/categories')
      await settled(page)
      await expect(page.getByRole('region', { name: 'Recipes' })).toHaveCount(0)
    } finally {
      await page.request.post(apiUrl('/api/auth/login'), {
        data: { email: 'owner@goldenfork.com', password: 'Nexus_dev1' },
      })
      await page.request.delete(apiUrl(`/api/recipes/${recipe.id}`))
      await removeCategory(page, 'recipe', name)
    }
  })

  test('a category is renamed on its own page', async ({ page }) => {
    await signInAs(page, 'owner')
    const stamp = Date.now()
    const made = await page.request.post(apiUrl('/api/categories'), {
      data: { name: `Probe Old Name ${stamp}`, kind: 'menu' },
    })
    expect(made.ok()).toBeTruthy()
    try {
      await page.goto('/settings/categories')
      await settled(page)
      const dishes = page.getByRole('region', { name: 'Menu items' })
      await dishes.getByRole('button', { name: `Rename Probe Old Name ${stamp}` }).click()
      await dishes
        .getByLabel(`New name for Probe Old Name ${stamp}`)
        .fill(`Probe New Name ${stamp}`)
      await dishes.getByRole('button', { name: 'Save', exact: true }).click()
      await expectToast(page, new RegExp(`renamed to Probe New Name ${stamp}`))
      await expect(
        dishes.getByRole('listitem').filter({ hasText: `Probe New Name ${stamp}` })
      ).toHaveCount(1)
      await expect(
        dishes.getByRole('listitem').filter({ hasText: `Probe Old Name ${stamp}` })
      ).toHaveCount(0)
    } finally {
      await removeCategory(page, 'menu', `Probe New Name ${stamp}`)
      await removeCategory(page, 'menu', `Probe Old Name ${stamp}`)
    }
  })
})

test.describe('Components are the recipes others are built on', () => {
  test('the library lists a recipe used inside another, and the recipe names where', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const recipes = await apiGet<{ id: string; name: string; usedIn: number }[]>(
      page,
      '/api/recipes'
    )
    const base = recipes.find((r) => r.usedIn > 0)!
    const detail = await apiGet<{ usedBy: { recipes: { name: string }[] } }>(
      page,
      `/api/recipes/${base.id}/detail`
    )

    await page.goto('/components')
    await settled(page)
    await expect(
      page.getByText(/A component is a recipe that other recipes are built on/)
    ).toBeVisible()
    await dataRows(page)
      .filter({ hasText: base.name })
      .getByRole('link', { name: base.name })
      .click()
    await expect(page).toHaveURL(new RegExp(`/recipes/${base.id}$`))
    await settled(page)
    await expect(page.getByRole('heading', { name: 'Used in' })).toBeVisible()
    await expect(
      page.getByRole('link', { name: detail.usedBy.recipes[0].name, exact: true })
    ).toBeVisible()
  })
})

test.describe('How much of a nested recipe goes in', () => {
  test('the quantity is changed in place and the card is recosted', async ({ page }) => {
    await signInAs(page, 'owner')
    const stamp = Date.now()
    const make = async (name: string) => {
      const res = await page.request.post(apiUrl('/api/recipes'), { data: { name, portions: 1 } })
      expect(res.ok()).toBeTruthy()
      return ((await res.json()) as { id: string }).id
    }
    const parent = await make(`Probe Nest Parent ${stamp}`)
    const base = `Probe Nest Base ${stamp}`
    const component = await make(base)
    try {
      const nested = await page.request.post(apiUrl(`/api/recipes/${parent}/components`), {
        data: { componentId: component, quantity: 1, unit: 'portion' },
      })
      expect(nested.ok()).toBeTruthy()

      await page.goto(`/recipes/${parent}`)
      await settled(page)
      const row = page.getByRole('row').filter({ hasText: base })
      await expect(row).toContainText('1 portion')
      await row.getByRole('button', { name: 'Change' }).click()
      await dialog(page).getByLabel('Qty').fill('3')
      await dialog(page).getByRole('button', { name: 'Save' }).click()
      await expectToast(page, new RegExp(`${base} changed`))
      await expect(row).toContainText('3 portion')

      const detail = await apiGet<{ components: { componentId: string; qty: number }[] }>(
        page,
        `/api/recipes/${parent}/detail`
      )
      expect(detail.components.find((c) => c.componentId === component)?.qty).toBe(3)
    } finally {
      await page.request.delete(apiUrl(`/api/recipes/${parent}`))
      await page.request.delete(apiUrl(`/api/recipes/${component}`))
    }
  })
})

test.describe('A parent recipe follows its component without a reload', () => {
  test('the parent card opened from Used in shows the new cost right after the component is edited', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const stamp = Date.now()
    const butter = (
      await apiGet<{ id: string; name: string; unit: string }[]>(page, '/api/ingredients')
    ).find((i) => i.name === 'Unsalted Butter')!
    const make = async (name: string) => {
      const res = await page.request.post(apiUrl('/api/recipes'), {
        data: {
          name,
          portions: 4,
          ingredients: [{ ingredientId: butter.id, quantity: 0.1, unit: butter.unit }],
        },
      })
      expect(res.ok()).toBeTruthy()
      return ((await res.json()) as { id: string }).id
    }
    const parentName = `Probe Follow Parent ${stamp}`
    const parent = await make(parentName)
    const component = await make(`Probe Follow Base ${stamp}`)
    try {
      const nested = await page.request.post(apiUrl(`/api/recipes/${parent}/components`), {
        data: { componentId: component, quantity: 2, unit: 'portion' },
      })
      expect(nested.ok()).toBeTruthy()
      const costOf = async () => recipeCost(page, parentName)
      const before = await costOf()

      await page.goto(`/recipes/${parent}`)
      await settled(page)
      await page
        .getByRole('main')
        .getByRole('link', { name: `Probe Follow Base ${stamp}` })
        .first()
        .click()
      await settled(page)
      await page.getByRole('button', { name: 'Edit Recipe' }).click()
      await dialog(page).getByLabel('Qty').first().fill('0.3')
      await dialog(page).getByRole('button', { name: 'Save Recipe' }).click()
      await expectToast(page, /Recipe saved/i)
      const after = await costOf()
      expect(after, 'the parent must be recosted on the server').toBeGreaterThan(before)

      await page.getByRole('main').getByRole('link', { name: parentName }).first().click()
      await settled(page)
      await expect(page.getByRole('main')).toContainText(`$${after.toFixed(2)}`)
    } finally {
      await page.request.delete(apiUrl(`/api/recipes/${parent}`))
      await page.request.delete(apiUrl(`/api/recipes/${component}`))
    }
  })
})

test.describe('What a recipe says about itself', () => {
  test('a description is written in the form and read on the card', async ({ page }) => {
    await signInAs(page, 'owner')
    const name = `Probe Described ${Date.now()}`
    const res = await page.request.post(apiUrl('/api/recipes'), { data: { name, portions: 2 } })
    expect(res.ok()).toBeTruthy()
    const { id } = (await res.json()) as { id: string }
    const text = 'Sear hard, rest ten minutes.\nSlice against the grain.'
    try {
      await page.goto(`/recipes/${id}`)
      await settled(page)
      await expect(page.getByRole('heading', { name: 'Description' })).toHaveCount(0)

      await page.getByRole('button', { name: 'Edit Recipe' }).click()
      await dialog(page).getByLabel('Description').fill(text)
      await dialog(page).getByRole('button', { name: 'Save Recipe' }).click()
      await expectToast(page, /Recipe saved/i)
      await expect(page.locator('p', { hasText: 'Slice against the grain.' })).toBeVisible()
      const saved = await apiGet<{ description: string }>(page, `/api/recipes/${id}/detail`)
      expect(saved.description).toBe(text)
    } finally {
      await page.request.delete(apiUrl(`/api/recipes/${id}`))
    }
  })
})

test.describe('How an ingredient is prepared', () => {
  test('the prep note is shown, kept by an edit and changed from the form', async ({ page }) => {
    await signInAs(page, 'owner')
    const [ingredient] = await apiGet<{ id: string; unit: string }[]>(page, '/api/ingredients')
    const name = `Probe Prep Recipe ${Date.now()}`
    const res = await page.request.post(apiUrl('/api/recipes'), {
      data: {
        name,
        portions: 2,
        ingredients: [
          { ingredientId: ingredient.id, quantity: 1, unit: ingredient.unit, prepNote: 'diced' },
        ],
      },
    })
    expect(res.ok()).toBeTruthy()
    const { id } = (await res.json()) as { id: string }
    const prepNotes = async () =>
      (
        await apiGet<{ ingredients: { prepNote: string }[] }>(page, `/api/recipes/${id}/detail`)
      ).ingredients.map((l) => l.prepNote)
    try {
      await page.goto(`/recipes/${id}`)
      await settled(page)
      await expect(page.getByRole('cell', { name: /diced/ })).toBeVisible()

      await page.getByRole('button', { name: 'Edit Recipe' }).click()
      await expect(dialog(page).getByLabel('Prep')).toHaveValue('diced')
      await dialog(page).getByLabel('Portions').fill('3')
      await dialog(page).getByRole('button', { name: 'Save Recipe' }).click()
      await expectToast(page, /Recipe saved/i)
      expect(await prepNotes()).toEqual(['diced'])

      await page.getByRole('button', { name: 'Edit Recipe' }).click()
      await dialog(page).getByLabel('Prep').fill('thinly sliced')
      await dialog(page).getByRole('button', { name: 'Save Recipe' }).click()
      await expectToast(page, /Recipe saved/i)
      await expect(page.getByRole('cell', { name: /thinly sliced/ })).toBeVisible()
      expect(await prepNotes()).toEqual(['thinly sliced'])
    } finally {
      await page.request.delete(apiUrl(`/api/recipes/${id}`))
    }
  })
})

test.describe('A whole number stays what was typed', () => {
  test('a recipe of two and a half portions is refused, not saved as two', async ({ page }) => {
    await signInAs(page, 'owner')
    const recipes = await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')
    const steak = recipes.find((r) => r.name === 'Steak Frites')!
    const portions = async () =>
      (await apiGet<{ portions: number }>(page, `/api/recipes/${steak.id}/detail`)).portions
    const before = await portions()

    await page.goto(`/recipes/${steak.id}`)
    await settled(page)
    await page.getByRole('button', { name: 'Edit Recipe' }).click()
    await dialog(page).getByLabel('Portions').fill('2.5')
    await dialog(page).getByRole('button', { name: 'Save Recipe' }).click()
    await expectToast(page, /Portions is a whole number/)
    await expect(dialog(page)).toBeVisible()
    expect(await portions()).toBe(before)
  })
})

test.describe('An archived ingredient a recipe already uses', () => {
  test('the line keeps naming it instead of emptying itself', async ({ page }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)

    const recipes = await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')
    const wellington = recipes.find((r) => r.name === 'Beef Wellington')!
    const detail = await apiGet<{ ingredients: { ingredientId: string; name: string }[] }>(
      page,
      `/api/recipes/${wellington.id}/detail`
    )
    const line = detail.ingredients[0]

    const archived = await page.request.patch(apiUrl(`/api/ingredients/${line.ingredientId}`), {
      data: { isActive: false },
    })
    expect(archived.ok(), 'the ingredient is archived').toBeTruthy()

    try {
      await page.goto(`/recipes/${wellington.id}`)
      await settled(page)
      const select = page.getByLabel('Ingredient').first()
      await expect(select).toHaveValue(line.ingredientId)
    } finally {
      await page.request.patch(apiUrl(`/api/ingredients/${line.ingredientId}`), {
        data: { isActive: true },
      })
    }
  })
})

test.describe('Where a cost comes from', () => {
  test('the screens that print a cost name the prices they cost on', async ({ page }) => {
    await signInAs(page, 'owner')

    const named = [
      ['/recipes', "costed on the organization's shared ingredient prices"],
      ['/menu', "costed on the organization's shared ingredient prices"],
      ['/analytics/food-cost', "both on the organization's shared ingredient prices"],
    ] as const

    for (const [path, phrase] of named) {
      await page.goto(path)
      await settled(page)
      await expect(page.getByText(phrase, { exact: false }).first()).toBeVisible()
    }
  })
})

test.describe('Menu items', () => {
  test('a new dish is offered at the location in the header unless every location is chosen', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)
    await page.goto('/menu')
    await settled(page)
    const here = await page.evaluate(() => window.localStorage.getItem('nexus.locationId'))
    await page.getByRole('button', { name: /New Menu Item/i }).click()
    await expect(dialog(page).getByLabel('Location')).toHaveValue(here!)
    await page.keyboard.press('Escape')

    const recipe = (await apiGet<{ id: string }[]>(page, '/api/recipes'))[0]
    await page.goto(`/menu?recipe=${recipe.id}`)
    await settled(page)
    await expect(dialog(page).getByLabel('Location')).toHaveValue(here!)
  })

  test('a dish is flagged only when the share it shows is above the target', async ({ page }) => {
    const names: string[] = []
    await page.route('**/api/dashboard/kpis', async (route) => {
      const real = await route.fetch()
      await route.fulfill({ response: real, json: { ...(await real.json()), foodCostTarget: 30 } })
    })
    await page.route(
      (url) => url.pathname === '/api/menu-items',
      async (route) => {
        if (route.request().method() !== 'GET') return route.continue()
        const real = await route.fetch()
        const body = (await real.json()) as {
          name: string
          price: number
          cost: number
          recipes: unknown[]
        }[]
        const costed = body.filter((m) => m.recipes.length > 0).slice(0, 2)
        costed.forEach((m, i) => {
          m.price = 100
          m.cost = i === 0 ? 30.04 : 30.06
        })
        names.splice(0, names.length, ...costed.map((m) => m.name))
        await route.fulfill({ response: real, json: body })
      }
    )
    await signInAs(page, 'owner')
    await page.goto('/menu')
    await settled(page)
    expect(names).toHaveLength(2)

    const row = (name: string) => dataRows(page).filter({ hasText: name }).first()
    await expect(row(names[0])).toContainText('30.0%')
    await expect(row(names[0]).locator('span.text-warning-700')).toHaveCount(0)
    await expect(row(names[1])).toContainText('30.1%')
    await expect(row(names[1]).locator('span.text-warning-700')).toHaveCount(1)
  })

  test('the target a food cost is judged by is the one the organization set', async ({ page }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)

    const setTarget = async (value: string) => {
      await page.goto('/settings')
      await settled(page)
      await page.getByLabel('Target food cost %').fill(value)
      await page.getByRole('button', { name: /Save/ }).first().click()
      await expectToast(page, /saved/i)
    }

    const steak = (await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')).find(
      (r) => r.name === 'Steak Frites'
    )!
    const setRecipeTarget = (value: number | null) =>
      page.request.patch(apiUrl(`/api/recipes/${steak.id}`), { data: { targetFoodCostPct: value } })

    try {
      await setRecipeTarget(null)
      await setTarget('1')
      await page.goto('/menu')
      await settled(page)
      const flagged = dataRows(page).first().locator('span.text-warning-700')
      await expect(flagged).toBeVisible()

      await page.goto('/recipes')
      await settled(page)
      const flaggedAtOne = await page.locator('.text-warning-700').count()
      expect(flaggedAtOne).toBeGreaterThan(0)

      await page.goto('/dashboard')
      await settled(page)
      await expect(page.getByText('target 1%')).toBeVisible()

      await setTarget('99')
      await page.goto('/menu')
      await settled(page)
      await expect(dataRows(page).first().locator('span.text-warning-700')).toHaveCount(0)

      await page.goto('/recipes')
      await settled(page)
      expect(await page.locator('.text-warning-700').count()).toBeLessThan(flaggedAtOne)
    } finally {
      await setRecipeTarget(30)
      await setTarget('30')
    }
  })

  test('one dish carries its own price at each location, and no menu repeats a name', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/menu')
    await settled(page)

    const name = `Two-Site Plate ${Date.now()}`
    const add = async (locationIndex: number, price: string) => {
      await page.getByRole('button', { name: /New Menu Item/i }).click()
      await dialog(page).getByLabel(/^Name/).fill(name)
      await dialog(page)
        .getByLabel(/Selling price/)
        .fill(price)
      await dialog(page).getByLabel('Location').selectOption({ index: locationIndex })
      await dialog(page)
        .getByRole('button', { name: /save|create/i })
        .last()
        .click()
    }

    await add(1, '21')
    await expectToast(page, /Menu item created/i)
    await add(2, '26')
    await expectToast(page, /Menu item created/i)

    await page.reload()
    await settled(page)
    const rows = dataRows(page).filter({ hasText: name })
    await expect(rows).toHaveCount(2)
    await expect(rows.filter({ hasText: '$21.00' })).toHaveCount(1)
    await expect(rows.filter({ hasText: '$26.00' })).toHaveCount(1)

    await add(1, '30')
    await expectToast(page, /already on the menu/i)
    await dialog(page)
      .getByRole('button', { name: /cancel/i })
      .click()

    await page.reload()
    await settled(page)
    for (let i = 0; i < 2; i++) {
      await dataRows(page)
        .filter({ hasText: name })
        .first()
        .getByRole('button', { name: 'Delete' })
        .click()
      await dialog(page).getByRole('button', { name: 'Delete' }).click()
      await expectToast(page, /deleted/i)
      await page.reload()
      await settled(page)
    }
    await expect(dataRows(page).filter({ hasText: name })).toHaveCount(0)
  })

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
    await dialog(page)
      .getByLabel(/Selling price/)
      .fill('50')
    await dialog(page).getByLabel('Location').selectOption({ index: 1 })
    await dialog(page).locator('select').last().selectOption({ label: 'Steak Frites' })
    await dialog(page)
      .getByRole('button', { name: /save|create/i })
      .last()
      .click()
    await expectToast(page, /Menu item created/i)

    await page.reload()
    await settled(page)
    const row = dataRows(page).filter({ hasText: name })
    await expect(row).toHaveCount(1)

    const headers = await page.getByRole('columnheader').allTextContents()
    const cells = await row.locator('td').allTextContents()
    const under = (column: string) => Number(cells[headers.indexOf(column)].replace(/[^\d.]/g, ''))
    const price = under('Price')
    const cost = under('Cost')
    const marginPct = under('Margin %')
    const foodCostPct = under('Food cost %')

    expect(marginPct + foodCostPct).toBeCloseTo(100, 0)
    expect(foodCostPct).toBeCloseTo((cost / price) * 100, 0)

    await row.getByRole('button', { name: 'Delete' }).click()
    await expect(dialog(page)).toContainText('The recipes themselves stay')
    await written(page, () => dialog(page).getByRole('button', { name: 'Delete' }).click())
    await page.reload()
    await settled(page)
    await expect(dataRows(page).filter({ hasText: name })).toHaveCount(0)
  })
})

test.describe('Menus', () => {
  test('a menu row keeps its actions on one line', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/menus')
    await settled(page)
    const dinner = dataRows(page).filter({ hasText: 'Dinner' })
    const edit = (await dinner.getByRole('button', { name: 'Edit' }).boundingBox())!
    const del = (await dinner.getByRole('button', { name: 'Delete' }).boundingBox())!
    expect(Math.abs(edit.y - del.y)).toBeLessThan(2)
  })

  test('a menu names what it serves, where, and what it all costs', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/menus')
    await settled(page)

    const dinner = dataRows(page).filter({ hasText: 'Dinner' })
    await expect(dinner).toHaveCount(1)
    await expect(dinner).toContainText('Golden Fork — Downtown')

    const listed = await dinner.locator('td').allTextContents()
    await dinner.getByRole('link', { name: 'Dinner' }).click()
    await expect(page).toHaveURL(/\/menus\/[^/]+$/)
    await settled(page)
    await expect(page.getByRole('heading', { name: 'Dinner' })).toBeVisible()
    await expect(page.getByText('Served at Golden Fork — Downtown')).toBeVisible()
    const rows = dataRows(page)
    await expect(rows.filter({ hasText: 'Steak Frites' })).toHaveCount(1)
    await expect(rows.filter({ hasText: 'Crème Brûlée' })).toHaveCount(1)

    const prices: number[] = []
    const costs: number[] = []
    for (const row of await rows.all()) {
      const cells = await row.locator('td').allTextContents()
      prices.push(Number(cells[3].replace(/[^\d.]/g, '')))
      costs.push(Number(cells[4].replace(/[^\d.]/g, '')) || 0)
    }
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
    expect(Number(listed[2])).toBe(prices.length)
    expect(Number(listed[3].replace(/[^\d.]/g, ''))).toBeCloseTo(sum(prices), 1)
    expect(Number(listed[4].replace(/[^\d.]/g, ''))).toBeCloseTo(sum(costs), 1)
  })

  test('the menu form offers only dishes sold where the menu is served', async ({ page }) => {
    await signInAs(page, 'owner')
    const riverside = (await apiGet<{ id: string; name: string }[]>(page, '/api/properties')).find(
      (l) => l.name.includes('Riverside')
    )!
    const made = await page.request.post(apiUrl('/api/menu-items'), {
      data: { name: 'Probe Riverside Only', price: 5, locationId: riverside.id },
    })
    expect(made.ok()).toBeTruthy()
    const dishId = ((await made.json()) as { id: string }).id
    try {
      await page.goto('/menus')
      await settled(page)
      await dataRows(page)
        .filter({ hasText: 'Lunch' })
        .getByRole('button', { name: 'Edit' })
        .click()
      const form = dialog(page)
      await expect(form.getByLabel('Golden Fork — Downtown')).toBeChecked()
      await expect(form.getByLabel(/Probe Riverside Only/)).toHaveCount(0)
      await form.getByLabel('Golden Fork — Riverside').check()
      await expect(form.getByLabel(/Probe Riverside Only/)).toBeVisible()
      await form.getByRole('button', { name: 'Cancel' }).click()

      await page.goto('/menu')
      await settled(page)
      const row = dataRows(page).filter({ hasText: 'Probe Riverside Only' })
      await expect(row).toContainText('Golden Fork — Riverside')
      await expect(dataRows(page).filter({ hasText: 'Steak Frites' })).toContainText(
        'All locations'
      )
    } finally {
      await page.request.delete(apiUrl(`/api/menu-items/${dishId}`))
    }
  })

  test('the dish form offers only the menus that serve where the dish is sold', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const locations = await apiGet<{ id: string; name: string }[]>(page, '/api/locations')
    const airport = locations.find((l) => l.name.endsWith('Airport'))!
    const downtown = locations.find((l) => l.name.endsWith('Downtown'))!
    const name = `Probe Airport Only Menu ${Date.now()}`
    const made = await page.request.post(apiUrl('/api/menus'), {
      data: { name, locationIds: [airport.id] },
    })
    expect(made.ok(), 'the probe menu is created').toBeTruthy()
    const menu = (await made.json()) as { id: string }
    try {
      await page.goto('/menu')
      await settled(page)
      await page.getByRole('button', { name: '+ New Menu Item' }).click()
      const form = dialog(page)
      const offered = form.getByRole('checkbox', { name })
      await form.getByLabel('Location').selectOption({ label: downtown.name })
      await expect(offered).toHaveCount(0)
      await form.getByLabel('Location').selectOption({ label: airport.name })
      await expect(offered).toHaveCount(1)
      await form.getByLabel('Location').selectOption({ label: 'All locations' })
      await expect(offered).toHaveCount(1)
      await form.getByRole('button', { name: 'Cancel' }).click()
    } finally {
      await page.request.delete(apiUrl(`/api/menus/${menu.id}`))
    }
  })

  test('the dish form refuses a recipe line with no portions instead of counting one', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/menu')
    await settled(page)
    await page.getByRole('button', { name: '+ New Menu Item' }).click()
    const form = dialog(page)
    await form.getByLabel('Name').fill('Probe No Portions')
    await form.getByLabel('Selling price').fill('10')
    await form.getByLabel('Recipe').selectOption({ label: 'Steak Frites' })
    await form.getByLabel('Portions').fill('0')
    await form.getByRole('button', { name: 'Create Item' }).click()
    await expect(form.getByText(/needs portions above zero/)).toBeVisible()
    await expect(dialog(page)).toBeVisible()
    await form.getByRole('button', { name: 'Cancel' }).click()
  })

  test('a menu page adds dishes to the menu and takes them off again', async ({ page }) => {
    await signInAs(page, 'owner')
    const dinner = (await apiGet<{ id: string; name: string }[]>(page, '/api/menus')).find(
      (m) => m.name === 'Dinner'
    )!
    const before = await apiGet<{ items: { id: string; name: string }[] }>(
      page,
      `/api/menus/${dinner.id}`
    )
    const probe = await page.request.post(apiUrl('/api/menu-items'), {
      data: { name: `Menu page probe ${Date.now()}`, price: 8 },
    })
    expect(probe.ok(), 'the probe dish is created').toBeTruthy()
    const outside = (await probe.json()) as { id: string; name: string }
    try {
      await page.goto(`/menus/${dinner.id}`)
      await settled(page)
      await page.getByRole('button', { name: 'Add dishes' }).click()
      await dialog(page).getByPlaceholder('Search dishes…').fill(outside.name)
      await dialog(page)
        .getByRole('checkbox', { name: new RegExp(`^${outside.name}`) })
        .check()
      await dialog(page)
        .getByRole('button', { name: /to menu/ })
        .click()
      await expectToast(page, /added to Dinner/)
      await expect(dataRows(page).filter({ hasText: outside.name })).toHaveCount(1)
      const added = await apiGet<{ items: { id: string }[] }>(page, `/api/menus/${dinner.id}`)
      expect(added.items.map((i) => i.id)).toEqual([...before.items.map((i) => i.id), outside.id])

      await dataRows(page)
        .filter({ hasText: outside.name })
        .getByRole('button', { name: 'Remove' })
        .click()
      await expectToast(page, /taken off Dinner/)
      await expect(dataRows(page).filter({ hasText: outside.name })).toHaveCount(0)
    } finally {
      await page.request.patch(apiUrl(`/api/menus/${dinner.id}`), {
        data: { menuItemIds: before.items.map((i) => i.id) },
      })
      await page.request.delete(apiUrl(`/api/menu-items/${outside.id}`))
    }
  })

  test('a menu page offers the dishes of the locations that serve the menu, whatever the header says', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const lunch = (await apiGet<{ id: string; name: string }[]>(page, '/api/menus')).find(
      (m) => m.name === 'Lunch'
    )!
    const locations = await apiGet<{ id: string; name: string }[]>(page, '/api/locations')
    const downtown = locations.find((l) => l.name === 'Golden Fork — Downtown')!
    const airport = locations.find((l) => l.name === 'Golden Fork — Airport')!
    const before = await apiGet<{ items: { id: string }[] }>(page, `/api/menus/${lunch.id}`)
    const stamp = Date.now()
    const created: string[] = []
    const dish = async (name: string, locationId: string) => {
      const res = await page.request.post(apiUrl('/api/menu-items'), {
        data: { name, price: 9, locationId },
      })
      expect(res.ok(), `${name} is created`).toBeTruthy()
      const body = (await res.json()) as { id: string; name: string }
      created.push(body.id)
      return body
    }
    const served = await dish(`Downtown probe ${stamp}`, downtown.id)
    const elsewhere = await dish(`Airport probe ${stamp}`, airport.id)
    try {
      await page.goto('/menus')
      await switchLocation(page, airport.name)
      await page.goto(`/menus/${lunch.id}`)
      await settled(page)

      await page.getByRole('button', { name: 'Add dishes' }).click()
      await dialog(page).getByPlaceholder('Search dishes…').fill(`probe ${stamp}`)
      await expect(
        dialog(page).getByRole('checkbox', { name: new RegExp(`^${elsewhere.name}`) })
      ).toHaveCount(0)
      await dialog(page)
        .getByRole('checkbox', { name: new RegExp(`^${served.name}`) })
        .check()
      await dialog(page)
        .getByRole('button', { name: /to menu/ })
        .click()
      await expectToast(page, /added to Lunch/)
      await expect(dataRows(page).filter({ hasText: served.name })).toHaveCount(1)

      await dataRows(page)
        .filter({ hasText: served.name })
        .getByRole('button', { name: 'Remove' })
        .click()
      await expectToast(page, /taken off Lunch/)
      await expect(dataRows(page).filter({ hasText: served.name })).toHaveCount(0)
    } finally {
      await page.request.patch(apiUrl(`/api/menus/${lunch.id}`), {
        data: { menuItemIds: before.items.map((i) => i.id) },
      })
      for (const id of created) await page.request.delete(apiUrl(`/api/menu-items/${id}`))
    }
  })

  test('a dish says which menus it is on, can be filtered by menu, and is created straight onto one', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const dinner = (await apiGet<{ id: string; name: string }[]>(page, '/api/menus')).find(
      (m) => m.name === 'Dinner'
    )!
    const onDinner = await apiGet<{ items: { name: string }[] }>(page, `/api/menus/${dinner.id}`)

    await page.goto('/menu')
    await settled(page)
    await page.getByLabel('Menu', { exact: true }).selectOption(dinner.id)
    await expect
      .poll(async () => (await dataRows(page).allTextContents()).length)
      .toBe(onDinner.items.length)
    for (const row of await dataRows(page).all()) await expect(row).toContainText('Dinner')

    const name = `Straight onto Dinner ${Date.now()}`
    await page.goto(`/menus/${dinner.id}`)
    await settled(page)
    await page.getByRole('link', { name: 'New dish on this menu' }).click()
    await expect(page).toHaveURL(new RegExp(`/menu\\?menu=${dinner.id}`))
    await expect(dialog(page).getByRole('checkbox', { name: 'Dinner' })).toBeChecked()
    await dialog(page).getByLabel('Name').fill(name)
    await dialog(page).getByLabel('Selling price').fill('19')
    await dialog(page)
      .getByRole('button', { name: /Create|Save/ })
      .click()
    await expectToast(page, /Menu item created/i)

    const created = (
      await apiGet<{ id: string; name: string; menus: { id: string }[] }[]>(page, '/api/menu-items')
    ).find((i) => i.name === name)
    expect(created, 'the dish reached the API').toBeDefined()
    expect(created!.menus.map((m) => m.id)).toEqual([dinner.id])
    await page.request.delete(apiUrl(`/api/menu-items/${created!.id}`))
  })

  test('a dish taken off sale is on the menu but out of its cost', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/menu')
    await settled(page)

    const dish = 'Crème Brûlée'
    await dataRows(page).filter({ hasText: dish }).getByRole('button', { name: 'Edit' }).click()
    await dialog(page).getByLabel('Active on the menu').uncheck()
    await dialog(page)
      .getByRole('button', { name: /save|create/i })
      .last()
      .click()
    await expectToast(page, /Menu item saved/i)

    await page.goto('/menus')
    await settled(page)
    const dinner = dataRows(page).filter({ hasText: 'Dinner' })
    await dinner.getByRole('link', { name: 'Dinner' }).click()
    await settled(page)
    const row = dataRows(page).filter({ hasText: dish })
    await expect(row.getByText('Not served', { exact: true })).toBeVisible()
    await expect(page.getByText('1 not served')).toBeVisible()

    await page.goto('/menu')
    await settled(page)
    await dataRows(page).filter({ hasText: dish }).getByRole('button', { name: 'Edit' }).click()
    await dialog(page).getByLabel('Active on the menu').check()
    await dialog(page)
      .getByRole('button', { name: /save|create/i })
      .last()
      .click()
    await expectToast(page, /Menu item saved/i)
  })

  test('a menu is created, assigned to a location, taken out of service and removed', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/menus')
    await settled(page)

    const name = `Probe Menu ${Date.now()}`
    await page.getByRole('button', { name: 'New Menu' }).click()
    await dialog(page).getByLabel('Name').fill(name)
    await dialog(page).locator('input[type=checkbox]').first().check()
    await dialog(page).locator('input[type=checkbox]').last().check()
    await dialog(page).getByRole('button', { name: 'Create Menu' }).click()
    await expectToast(page, /Menu created/i)

    const row = dataRows(page).filter({ hasText: name })
    await expect(row).toHaveCount(1)
    await expect(row).not.toContainText('Not assigned')
    await expect(row.getByText('Inactive', { exact: true })).toHaveCount(0)

    await row.getByRole('button', { name: 'Edit' }).click()
    await dialog(page).getByLabel('Active: the menu is in service').uncheck()
    await dialog(page).getByRole('button', { name: 'Save Menu' }).click()
    await expectToast(page, /Menu updated/i)
    await expect(row.getByText('Inactive', { exact: true })).toBeVisible()
    const menus = await apiGet<{ name: string; isActive: boolean }[]>(page, '/api/menus')
    expect(menus.find((m) => m.name === name)?.isActive).toBe(false)

    await row.getByRole('button', { name: 'Delete' }).click()
    await dialog(page).getByRole('button', { name: 'Delete' }).click()
    await expectToast(page, /deleted/i)
    await expect(dataRows(page).filter({ hasText: name })).toHaveCount(0)
  })

  test('All locations ticks every location, and the menu is served at each of them', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const active = await apiGet<{ id: string }[]>(page, '/api/properties')
    await page.goto('/menus')
    await settled(page)

    const name = `Probe Everywhere ${Date.now()}`
    await page.getByRole('button', { name: 'New Menu' }).click()
    await dialog(page).getByLabel('Name').fill(name)
    const all = dialog(page).getByLabel('All locations', { exact: true })
    await all.check()
    for (const l of [
      'Golden Fork — Airport',
      'Golden Fork — Downtown',
      'Golden Fork — Riverside',
    ]) {
      await expect(dialog(page).getByLabel(l, { exact: true })).toBeChecked()
    }
    await dialog(page).getByLabel('Golden Fork — Airport', { exact: true }).uncheck()
    await expect(all).not.toBeChecked()
    await all.check()
    await dialog(page).getByRole('button', { name: 'Create Menu' }).click()
    await expectToast(page, /Menu created/i)

    const menus = await apiGet<{ id: string; name: string; locations: { id: string }[] }[]>(
      page,
      '/api/menus'
    )
    const made = menus.find((m) => m.name === name)!
    try {
      expect(made.locations.map((l) => l.id).sort()).toEqual(active.map((l) => l.id).sort())
    } finally {
      await page.request.delete(apiUrl(`/api/menus/${made.id}`))
    }
  })

  test('a new menu starts at the location in the header', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/menus')
    await settled(page)
    await switchLocation(page, 'Golden Fork — Riverside')
    await page.getByRole('button', { name: 'New Menu' }).click()
    await expect(dialog(page).getByLabel('Golden Fork — Riverside', { exact: true })).toBeChecked()
    await expect(
      dialog(page).getByLabel('Golden Fork — Downtown', { exact: true })
    ).not.toBeChecked()
    await page.keyboard.press('Escape')
  })

  test('the list follows the location in the header', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/menus')
    await settled(page)
    await expect(dataRows(page).filter({ hasText: 'Lunch' })).toHaveCount(1)

    await switchLocation(page, 'Golden Fork — Riverside')
    await expect(dataRows(page).filter({ hasText: 'Dinner' })).toHaveCount(1)
    await expect(dataRows(page).filter({ hasText: 'Lunch' })).toHaveCount(0)
    await expect(page.getByText(/Menus served at Golden Fork — Riverside/)).toBeVisible()

    await switchLocation(page, 'Golden Fork — Airport')
    await expect(dataRows(page).filter({ hasText: 'Dinner' })).toHaveCount(0)
    await expect(dataRows(page).filter({ hasText: 'Lunch' })).toHaveCount(0)
  })

  test('a chef sees the menus but is offered no way to change them', async ({ page }) => {
    await signInAs(page, 'staff')
    await page.goto('/menus')
    await settled(page)
    await expect(dataRows(page).filter({ hasText: 'Dinner' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'New Menu' })).toHaveCount(0)
  })
})

test.describe('Unit conversions', () => {
  const fill = async (page: Page, from: string, to: string, factor: string) => {
    await page.getByRole('button', { name: '+ Add Conversion' }).first().click()
    await dialog(page).getByLabel('From unit').selectOption(from)
    await dialog(page).getByLabel('To unit').selectOption(to)
    await dialog(page).getByLabel('Factor').fill(factor)
    await dialog(page).getByRole('button', { name: 'Save' }).click()
  }

  test('a rule is recorded, listed against its ingredient, changed and removed again', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/settings/units')
    await settled(page)

    const before = await dataRows(page).count()

    await page.getByRole('button', { name: '+ Add Conversion' }).first().click()
    await dialog(page).getByLabel('Ingredient').selectOption({ label: 'Eggs' })
    await dialog(page).getByLabel('From unit').selectOption('ea')
    await dialog(page).getByLabel('To unit').selectOption('kg')
    await dialog(page).getByLabel('Factor').fill('0.05')
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    await expectToast(page, /recosted/i)
    await settled(page)

    await expect(dataRows(page)).toHaveCount(before + 1)
    const row = dataRows(page).filter({ hasText: 'Eggs' })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('ea')
    await expect(row).toContainText('kg')
    await expect(row).toContainText('0.05')

    await row.getByRole('button', { name: 'Edit' }).click()
    await expect(dialog(page).getByLabel('Factor')).toHaveValue('0.05')
    await expect(dialog(page).getByLabel('Ingredient')).toHaveValue(/.+/)
    await dialog(page).getByLabel('Factor').fill('0.06')
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    await expectToast(page, /recosted/i)
    await expect(row).toContainText('0.06')
    await expect(dataRows(page)).toHaveCount(before + 1)
    const rules = await apiGet<{ ingredient: string; factor: number }[]>(
      page,
      '/api/unit-conversions'
    )
    expect(rules.filter((r) => r.ingredient === 'Eggs').map((r) => r.factor)).toEqual([0.06])

    await row.getByRole('button', { name: 'Remove' }).click()
    await expect(dialog(page)).toContainText('may change their totals')
    await dialog(page).getByRole('button', { name: 'Remove' }).click()
    await expectToast(page, /removed/i)

    await page.reload()
    await settled(page)
    await expect(dataRows(page)).toHaveCount(before)
  })

  test('a rule for an archived ingredient still names it when edited', async ({ page }) => {
    await signInAs(page, 'owner')
    const [eggs] = (await apiGet<{ id: string; name: string }[]>(page, '/api/ingredients')).filter(
      (i) => i.name === 'Eggs'
    )
    const made = await page.request.post(apiUrl('/api/unit-conversions'), {
      data: { ingredientId: eggs.id, fromUnit: 'ea', toUnit: 'kg', factor: 0.05 },
    })
    expect(made.ok()).toBeTruthy()
    const { id } = (await made.json()) as { id: string }
    await page.request.patch(apiUrl(`/api/ingredients/${eggs.id}`), { data: { isActive: false } })
    try {
      await page.goto('/settings/units')
      await settled(page)
      await dataRows(page).filter({ hasText: 'Eggs' }).getByRole('button', { name: 'Edit' }).click()
      const field = dialog(page).getByLabel('Ingredient')
      await expect(field).toHaveValue(eggs.id)
      await expect(field.locator('option:checked')).toHaveText('Eggs (archived)')
    } finally {
      await page.request.patch(apiUrl(`/api/ingredients/${eggs.id}`), { data: { isActive: true } })
      await page.request.delete(apiUrl(`/api/unit-conversions/${id}`))
    }
  })

  test('the form refuses what it cannot mean', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/settings/units')
    await settled(page)
    const before = await dataRows(page).count()

    await fill(page, 'g', 'kg', '0.001')
    await expectToast(page, /already convert/i)

    await page.reload()
    await settled(page)
    await expect(dataRows(page)).toHaveCount(before)
  })

  test('a line stated through a conversion keeps that unit on the screen', async ({ page }) => {
    await signInAs(page, 'owner')

    const eggs = (await apiGet<{ id: string; name: string }[]>(page, '/api/ingredients')).find(
      (i) => i.name === 'Eggs'
    )!
    const rule = await page.request.post(apiUrl('/api/unit-conversions'), {
      data: { ingredientId: eggs.id, fromUnit: 'ea', toUnit: 'kg', factor: 0.05 },
    })
    const made = await page.request.post(apiUrl('/api/recipes'), {
      data: {
        name: 'Bridged Unit Probe',
        portions: 1,
        ingredients: [{ ingredientId: eggs.id, quantity: 0.5, unit: 'kg' }],
      },
    })
    expect(made.status(), 'a kilogram line is allowed once a rule weighs the egg').toBe(201)
    const recipe = (await made.json()) as { id: string }

    await page.goto(`/recipes/${recipe.id}`)
    await settled(page)
    await page.getByRole('button', { name: /^Edit/ }).first().click()

    const unit = page.getByLabel('Unit').first()
    await expect(unit, 'the box states the unit the line is actually in').toHaveValue('kg')
    const offered = await unit.locator('option').allTextContents()
    expect(offered.join(' ')).toContain('Kilogram')
    expect(offered.join(' '), 'the unit it is priced in stays reachable').toContain('Each')

    await page.request.delete(apiUrl(`/api/recipes/${recipe.id}`))
    await page.request.delete(
      apiUrl(`/api/unit-conversions/${((await rule.json()) as { id: string }).id}`)
    )
  })

  test('a chef is offered no unit conversions', async ({ page }) => {
    await signInAs(page, 'staff')
    await page.goto('/settings/units')
    await expect(page).not.toHaveURL(/\/settings\/units$/, { timeout: 15000 })
  })
})

test.describe('Recipe import', () => {
  test('an uploaded recipe becomes a recipe with its lines and a cost', async ({ page }) => {
    await signInAs(page, 'owner')
    await workAtFirstLocation(page)

    const stamp = Date.now()
    const name = `UI Imported Recipe ${stamp}`
    const rawName = `UI Recipe Wording ${stamp}`
    const fileName = `recipe-${stamp}.json`

    await page.goto('/recipes/import')
    await expect(page).toHaveURL(/\/recipes$/)
    await settled(page)
    await page.getByRole('button', { name: 'Upload recipes' }).click()
    await dialog(page)
      .locator('input[type="file"]')
      .setInputFiles({
        name: fileName,
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify({
            kind: 'recipe',
            name,
            portions: 6,
            items: [
              { rawName: 'San Marzano Tomatoes', quantity: 2, unit: 'kg' },
              { rawName, quantity: 3, unit: 'ea' },
            ],
          })
        ),
      })

    await expectToast(page, /1 file sent for reading/)
    await expect(page).toHaveURL(/\/recipes$/)
    await expect(page.getByRole('status').filter({ hasText: 'waiting for review' })).toBeVisible({
      timeout: 20000,
    })
    await expect(page.getByRole('status').filter({ hasText: 'waiting for review' })).toHaveText(
      /\d+ recipes? (is|are) waiting for review/
    )
    await page.getByRole('link', { name: 'Review in Documents' }).click()
    await expect(page).toHaveURL(/\/documents\?type=recipe$/)
    await expect(page.getByLabel('Show')).toHaveValue('recipe')
    const row = page.locator('tbody tr').filter({ hasText: fileName })
    await expect(row.getByText('Requires Review')).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Review' }).click()

    const window = dialog(page)
    await expect(window.getByRole('columnheader', { name: 'Ingredient' })).toBeVisible()
    const unresolved = window.locator('tbody tr').filter({ hasText: rawName }).last()
    await expect(unresolved).toBeVisible()
    await unresolved.locator('select').selectOption({ label: 'Eggs' })
    await expectToast(page, /mapped/i)

    await window.getByRole('button', { name: /Confirm/ }).click()
    await expectToast(page, /applied|confirmed/i)

    expect(await recipeCost(page, name)).toBeGreaterThan(0)

    const recipes = await apiGet<{ id: string; name: string }[]>(page, '/api/recipes')
    const created = recipes.find((r) => r.name === name)!
    expect((await page.request.delete(apiUrl(`/api/recipes/${created.id}`))).ok()).toBeTruthy()

    await page.goto('/ingredients/mapping')
    await settled(page)
    const alias = page.locator('tbody tr').filter({ hasText: rawName })
    await alias.getByRole('button', { name: 'Remove' }).click()
    await dialog(page).getByRole('button', { name: 'Remove' }).click()
    await expectToast(page, /removed/i)
  })
})

test.describe('A dish with no recipe', () => {
  test('carries no cost, no margin and no weight in the average', async ({ page }) => {
    await signInAs(page, 'owner')
    const name = `No Recipe Probe ${Date.now()}`
    const created = await page.request.post(apiUrl('/api/menu-items'), {
      data: { name, price: 20 },
    })
    expect(created.ok(), 'the probe dish is created').toBeTruthy()
    const id = ((await created.json()) as { id: string }).id
    try {
      await page.goto('/menu')
      await settled(page)
      const row = dataRows(page).filter({ hasText: name })
      await expect(row).toContainText('No recipe')
      await expect(row).not.toContainText('100.0%')

      const items = await apiGet<{ price: number; cost: number; recipes: unknown[] }[]>(
        page,
        '/api/menu-items'
      )
      const costed = items.filter((m) => m.recipes.length > 0 && m.price > 0)
      const average =
        costed.reduce((sum, m) => sum + ((m.price - m.cost) / m.price) * 100, 0) / costed.length
      const card = page
        .locator('.lift')
        .filter({ has: page.getByText('Avg Margin', { exact: true }) })
      await expect(card).toContainText(`${average.toFixed(1)}%`)
    } finally {
      await page.request.delete(apiUrl(`/api/menu-items/${id}`))
    }
  })
})

test.describe('A conversion factor with a decimal comma', () => {
  test('is read as the number it means', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/settings/units')
    await settled(page)
    await page.getByRole('button', { name: '+ Add Conversion' }).first().click()
    await dialog(page).getByLabel('From unit').selectOption('dozen')
    await dialog(page).getByLabel('To unit').selectOption('kg')
    await dialog(page).getByLabel('Factor').fill('0,12')
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    try {
      await expectToast(page, /recosted/i)
      await expect(dataRows(page).filter({ hasText: 'dozen' })).toContainText('0.12')
    } finally {
      const rules = await apiGet<{ id: string; fromUnit: string }[]>(page, '/api/unit-conversions')
      for (const rule of rules.filter((r) => r.fromUnit === 'dozen')) {
        await page.request.delete(apiUrl(`/api/unit-conversions/${rule.id}`))
      }
    }
  })
})

test.describe('Category names at a desktop width', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('every category name is shown whole', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/settings/categories')
    await settled(page)
    const names = page.getByRole('main').locator('[title]')
    const cut = await names.evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth)
        .map((el) => el.getAttribute('title'))
    )
    expect(await names.count()).toBeGreaterThan(0)
    expect(cut, 'names cut short').toEqual([])
  })
})
