import { BadRequestException } from '@nestjs/common'
import { z } from 'zod'
import { isCalendarDay } from '../../common/utils/calendar'
import { MONEY_MAX, PORTIONS_MAX, QUANTITY_MAX, RATE_MAX } from '../../common/validation/numeric'
import { CATEGORY_NAME_MAX, RECORD_NAME_MAX } from '../../common/validation/trimmed'
import type { DocumentType, ExtractionPayload, RecipePayload, SubRecipe } from './extraction'
import { dimensionOf, normalizeUnit } from '../../costing/units'
import { readMeasure } from './measures'

/* ===== What a reviewed or extracted payload may state ===== */

const LINE_NAME_MAX = 200
const UNIT_MAX = 20
const QUANTITY_TEXT_MAX = 40
const YIELD_UNIT_MAX = 20
const CODE_MAX = 60
const VENDOR_NAME_MAX = 160
const DISH_NAME_MAX = 160

const name = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) => z.string().trim().max(max).optional()
const latestDay = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const isDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? isCalendarDay(value) : !Number.isNaN(Date.parse(value))
const notYet = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value > latestDay()
    : Date.parse(value) > Date.now() + 86400000

const calendarDate = z
  .string()
  .trim()
  .max(40)
  .refine(isDay, 'is not a date')
  .refine((value) => !isDay(value) || !notYet(value), 'cannot be in the future')
  .optional()
const quantity = z.number().min(-QUANTITY_MAX).max(QUANTITY_MAX)
const signedRate = z.number().min(-RATE_MAX).max(RATE_MAX)
const money = z.number().min(-MONEY_MAX).max(MONEY_MAX)

const invoiceLine = z.object({
  rawName: name(LINE_NAME_MAX),
  sku: optionalText(CODE_MAX),
  quantity,
  unit: z.string().trim().max(UNIT_MAX),
  unitPrice: signedRate,
  lineTotal: money.optional(),
})

const invoice = z.object({
  kind: z.literal('invoice'),
  vendorName: optionalText(VENDOR_NAME_MAX),
  number: optionalText(CODE_MAX),
  invoiceDate: calendarDate,
  items: z.array(invoiceLine),
})

const sales = z.object({
  kind: z.literal('sales'),
  date: calendarDate,
  items: z.array(
    z.object({
      menuItemName: name(DISH_NAME_MAX),
      quantity: z.number().min(-2_147_483_647).max(2_147_483_647),
      unitPrice: signedRate,
    }),
  ),
})

const recipeFields = {
  name: z.string().trim().max(RECORD_NAME_MAX),
  portions: z.number().int().min(1).max(PORTIONS_MAX).optional(),
  yieldQty: z.number().min(0).max(QUANTITY_MAX).optional(),
  yieldUnit: optionalText(YIELD_UNIT_MAX),
  items: z
    .array(
      z.object({
        rawName: name(LINE_NAME_MAX),
        quantity: z.number().min(0).max(QUANTITY_MAX),
        unit: z.string().trim().max(UNIT_MAX),
        quantityText: optionalText(QUANTITY_TEXT_MAX),
      }),
    )
    .default([]),
}

export const SUB_RECIPES_MAX = 50

const recipe = z.object({
  kind: z.literal('recipe'),
  ...recipeFields,
  subRecipes: z.array(z.object(recipeFields)).max(SUB_RECIPES_MAX).optional(),
})

const menu = z.object({
  kind: z.literal('menu'),
  name: z.string().trim().max(RECORD_NAME_MAX).default(''),
  items: z.array(
    z.object({
      name: z.string().trim().max(RECORD_NAME_MAX),
      price: z.number().min(0).max(MONEY_MAX),
      section: optionalText(CATEGORY_NAME_MAX),
    }),
  ),
})

const payloadSchema = z.discriminatedUnion('kind', [invoice, sales, recipe, menu])

export class PayloadError extends Error {
  constructor(
    message: string,
    readonly path: PropertyKey[] = [],
  ) {
    super(message)
  }
}

const EDITOR_FIELD: Record<string, string> = { yieldAmount: 'yield', yieldUnit: 'yield' }

function placeOf(path: PropertyKey[], type: DocumentType) {
  const rest = [...path]
  let part: number | null | undefined = type === 'recipe' ? null : undefined
  if (rest[0] === 'subRecipes' && typeof rest[1] === 'number') {
    part = rest[1]
    rest.splice(0, 2)
  }
  let line: number | undefined
  if (rest[0] === 'items' && typeof rest[1] === 'number') {
    line = rest[1]
    rest.splice(0, 2)
  }
  const named = typeof rest[0] === 'string' ? rest[0] : undefined
  const field = named ? (EDITOR_FIELD[named] ?? named) : undefined
  return {
    ...(part !== undefined && { part }),
    ...(line !== undefined && { line }),
    ...(field && { field }),
  }
}

