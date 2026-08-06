import {
  componentContribution,
  computeAllCosts,
  depthAfterInsert,
  MAX_NESTING_DEPTH,
  RecipeCycleError,
  recipeFoodCostPct,
  wouldCreateCycle,
  type CostComponentEdge,
  type CostRecipe,
} from './costing.core'

const recipe = (id: string, over: Partial<CostRecipe> = {}): CostRecipe => ({
  id,
  portions: 1,
  yieldAmount: null,
  yieldUnit: null,
  ingredients: [],
  ...over,
})
const edge = (
  parentId: string,
  componentId: string,
  quantity = 1,
  unit = 'ea',
): CostComponentEdge => ({
  parentId,
  componentId,
  quantity,
  unit,
})

describe('componentContribution', () => {
  it('a matching yieldUnit means a fraction of the batch', () => {
    const cost = componentContribution(
      { totalCost: 100, portions: 10, yieldAmount: 2, yieldUnit: 'kg' },
      { quantity: 0.5, unit: 'kg' },
    )
    expect(cost).toBeCloseTo((100 * 0.5) / 2)
  })

  it('a non-matching unit is treated as portions', () => {
    const cost = componentContribution(
      { totalCost: 100, portions: 10, yieldAmount: 2, yieldUnit: 'kg' },
      { quantity: 4, unit: 'ea' },
    )
    expect(cost).toBeCloseTo((100 / 10) * 4)
  })

  it('without yieldAmount portions are the only path', () => {
    expect(
      componentContribution(
        { totalCost: 60, portions: 6, yieldAmount: null, yieldUnit: null },
        { quantity: 2, unit: 'kg' },
      ),
    ).toBeCloseTo(20)
  })

  it('portions=0 never divides by zero', () => {
    expect(
      componentContribution(
        { totalCost: 50, portions: 0, yieldAmount: null, yieldUnit: null },
        { quantity: 1, unit: 'ea' },
      ),
    ).toBe(50)
  })
})

describe('recipeFoodCostPct', () => {
  it('is the share of the menu price one portion consumes', () => {
    expect(recipeFoodCostPct({ totalCost: 40, portions: 4 }, [{ portions: 1, price: 40 }])).toBe(25)
  })

  it('counts how many portions the menu item puts on the plate', () => {
    expect(recipeFoodCostPct({ totalCost: 40, portions: 4 }, [{ portions: 2, price: 40 }])).toBe(50)
  })

  it('averages across every menu item the recipe appears on', () => {
    expect(
      recipeFoodCostPct({ totalCost: 40, portions: 4 }, [
        { portions: 1, price: 40 },
        { portions: 1, price: 20 },
      ]),
    ).toBe(37.5)
  })

  it('is unknown while the recipe is on no menu item', () => {
    expect(recipeFoodCostPct({ totalCost: 40, portions: 4 }, [])).toBeNull()
  })

  it('a menu item without a price says nothing about food cost', () => {
    expect(
      recipeFoodCostPct({ totalCost: 40, portions: 4 }, [{ portions: 1, price: 0 }]),
    ).toBeNull()
  })
})

describe('computeAllCosts', () => {
  it('sums the ingredient cost', () => {
    const costs = computeAllCosts(
      [
        recipe('a', {
          ingredients: [
            { quantity: 2, costPerUnit: 3.5 },
            { quantity: 1, costPerUnit: 1 },
          ],
        }),
      ],
      [],
    )
    expect(costs.get('a')).toBeCloseTo(8)
  })

  it('cascades bottom-up across two levels', () => {
    const recipes = [
      recipe('base', { ingredients: [{ quantity: 1, costPerUnit: 10 }] }),
      recipe('mid', { portions: 2 }),
      recipe('top'),
    ]
    const costs = computeAllCosts(recipes, [edge('mid', 'base', 1), edge('top', 'mid', 2)])
    expect(costs.get('base')).toBeCloseTo(10)
    expect(costs.get('mid')).toBeCloseTo(10)
    expect(costs.get('top')).toBeCloseTo((10 / 2) * 2)
  })

  it('diamond: a shared component is counted in every branch', () => {
    const recipes = [
      recipe('shared', { ingredients: [{ quantity: 1, costPerUnit: 8 }] }),
      recipe('left'),
      recipe('right'),
      recipe('top'),
    ]
    const costs = computeAllCosts(recipes, [
      edge('left', 'shared'),
      edge('right', 'shared'),
      edge('top', 'left'),
      edge('top', 'right'),
    ])
    expect(costs.get('top')).toBeCloseTo(16)
  })

  it('a cycle A→B→A throws RecipeCycleError', () => {
    expect(() =>
      computeAllCosts([recipe('a'), recipe('b')], [edge('a', 'b'), edge('b', 'a')]),
    ).toThrow(RecipeCycleError)
  })

  it('an edge to a missing recipe is ignored and does not hang the graph', () => {
    const costs = computeAllCosts(
      [recipe('a', { ingredients: [{ quantity: 1, costPerUnit: 5 }] })],
      [edge('a', 'ghost')],
    )
    expect(costs.get('a')).toBeCloseTo(5)
  })
})

describe('wouldCreateCycle', () => {
  const edges = [edge('b', 'c'), edge('a', 'b')]

  it('self-reference', () => {
    expect(wouldCreateCycle('a', 'a', edges)).toBe(true)
  })
  it('an indirect cycle c→a when a→b→c already exists', () => {
    expect(wouldCreateCycle('c', 'a', edges)).toBe(true)
  })
  it('a regular edge is allowed', () => {
    expect(wouldCreateCycle('a', 'd', edges)).toBe(false)
  })
})

describe('depthAfterInsert', () => {
  it('a five-level chain still passes, a sixth does not', () => {
    const chain: CostComponentEdge[] = []
    const ids = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5']
    for (let i = 0; i < 4; i++) chain.push(edge(ids[i]!, ids[i + 1]!))
    expect(depthAfterInsert('r4', 'r5', chain)).toBe(MAX_NESTING_DEPTH)
    chain.push(edge('r4', 'r5'))
    expect(depthAfterInsert('r5', 'r6', chain)).toBeGreaterThan(MAX_NESTING_DEPTH)
  })
})
