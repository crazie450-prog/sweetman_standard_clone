import { expect, test } from '@playwright/test'
import {
  ACCOUNTS,
  apiGet,
  apiUrl,
  dataRows,
  dialog,
  expectToast,
  settled,
  signIn,
  signInAs,
  workAtFirstLocation,
} from '../helpers'

const stamp = () => Date.now().toString(36)

test.describe('An edit form can empty a field', () => {
  test('an ingredient goes back to no category', async ({ page }) => {
    await signInAs(page, 'owner')
    const name = `Probe Clear Ingredient ${stamp()}`
    const category = (
      await (
        await page.request.post(apiUrl('/api/categories'), {
          data: { name: `Probe Pantry ${stamp()}`, kind: 'ingredient' },
        })
      ).json()
    ).id as string
    const created = await page.request.post(apiUrl('/api/ingredients'), {
      data: { name, unit: 'kg', costPerUnit: 2, categoryId: category },
    })
    const id = (await created.json()).id as string
    try {
      await page.goto('/ingredients')
      await settled(page)
      await dataRows(page).filter({ hasText: name }).getByRole('button', { name: 'Edit' }).click()
      await dialog(page).getByLabel('Category').selectOption('')
      await dialog(page).getByRole('button', { name: 'Save Ingredient' }).click()
      await expectToast(page, /Ingredient updated/i)
      const rows = await apiGet<{ id: string; categoryId: string | null }[]>(
        page,
        '/api/ingredients'
      )
      expect(rows.find((r) => r.id === id)?.categoryId).toBeNull()
    } finally {
      await page.request.delete(apiUrl(`/api/ingredients/${id}`))
      await page.request.delete(apiUrl(`/api/categories/${category}`))
    }
  })

  test('a dish of one location becomes a dish of every location', async ({ page }) => {
    await signInAs(page, 'owner')
    const downtown = (await apiGet<{ id: string; name: string }[]>(page, '/api/properties')).find(
      (l) => l.name.endsWith('Downtown')
    )!
    const name = `Probe Clear Dish ${stamp()}`
    const id = (
      await (
        await page.request.post(apiUrl('/api/menu-items'), {
          data: { name, price: 7, locationId: downtown.id },
        })
      ).json()
    ).id as string
    try {
      await page.goto('/menu')
      await settled(page)
      await dataRows(page).filter({ hasText: name }).getByRole('button', { name: 'Edit' }).click()
      await dialog(page).getByLabel('Location').selectOption('')
      await dialog(page).getByRole('button', { name: 'Save Item' }).click()
      await expectToast(page, /Menu item saved/i)
      const rows = await apiGet<{ id: string; locationId: string | null }[]>(
        page,
        '/api/menu-items'
      )
      expect(rows.find((r) => r.id === id)?.locationId).toBeNull()
    } finally {
      await page.request.delete(apiUrl(`/api/menu-items/${id}`))
    }
  })

  test('a recipe drops its category and its own target, and a line without a quantity is not dropped silently', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    const ingredients = await apiGet<{ id: string; name: string; unit: string }[]>(
      page,
      '/api/ingredients'
    )
    const flour = ingredients.find((i) => i.name === 'All-Purpose Flour') ?? ingredients[0]
    const category = (
      await (
        await page.request.post(apiUrl('/api/categories'), {
          data: { name: `Probe Sauces ${stamp()}`, kind: 'recipe' },
        })
      ).json()
    ).id as string
    const id = (
      await (
        await page.request.post(apiUrl('/api/recipes'), {
          data: {
            name: `Probe Clear Recipe ${stamp()}`,
            categoryId: category,
            targetFoodCostPct: 40,
            ingredients: [{ ingredientId: flour.id, quantity: 1, unit: flour.unit }],
          },
        })
      ).json()
    ).id as string
    try {
      await page.goto(`/recipes/${id}`)
      await settled(page)
      await page.getByRole('button', { name: 'Edit Recipe' }).click()
      await dialog(page).getByLabel('Qty', { exact: true }).first().fill('')
      await dialog(page).getByRole('button', { name: 'Save Recipe' }).click()
      await expect(dialog(page).getByRole('alert')).toContainText(/needs a quantity/)
      const kept = await apiGet<{ ingredients: unknown[] }>(page, `/api/recipes/${id}/detail`)
      expect(kept.ingredients).toHaveLength(1)

      await dialog(page).getByLabel('Qty', { exact: true }).first().fill('1')
      await dialog(page).getByLabel('Category').selectOption('')
      await dialog(page).getByLabel('Target food-cost %').fill('')
      await dialog(page).getByRole('button', { name: 'Save Recipe' }).click()
      await expectToast(page, /Recipe saved/i)
      const after = await apiGet<{ categoryId: string | null; targetFoodCostPct: number | null }>(
        page,
        `/api/recipes/${id}/detail`
      )
      expect(after.categoryId).toBeNull()
      expect(after.targetFoodCostPct).toBeNull()
    } finally {
      await page.request.delete(apiUrl(`/api/recipes/${id}`))
      await page.request.delete(apiUrl(`/api/categories/${category}`))
    }
  })
})

