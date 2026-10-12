import { scoreExtraction, accuracy } from './extraction-score'
import type { InvoicePayload } from './extraction'

const invoice = (over: Partial<InvoicePayload> = {}): InvoicePayload => ({
  kind: 'invoice',
  vendorName: 'Sunrise Produce',
  number: 'A-1',
  items: [{ rawName: 'Yellow Onions', quantity: 10, unit: 'kg', unitPrice: 1.2 }],
  ...over,
})

describe('scoreExtraction', () => {
  it('gives a perfect score to an exact match', () => {
    const s = scoreExtraction(invoice(), invoice())
    expect(accuracy(s)).toBe(1)
  })

  it('counts only fields present in the expected payload', () => {
    const s = scoreExtraction(
      invoice({ invoiceDate: undefined }),
      invoice({ invoiceDate: undefined }),
    )
    // vendorName, number + line matchKey + quantity/unit/unitPrice = 6 fields
    expect(s.total).toBe(6)
    expect(s.correct).toBe(6)
  })

  it('measures the line total when the document states one', () => {
    const withTotal = invoice({
      items: [
        { rawName: 'Yellow Onions', quantity: 10, unit: 'kg', unitPrice: 1.2, lineTotal: 12 },
      ],
    })
    const missed = invoice({
      items: [
        { rawName: 'Yellow Onions', quantity: 10, unit: 'kg', unitPrice: 1.2, lineTotal: 99 },
      ],
    })
    expect(scoreExtraction(withTotal, withTotal).total).toBe(
      scoreExtraction(invoice(), invoice()).total + 1,
    )
    expect(scoreExtraction(withTotal, missed).correct).toBe(
      scoreExtraction(withTotal, withTotal).total - 1,
    )
  })

  it('penalises a wrong field but keeps the rest', () => {
    const s = scoreExtraction(invoice(), invoice({ number: 'WRONG' }))
    expect(s.correct).toBe(s.total - 1)
  })

  it('matches line items by name regardless of order', () => {
    const two = invoice({
      items: [
        { rawName: 'Yellow Onions', quantity: 10, unit: 'kg', unitPrice: 1.2 },
        { rawName: 'Garlic', quantity: 2, unit: 'kg', unitPrice: 5 },
      ],
    })
    const reversed = invoice({
      items: [
        { rawName: 'Garlic', quantity: 2, unit: 'kg', unitPrice: 5 },
        { rawName: 'Yellow Onions', quantity: 10, unit: 'kg', unitPrice: 1.2 },
      ],
    })
    expect(accuracy(scoreExtraction(two, reversed))).toBe(1)
  })

  it('tolerates a one-cent rounding difference on numbers', () => {
    const s = scoreExtraction(
      invoice(),
      invoice({ items: [{ rawName: 'Yellow Onions', quantity: 10, unit: 'kg', unitPrice: 1.21 }] }),
    )
    expect(accuracy(s)).toBe(1)
  })

  it('scores zero when the extractor returned nothing', () => {
    const s = scoreExtraction(invoice(), undefined)
    expect(s.correct).toBe(0)
    expect(s.total).toBeGreaterThan(0)
  })

  it('scores zero when the kind does not match', () => {
    const s = scoreExtraction(invoice(), { kind: 'menu', name: 'x', items: [] })
    expect(s.correct).toBe(0)
  })
})
