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
  UnitField,
  TH,
  THead,
  TR,
  useToast,
  PAGE_SIZE,
  Pager,
  usePageOffset,
} from '@/components/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { wasteService, type WasteIngredient } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { convertWithin, useUnits } from '@/lib/api/useUnits'
import { formatDate, formatMoney } from '@/lib/utils/format'
import { useRestaurantDay } from '@/lib/utils/restaurant-day'
import { useActiveLocationId } from '@/lib/api/useActiveLocation'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

function WastePage() {
  const { data: wasteIngredients = [] } = useQuery(queries.wasteIngredients())
  const { data: wasteReasons = [] } = useQuery(queries.wasteReasons())
  const [offset, setOffset] = usePageOffset()
  const { data: page } = useQuery(queries.wasteEntries({ offset, limit: PAGE_SIZE }))
  const entries = page?.data ?? []
  const invalidate = useInvalidate()
  const toast = useToast()
  const units = useUnits()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<WasteIngredient | null>(null)
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const day = useRestaurantDay()
  const [date, setDate] = useState('')
  const locationId = useActiveLocationId()

  const results = query.trim()
    ? wasteIngredients.filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase()))
    : wasteIngredients

  const stated = selected
    ? convertWithin(units, selected.onHand, selected.unit, unit || selected.unit)
    : null
  const available = stated ?? selected?.onHand ?? 0
  const availableUnit = stated === null ? (selected?.unit ?? '') : unit || selected?.unit || ''
  const availableShown = Math.round(available * 1000) / 1000
  const asked = parseFloat(qty)
  const tooMuch = stated !== null && Number.isFinite(asked) && asked > stated

  function select(ing: WasteIngredient) {
    setSelected(ing)
    setUnit(ing.unit)
    setQty('')
    setReason('')
    setNotes('')
    setDate('')
  }

  const logging = useMutation({
    mutationFn: (entry: Parameters<typeof wasteService.create>[0]) => wasteService.create(entry),
    onSuccess: async () => {
      await invalidate('waste')
      toast('success', `Waste logged for ${selected?.name ?? 'the ingredient'}`)
      setSelected(null)
      setQuery('')
      setNotes('')
      setDate('')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not log the waste entry. Try again.')),
  })

  function logWaste() {
    if (!selected) return
    const q = parseFloat(qty)
    if (!q || q <= 0 || !reason) {
      toast('danger', 'Enter a quantity and reason')
      return
    }
    if (tooMuch) {
      toast(
        'danger',
        `Only ${availableShown} ${unit || selected.unit} of ${selected.name} is in stock`
      )
      return
    }
    logging.mutate({
      ingredientId: selected.id,
      quantity: q,
      unit: unit || selected.unit,
      reason,
      date: date || day.today,
      notes: notes.trim() || undefined,
    })
  }

  return (
    <>
      <PageHeader
        title="Quick Waste Entry"
        subtitle={
          locationId
            ? 'Log food waste in seconds to track shrinkage'
            : 'Waste is thrown out at a location. Choose one in the header to log an entry; the list below shows what every location holds together'
        }
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
                  disabled={!locationId}
                  title={locationId ? undefined : 'Choose a location in the header first'}
                  onClick={() => select(i)}
                  className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-primary-900/20 ${
                    selected?.id === i.id
                      ? 'bg-primary-50 font-medium text-primary-900 dark:bg-primary-900/25 dark:text-primary-100'
                      : ''
                  }`}
                >
                  <span className="font-medium">
                    {i.name}
                    {!i.isActive && <span className="ml-2 text-xs text-text-muted">archived</span>}
                  </span>
                  <span className={i.onHand > 0 ? 'text-text-muted' : 'text-danger-700'}>
                    {i.onHand} {i.unit} in stock
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
              <p className="mt-3 text-lg font-semibold">
                {locationId ? 'No Ingredient Selected' : 'No Location Chosen'}
              </p>
              <p className="max-w-56 text-sm text-text-muted">
                {locationId
                  ? 'Select an item from the list to begin logging waste'
                  : 'Choose a location in the header, then pick an item from the list'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-lg font-semibold">{selected.name}</p>
                <p className="text-sm text-text-muted">
                  {selected.onHand} {selected.unit} in stock · {formatMoney(selected.unitCost)} /{' '}
                  {selected.unit}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField
                  label="Quantity"
                  type="number"
                  min="0"
                  max={stated === null ? undefined : availableShown}
                  step="0.1"
                  required
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  error={tooMuch ? `Only ${availableShown} ${availableUnit} in stock` : undefined}
                  help={`Available: ${availableShown} ${availableUnit}`}
                />
                <UnitField
                  label="Unit"
                  pricedIn={selected.unit}
                  ingredientId={selected.id}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SelectField
                  label="Reason"
                  required
                  placeholder="Select reason…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  options={wasteReasons}
                />
                <TextField
                  label="Date"
                  type="date"
                  max={day.latest}
                  value={date || day.today}
                  onChange={(e) => setDate(e.target.value)}
                  help="When it was thrown out, not when it is logged"
                />
              </div>
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
                <Button
                  onClick={logWaste}
                  disabled={logging.isPending || tooMuch || available <= 0}
                >
                  Log Waste
                </Button>
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
                <TD className="whitespace-nowrap text-text-muted">{formatDate(w.date)}</TD>
                <TD className="text-danger-700 font-medium dark:text-danger-100">
                  {formatMoney(w.value)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pager page={page?.pagination} onOffset={setOffset} label="Waste entry pages" />
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
