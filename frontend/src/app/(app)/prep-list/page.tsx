'use client'

import { useState } from 'react'
import {
  Button,
  Card,
  PageHeader,
  Table,
  TableEmpty,
  TBody,
  TD,
  TextField,
  TH,
  THead,
  TR,
} from '@/components/ui'
import { useQuery } from '@tanstack/react-query'
import { productionService } from '@/lib/api/services'

const steps = [
  'Select the date you want to prep for (usually tomorrow)',
  'The system analyzes sales from the same day of the week for the past 4 weeks',
  'Calculates average quantities sold for each menu item',
  'Adds a 20% buffer to prevent stockouts',
  'Subtracts your current inventory to show only what you need',
  'Groups items by category for efficient prep workflow',
]

export default function PrepListPage() {
  const { data: suggestions = [] } = useQuery({
    queryKey: ['prep-list'],
    queryFn: productionService.prepSuggestions,
  })
  const [generated, setGenerated] = useState(false)
  const [prepDate, setPrepDate] = useState(() => new Date().toISOString().slice(0, 10))

  return (
    <>
      <PageHeader
        title="Prep List Generator"
        subtitle="Prep planning based on historical sales patterns"
      />

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <TextField
          label="Prep Date"
          type="date"
          className="w-64"
          value={prepDate}
          onChange={(e) => setPrepDate(e.target.value)}
        />
        <Button variant="primary" onClick={() => setGenerated(true)}>
          Generate Prep List
        </Button>
      </div>

      <Card className="mb-6">
        <h2 className="section-title mb-4 text-lg font-semibold">How It Works</h2>
        <ol className="mb-4 space-y-3 text-sm">
          {steps.map((step, i) => (
            <li key={step} className="flex items-start gap-3">
              <span className="mt-[-2px] flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[12px] font-bold text-primary-800 dark:bg-primary-900/40 dark:text-primary-200">
                {i + 1}
              </span>
              <span className="text-text-muted">{step}</span>
            </li>
          ))}
        </ol>
        <div className="rounded-lg bg-info-100 px-4 py-3 text-sm text-info-700 dark:bg-info-900/40 dark:text-info-100">
          <span className="font-semibold">Pro Tip:</span> Generate and print your prep list at the
          end of each day for the next day&apos;s service.
        </div>
      </Card>

      {generated && (
        <Table>
          <THead>
            <TR>
              <TH>Component</TH>
              <TH>On hand</TH>
              <TH>Suggested prep</TH>
              <TH>Why</TH>
            </TR>
          </THead>
          <TBody>
            {suggestions.length === 0 && (
              <TableEmpty colSpan={4}>
                Prep suggestions arrive with the costing engine. Until then this list stays empty —
                sales history is recorded, but nothing turns it into prep quantities yet.
              </TableEmpty>
            )}
            {suggestions.map((s) => (
              <TR key={s.item}>
                <TD className="font-medium">{s.item}</TD>
                <TD>{s.onHand}</TD>
                <TD className="font-medium text-primary-800 dark:text-primary-300">
                  {s.suggested}
                </TD>
                <TD className="text-text-muted">{s.reason}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  )
}