test.describe('Screens offer what is there', () => {
  test('the recipe category filter lists the categories the organization has', async ({ page }) => {
    await signInAs(page, 'owner')
    const name = `Probe Filter ${stamp()}`
    const category = (
      await (
        await page.request.post(apiUrl('/api/categories'), { data: { name, kind: 'recipe' } })
      ).json()
    ).id as string
    try {
      await page.goto('/recipes')
      await settled(page)
      await page.getByRole('button', { name: 'Filters' }).click()
      await expect(page.getByLabel('Category').locator('option', { hasText: name })).toHaveCount(1)
    } finally {
      await page.request.delete(apiUrl(`/api/categories/${category}`))
    }
  })

  test('a dish taken off sale is not offered when a sale is recorded', async ({ page }) => {
    await signInAs(page, 'owner')
    const name = `Probe Off Sale ${stamp()}`
    const id = (
      await (
        await page.request.post(apiUrl('/api/menu-items'), {
          data: { name, price: 5, isActive: false },
        })
      ).json()
    ).id as string
    try {
      await workAtFirstLocation(page)
      await page.goto('/sales')
      await settled(page)
      await page.getByRole('button', { name: '+ Record New Sale' }).click()
      await expect(
        dialog(page).getByLabel('Menu Item').locator('option', { hasText: name })
      ).toHaveCount(0)
    } finally {
      await page.request.delete(apiUrl(`/api/menu-items/${id}`))
    }
  })

  test('an inactive vendor is not offered for a new ingredient', async ({ page }) => {
    await signInAs(page, 'owner')
    const name = `Probe Dormant Vendor ${stamp()}`
    const id = (
      await (
        await page.request.post(apiUrl('/api/vendors'), { data: { name, status: 'inactive' } })
      ).json()
    ).id as string
    try {
      await page.goto('/ingredients')
      await settled(page)
      await page.getByRole('button', { name: 'Add Ingredient' }).click()
      await expect(
        dialog(page).getByLabel('Vendor').locator('option', { hasText: name })
      ).toHaveCount(0)
    } finally {
      await page.request.delete(apiUrl(`/api/vendors/${id}`))
    }
  })

  test('the profile says which locations a person works at', async ({ page }) => {
    await signIn(page, ACCOUNTS.manager)
    await page.goto('/profile')
    await settled(page)
    await expect(page.getByText(/Locations you work at/).locator('..')).toContainText('Downtown')
  })

  test('a new recipe starts on the organization target instead of a fixed one', async ({
    page,
  }) => {
    await signInAs(page, 'owner')
    await page.goto('/recipes/new')
    await settled(page)
    await expect(page.getByLabel('Target food-cost %')).toHaveValue('')
  })

  test('a recipe that is out of reach says it may belong to another location', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/recipes/does-not-exist')
    await expect(page.getByText(/another location/)).toBeVisible()
  })

  test('the component showcase is for the platform administrator only', async ({ page }) => {
    await signInAs(page, 'owner')
    await page.goto('/design')
    await expect(page.getByRole('heading', { name: 'Stepper + Upload' })).toHaveCount(0)
  })
})
