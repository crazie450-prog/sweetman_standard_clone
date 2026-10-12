import { splitPrep } from './prep'

describe('a recipe line names the product apart from how it is prepared', () => {
  it.each([
    ['minced Lemongrass', 'Lemongrass', 'minced'],
    ['brunoise Shallots', 'Shallots', 'brunoise'],
    ['Finely Chopped Parsley', 'Parsley', 'finely chopped'],
    ['Shallots, thinly sliced', 'Shallots', 'thinly sliced'],
    ['Garlic (crushed)', 'Garlic', 'crushed'],
    ['peeled and diced Carrots', 'Carrots', 'peeled and diced'],
    ['Fresh Ginger minced', 'Fresh Ginger', 'minced'],
    ['Parsley finely chopped', 'Parsley', 'finely chopped'],
    ['medium diced Red Peppers', 'Red Peppers', 'medium diced'],
    ['small diced Fennel', 'Fennel', 'small diced'],
    ['Eggs, whole', 'Eggs', 'whole'],
    ['Garlic, cloves/fresh', 'Garlic', 'cloves fresh'],
    ['Pignoli Nuts, toasted', 'Pignoli Nuts', 'toasted'],
    ['Italian Parsley, Chiffonade', 'Italian Parsley', 'chiffonade'],
    ['Garlic, cloves, minced', 'Garlic', 'cloves minced'],
    ['Limes, halved/juiced', 'Limes', 'halved juiced'],
    ['Vanilla Beans, split', 'Vanilla Beans', 'split'],
  ])('%s reads as %s, %s', (raw, name, prep) => {
    expect(splitPrep(raw)).toEqual({ name, prep })
  })

  it.each([
    'Ground Black Pepper',
    'Roasted Red Peppers',
    'Lemongrass',
    'Chopped',
    'Smoked Paprika',
    'Whole Milk',
    'Fresh Mozzarella',
    'Olive Oil, Extra Virgin',
    'Cumin, Ground',
    'Large Eggs',
  ])('%s is a product name and stays whole', (raw) => {
    expect(splitPrep(raw)).toEqual({ name: raw, prep: null })
  })
})
