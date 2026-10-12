import { recommendPurchases, type ConsumptionInput } from './consumption'

const base: ConsumptionInput = {
  days: 28,
  horizon: 7,
  recipes: [
    {
      id: 'steak',
      portions: 1,
      yieldAmount: null,
      yieldUnit: null,
      ingredients: [{ ingredientId: 'beef', quantity: 250, unit: 'g' }],
      components: [],
    },
  ],
  menuItems: [{ id: 'm-steak', name: 'Steak', recipes: [{ recipeId: 'steak', portions: 1 }] }],
  sales: [{ menuItemId: 'm-steak', quantity: 280 }],
  ingredients: [{ id: 'beef', unit: 'kg', onHand: 10, reorderLevel: 5, reorderQty: 0 }],
  movements: [],
}

describe('recommendPurchases', () => {
  it('reads sales through the recipe in the unit the stock is kept in', () => {
    const [beef] = recommendPurchases(base)
    expect(beef.salesQty).toBe(70)
    expect(beef.dailyRate).toBe(2.5)
    expect(beef.basis).toBe('sales')
    expect(beef.coverDays).toBe(4)
    expect(beef.suggested).toBe(13)
  })

  it('takes the higher of sales-implied and recorded use, never their sum', () => {
    const [beef] = recommendPurchases({
      ...base,
      movements: [{ ingredientId: 'beef', quantity: -84, waste: false }],
    })
    expect(beef.useQty).toBe(84)
    expect(beef.dailyRate).toBe(3)
    expect(beef.basis).toBe('usage')
  })

  it('adds waste on top of whichever consumption it took', () => {
    const [beef] = recommendPurchases({
      ...base,
      movements: [{ ingredientId: 'beef', quantity: -14, waste: true }],
    })
    expect(beef.wasteQty).toBe(14)
    expect(beef.dailyRate).toBe(3)
  })

  it('rounds the suggestion up to a whole stock unit', () => {
    const [beef] = recommendPurchases({
      ...base,
      sales: [{ menuItemId: 'm-steak', quantity: 281 }],
    })
    expect(beef.dailyRate).toBeCloseTo(2.509, 3)
    expect(beef.suggested).toBe(13)
  })

  it('does not order an extra unit when the exact need is already whole', () => {
    const [flour] = recommendPurchases({
      ...base,
      days: 7,
      horizon: 14,
      sales: [],
      ingredients: [{ id: 'beef', unit: 'kg', onHand: 2.2, reorderLevel: 0, reorderQty: 0 }],
      movements: [{ ingredientId: 'beef', quantity: -3.6, waste: false }],
    })
    expect(flour.suggested).toBe(5)
  })

  it('names the basis it took, waste alone included', () => {
    const [wasteOnly] = recommendPurchases({
      ...base,
      sales: [],
      movements: [{ ingredientId: 'beef', quantity: -28, waste: true }],
      ingredients: [{ id: 'beef', unit: 'kg', onHand: 0, reorderLevel: 0, reorderQty: 0 }],
    })
    expect(wasteOnly.basis).toBe('waste')
    expect(wasteOnly.dailyRate).toBe(1)
    expect(wasteOnly.coverDays).toBe(0)
    expect(wasteOnly.suggested).toBe(7)
  })

  it('orders up to the reorder level for an ingredient nothing consumed', () => {
    const [idle] = recommendPurchases({
      ...base,
      sales: [],
      ingredients: [{ id: 'beef', unit: 'kg', onHand: 1, reorderLevel: 4, reorderQty: 0 }],
    })
    expect(idle.basis).toBe('none')
    expect(idle.dailyRate).toBe(0)
    expect(idle.coverDays).toBeNull()
    expect(idle.suggested).toBe(3)
  })

  it('reads a recorded movement by its size whatever sign it was stored with', () => {
    const [beef] = recommendPurchases({
      ...base,
      sales: [],
      movements: [
        { ingredientId: 'beef', quantity: -42, waste: false },
        { ingredientId: 'beef', quantity: 42, waste: false },
      ],
    })
    expect(beef.useQty).toBe(84)
  })

  it('reads the deliveries received when a kitchen records no sales and no use', () => {
    const [flour] = recommendPurchases({
      ...base,
      sales: [],
      ingredients: [{ id: 'flour', unit: 'kg', onHand: 2, reorderLevel: 0, reorderQty: 0 }],
      movements: [
        { ingredientId: 'flour', quantity: 20, waste: false, receipt: true },
        { ingredientId: 'flour', quantity: 8, waste: false, receipt: true },
        { ingredientId: 'flour', quantity: -3, waste: true },
      ],
    })
    expect(flour).toMatchObject({
      basis: 'receipts',
      receivedQty: 28,
      wasteQty: 3,
      dailyRate: 1,
      suggested: 5,
    })
  })

  it('never adds deliveries to what was consumed, because a delivery is what the consumption came from', () => {
    const [beef] = recommendPurchases({
      ...base,
      movements: [{ ingredientId: 'beef', quantity: 500, waste: false, receipt: true }],
    })
    expect(beef).toMatchObject({
      basis: 'sales',
      salesQty: 70,
      receivedQty: 500,
      dailyRate: 2.5,
      suggested: 13,
    })

    const [wasted] = recommendPurchases({
      ...base,
      sales: [],
      movements: [
        { ingredientId: 'beef', quantity: 14, waste: false, receipt: true },
        { ingredientId: 'beef', quantity: 28, waste: true },
      ],
    })
    expect(wasted).toMatchObject({ basis: 'waste', dailyRate: 1 })
  })

  it('never suggests less than the minimum order quantity', () => {
    const [beef] = recommendPurchases({
      ...base,
      ingredients: [{ id: 'beef', unit: 'kg', onHand: 10, reorderLevel: 5, reorderQty: 20 }],
    })
    expect(beef.suggested).toBe(20)
  })

  it('leaves out an ingredient that needs nothing', () => {
    expect(
      recommendPurchases({
        ...base,
        ingredients: [{ id: 'beef', unit: 'kg', onHand: 40, reorderLevel: 5, reorderQty: 20 }],
      }),
    ).toEqual([])
    expect(recommendPurchases({ ...base, sales: [] })).toEqual([])
  })

  it('orders by days of cover, the soonest to run out first', () => {
    const rows = recommendPurchases({
      ...base,
      ingredients: [
        { id: 'beef', unit: 'kg', onHand: 10, reorderLevel: 5, reorderQty: 0 },
        { id: 'salt', unit: 'kg', onHand: 0, reorderLevel: 1, reorderQty: 0 },
      ],
      movements: [{ ingredientId: 'salt', quantity: -0.5, waste: false }],
    })
    expect(rows.map((r) => r.ingredientId)).toEqual(['salt', 'beef'])
    expect(rows[0].coverDays).toBe(0)
  })
})
