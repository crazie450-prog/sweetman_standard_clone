import type { RecipePayload } from './extraction'
import {
  nestSubRecipes,
  withUnitCodes,
  menuNameFrom,
  namedMenu,
  readExtracted,
  readPayload,
  storedPayload,
} from './payload.schema'

const line = { rawName: 'Butter', quantity: 1, unit: 'kg', unitPrice: 2 }

describe('a reviewed payload is refused in the words the rest of the API uses', () => {
  const refusal = (input: unknown) => {
    try {
      readPayload(input)
      return ''
    } catch (e) {
      return (e as Error).message
    }
  }

  it('names the line and the field for a quantity that is not a number', () => {
    expect(refusal({ kind: 'invoice', items: [{ ...line, quantity: 'abc' }] })).toBe(
      'items[0].quantity must be a number',
    )
  })

  it('states the ceiling the column imposes', () => {
    expect(refusal({ kind: 'invoice', items: [{ ...line, quantity: 1e12 }] })).toBe(
      'items[0].quantity must not be greater than 999999999.999',
    )
  })

  it('says a missing collection is required', () => {
    expect(refusal({ kind: 'invoice' })).toBe('items is required')
  })

  it('refuses a date that is not a date', () => {
    expect(refusal({ kind: 'invoice', invoiceDate: 'yesterday-ish', items: [line] })).toBe(
      'invoiceDate is not a date',
    )
  })

  it('refuses a day the calendar does not have, and a reading leaves it for the person to state', () => {
    expect(refusal({ kind: 'invoice', invoiceDate: '2026-02-30', items: [line] })).toBe(
      'invoiceDate is not a date',
    )
    expect(
      refusal({
        kind: 'sales',
        date: '2026-04-31',
        items: [{ menuItemName: 'Soup', quantity: 1, unitPrice: 5 }],
      }),
    ).toBe('date is not a date')
    expect(
      readExtracted({ kind: 'invoice', invoiceDate: '2026-02-30', items: [line] }),
    ).not.toHaveProperty('invoiceDate')
  })

  it('refuses a date that has not come yet, on an invoice and on a sales report', () => {
    expect(refusal({ kind: 'invoice', invoiceDate: '2099-01-01', items: [line] })).toBe(
      'invoiceDate cannot be in the future',
    )
    expect(
      refusal({
        kind: 'sales',
        date: '2099-01-01',
        items: [{ menuItemName: 'Soup', quantity: 1, unitPrice: 5 }],
      }),
    ).toBe('date cannot be in the future')
    expect(refusal({ kind: 'invoice', invoiceDate: '2026-01-15', items: [line] })).toBe('')
  })

  it('leaves a date a model read as the future for the person to state', () => {
    expect(
      readExtracted({ kind: 'invoice', invoiceDate: '2099-01-01', items: [line] }),
    ).not.toHaveProperty('invoiceDate')
  })

  it('reads a date written day first instead of dropping it', () => {
    const read = (invoiceDate: string) =>
      (readExtracted({ kind: 'invoice', invoiceDate, items: [line] }) as { invoiceDate?: string })
        .invoiceDate
    expect(read('27/09/2026')).toBe('2026-09-27')
    expect(read('27.09.2026')).toBe('2026-09-27')
    expect(read('27-09-2026')).toBe('2026-09-27')
    expect(read('03.04.2026')).toBe('2026-04-03')
    expect(read('03/04/2026')).toBe('2026-03-04')
    expect(read('2026/09/27')).toBe('2026-09-27')
    expect(read('31/02/2026')).toBeUndefined()
  })

  it('accepts what the parser and the model produce, including an empty unit', () => {
    expect(readPayload({ kind: 'invoice', items: [{ ...line, unit: '' }] })).toMatchObject({
      kind: 'invoice',
    })
    expect(readPayload({ kind: 'recipe', name: 'Sauce' })).toMatchObject({ items: [] })
  })
})

