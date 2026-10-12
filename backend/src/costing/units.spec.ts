import {
  bridgedConversion,
  convertQuantity,
  dimensionOf,
  isConvertible,
  normalizeUnit,
  unitCatalogue,
} from './units'
import { conversionsFor } from './costing.service'

describe('normalizeUnit', () => {
  test('spelling, case, plurals and trailing dots reach the same unit', () => {
    for (const written of ['kg', 'KG', ' kg ', 'kgs', 'kilogram', 'kilograms', 'Kilo']) {
      expect(normalizeUnit(written)).toBe('kg')
    }
    for (const written of ['l', 'L', 'liter', 'litres', 'lt']) {
      expect(normalizeUnit(written)).toBe('l')
    }
    for (const written of ['ea', 'each', 'piece', 'pcs', 'unit']) {
      expect(normalizeUnit(written)).toBe('ea')
    }
  })

  test('the shorthand recipes are written in reaches the spoon and the cup', () => {
    for (const written of ['T', 'Tb.', 'Tbs', 'Tbls.', 'TBSP', 'Tablespoons']) {
      expect(normalizeUnit(written)).toBe('tbsp')
    }
    for (const written of ['t', 'tsp.', 'teaspoons']) {
      expect(normalizeUnit(written)).toBe('tsp')
    }
    for (const written of ['c', 'C', 'cups', 'quarts']) {
      expect(dimensionOf(written)).toBe('volume')
    }
  })

  test('an unknown unit is lowercased and read in the singular', () => {
    expect(normalizeUnit('Crate')).toBe('crate')
    expect(dimensionOf('crate')).toBeNull()
    for (const [written, read] of [
      ['bunches', 'bunch'],
      ['Bags', 'bag'],
      ['boxes', 'box'],
      ['cases', 'case'],
      ['glasses', 'glass'],
      ['glass', 'glass'],
      ['slices', 'slice'],
    ]) {
      expect(normalizeUnit(written)).toBe(read)
    }
  })
})

describe('convertQuantity within one dimension', () => {
  test('grams to kilograms is the thousandth the invoice implies', () => {
    expect(convertQuantity(200, 'g', 'kg')).toBeCloseTo(0.2, 9)
    expect(convertQuantity(1.5, 'kg', 'g')).toBeCloseTo(1500, 9)
  })

  test('imperial mass lands on metric', () => {
    expect(convertQuantity(1, 'lb', 'g')).toBeCloseTo(453.59237, 5)
    expect(convertQuantity(16, 'oz', 'lb')).toBeCloseTo(1, 9)
  })

  test('volume converts through millilitres', () => {
    expect(convertQuantity(2, 'l', 'ml')).toBeCloseTo(2000, 9)
    expect(convertQuantity(4, 'cup', 'qt')).toBeCloseTo(1, 6)
    expect(convertQuantity(3, 'tsp', 'tbsp')).toBeCloseTo(1, 9)
  })

  test('the same unit passes through untouched', () => {
    expect(convertQuantity(7, 'kg', 'kilograms')).toBe(7)
  })
})

describe('convertQuantity across dimensions', () => {
  test('without a rule, mass and volume do not meet', () => {
    expect(convertQuantity(1, 'l', 'kg')).toBeNull()
    expect(convertQuantity(1, 'ea', 'kg')).toBeNull()
  })

  test('an ingredient rule carries the quantity across, both ways', () => {
    const eggs = [{ fromUnit: 'ea', toUnit: 'kg', factor: 0.05 }]
    expect(convertQuantity(4, 'ea', 'kg', eggs)).toBeCloseTo(0.2, 9)
    expect(convertQuantity(0.2, 'kg', 'ea', eggs)).toBeCloseTo(4, 9)
  })

  test('a rule is ignored when its factor is not a positive number', () => {
    const broken = [{ fromUnit: 'ea', toUnit: 'kg', factor: 0 }]
    expect(convertQuantity(4, 'ea', 'kg', broken)).toBeNull()
  })

  test('a rule stated in one pair of units still serves its neighbours', () => {
    const flour = [{ fromUnit: 'l', toUnit: 'kg', factor: 0.6 }]
    expect(bridgedConversion(500, 'ml', 'g', flour)).toBeCloseTo(300, 6)
    expect(bridgedConversion(300, 'g', 'ml', flour)).toBeCloseTo(500, 6)
  })

  test('a bridge that does not exist stays null rather than guessing', () => {
    expect(bridgedConversion(1, 'ea', 'kg', [])).toBeNull()
    expect(bridgedConversion(1, 'bunch', 'kg', [])).toBeNull()
  })
})