function where(path: PropertyKey[]) {
  return path
    .map((part, i) =>
      typeof part === 'number' ? `[${part}]` : i === 0 ? String(part) : `.${String(part)}`,
    )
    .join('')
}

function complaint(issue: z.core.$ZodIssue) {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined ? 'is required' : `must be a ${issue.expected}`
    case 'too_big':
      return issue.origin === 'string'
        ? `must be at most ${issue.maximum} characters`
        : `must not be greater than ${issue.maximum}`
    case 'too_small':
      if (issue.origin === 'string')
        return issue.minimum === 1 ? 'is required' : `must be at least ${issue.minimum} characters`
      return `must not be less than ${issue.minimum}`
    case 'invalid_value':
      return `must be one of ${issue.values.join(', ')}`
    default:
      return issue.message
  }
}

function describe(issue: z.core.$ZodIssue) {
  const at = where(issue.path)
  return at ? `${at} ${complaint(issue)}` : complaint(issue)
}

export function upgradePayload<T>(input: T): T {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const value = input as Record<string, unknown>
  if (value.kind !== 'menu' || 'items' in value) return input
  const { name, price, section } = value
  const dish = section === undefined ? { name, price } : { name, price, section }
  return { kind: 'menu', name: '', items: [dish] } as T
}

export function storedPayload(value: unknown): ExtractionPayload | null {
  return value ? (upgradePayload(value) as ExtractionPayload) : null
}

export function menuNameFrom(fileName: string): string {
  return (
    fileName
      .replace(/\.[^.]+$/, '')
      .trim()
      .slice(0, RECORD_NAME_MAX) || 'Imported menu'
  )
}

export function namedMenu(payload: ExtractionPayload, fileName: string): ExtractionPayload {
  if (payload.kind !== 'menu' || payload.name.trim()) return payload
  return { ...payload, name: menuNameFrom(fileName) }
}

const coded = (unit: string) => (dimensionOf(unit) === null ? unit : normalizeUnit(unit))

const recipeCoded = <T extends SubRecipe>(recipe: T): T => ({
  ...recipe,
  ...(recipe.yieldUnit ? { yieldUnit: coded(recipe.yieldUnit) } : {}),
  items: recipe.items.map((line) => ({ ...line, unit: coded(line.unit) })),
})

export function withUnitCodes(payload: ExtractionPayload): ExtractionPayload {
  if (payload.kind === 'recipe') {
    const own = recipeCoded(payload)
    return payload.subRecipes ? { ...own, subRecipes: payload.subRecipes.map(recipeCoded) } : own
  }
  if (payload.kind === 'invoice') {
    return { ...payload, items: payload.items.map((line) => ({ ...line, unit: coded(line.unit) })) }
  }
  return payload
}

/* ===== Sub-recipes ===== */

const recipeKey = (text: string) => text.trim().toLowerCase()

const linesOf = (recipe: RecipePayload) => [
  ...recipe.items,
  ...(recipe.subRecipes ?? []).flatMap((sub) => sub.items),
]

const asSub = ({ name, portions, yieldQty, yieldUnit, items }: SubRecipe): SubRecipe => ({
  name,
  ...(portions === undefined ? {} : { portions }),
  ...(yieldQty === undefined ? {} : { yieldQty }),
  ...(yieldUnit === undefined ? {} : { yieldUnit }),
  items,
})

function withComponentLines(recipe: RecipePayload): RecipePayload {
  const subs = recipe.subRecipes ?? []
  if (subs.length === 0) return recipe
  const named = new Set(linesOf(recipe).map((line) => recipeKey(line.rawName)))
  const unnamed = subs.filter((sub) => !named.has(recipeKey(sub.name)))
  if (unnamed.length === 0) return recipe
  return {
    ...recipe,
    items: [
      ...recipe.items,
      ...unnamed.map((sub) => ({ rawName: sub.name, quantity: 1, unit: 'portion' })),
    ],
  }
}

