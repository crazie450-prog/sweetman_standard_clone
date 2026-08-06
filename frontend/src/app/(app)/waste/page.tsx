'use client'

import { RequireRole } from '@/components/layout/RequireRole'
import { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  PageHeader,
  SearchInput,
  SelectField,
  Table,
  TBody,
  TD,
  TextAreaField,
  TextField,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { wasteService, type WasteIngredient } from '@/lib/api/services'
import { formatDate, formatMoney } from '@/lib/utils/format'

function WastePage() {
  const { data: wasteIngredients = [] } = useQuery({
    queryKey: ['waste-ingredients'],
    queryFn: wasteService.ingredients,
  })
  const { data: wasteReasons = [] } = useQuery({
    queryKey: ['waste-reasons'],
    queryFn: wasteService.reasons,
  })
  const { data: entries = [] } = useQuery({
    queryKey: ['waste-entries'],
    queryFn: wasteService.entries,
  })
  const queryClient = useQueryClient()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<WasteIngredient | null>(null)
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')

  const results = query.trim()
    ? wasteIngredients.filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase()))
    : wasteIngredients

  function select(ing: WasteIngredient) {
    setSelected(ing)
    setUnit(ing.unit)
    setQty('')
    setReason('')
    setNotes('')
  }

  async function logWaste() {
    if (!selected) return
    const q = parseFloat(qty)
    if (!q || q <= 0 || !reason) {
      toast('danger', 'Enter a quantity and reason')
      return
    }
    try {
      await wasteService.create({
        ingredientId: selected.id,
        quantity: q,
        reason,
        notes: notes.trim() || undefined,
      })
      await queryClient.invalidateQueries({ queryKey: ['waste-entries'] })
      await queryClient.invalidateQueries({ queryKey: ['inventory'] })
      await queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      toast('success', `Waste logged for ${selected.name}`)
      setSelected(null)
      setQuery('')
      setNotes('')
    } catch {
      toast('danger', 'Could not log the waste entry. Try again.')
    }
  }

  return (
    <>
      <PageHeader
        title="Quick Waste Entry"
        subtitle="Log food waste in seconds to track shrinkage"
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <div>
          <SearchInput
            label="Search ingredients"
            placeholder="Search ingredients..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="mt-3 overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            {results.length === 0 && (
              <li className="px-4 py-3 text-sm text-text-muted">No ingredients found</li>
            )}
            {results.map((i) => (
              <li key={i.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => select(i)}
                  className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-primary-50 ${
                    selected?.id === i.id ? 'bg-primary-50' : ''
                  }`}
                >
                  <span className="font-medium">{i.name}</span>
                  <span className="text-text-muted">
                    {formatMoney(i.unitCost)} / {i.unit}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <Card>
          {!selected ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <div className="flex size-20 items-center justify-center rounded-full border-2 border-dashed border-border">
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="size-8 text-text-muted"
                  aria-hidden
                >
                  <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                </svg>
              </div>
              <p className="mt-3 text-lg font-semibold">No Ingredient Selected</p>
              <p className="max-w-48 text-sm text-text-muted">
                Select an item from the list to begin logging waste
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-lg font-semibold">{selected.name}</p>
                <p className="text-sm text-text-muted">
                  {formatMoney(selected.unitCost)} / {selected.unit}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField
                  label="Quantity"
                  type="number"
                  min="0"
                  step="0.1"
                  required
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
                <SelectField
                  label="Unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  options={[
                    { value: 'kg', label: 'kg' },
                    { value: 'l', label: 'l' },
                    { value: 'ea', label: 'each' },
                  ]}
                />
              </div>
              <SelectField
                label="Reason"
                required
                placeholder="Select reason…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                options={wasteReasons}
              />
              <TextAreaField
                label="Notes"
                placeholder="Optional"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <div className="flex flex-wrap justify-end gap-3">
                <Button variant="secondary" onClick={() => setSelected(null)}>
                  Cancel
                </Button>
                <Button onClick={logWaste}>Log Waste</Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-8">
        <h2 className="section-title mb-3 text-lg font-semibold">Recent Entries</h2>
        <Table>
          <THead>
            <TR>
              <TH>Ingredient</TH>
              <TH>Quantity</TH>
              <TH>Reason</TH>
              <TH>Date</TH>
              <TH>Value</TH>
            </TR>
          </THead>
          <TBody>
            {entries.map((w) => (
              <TR key={w.id}>
                <TD className="font-medium">{w.ingredient}</TD>
                <TD>
                  {w.qty} {w.unit}
                </TD>
                <TD>
                  <Badge
                    dot
                    tone={
                      w.reason === 'Expired'
                        ? 'danger'
                        : w.reason === 'Spoilage'
                          ? 'warning'
                          : 'info'
                    }
                  >
                    {w.reason}
                  </Badge>
                </TD>
                <TD className="text-text-muted">{formatDate(w.date)}</TD>
                <TD className="text-danger-700 font-medium dark:text-danger-100">
                  {formatMoney(w.value)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </>
  )
}

export default function Page() {
  return (
    <RequireRole minRole="staff">
      <WastePage />
    </RequireRole>
  )
}
