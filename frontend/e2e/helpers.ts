import { expect, type Page } from '@playwright/test'

export const ACCOUNTS = {
  owner: { email: 'owner@goldenfork.com', password: 'Nexus_dev1' },
  manager: { email: 'maria@goldenfork.com', password: 'Nexus_dev1' },
  staff: { email: 'ken@goldenfork.com', password: 'Nexus_dev1' },
  otherTenant: { email: 'owner@bellacucina.com', password: 'Nexus_dev1' },
}

export async function fillCredentials(page: Page, email: string, password: string) {
  const emailField = page.getByLabel('Email')
  const passwordField = page.getByLabel('Password')
  await expect(async () => {
    await emailField.fill(email)
    await passwordField.fill(password)
    await expect(emailField).toHaveValue(email)
    await expect(passwordField).toHaveValue(password)
  }).toPass({ timeout: 15000 })
}

export async function signIn(page: Page, account: { email: string; password: string }) {
  await page.goto('/login')
  await fillCredentials(page, account.email, account.password)
  await expect(async () => {
    if (!/\/dashboard$/.test(page.url())) {
      await page.getByRole('button', { name: 'Sign In' }).click()
    }
    await page.waitForURL('**/dashboard', { timeout: 15000 })
  }).toPass({ timeout: 45000 })
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Logout' }).click()
  await page.waitForURL('**/login')
}

export function dataRows(page: Page) {
  return page.locator('tbody tr').filter({ hasNot: page.locator('td[colspan]') })
}

export async function settled(page: Page) {
  await expect(page.getByText(/^loading/i)).toHaveCount(0, { timeout: 15000 })
}

export async function recordCount(page: Page): Promise<number> {
  await settled(page)
  const rows = await dataRows(page).count()
  if (rows > 0) return rows
  return page.getByRole('main').getByRole('link').count()
}

export async function expectNoErrorState(page: Page) {
  await expect(page.getByText(/something went wrong|failed to load/i)).toHaveCount(0)
}

export type RoleName = keyof typeof ACCOUNTS

export async function signInAs(page: Page, role: RoleName) {
  await signIn(page, ACCOUNTS[role])
}

export async function expectToast(page: Page, text: RegExp | string) {
  await expect(page.locator('[role="status"]').filter({ hasText: text }).first()).toBeVisible({
    timeout: 10000,
  })
}

export async function written(page: Page, act: () => Promise<unknown>) {
  const response = page.waitForResponse(
    (r) =>
      r.url().includes('/api/') &&
      r.request().method() !== 'GET' &&
      !new URL(r.url()).pathname.endsWith('/check')
  )
  await act()
  await response
}

export function dialog(page: Page) {
  return page.locator('dialog[open]')
}

export async function switchLocation(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Location' }).selectOption({ label: name })
  await settled(page)
}

export async function locationOptions(page: Page): Promise<string[]> {
  const options = await page
    .getByRole('combobox', { name: 'Location' })
    .locator('option')
    .allTextContents()
  return options.map((o) => o.trim())
}

export function apiUrl(path: string): string {
  return `${process.env.E2E_API_URL ?? 'http://localhost:8000'}${path}`
}

export async function workAtFirstLocation(page: Page): Promise<string> {
  const all = await apiGet<{ id: string; name: string }[]>(page, '/api/properties')
  const first =
    all.find((l) => l.name.includes('Downtown')) ??
    all.find((l) => !l.name.startsWith('Audit ')) ??
    all[0]
  expect(first, 'the account reaches no location').toBeDefined()
  await page.evaluate((id) => window.localStorage.setItem('nexus.locationId', id), first.id)
  if (page.url().startsWith('http')) await page.reload()
  return first.id
}

export async function apiGet<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(apiUrl(path))
  expect(res.ok(), `GET ${path} → ${res.status()}`).toBeTruthy()
  return (await res.json()) as T
}

export async function apiRows<T>(page: Page, path: string): Promise<T[]> {
  const glue = path.includes('?') ? '&' : '?'
  return (await apiGet<{ data: T[] }>(page, `${path}${glue}limit=200`)).data
}

export async function onHandOf(page: Page, ingredient: string): Promise<number> {
  const rows = await apiGet<{ name: string; onHand: number }[]>(page, '/api/ingredients')
  const found = rows.find((i) => i.name === ingredient)
  expect(found, `ingredient ${ingredient} not found`).toBeDefined()
  return found!.onHand
}

export async function onHandAt(
  page: Page,
  ingredient: string,
  locationId: string
): Promise<number> {
  const res = await page.request.get(apiUrl('/api/ingredients'), {
    headers: { 'X-Location-Id': locationId },
  })
  expect(res.ok(), `GET /api/ingredients → ${res.status()}`).toBeTruthy()
  const rows = (await res.json()) as { name: string; onHand: number }[]
  const found = rows.find((i) => i.name === ingredient)
  expect(found, `ingredient ${ingredient} not found`).toBeDefined()
  return found!.onHand
}

export async function recipeCost(page: Page, name: string): Promise<number> {
  const rows = await apiGet<{ name: string; cost: number }[]>(page, '/api/recipes')
  const found = rows.find((r) => r.name === name)
  expect(found, `recipe ${name} not found`).toBeDefined()
  return found!.cost
}
