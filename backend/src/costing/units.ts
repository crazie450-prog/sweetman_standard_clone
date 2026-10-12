const ITEM_UNITS = {
  bunch: 'Bunch',
  clove: 'Clove',
  sprig: 'Sprig',
  head: 'Head',
  slice: 'Slice',
  sheet: 'Sheet',
  can: 'Can',
  jar: 'Jar',
  bottle: 'Bottle',
  bag: 'Bag',
  pack: 'Pack',
  case: 'Case',
} as const

type ItemUnit = keyof typeof ITEM_UNITS

export type Dimension = 'mass' | 'volume' | 'count' | ItemUnit

interface BaseUnit {
  dimension: Dimension
  perBase: number
  label: string
}

const UNITS: Record<string, BaseUnit> = {
  mg: { dimension: 'mass', perBase: 0.001, label: 'Milligram' },
  g: { dimension: 'mass', perBase: 1, label: 'Gram' },
  kg: { dimension: 'mass', perBase: 1000, label: 'Kilogram' },
  oz: { dimension: 'mass', perBase: 28.349523125, label: 'Ounce' },
  lb: { dimension: 'mass', perBase: 453.59237, label: 'Pound' },

  ml: { dimension: 'volume', perBase: 1, label: 'Millilitre' },
  cl: { dimension: 'volume', perBase: 10, label: 'Centilitre' },
  l: { dimension: 'volume', perBase: 1000, label: 'Litre' },
  tsp: { dimension: 'volume', perBase: 4.92892159375, label: 'Teaspoon' },
  tbsp: { dimension: 'volume', perBase: 14.78676478125, label: 'Tablespoon' },
  floz: { dimension: 'volume', perBase: 29.5735295625, label: 'Fluid ounce' },
  cup: { dimension: 'volume', perBase: 236.5882365, label: 'Cup' },
  pt: { dimension: 'volume', perBase: 473.176473, label: 'Pint' },
  qt: { dimension: 'volume', perBase: 946.352946, label: 'Quart' },
  gal: { dimension: 'volume', perBase: 3785.411784, label: 'Gallon' },

  pinch: { dimension: 'volume', perBase: 0.30805759960937, label: 'Pinch' },
  dash: { dimension: 'volume', perBase: 0.61611519921875, label: 'Dash' },

  ea: { dimension: 'count', perBase: 1, label: 'Each' },
  dozen: { dimension: 'count', perBase: 12, label: 'Dozen' },

  ...Object.fromEntries(
    Object.entries(ITEM_UNITS).map(([unit, label]) => [
      unit,
      { dimension: unit as ItemUnit, perBase: 1, label },
    ]),
  ),
}

const ALIASES: Record<string, string> = {
  milligram: 'mg',
  gram: 'g',
  gramme: 'g',
  kilogram: 'kg',
  kilo: 'kg',
  ounce: 'oz',
  pound: 'lb',
  lbs: 'lb',

  milliliter: 'ml',
  millilitre: 'ml',
  centiliter: 'cl',
  centilitre: 'cl',
  liter: 'l',
  litre: 'l',
  lt: 'l',
  teaspoon: 'tsp',
  tablespoon: 'tbsp',
  tb: 'tbsp',
  tbs: 'tbsp',
  tbl: 'tbsp',
  c: 'cup',
  'fl oz': 'floz',
  'fluid ounce': 'floz',
  pint: 'pt',
  quart: 'qt',
  gallon: 'gal',

  each: 'ea',
  unit: 'ea',
  piece: 'ea',
  pc: 'ea',
  pcs: 'ea',
  count: 'ea',
  doz: 'dozen',

  bch: 'bunch',
  package: 'pack',
  packet: 'pack',
  pkg: 'pack',
  tin: 'can',
}

const CASED: Record<string, string> = { T: 'tbsp', t: 'tsp' }

export function normalizeUnit(unit: string): string {
  const cased = CASED[unit.trim().replace(/\.$/, '')]
  if (cased) return cased
  const trimmed = unit.trim().toLowerCase().replace(/\.$/, '')
  if (UNITS[trimmed]) return trimmed
  if (ALIASES[trimmed]) return ALIASES[trimmed]
  const singular = trimmed.replace(/s$/, '')
  if (UNITS[singular]) return singular
  if (ALIASES[singular]) return ALIASES[singular]
  return trimmed.replace(/(ch|sh|x|ss|z)es$/, '$1').replace(/([^s])s$/, '$1')
}

export function dimensionOf(unit: string): Dimension | null {
  return UNITS[normalizeUnit(unit)]?.dimension ?? null
}

export interface UnitDescriptor {
  value: string
  label: string
  dimension: Dimension
  perBase: number
}

export function unitCatalogue(): UnitDescriptor[] {
  return Object.entries(UNITS).map(([value, u]) => ({
    value,
    label: u.label,
    dimension: u.dimension,
    perBase: u.perBase,
  }))
}

export interface IngredientConversion {
  fromUnit: string
  toUnit: string
  factor: number
}

export function convertQuantity(
  quantity: number,
  from: string,
  to: string,
  overrides: IngredientConversion[] = [],
): number | null {
  const a = normalizeUnit(from)
  const b = normalizeUnit(to)
  if (a === b) return quantity

  for (const rule of overrides) {
    const ruleFrom = normalizeUnit(rule.fromUnit)
    const ruleTo = normalizeUnit(rule.toUnit)
    if (!Number.isFinite(rule.factor) || rule.factor <= 0) continue
    if (ruleFrom === a && ruleTo === b) return quantity * rule.factor
    if (ruleFrom === b && ruleTo === a) return quantity / rule.factor
  }

  const left = UNITS[a]
  const right = UNITS[b]
  if (!left || !right || left.dimension !== right.dimension) return null
  return (quantity * left.perBase) / right.perBase
}

export function bridgedConversion(
  quantity: number,
  from: string,
  to: string,
  overrides: IngredientConversion[] = [],
): number | null {
  const direct = convertQuantity(quantity, from, to, overrides)
  if (direct !== null) return direct

  const a = normalizeUnit(from)
  const b = normalizeUnit(to)
  for (const rule of overrides) {
    for (const [step, next] of [
      [normalizeUnit(rule.fromUnit), normalizeUnit(rule.toUnit)],
      [normalizeUnit(rule.toUnit), normalizeUnit(rule.fromUnit)],
    ]) {
      const toStep = convertQuantity(quantity, a, step, overrides)
      if (toStep === null) continue
      const crossed = convertQuantity(toStep, step, next, overrides)
      if (crossed === null) continue
      const finished = convertQuantity(crossed, next, b, overrides)
      if (finished !== null) return finished
    }
  }
  return null
}

export function isConvertible(
  from: string,
  to: string,
  overrides: IngredientConversion[] = [],
): boolean {
  return bridgedConversion(1, from, to, overrides) !== null
}