describe('a menu document', () => {
  it('reads the whole menu: its name and every dish on it', () => {
    expect(
      readPayload(
        {
          kind: 'menu',
          name: ' Dinner ',
          items: [
            { name: 'Steak Frites', price: 34, section: 'Mains' },
            { name: 'Lemon Tart', price: 9 },
          ],
        },
        'menu',
      ),
    ).toEqual({
      kind: 'menu',
      name: 'Dinner',
      items: [
        { name: 'Steak Frites', price: 34, section: 'Mains' },
        { name: 'Lemon Tart', price: 9 },
      ],
    })
  })

  it('still reads a single dish written in the earlier shape, as a menu of one', () => {
    expect(
      readPayload({ kind: 'menu', name: 'Steak Frites', price: 34, section: 'Mains' }, 'menu'),
    ).toEqual({
      kind: 'menu',
      name: '',
      items: [{ name: 'Steak Frites', price: 34, section: 'Mains' }],
    })
    expect(storedPayload({ kind: 'menu', name: 'Soup', price: 6 })).toEqual({
      kind: 'menu',
      name: '',
      items: [{ name: 'Soup', price: 6 }],
    })
  })

  it('names a menu that prints no name after its file', () => {
    const unnamed = readPayload({ kind: 'menu', items: [{ name: 'Soup', price: 6 }] }, 'menu')
    expect(unnamed).toMatchObject({ name: '' })
    if (unnamed.kind !== 'menu') throw new Error('not a menu')
    expect(namedMenu(unnamed, 'menu 2.jpg')).toMatchObject({ name: 'menu 2' })
    expect(namedMenu({ ...unnamed, name: 'Lunch' }, 'menu 2.jpg')).toMatchObject({ name: 'Lunch' })
    expect(menuNameFrom('.pdf')).toBe('Imported menu')
  })

  it('refuses a dish price the column cannot hold, naming the dish', () => {
    expect(() =>
      readPayload({ kind: 'menu', name: 'M', items: [{ name: 'Gold', price: 1e12 }] }, 'menu'),
    ).toThrow(/^items\[0\]\.price must not be greater than/)
  })
})

