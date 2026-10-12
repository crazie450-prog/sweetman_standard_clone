import type { DocumentType, ExtractionPayload } from './extraction'

/* ===== Extraction accuracy scoring ===== */

export interface FieldScore {
  total: number
  correct: number
}

type Cmp = 'str' | 'num'

interface Spec {
  scalars: { key: string; cmp: Cmp }[]
  line?: { key: string; matchKey: string; fields: { key: string; cmp: Cmp }[] }
}

const SPECS: Record<DocumentType, Spec> = {
  invoice: {
    scalars: [
      { key: 'vendorName', cmp: 'str' },
      { key: 'number', cmp: 'str' },
      { key: 'invoiceDate', cmp: 'str' },
    ],
    line: {
      key: 'items',
      matchKey: 'rawName',
      fields: [
        { key: 'sku', cmp: 'str' },
        { key: 'quantity', cmp: 'num' },
        { key: 'unit', cmp: 'str' },
        { key: 'unitPrice', cmp: 'num' },
        { key: 'lineTotal', cmp: 'num' },
      ],
    },
  },
  sales: {
    scalars: [{ key: 'date', cmp: 'str' }],
    line: {
      key: 'items',
      matchKey: 'menuItemName',
      fields: [
        { key: 'quantity', cmp: 'num' },
        { key: 'unitPrice', cmp: 'num' },
      ],
    },
  },
  recipe: {
    scalars: [
      { key: 'name', cmp: 'str' },
      { key: 'portions', cmp: 'num' },
      { key: 'yieldQty', cmp: 'num' },
      { key: 'yieldUnit', cmp: 'str' },
    ],
    line: {
      key: 'items',
      matchKey: 'rawName',
      fields: [
        { key: 'quantity', cmp: 'num' },
        { key: 'unit', cmp: 'str' },
      ],
    },
  },
  menu: {
    scalars: [{ key: 'name', cmp: 'str' }],
    line: {
      key: 'items',
      matchKey: 'name',
      fields: [
        { key: 'price', cmp: 'num' },
        { key: 'section', cmp: 'str' },
      ],
    },
  },
}

function eq(cmp: Cmp, expected: unknown, actual: unknown): boolean {
  if (cmp === 'num') {
    const x = Number(expected)
    const y = Number(actual)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    return Math.abs(x - y) <= 0.01 * Math.max(1, Math.abs(x))
  }
  return (
    String(expected ?? '')
      .trim()
      .toLowerCase() ===
    String(actual ?? '')
      .trim()
      .toLowerCase()
  )
}

type Row = Record<string, unknown>

export function scoreExtraction(
  expected: ExtractionPayload,
  actual: ExtractionPayload | undefined,
): FieldScore {
  const spec = SPECS[expected.kind]
  const score: FieldScore = { total: 0, correct: 0 }
  const matched = !!actual && actual.kind === expected.kind
  const exp = expected as unknown as Row
  const act = (matched ? actual : {}) as unknown as Row

  for (const s of spec.scalars) {
    if (exp[s.key] === undefined) continue
    score.total += 1
    if (matched && eq(s.cmp, exp[s.key], act[s.key])) score.correct += 1
  }

  if (spec.line) {
    const expLines = (exp[spec.line.key] as Row[] | undefined) ?? []
    const actLines = (act[spec.line.key] as Row[] | undefined) ?? []
    const used = new Set<number>()
    for (const el of expLines) {
      score.total += 1
      let hit = -1
      for (let i = 0; i < actLines.length; i++) {
        if (used.has(i)) continue
        if (eq('str', el[spec.line.matchKey], actLines[i][spec.line.matchKey])) {
          hit = i
          break
        }
      }
      if (hit >= 0) {
        used.add(hit)
        score.correct += 1
      }
      for (const f of spec.line.fields) {
        if (el[f.key] === undefined) continue
        score.total += 1
        if (hit >= 0 && eq(f.cmp, el[f.key], actLines[hit][f.key])) score.correct += 1
      }
    }
  }

  return score
}

export function accuracy(score: FieldScore): number {
  return score.total === 0 ? 1 : score.correct / score.total
}
