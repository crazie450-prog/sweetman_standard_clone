'use client'

import { Fragment, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Table, TBody, TD, TH, THead, TR, useToast } from '@/components/ui'
import { documentsService } from '@/lib/api/services'
import type { FileUnitsRow } from '@/lib/api/types'
import { serverMessage } from '@/lib/api/error'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { useUnits } from '@/lib/api/useUnits'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { queries } from '@/lib/api/queries'
import { NumericInput, inputCls } from './ExtractionEditor'

export function FileUnits({ documentId, stamp }: { documentId: string; stamp: number }) {
  const units = useUnits()
  const { can } = useCurrentUser()
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  const toast = useToast()
  const [bases, setBases] = useState<Record<string, string>>({})
  const [factors, setFactors] = useState<Record<string, number | undefined>>({})
  const { data } = useQuery({
    queryKey: ['document-file-units', documentId, stamp],
    queryFn: () => documentsService.fileUnits(documentId),
  })
  const rows = data?.ingredients ?? []

  const dimensionOf = (unit: string) => units.find((u) => u.value === unit)?.dimension ?? null
  const baseOf = (row: FileUnitsRow) => bases[row.key] ?? row.unit
  const needed = (row: FileUnitsRow) => {
    const base = baseOf(row)
    return row.units.filter((u) =>
      base === row.unit ? !u.reaches : u.unit !== base && u.dimension !== dimensionOf(base)
    )
  }
  const factorKey = (row: FileUnitsRow, unit: string) => `${row.key}:${baseOf(row)}:${unit}`

  const save = useMutation({
    mutationFn: () => {
      const touched = rows.filter(
        (row) =>
          bases[row.key] !== undefined ||
          needed(row).some((u) => factors[factorKey(row, u.unit)] !== undefined)
      )
      return documentsService.saveFileUnits(documentId, {
        ingredients: touched
          .filter((row) => !row.ingredientId)
          .map((row) => ({ name: row.name, unit: baseOf(row) })),
        conversions: touched.flatMap((row) =>
          needed(row).flatMap((u) => {
            const factor = factors[factorKey(row, u.unit)]
            if (!(Number(factor) > 0)) return []
            return [
              {
                ...(row.ingredientId ? { ingredientId: row.ingredientId } : { name: row.name }),
                fromUnit: u.unit,
                factor: factor as number,
              },
            ]
          })
        ),
      })
    },
    onSuccess: async (result) => {
      setBases({})
      setFactors({})
      await invalidate('units')
      await qc.invalidateQueries({ queryKey: ['document-file-units', documentId] })
      await qc.invalidateQueries({ queryKey: queries.document(documentId).queryKey })
      toast(
        'success',
        `${result.added} ${result.added === 1 ? 'ingredient' : 'ingredients'} added, ${result.recorded} ${result.recorded === 1 ? 'conversion' : 'conversions'} recorded for this file`
      )
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not save the units for this file')),
  })

  if (rows.length === 0) return null
  const anything =
    Object.keys(bases).length > 0 || Object.values(factors).some((f) => Number(f) > 0)
  return (
    <section className="space-y-2" aria-label="Units across this file">
      <h3 className="text-sm font-semibold">Units across this file</h3>
      <p className="text-[13px] text-text-muted">
        These ingredients are written in units that do not reach the unit they are counted in, here
        or in other recipes of the same file. Settle each once: choose the unit a new ingredient is
        counted in, and say how much one of every other unit is. Every recipe of the file then uses
        it.
      </p>
      <Table>
        <THead>
          <TR>
            <TH>Ingredient</TH>
            <TH>Counted in</TH>
            <TH>Written as</TH>
            <TH className="text-right">One of it is</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => {
            const base = baseOf(row)
            const missing = needed(row)
            const span = Math.max(1, missing.length)
            const counted = row.ingredientId ? (
              <span>{row.unit}</span>
            ) : (
              <select
                aria-label={`Unit ${row.name} is counted in`}
                className={inputCls}
                value={base}
                disabled={!can('manager')}
                onChange={(e) => setBases((b) => ({ ...b, [row.key]: e.target.value }))}
              >
                {row.choices.map((unit) => (
                  <option key={unit} value={unit}>
                    {units.find((u) => u.value === unit)?.label ?? unit} ({unit})
                  </option>
                ))}
              </select>
            )
            const head = (
              <>
                <TD rowSpan={span} className="font-medium">
                  {row.name}
                  {!row.ingredientId && (
                    <span className="ml-1 text-[12px] text-text-muted">(new)</span>
                  )}
                </TD>
                <TD rowSpan={span} className="w-52 min-w-44">
                  {counted}
                </TD>
              </>
            )
            if (missing.length === 0)
              return (
                <TR key={row.key}>
                  {head}
                  <TD colSpan={2} className="text-[13px] text-text-muted">
                    Every line reaches {base} now
                  </TD>
                </TR>
              )
            return (
              <Fragment key={row.key}>
                {missing.map((u, i) => (
                  <TR key={`${row.key}:${u.unit}`}>
                    {i === 0 && head}
                    <TD>
                      {u.unit}
                      <span className="ml-1 text-[12px] text-text-muted">
                        ({u.lines} {u.lines === 1 ? 'line' : 'lines'})
                      </span>
                    </TD>
                    <TD className="text-right">
                      <span className="inline-flex items-center gap-2">
                        <NumericInput
                          label={`How many ${base} one ${u.unit} of ${row.name} is`}
                          className={`${inputCls} w-24 text-right`}
                          allowEmpty
                          value={factors[factorKey(row, u.unit)]}
                          onValue={(n) =>
                            setFactors((f) => ({ ...f, [factorKey(row, u.unit)]: n }))
                          }
                        />
                        {base}
                      </span>
                    </TD>
                  </TR>
                ))}
              </Fragment>
            )
          })}
        </TBody>
      </Table>
      {can('manager') ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={!anything || save.isPending}
          onClick={() => save.mutate()}
        >
          Save units for this file
        </Button>
      ) : (
        <p className="text-[13px] text-text-muted">
          A manager records units and conversions; ask one to settle these, then confirm.
        </p>
      )}
    </section>
  )
}