describe('units a kitchen counts and measures by', () => {
  test('a dozen is twelve, both ways', () => {
    expect(convertQuantity(2, 'dozen', 'ea')).toBe(24)
    expect(convertQuantity(30, 'each', 'doz')).toBeCloseTo(2.5, 9)
  })

  test('imperial units land on their exact metric values', () => {
    expect(convertQuantity(1, 'lb', 'g')).toBeCloseTo(453.59237, 9)
    expect(convertQuantity(16, 'oz', 'lb')).toBeCloseTo(1, 9)
    expect(convertQuantity(1, 'gal', 'l')).toBeCloseTo(3.785411784, 9)
    expect(convertQuantity(3, 'tsp', 'tbsp')).toBeCloseTo(1, 9)
  })

  test('a capital T is a tablespoon and a small t a teaspoon', () => {
    expect(convertQuantity(1, 'T', 'tsp')).toBeCloseTo(3, 9)
    expect(convertQuantity(3, 't', 'T')).toBeCloseTo(1, 9)
  })

  test('a quantity keeps its sign, so a credit stays a credit', () => {
    expect(convertQuantity(-2, 'kg', 'g')).toBe(-2000)
    expect(convertQuantity(0, 'kg', 'g')).toBe(0)
  })
})

describe('a rule bridges units on both of its sides', () => {
  const eggs = [{ fromUnit: 'ea', toUnit: 'kg', factor: 0.05 }]

  test('a dozen reaches grams through a rule stated per egg and per kilogram', () => {
    expect(bridgedConversion(1, 'dozen', 'g', eggs)).toBeCloseTo(600, 6)
    expect(bridgedConversion(600, 'g', 'dozen', eggs)).toBeCloseTo(1, 9)
  })

  test('a unit the catalogue does not know is reached once a rule names it', () => {
    const herbs = [{ fromUnit: 'bunch', toUnit: 'g', factor: 80 }]
    expect(isConvertible('bunch', 'kg')).toBe(false)
    expect(bridgedConversion(2, 'bunch', 'kg', herbs)).toBeCloseTo(0.16, 9)
    expect(bridgedConversion(0.16, 'kg', 'bunches', herbs)).toBeCloseTo(2, 9)
  })
})