export function nestSubRecipes(recipes: RecipePayload[]): RecipePayload[] {
  const at = new Map<string, number>()
  recipes.forEach((recipe, i) => {
    const k = recipeKey(recipe.name)
    if (k && !at.has(k)) at.set(k, i)
  })
  const users = recipes.map(() => new Set<number>())
  recipes.forEach((recipe, i) => {
    for (const line of linesOf(recipe)) {
      const used = at.get(recipeKey(line.rawName))
      if (used !== undefined && used !== i) users[used].add(i)
    }
  })
  const parentOf = (i: number) => (users[i].size === 1 ? [...users[i]][0] : null)
  const rootOf = (i: number) => {
    const seen = new Set([i])
    let top = i
    for (let up = parentOf(top); up !== null; up = parentOf(top)) {
      if (seen.has(up)) return null
      seen.add(up)
      top = up
    }
    return top
  }
  const roots = recipes.map((_, i) => rootOf(i) ?? i)
  const nested = recipes.map((recipe, i) => {
    if (roots[i] !== i) return null
    const inside = recipes.filter((_, j) => j !== i && roots[j] === i)
    if (inside.length === 0) return withComponentLines(recipe)
    const subs = [...(recipe.subRecipes ?? [])]
    const taken = new Set([recipeKey(recipe.name), ...subs.map((sub) => recipeKey(sub.name))])
    for (const sub of inside.flatMap((r) => [r, ...(r.subRecipes ?? [])])) {
      if (taken.has(recipeKey(sub.name))) continue
      taken.add(recipeKey(sub.name))
      subs.push(asSub(sub))
    }
    return withComponentLines({ ...recipe, subRecipes: subs })
  })
  return nested.filter((recipe): recipe is RecipePayload => recipe !== null)
}

const ORDINAL = /(\d)(st|nd|rd|th)\b/gi
const NUMERIC_DAY = /^(\d{1,4})([./-])(\d{1,2})\2(\d{2,4})$/

export type DayOrder = 'dmy' | 'mdy'

export function dayOrderOf(value: string): DayOrder | null {
  const m = NUMERIC_DAY.exec(value.trim())
  if (!m || m[1].length === 4) return null
  if (m[2] === '.' || Number(m[1]) > 12) return 'dmy'
  if (Number(m[3]) > 12) return 'mdy'
  return null
}

export function numericDay(value: string, order: DayOrder = 'mdy'): string | undefined {
  const m = NUMERIC_DAY.exec(value.trim())
  if (!m) return undefined
  const pad = (n: number) => String(n).padStart(2, '0')
  const [y, mo, d] =
    m[1].length === 4
      ? [Number(m[1]), Number(m[3]), Number(m[4])]
      : (dayOrderOf(value) ?? order) === 'dmy'
        ? [Number(m[4]), Number(m[3]), Number(m[1])]
        : [Number(m[4]), Number(m[1]), Number(m[3])]
  const year = y < 100 ? 2000 + y : y
  const day = `${year}-${pad(mo)}-${pad(d)}`
  const check = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === day
    ? day
    : undefined
}

function statedDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return value as undefined
  if (NUMERIC_DAY.test(value.trim())) return numericDay(value)
  const time = Date.parse(value.replace(ORDINAL, '$1'))
  if (Number.isNaN(time)) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim()))
    return isCalendarDay(value.trim()) ? value.trim() : undefined
  const d = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function netted(items: unknown[]): unknown[] {
  const lines = new Map<string, { menuItemName: string; quantity: number; unitPrice: number }>()
  const kept: unknown[] = []
  for (const item of items) {
    const line = item as { menuItemName?: unknown; quantity?: unknown; unitPrice?: unknown }
    if (
      typeof line?.menuItemName !== 'string' ||
      typeof line.quantity !== 'number' ||
      typeof line.unitPrice !== 'number'
    ) {
      kept.push(item)
      continue
    }
    const key = `${line.menuItemName.trim().toLowerCase()}|${line.unitPrice}`
    const known = lines.get(key)
    if (known) known.quantity += line.quantity
    else {
      const first = {
        menuItemName: line.menuItemName.trim(),
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      }
      lines.set(key, first)
      kept.push(first)
    }
  }
  return kept.filter((item) => (item as { quantity?: unknown }).quantity !== 0)
}

type Loose = Record<string, unknown>

const isLoose = (value: unknown): value is Loose =>
  !!value && typeof value === 'object' && !Array.isArray(value)

function fitted(value: Loose, limits: Record<string, number>): Loose {
  const out = { ...value }
  for (const [key, max] of Object.entries(limits)) {
    const text = out[key]
    if (typeof text === 'string' && text.trim().length > max)
      out[key] = text.trim().slice(0, max).trim()
  }
  return out
}

