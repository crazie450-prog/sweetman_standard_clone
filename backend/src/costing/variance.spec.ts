import { foodCostVariance, theoreticalUsage, type VarianceInput } from './variance'

const base: VarianceInput = {
  ingredients: [
    { id: 'flour', costPerUnit: 2, category: 'Dry' },
    { id: 'cream', costPerUnit: 5, category: 'Dairy' },
  ],
  recipes: [
    {
      id: 'r1',
      portions: 2,
      yieldAmount: null,
      yieldUnit: null,
      ingredients: [{ ingredientId: 'flour', quantity: 4 }],
      components: [],
    },
    {
      id: 'r2',
      portions: 1,
      yieldAmount: null,
      yieldUnit: null,
      ingredients: [{ ingredientId: 'cream', quantity: 1 }],
      components: [{ componentId: 'r1', quantity: 1, unit: 'portion' }],
    },
  ],
  menuItems: [{ id: 'm1', name: 'Cream Pie', recipes: [{ recipeId: 'r2', portions: 1 }] }],
  sales: [{ menuItemId: 'm1', quantity: 3 }],
  actual: [
    { ingredientId: 'flour', cost: 10 },
    { ingredientId: 'cream', cost: 20 },
  ],
}

describe('foodCostVariance', () => {
  it('expands nested recipes into theoretical usage and costs it', () => {
    const r = foodCostVariance(base)
    expect(r.theoreticalCost).toBe(27)
    expect(r.actualCost).toBe(30)
    expect(r.variance).toBe(3)
    expect(r.variancePct).toBe(11.1)
  })

  it('breaks variance down by category, largest gap first', () => {
    const r = foodCostVariance(base)
    expect(r.byCategory[0]).toEqual({ category: 'Dairy', theoretical: 15, actual: 20, variance: 5 })
    expect(r.byCategory).toContainEqual({
      category: 'Dry',
      theoretical: 12,
      actual: 10,
      variance: -2,
    })
  })

  it('costs each dish that was sold, standard against actual, with its share of waste', () => {
    const r = foodCostVariance({
      ...base,
      menuItems: [
        { id: 'm1', name: 'Cream Pie', recipes: [{ recipeId: 'r2', portions: 1 }] },
        { id: 'm2', name: 'Flatbread', recipes: [{ recipeId: 'r1', portions: 1 }] },
      ],
      sales: [
        { menuItemId: 'm1', quantity: 3 },
        { menuItemId: 'm2', quantity: 1 },
      ],
      actual: [
        { ingredientId: 'flour', cost: 10, waste: true },
        { ingredientId: 'cream', cost: 20 },
      ],
    })

    expect(r.wasteCost).toBe(10)
    const pie = r.byDish.find((d) => d.menuItemId === 'm1')
    const flatbread = r.byDish.find((d) => d.menuItemId === 'm2')

    expect(pie).toEqual({
      menuItemId: 'm1',
      name: 'Cream Pie',
      quantity: 3,
      standardCost: 27,
      actualCost: 27.5,
      wasteCost: 7.5,
      variance: 0.5,
    })
    expect(flatbread).toEqual({
      menuItemId: 'm2',
      name: 'Flatbread',
      quantity: 1,
      standardCost: 4,
      actualCost: 2.5,
      wasteCost: 2.5,
      variance: -1.5,
    })
    expect(r.byDish[0].menuItemId).toBe('m2')
  })

  it('names a dish nothing was sold of nowhere in the dish breakdown', () => {
    const r = foodCostVariance({
      ...base,
      menuItems: [
        { id: 'm1', name: 'Cream Pie', recipes: [{ recipeId: 'r2', portions: 1 }] },
        { id: 'm2', name: 'Never Ordered', recipes: [{ recipeId: 'r1', portions: 1 }] },
      ],
    })
    expect(r.byDish.map((d) => d.menuItemId)).toEqual(['m1'])
  })

  it('reads a recipe line in the unit its ingredient is stocked and priced in', () => {
    const r = foodCostVariance({
      ...base,
      ingredients: [{ id: 'butter', costPerUnit: 10, category: 'Dairy', unit: 'kg' }],
      recipes: [
        {
          id: 'r3',
          portions: 1,
          yieldAmount: null,
          yieldUnit: null,
          ingredients: [{ ingredientId: 'butter', quantity: 200, unit: 'g' }],
          components: [],
        },
      ],
      menuItems: [{ id: 'm3', name: 'Toast', recipes: [{ recipeId: 'r3', portions: 1 }] }],
      sales: [{ menuItemId: 'm3', quantity: 1 }],
      actual: [],
    })
    expect(r.theoreticalCost).toBe(2)
  })

  it('returns a null percentage when nothing was sold', () => {
    const r = foodCostVariance({ ...base, sales: [] })
    expect(r.theoreticalCost).toBe(0)
    expect(r.variancePct).toBeNull()
  })

  it('does not loop forever on a circular recipe graph', () => {
    const cyclic: VarianceInput = {
      ...base,
      recipes: [
        {
          id: 'a',
          portions: 1,
          yieldAmount: null,
          yieldUnit: null,
          ingredients: [{ ingredientId: 'flour', quantity: 1 }],
          components: [{ componentId: 'b', quantity: 1, unit: 'portion' }],
        },
        {
          id: 'b',
          portions: 1,
          yieldAmount: null,
          yieldUnit: null,
          ingredients: [{ ingredientId: 'cream', quantity: 1 }],
          components: [{ componentId: 'a', quantity: 1, unit: 'portion' }],
        },
      ],
      menuItems: [{ id: 'm1', name: 'Loop', recipes: [{ recipeId: 'a', portions: 1 }] }],
      sales: [{ menuItemId: 'm1', quantity: 1 }],
    }
    expect(() => foodCostVariance(cyclic)).not.toThrow()
  })
})

