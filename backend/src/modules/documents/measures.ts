import { dimensionOf, normalizeUnit } from '../../costing/units'
import type { RecipeLine } from './extraction'

const UNMEASURED = new Set([
  'to taste',
  'as needed',
  'as required',
  'for frying',
  'to fry',
  'for deep frying',
  'to deep fry',
  'to garnish',
  'for garnish',
  'garnish',
  'optional',
  'for serving',
  'to serve',
  'for dusting',
  'to dust',
  'for greasing',
  'to grease',
  'to finish',
  't.taste',
  'sprinkle',
  'drizzle',
  'dust',
  'splash',
  'chilled',
  'cold',
  'warm',
  'hot',
  'softened',
  'melted',
  'frozen',
  'room temperature',
  'at room temperature',
])
const COUNTED = new Set([
  'whole',
  'large',
  'medium',
  'small',
  'extra large',
  'jumbo',
  'halves',
  'sticks',
  'stick',
  'wedge',
  'wedges',
  'each(small)',
  'each halved',
  'egg',
  'eggs',
  'bone',
  'bones',
  'leaf',
  'leaves',
  'thick cut',
  'thin cut',
])

const measured = (unit: string) => dimensionOf(normalizeUnit(unit)) !== null
const PACK = /^\(\s*(\d+(?:\.\d+)?)\s*([a-z]+)\.?\s*\)$/

export function readMeasure(line: RecipeLine): {
  line: RecipeLine
  note: string | null
  unmeasured: boolean
} {
  const phrase = line.unit.trim().toLowerCase().replace(/\s+/g, ' ')
  if (UNMEASURED.has(phrase) || (COUNTED.has(phrase) && !(line.quantity > 0)))
    return { line: { ...line, quantity: 0, unit: '' }, note: phrase, unmeasured: true }
  if (COUNTED.has(phrase) && line.quantity > 0)
    return { line: { ...line, unit: 'ea' }, note: phrase, unmeasured: false }
  const pack = PACK.exec(phrase)
  if (pack && measured(pack[2]) && line.quantity > 0)
    return {
      line: { ...line, quantity: line.quantity * Number(pack[1]), unit: pack[2] },
      note: phrase,
      unmeasured: false,
    }
  const [first, ...rest] = phrase.split(' ')
  if (rest.length > 0 && measured(first) && rest.every((word) => /^[a-z]+$/.test(word))) {
    const words = rest.filter((word) => word !== 'of')
    return {
      line: { ...line, unit: first },
      note: words.length > 0 ? words.join(' ') : null,
      unmeasured: false,
    }
  }
  return { line, note: null, unmeasured: false }
}