function namedLines(items: unknown, key: string, limits: Record<string, number>): unknown {
  if (!Array.isArray(items)) return items
  return items
    .filter((line) => !(isLoose(line) && typeof line[key] === 'string' && line[key].trim() === ''))
    .map((line) => (isLoose(line) ? fitted(line, limits) : line))
}

function unstatedAmount(line: unknown): unknown {
  if (!isLoose(line)) return line
  const { note, ...rest } = line
  if (rest.quantity !== null && rest.quantity !== undefined)
    return { ...rest, unit: rest.unit ?? '' }
  const phrase = typeof note === 'string' ? note.trim() : ''
  const unit = typeof rest.unit === 'string' && rest.unit.trim() ? rest.unit : phrase
  return { ...rest, quantity: 0, unit: unit.length <= UNIT_MAX ? unit : '' }
}

function unmeasuredAtZero(line: unknown): unknown {
  if (!isLoose(line) || typeof line.unit !== 'string' || typeof line.quantity !== 'number')
    return line
  const read = readMeasure({ rawName: '', quantity: line.quantity, unit: line.unit })
  return read.unmeasured ? { ...line, quantity: 0 } : line
}

function recipeRead(input: Loose): Loose {
  const value = fitted(input, { name: RECORD_NAME_MAX })
  if (typeof value.portions === 'number') {
    const portions = Math.round(value.portions)
    if (portions >= 1) value.portions = portions
    else delete value.portions
  }
  if (typeof value.yieldQty === 'number' && !(value.yieldQty >= 0)) delete value.yieldQty
  if (typeof value.yieldUnit === 'string' && value.yieldUnit.trim().length > YIELD_UNIT_MAX) {
    delete value.yieldUnit
    delete value.yieldQty
  }
  value.items = namedLines(value.items, 'rawName', {
    rawName: LINE_NAME_MAX,
    unit: UNIT_MAX,
    quantityText: QUANTITY_TEXT_MAX,
  })
  if (Array.isArray(value.items))
    value.items = value.items.map(unstatedAmount).map(unmeasuredAtZero)
  return value
}

function withoutUnreadable(input: unknown): unknown {
  if (!isLoose(input)) return input
  let value: Loose = { ...input }
  const drop = (key: string) => delete value[key]
  if (value.kind === 'recipe') {
    value = recipeRead(value)
    if (Array.isArray(value.subRecipes)) {
      value.subRecipes = value.subRecipes.map((sub) => (isLoose(sub) ? recipeRead(sub) : sub))
    }
  }
  if (value.kind === 'invoice') {
    value = fitted(value, { vendorName: VENDOR_NAME_MAX, number: CODE_MAX })
    value.items = namedLines(value.items, 'rawName', {
      rawName: LINE_NAME_MAX,
      unit: UNIT_MAX,
      sku: CODE_MAX,
    })
  }
  if (value.kind === 'menu') {
    value = fitted(value, { name: RECORD_NAME_MAX })
    if (Array.isArray(value.items)) {
      value.items = value.items.map((item) =>
        isLoose(item) ? fitted(item, { name: RECORD_NAME_MAX, section: CATEGORY_NAME_MAX }) : item,
      )
    }
  }
  if (value.kind === 'sales') {
    value.items = namedLines(value.items, 'menuItemName', { menuItemName: DISH_NAME_MAX })
    if (Array.isArray(value.items)) value.items = netted(value.items)
  }
  for (const key of ['invoiceDate', 'date']) {
    if (!(key in value)) continue
    const date = statedDate(value[key])
    if (date === undefined || notYet(date)) drop(key)
    else value[key] = date
  }
  return value
}

export function readExtracted(input: unknown, type?: DocumentType): ExtractionPayload {
  return readPayload(withoutUnreadable(input), type)
}

export function readPayload(input: unknown, type?: DocumentType): ExtractionPayload {
  const result = payloadSchema.safeParse(upgradePayload(input), { reportInput: true })
  if (!result.success)
    throw new PayloadError(describe(result.error.issues[0]), result.error.issues[0].path)
  if (type && result.data.kind !== type) {
    throw new PayloadError(`kind is ${result.data.kind}, the document is ${type}`)
  }
  return result.data
}

export function reviewedPayload(input: unknown, type: DocumentType): ExtractionPayload {
  try {
    return readPayload(input, type)
  } catch (e) {
    if (e instanceof PayloadError)
      throw new BadRequestException({
        code: 'PAYLOAD_INVALID',
        message: e.message,
        ...placeOf(e.path, type),
      })
    throw e
  }
}