describe('what a model answers', () => {
  const recipe = {
    kind: 'recipe',
    name: 'Pancake batter',
    items: [{ rawName: 'Flour', quantity: 2, unit: 'cup' }],
  }

  it('cuts a text longer than its field holds and leaves out a line that names nothing', () => {
    const read = readExtracted(
      {
        ...recipe,
        name: 'Long '.repeat(40),
        yieldQty: 2,
        yieldUnit: 'a batch of about two litres',
        items: [
          { rawName: '  ', quantity: 1, unit: 'g' },
          { rawName: 'Flour', quantity: 2, unit: 'cups, sifted twice before measuring' },
        ],
        subRecipes: [{ name: 'Glaze', items: [{ rawName: '', quantity: 1, unit: 'g' }] }],
      },
      'recipe',
    ) as RecipePayload
    expect(read.name.length).toBeLessThanOrEqual(120)
    expect(read).not.toHaveProperty('yieldUnit')
    expect(read).not.toHaveProperty('yieldQty')
    expect(read.items).toEqual([{ rawName: 'Flour', quantity: 2, unit: 'cups, sifted twice b' }])
    expect(read.subRecipes?.[0].items).toEqual([])

    const invoice = readExtracted(
      {
        kind: 'invoice',
        vendorName: 'V'.repeat(200),
        items: [
          { rawName: '', quantity: 1, unit: 'kg', unitPrice: 1 },
          { rawName: 'Butter', quantity: 1, unit: 'kg', unitPrice: 1 },
        ],
      },
      'invoice',
    ) as { vendorName: string; items: unknown[] }
    expect(invoice.vendorName).toHaveLength(160)
    expect(invoice.items).toHaveLength(1)
  })

  it('keeps a quantity as the paper writes it beside the figure taken from it', () => {
    const read = readExtracted(
      {
        ...recipe,
        items: [
          { rawName: 'Garlic', quantity: 2, unit: 'cloves', quantityText: ' 2 or 4 ' },
          { rawName: 'Shallots', quantity: 2, unit: 'ea', quantityText: 'x'.repeat(60) },
        ],
      },
      'recipe',
    ) as RecipePayload
    expect(read.items.map((line) => line.quantityText)).toEqual(['2 or 4', 'x'.repeat(40)])
  })

  it('keeps a line the paper gives no amount, with its phrase as the unit and no quantity', () => {
    const read = readExtracted(
      {
        ...recipe,
        items: [
          { rawName: 'Burrata', quantity: null, note: 'to taste' },
          { rawName: 'Papaya' },
          {
            rawName: 'Bay Leaves',
            quantity: null,
            unit: '',
            note: 'a long note the paper writes beside it',
          },
          { rawName: 'Flour', quantity: 2, unit: 'cup', note: 'sifted' },
        ],
      },
      'recipe',
    ) as RecipePayload
    expect(read.items).toEqual([
      { rawName: 'Burrata', quantity: 0, unit: 'to taste' },
      { rawName: 'Papaya', quantity: 0, unit: '' },
      { rawName: 'Bay Leaves', quantity: 0, unit: '' },
      { rawName: 'Flour', quantity: 2, unit: 'cup' },
    ])
  })

  it('reads a line written to taste or chilled at no quantity, keeping the phrase as its unit', () => {
    const read = readExtracted(
      {
        ...recipe,
        items: [
          { rawName: 'Salt', quantity: 1, unit: 'to taste' },
          { rawName: 'Cucumber', quantity: 1, unit: 'chilled' },
          { rawName: 'Eggs', quantity: 2, unit: 'large' },
        ],
      },
      'recipe',
    ) as RecipePayload
    expect(read.items.map(({ quantity, unit }) => [quantity, unit])).toEqual([
      [0, 'to taste'],
      [0, 'chilled'],
      [2, 'large'],
    ])
  })

  it('leaves a portion count that cannot be a count unstated rather than failing the whole file', () => {
    expect(readExtracted({ ...recipe, portions: 0 }, 'recipe')).not.toHaveProperty('portions')
    expect(readExtracted({ ...recipe, portions: -3, yieldQty: -1 }, 'recipe')).not.toHaveProperty(
      'yieldQty',
    )
    expect(readExtracted({ ...recipe, portions: 2.6 }, 'recipe')).toMatchObject({ portions: 3 })
    expect(readExtracted({ ...recipe, portions: 12 }, 'recipe')).toMatchObject({ portions: 12 })
  })

  it('nets a refund into the sale of the same dish at the same price, and keeps a line nothing is left of out', () => {
    const read = readExtracted(
      {
        kind: 'sales',
        items: [
          { menuItemName: 'Caesar Salad', quantity: 5, unitPrice: 12 },
          { menuItemName: 'caesar salad ', quantity: -1, unitPrice: 12 },
          { menuItemName: 'Soup', quantity: 2, unitPrice: 6 },
          { menuItemName: 'Soup', quantity: -2, unitPrice: 6 },
          { menuItemName: 'Caesar Salad', quantity: 1, unitPrice: 10 },
        ],
      },
      'sales',
    ) as { items: { menuItemName: string; quantity: number; unitPrice: number }[] }
    expect(read.items).toEqual([
      { menuItemName: 'Caesar Salad', quantity: 4, unitPrice: 12 },
      { menuItemName: 'Caesar Salad', quantity: 1, unitPrice: 10 },
    ])
  })

  it('reads a date written with an ordinal and leaves one it cannot read unstated', () => {
    const invoice = { kind: 'invoice', items: [line] }
    expect(readExtracted({ ...invoice, invoiceDate: 'Jul 13th, 2021' }, 'invoice')).toMatchObject({
      invoiceDate: '2021-07-13',
    })
    expect(
      readExtracted({ ...invoice, invoiceDate: 'sometime in May' }, 'invoice'),
    ).not.toHaveProperty('invoiceDate')
    expect(
      readExtracted({ kind: 'sales', date: 'August 1st 2009', items: [] }, 'sales'),
    ).toMatchObject({
      date: '2009-08-01',
    })
  })

  it('still refuses what a person would have to correct, and a reviewer is held to the same fields', () => {
    expect(() =>
      readExtracted(
        { ...recipe, items: [{ rawName: 'Flour', quantity: 'two', unit: 'cup' }] },
        'recipe',
      ),
    ).toThrow('items[0].quantity must be a number')
    expect(() => readPayload({ ...recipe, portions: 0 }, 'recipe')).toThrow(
      'portions must not be less than 1',
    )
  })
})

describe('a document names what it creates within what the form accepts', () => {
  const long = 'N'.repeat(121)
  const refused = (input: unknown) => {
    try {
      readPayload(input)
      return false
    } catch {
      return true
    }
  }

  it('refuses a recipe, a dish or a menu name the form would refuse', () => {
    expect(refused({ kind: 'recipe', name: long, items: [] })).toBe(true)
    expect(refused({ kind: 'menu', name: 'Dinner', items: [{ name: long, price: 1 }] })).toBe(true)
    expect(refused({ kind: 'menu', name: long, items: [{ name: 'Soup', price: 1 }] })).toBe(true)
    expect(refused({ kind: 'recipe', name: 'N'.repeat(120), items: [] })).toBe(false)
  })

  it('cuts a menu named after its file to what the form accepts', () => {
    expect(menuNameFrom(`${'M'.repeat(150)}.pdf`)).toHaveLength(120)
  })
})

