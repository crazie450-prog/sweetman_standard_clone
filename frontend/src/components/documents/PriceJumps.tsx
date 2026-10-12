import { Table, TBody, TD, TH, THead, TR } from '@/components/ui'
import type { ExtractionPayload, PriceJump } from '@/lib/api/types'
import { formatMoney } from '@/lib/utils/format'

type Line = {
  rawName: string
  quantity: number
  unit: string
  unitPrice?: number
  lineTotal?: number
}

function priced(payload: ExtractionPayload | null): string[] {
  if (payload?.kind !== 'invoice') return []
  return payload.items.map((l: Line) =>
    JSON.stringify([l.rawName.trim(), l.quantity, l.unit, l.unitPrice, l.lineTotal ?? null])
  )
}

export function PriceJumps({
  jumps,
  read,
  draft,
}: {
  jumps: PriceJump[]
  read: ExtractionPayload | null
  draft: ExtractionPayload
}) {
  const asRead = priced(read)
  const now = new Set(priced(draft))
  const standing = jumps.filter((j) =>
    asRead.some((l) => JSON.parse(l)[0] === j.rawName && now.has(l))
  )
  if (standing.length === 0) return null
  return (
    <section className="space-y-2" aria-label="Prices far from what this location pays">
      <h3 className="text-sm font-semibold text-warning-700 dark:text-warning-100">
        Prices far from what this location pays
      </h3>
      <p className="text-[13px] text-text-muted">
        These lines price their ingredient at more than ten times, or less than a tenth of, what
        this location pays now. A misread figure, such as a date or a code read as a price, looks
        like this. Check the quantity, unit and price above before confirming; on confirm the stated
        price becomes the price here.
      </p>
      <Table>
        <THead>
          <TR>
            <TH>Line</TH>
            <TH>Ingredient</TH>
            <TH className="text-right">On this document</TH>
            <TH className="text-right">Paid here now</TH>
          </TR>
        </THead>
        <TBody>
          {standing.map((j) => (
            <TR key={`${j.rawName}:${j.ingredient}`}>
              <TD>{j.rawName}</TD>
              <TD>{j.ingredient}</TD>
              <TD className="text-right tabular-nums">
                {formatMoney(j.stated)} / {j.unit}
              </TD>
              <TD className="text-right tabular-nums">
                {formatMoney(j.now)} / {j.unit}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </section>
  )
}