describe('conversionsFor', () => {
  const factor = (n: number) => ({ toNumber: () => n }) as never

  test('a rule recorded for the ingredient wins over the organization-wide one', () => {
    const rulesFor = conversionsFor([
      { ingredientId: null, fromUnit: 'ea', toUnit: 'kg', factor: factor(0.05) },
      { ingredientId: 'duck-egg', fromUnit: 'ea', toUnit: 'kg', factor: factor(0.08) },
    ])
    expect(bridgedConversion(4, 'ea', 'kg', rulesFor('duck-egg'))).toBeCloseTo(0.32, 9)
    expect(bridgedConversion(4, 'ea', 'kg', rulesFor('hen-egg'))).toBeCloseTo(0.2, 9)
    expect(bridgedConversion(4, 'ea', 'kg', rulesFor())).toBeCloseTo(0.2, 9)
  })

  test('a rule of one ingredient never reaches another', () => {
    const rulesFor = conversionsFor([
      { ingredientId: 'duck-egg', fromUnit: 'ea', toUnit: 'kg', factor: factor(0.08) },
    ])
    expect(bridgedConversion(4, 'ea', 'kg', rulesFor('hen-egg'))).toBeNull()
  })

  test("a recipe's own rule is read first there, and nowhere else", () => {
    const rulesFor = conversionsFor([
      { ingredientId: null, fromUnit: 'ea', toUnit: 'kg', factor: factor(0.05) },
      { ingredientId: 'duck-egg', fromUnit: 'ea', toUnit: 'kg', factor: factor(0.08) },
      {
        ingredientId: null,
        recipeId: 'custard',
        fromUnit: 'ea',
        toUnit: 'kg',
        factor: factor(0.06),
      },
      {
        ingredientId: 'duck-egg',
        recipeId: 'custard',
        fromUnit: 'ea',
        toUnit: 'kg',
        factor: factor(0.07),
      },
    ])
    expect(bridgedConversion(1, 'ea', 'kg', rulesFor('duck-egg', 'custard'))).toBeCloseTo(0.07, 9)
    expect(bridgedConversion(1, 'ea', 'kg', rulesFor('hen-egg', 'custard'))).toBeCloseTo(0.06, 9)
    expect(bridgedConversion(1, 'ea', 'kg', rulesFor(undefined, 'custard'))).toBeCloseTo(0.06, 9)
    expect(bridgedConversion(1, 'ea', 'kg', rulesFor('duck-egg', 'omelette'))).toBeCloseTo(0.08, 9)
    expect(bridgedConversion(1, 'ea', 'kg', rulesFor())).toBeCloseTo(0.05, 9)
  })
})

describe('kitchen units', () => {
  test('a pinch and a dash are volumes, so they reach a teaspoon on their own', () => {
    expect(convertQuantity(16, 'pinch', 'tsp')).toBeCloseTo(1, 6)
    expect(convertQuantity(8, 'dashes', 'tsp')).toBeCloseTo(1, 6)
  })

  test('a bunch, a clove or a can is a unit of its own, reached from another only through a rule', () => {
    for (const written of ['bunches', 'cloves', 'sprigs', 'cans', 'cases', 'package', 'jars']) {
      expect(dimensionOf(written)).not.toBeNull()
    }
    expect(normalizeUnit('Bunches')).toBe('bunch')
    expect(normalizeUnit('package')).toBe('pack')
    expect(convertQuantity(1, 'bunch', 'ea')).toBeNull()
    expect(convertQuantity(1, 'bunch', 'clove')).toBeNull()
    expect(
      bridgedConversion(2, 'bunch', 'kg', [{ fromUnit: 'bunch', toUnit: 'g', factor: 50 }]),
    ).toBeCloseTo(0.1, 9)
  })
})

describe('unitCatalogue', () => {
  test('every unit the converter knows is offered, with its dimension', () => {
    const catalogue = unitCatalogue()
    for (const entry of catalogue) {
      expect(dimensionOf(entry.value)).toBe(entry.dimension)
      expect(entry.label).not.toHaveLength(0)
      expect(entry.perBase).toBeGreaterThan(0)
    }
    expect(catalogue.map((u) => u.value)).toEqual(
      expect.arrayContaining(['kg', 'g', 'l', 'ml', 'ea']),
    )
  })

  test('the units offered for a mass ingredient are the ones it can be costed in', () => {
    const mass = unitCatalogue().filter((u) => u.dimension === 'mass')
    for (const entry of mass) expect(isConvertible(entry.value, 'kg')).toBe(true)
    expect(mass.map((u) => u.value).sort()).toEqual(['g', 'kg', 'lb', 'mg', 'oz'])
  })
})

describe('isConvertible', () => {
  test('units of one dimension always reach each other', () => {
    expect(isConvertible('g', 'kg')).toBe(true)
    expect(isConvertible('ml', 'l')).toBe(true)
  })

  test('crossing dimensions needs a rule, and says so without one', () => {
    expect(isConvertible('ea', 'kg')).toBe(false)
    expect(isConvertible('ea', 'kg', [{ fromUnit: 'ea', toUnit: 'kg', factor: 0.05 }])).toBe(true)
  })

  test('a unit nobody knows is not convertible to anything', () => {
    expect(isConvertible('bunch', 'kg')).toBe(false)
  })
})