describe('units a document writes', () => {
  it('are kept as the catalogue writes them when they are units, and as written when they are not', () => {
    const read = withUnitCodes({
      kind: 'recipe',
      name: 'Vinaigrette',
      yieldUnit: 'Cups',
      items: [
        { rawName: 'Soy Sauce', quantity: 0.33, unit: 'cups' },
        { rawName: 'Kanpachi', quantity: 1, unit: 'pound' },
        { rawName: 'Cashew oil', quantity: 1, unit: 'to fry' },
        { rawName: 'Salt', quantity: 1, unit: '' },
      ],
    } as never)
    expect(read).toMatchObject({
      yieldUnit: 'cup',
      items: [{ unit: 'cup' }, { unit: 'lb' }, { unit: 'to fry' }, { unit: '' }],
    })
  })
})

describe('a recipe that uses another recipe of the same file', () => {
  const recipe = (name: string, items: [string, number, string][], extra = {}) => ({
    kind: 'recipe' as const,
    name,
    items: items.map(([rawName, quantity, unit]) => ({ rawName, quantity, unit })),
    ...extra,
  })
  const names = (payloads: { name: string; subRecipes?: { name: string }[] }[]) =>
    payloads.map((p) => [p.name, (p.subRecipes ?? []).map((s) => s.name)])

  it('carries it inside the recipe that names it rather than as a recipe of its own', () => {
    const nested = nestSubRecipes([
      recipe('Kanpachi Tartare', [
        ['Kanpachi', 120, 'g'],
        ['SOY-LIME VINAIGRETTE', 2, 'tbsp'],
      ]),
      recipe('Soy-Lime Vinaigrette', [['Soy Sauce', 100, 'ml']], { yieldQty: 1, yieldUnit: 'cup' }),
    ])
    expect(names(nested)).toEqual([['Kanpachi Tartare', ['Soy-Lime Vinaigrette']]])
    expect(nested[0].subRecipes?.[0]).toEqual({
      name: 'Soy-Lime Vinaigrette',
      yieldQty: 1,
      yieldUnit: 'cup',
      items: [{ rawName: 'Soy Sauce', quantity: 100, unit: 'ml' }],
    })
    expect(nested[0].items).toHaveLength(2)
  })

  it('carries a component of a component inside the dish at the top', () => {
    const nested = nestSubRecipes([
      recipe('Chili Oil', [['Chili', 10, 'g']]),
      recipe('Dish', [['Dressing', 1, 'portion']]),
      recipe('Dressing', [['Chili Oil', 5, 'ml']]),
    ])
    expect(names(nested)).toEqual([['Dish', ['Chili Oil', 'Dressing']]])
  })

  it('keeps a component two dishes share as a recipe of its own', () => {
    const nested = nestSubRecipes([
      recipe('One', [['Stock', 1, 'l']]),
      recipe('Two', [['Stock', 2, 'l']]),
      recipe('Stock', [['Bones', 1, 'kg']]),
    ])
    expect(names(nested)).toEqual([
      ['One', []],
      ['Two', []],
      ['Stock', []],
    ])
  })

  it('leaves recipes that use each other as they are', () => {
    const nested = nestSubRecipes([
      recipe('A', [['B', 1, 'portion']]),
      recipe('B', [['A', 1, 'portion']]),
    ])
    expect(names(nested)).toEqual([
      ['A', []],
      ['B', []],
    ])
  })

  it('gives a component the dish never names a line of one portion, so the link is there to correct', () => {
    const [dish] = nestSubRecipes([
      recipe('Dish', [['Rice', 100, 'g']], {
        subRecipes: [{ name: 'Glaze', items: [{ rawName: 'Sugar', quantity: 5, unit: 'g' }] }],
      }),
    ])
    expect(dish.items).toEqual([
      { rawName: 'Rice', quantity: 100, unit: 'g' },
      { rawName: 'Glaze', quantity: 1, unit: 'portion' },
    ])
  })
})
