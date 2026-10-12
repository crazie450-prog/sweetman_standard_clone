const PREPARED = new Set([
  'minced',
  'chopped',
  'diced',
  'sliced',
  'julienned',
  'julienne',
  'brunoise',
  'grated',
  'shredded',
  'crushed',
  'peeled',
  'cubed',
  'zested',
  'pureed',
  'puréed',
  'melted',
  'softened',
  'halved',
  'quartered',
  'trimmed',
  'seeded',
  'deveined',
  'torn',
  'rinsed',
  'drained',
  'beaten',
  'sifted',
])
const MANNER = new Set([
  'finely',
  'thinly',
  'roughly',
  'coarsely',
  'freshly',
  'lightly',
  'small',
  'medium',
  'large',
  'fine',
  'thick',
  'thin',
])
const AFTER_A_COMMA = new Set([
  'whole',
  'fresh',
  'cloves',
  'clove',
  'leaves',
  'picked',
  'stemmed',
  'toasted',
  'roasted',
  'blanched',
  'cooked',
  'shaved',
  'chiffonade',
  'washed',
  'cleaned',
  'chilled',
  'confit',
  'juiced',
  'split',
])

function prepPhrase(words: string[], afterComma = false): string | null {
  const lower = words.map((w) => w.toLowerCase())
  let prepared = false
  for (let i = 0; i < lower.length; i++) {
    const word = lower[i]
    if (PREPARED.has(word) || (afterComma && AFTER_A_COMMA.has(word))) prepared = true
    else if (word === 'ground' && lower[i - 1] === 'freshly') prepared = true
    else if (MANNER.has(word)) continue
    else if (word === 'and' && i > 0 && i < lower.length - 1) continue
    else return null
  }
  return prepared ? lower.join(' ') : null
}

export function splitPrep(rawName: string): { name: string; prep: string | null } {
  const whole = rawName.trim()

  const trailing = /^(.+?)\s*(?:,\s*([^,()]+)|\(\s*([^()]+?)\s*\))$/.exec(whole)
  if (trailing) {
    const prep = prepPhrase((trailing[2] ?? trailing[3]).trim().split(/[\s/]+/), true)
    if (prep) {
      const before = splitPrep(trailing[1])
      return before.prep && before.name !== trailing[1].trim()
        ? { name: before.name, prep: `${before.prep} ${prep}` }
        : { name: trailing[1].trim(), prep }
    }
  }

  const words = whole.split(/\s+/)
  for (let cut = words.length - 1; cut > 0; cut--) {
    const prep = prepPhrase(words.slice(0, cut))
    if (prep) return { name: words.slice(cut).join(' '), prep }
  }
  for (let cut = 1; cut < words.length; cut++) {
    const prep = prepPhrase(words.slice(cut))
    if (prep) return { name: words.slice(0, cut).join(' '), prep }
  }
  return { name: whole, prep: null }
}
