import { readMeasure } from './measures'

describe('a recipe line is measured the way a kitchen writes it', () => {
  it.each([
    'to taste',
    'For Frying',
    'to fry',
    'to garnish',
    'as needed',
    'optional',
    'T.Taste',
    'drizzle',
  ])('%s keeps the line with no quantity and says why', (unit) => {
    expect(readMeasure({ rawName: 'Sea salt', quantity: 1, unit })).toEqual({
      line: { rawName: 'Sea salt', quantity: 0, unit: '' },
      note: unit.toLowerCase(),
      unmeasured: true,
    })
  })

  it.each(['large', 'whole', 'Medium', 'small', 'halves', 'each(small)'])(
    '2 %s is counted in each',
    (unit) => {
      expect(readMeasure({ rawName: 'Eggs', quantity: 2, unit })).toEqual({
        line: { rawName: 'Eggs', quantity: 2, unit: 'ea' },
        note: unit.toLowerCase(),
        unmeasured: false,
      })
    },
  )

  it.each(['chilled', 'Softened', 'melted', 'room temperature'])(
    '%s in place of a unit is a note, not a measure',
    (unit) => {
      expect(readMeasure({ rawName: 'Cucumber', quantity: 1, unit })).toEqual({
        line: { rawName: 'Cucumber', quantity: 0, unit: '' },
        note: unit.toLowerCase(),
        unmeasured: true,
      })
    },
  )

  it('a size with no quantity keeps the line with no quantity', () => {
    expect(readMeasure({ rawName: 'Onion', quantity: 0, unit: 'large' })).toEqual({
      line: { rawName: 'Onion', quantity: 0, unit: '' },
      note: 'large',
      unmeasured: true,
    })
  })

  it.each([
    [4, 'oz scoop', 4, 'oz', 'scoop'],
    [1, 'cup packed', 1, 'cup', 'packed'],
    [1, 'pinch of', 1, 'pinch', null],
    [2, '(6 oz.)', 12, 'oz', '(6 oz.)'],
    [3, '(2 lb)', 6, 'lb', '(2 lb)'],
  ])('%s %s is read as %s %s', (quantity, unit, read, as, note) => {
    expect(readMeasure({ rawName: 'Sorbet', quantity, unit })).toEqual({
      line: { rawName: 'Sorbet', quantity: read, unit: as },
      note,
      unmeasured: false,
    })
  })

  it.each(['eggs', 'bones', 'leaves', 'thick cut'])('3 %s is counted in each', (unit) => {
    expect(readMeasure({ rawName: 'Brioche', quantity: 3, unit })).toEqual({
      line: { rawName: 'Brioche', quantity: 3, unit: 'ea' },
      note: unit,
      unmeasured: false,
    })
  })

  it('a phrase that is no measure at all stays as written, to be corrected', () => {
    for (const unit of ['Plush + 2 slices', 'heab', 'g0 cbn'])
      expect(readMeasure({ rawName: 'Cress', quantity: 1, unit }).line.unit).toBe(unit)
  })

  it('a unit of measure and any other phrase are left as written', () => {
    for (const unit of ['g', 'cup', '', 'cloves', '#14 can'])
      expect(readMeasure({ rawName: 'Garlic', quantity: 2, unit })).toEqual({
        line: { rawName: 'Garlic', quantity: 2, unit },
        note: null,
        unmeasured: false,
      })
  })
})