describe('theoreticalUsage', () => {
  const recipe = (
    id: string,
    ingredients: { ingredientId: string; quantity: number; unit?: string }[],
    components: { componentId: string; quantity: number; unit: string }[] = [],
  ) => ({
    id,
    portions: 1,
    yieldAmount: null,
    yieldUnit: null,
    ingredients,
    components,
  })

  it('crosses dimensions through a recorded rule for the ingredient it names', () => {
    const { total } = theoreticalUsage({
      recipes: [recipe('omelette', [{ ingredientId: 'eggs', quantity: 3, unit: 'ea' }])],
      menuItems: [{ id: 'm', name: 'Omelette', recipes: [{ recipeId: 'omelette', portions: 1 }] }],
      sales: [{ menuItemId: 'm', quantity: 10 }],
      units: new Map([['eggs', 'kg']]),
      conversions: (id) => (id === 'eggs' ? [{ fromUnit: 'ea', toUnit: 'g', factor: 50 }] : []),
    })
    expect(total.get('eggs')).toBeCloseTo(1.5, 6)
  })

  it('adds nothing for a component the graph does not carry, and still counts the rest', () => {
    const { total, soldPerDish } = theoreticalUsage({
      recipes: [
        recipe(
          'plate',
          [{ ingredientId: 'beef', quantity: 250, unit: 'g' }],
          [{ componentId: 'elsewhere', quantity: 1, unit: 'portion' }],
        ),
      ],
      menuItems: [{ id: 'm', name: 'Plate', recipes: [{ recipeId: 'plate', portions: 1 }] }],
      sales: [{ menuItemId: 'm', quantity: 4 }],
      units: new Map([['beef', 'kg']]),
    })
    expect(total.get('beef')).toBe(1)
    expect([...total.keys()]).toEqual(['beef'])
    expect(soldPerDish.get('m')).toBe(4)
  })

  it('takes a component stated in grams out of a batch whose yield is stated in kilograms', () => {
    const { total } = theoreticalUsage({
      recipes: [
        {
          ...recipe('stock', [{ ingredientId: 'bones', quantity: 2, unit: 'kg' }]),
          portions: 10,
          yieldAmount: 4,
          yieldUnit: 'kg',
        },
        recipe('soup', [], [{ componentId: 'stock', quantity: 300, unit: 'g' }]),
      ],
      menuItems: [{ id: 'm', name: 'Soup', recipes: [{ recipeId: 'soup', portions: 1 }] }],
      sales: [{ menuItemId: 'm', quantity: 1 }],
      units: new Map([['bones', 'kg']]),
    })
    expect(total.get('bones')).toBeCloseTo(0.15, 6)
  })

  it('ignores a sale of a dish it does not know', () => {
    const { total } = theoreticalUsage({
      recipes: [recipe('plate', [{ ingredientId: 'beef', quantity: 1 }])],
      menuItems: [],
      sales: [{ menuItemId: 'gone', quantity: 5 }],
    })
    expect(total.size).toBe(0)
  })
})
