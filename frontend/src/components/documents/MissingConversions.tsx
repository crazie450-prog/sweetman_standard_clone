'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Table, TBody, TD, TH, THead, TR, useToast } from '@/components/ui'
import { unitConversionsService } from '@/lib/api/services'
import type { MissingConversion } from '@/lib/api/types'
import { serverMessage } from '@/lib/api/error'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { useUnits } from '@/lib/api/useUnits'
import { queries } from '@/lib/api/queries'
import { NumericInput, inputCls } from './ExtractionEditor'

export function MissingConversions({
  documentId,
  missing,
}: {
  documentId: string
  missing: MissingConversion[]
}) {
  const units = useUnits()
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  const toast = useToast()
  const [factors, setFactors] = useState<Record<string, number | undefined>>({})
  const keyOf = (m: MissingConversion) => `${m.ingredientId}:${m.from}`

  const record = useMutation({
    mutationFn: (m: MissingConversion) =>
      unitConversionsService.create({
        ingredientId: m.ingredientId,
        fromUnit: m.from,
        toUnit: m.to,
        factor: factors[keyOf(m)] as number,
      }),
    onSuccess: async (_, m) => {
      await invalidate('units')
      await qc.invalidateQueries({ queryKey: queries.document(documentId).queryKey })
      toast('success', `${m.ingredient} now converts from ${m.from} to ${m.to}`)
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not record the conversion')),
  })

  if (missing.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Units that reach no conversion</h3>
      <p className="text-[13px] text-text-muted">
        These lines are written in a unit their ingredient is not counted in. Say how much one of
        that unit is, and the rule is recorded for the ingredient here, without leaving the
        document.
      </p>
      <Table>
        <THead>
          <TR>
            <TH>Line</TH>
            <TH>One of</TH>
            <TH className="text-right">Equals</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {missing.map((m) => {
            const priced = units.some((u) => u.value === m.to)
            return (
              <TR key={keyOf(m)}>
                <TD className="font-medium">{m.rawName}</TD>
                <TD>{m.from}</TD>
                <TD className="text-right">
                  {priced ? (
                    <span className="inline-flex items-center gap-2">
                      <NumericInput
                        label={`How many ${m.to} one ${m.from} of ${m.ingredient} is`}
                        className={`${inputCls} w-24 text-right`}
                        allowEmpty
                        value={factors[keyOf(m)]}
                        onValue={(n) => setFactors((f) => ({ ...f, [keyOf(m)]: n }))}
                      />
                      {m.to}
                    </span>
                  ) : (
                    <span className="text-[13px] text-text-muted">
                      {m.ingredient} is counted in {m.to}, which is not a unit;{' '}
                      <Link className="underline" href="/ingredients">
                        change its base unit
                      </Link>
                    </span>
                  )}
                </TD>
                <TD className="text-right">
                  {priced && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={record.isPending || !(Number(factors[keyOf(m)]) > 0)}
                      onClick={() => record.mutate(m)}
                    >
                      Add conversion
                    </Button>
                  )}
                </TD>
              </TR>
            )
          })}
        </TBody>
      </Table>
    </section>
  )
}
