'use client'

import { useMemo, useState } from 'react'
import { isoDay, lastDays, today, endsBeforeBegins } from '@/lib/utils/date-range'
import { useRestaurantDay } from '@/lib/utils/restaurant-day'

import {
  Button,
  Card,
  KpiCard,
  Modal,
  PageHeader,
  SelectField,
  Table,
  TableEmpty,
  TBody,
  TD,
  TextField,
  TH,
  THead,
  TR,
  useToast,
  BackwardsPeriod,
  Icon,
  PAGE_SIZE,
  Pager,
  usePageOffset,
} from '@/components/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { salesService } from '@/lib/api/services'
import { DocumentUploadButton, PendingReview } from '@/components/documents/DocumentUpload'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { useActiveLocationId } from '@/lib/api/useActiveLocation'
import { cn } from '@/lib/utils/cn'
import { currencySymbol, formatDate, formatMoney, formatPercent } from '@/lib/utils/format'
import { percentOf, shownShare, wholeCount } from '@/lib/utils/money'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

const TABS = ['Daily View', 'Individual Sales'] as const
type Tab = (typeof TABS)[number]

const PRESETS = [
  'Last 7 Days',
  'Last 30 Days',
  'Last 90 Days',
  'This Month',
  'Last Month',
  'This Year',
] as const
type Preset = (typeof PRESETS)[number]

function rangeOf(preset: Preset): { from: string; to: string } {
  const now = new Date()
  const startOfMonth = (offset: number) => new Date(now.getFullYear(), now.getMonth() + offset, 1)
  switch (preset) {
    case 'Last 7 Days':
      return lastDays(7)
    case 'Last 30 Days':
      return lastDays(30)
    case 'Last 90 Days':
      return lastDays(90)
    case 'This Month':
      return { from: isoDay(startOfMonth(0)), to: today() }
    case 'Last Month':
      return {
        from: isoDay(startOfMonth(-1)),
        to: isoDay(new Date(now.getFullYear(), now.getMonth(), 0)),
      }
    case 'This Year':
      return { from: isoDay(new Date(now.getFullYear(), 0, 1)), to: today() }
  }
}

const inRange = (date: string, from: string, to: string) =>
  (!from || date >= from) && (!to || date <= to)

const numberOr = (raw: string, fallback: number) => {
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
}

const moneyOrNone = (raw: string) => {
  const n = parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

const SORT_FIELD_OPTIONS = [
  { value: 'date', label: 'Sort by Date' },
  { value: 'revenue', label: 'Sort by Revenue' },
  { value: 'profit', label: 'Sort by Profit' },
]

const SORT_DIR_OPTIONS = [
  { value: 'desc', label: 'Descending' },
  { value: 'asc', label: 'Ascending' },
]

export default function SalesPage() {
  const { data: menuItems = [] } = useQuery(queries.menuItems())
  const MENU_ITEM_OPTIONS = menuItems
    .filter((m) => m.active)
    .map((m) => ({ value: m.id, label: m.name }))
  const invalidate = useInvalidate()
  const { can } = useCurrentUser()
  const toast = useToast()
  const locationId = useActiveLocationId()
  const [tab, setTab] = useState<Tab>('Daily View')
  const [preset, setPreset] = useState<Preset>('Last 30 Days')
  const [from, setFrom] = useState(() => lastDays(30).from)
  const [to, setTo] = useState(() => lastDays(30).to)
  const backwards = endsBeforeBegins({ from, to })
  const { data: dailyRows = [] } = useQuery({
    ...queries.salesDaily(from, to),
    enabled: !backwards,
  })
  const [advancedOpen, setAdvancedOpen] = useState(true)
  const [minRevenue, setMinRevenue] = useState('')
  const [maxRevenue, setMaxRevenue] = useState('')
  const [minFoodCost, setMinFoodCost] = useState('')
  const [maxFoodCost, setMaxFoodCost] = useState('')
  const [sortField, setSortField] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
  const [recordOpen, setRecordOpen] = useState(false)
  const [saleItem, setSaleItem] = useState('')
  const [saleQty, setSaleQty] = useState('1')
  const day = useRestaurantDay()
  const [saleDate, setSaleDate] = useState('')

  const visibleDaily = useMemo(() => {
    const minRev = numberOr(minRevenue, -Infinity)
    const maxRev = numberOr(maxRevenue, Infinity)
    const minPct = numberOr(minFoodCost, -Infinity)
    const maxPct = numberOr(maxFoodCost, Infinity)
    const dir = sortDir === 'asc' ? 1 : -1
    return dailyRows
      .filter((r) => {
        const share = percentOf(r.cost, r.revenue)
        const pct = share === null ? null : shownShare(share)
        const unfiltered = minPct === -Infinity && maxPct === Infinity
        return (
          inRange(r.date, from, to) &&
          r.revenue >= minRev &&
          r.revenue <= maxRev &&
          (unfiltered || (pct !== null && pct >= minPct && pct <= maxPct))
        )
      })
      .sort((a, b) => {
        if (sortField === 'revenue') return (a.revenue - b.revenue) * dir
        if (sortField === 'profit') return (a.profit - b.profit) * dir
        return a.date < b.date ? -dir : a.date > b.date ? dir : 0
      })
  }, [dailyRows, from, to, minRevenue, maxRevenue, minFoodCost, maxFoodCost, sortField, sortDir])

  const lineFilter = {
    from,
    to,
    sort: sortField === 'date' ? ('date' as const) : ('total' as const),
    dir: sortDir === 'asc' ? ('asc' as const) : ('desc' as const),
    minTotal: moneyOrNone(minRevenue),
    maxTotal: moneyOrNone(maxRevenue),
  }
  const [lineOffset, setLineOffset] = usePageOffset(...Object.values(lineFilter))
  const { data: linePage } = useQuery({
    ...queries.salesIndividual({ ...lineFilter, offset: lineOffset, limit: PAGE_SIZE }),
    enabled: !backwards,
  })
  const visibleIndividual = linePage?.data ?? []

  const kpi = useMemo(() => {
    const revenue = visibleDaily.reduce((s, r) => s + r.revenue, 0)
    const cost = visibleDaily.reduce((s, r) => s + r.cost, 0)
    const profit = visibleDaily.reduce((s, r) => s + r.profit, 0)
    const sales = visibleDaily.reduce((s, r) => s + r.sales, 0)
    return { sales, revenue, cost, profit, pct: percentOf(cost, revenue) }
  }, [visibleDaily])

  const clearFilters = () => {
    setPreset('Last 30 Days')
    const range = lastDays(30)
    setFrom(range.from)
    setTo(range.to)
    setMinRevenue('')
    setMaxRevenue('')
    setMinFoodCost('')
    setMaxFoodCost('')
    setSortField('date')
    setSortDir('desc')
  }

  const recording = useMutation({
    mutationFn: ({ menuItemId, quantity }: { menuItemId: string; quantity: number }) =>
      salesService.create({
        date: saleDate || day.today,
        items: [{ menuItemId, quantity }],
      }),
    onSuccess: async (_, { menuItemId, quantity }) => {
      await invalidate('sales')
      setRecordOpen(false)
      const name = menuItems.find((m) => m.id === menuItemId)?.name ?? 'item'
      toast('success', `Sale recorded: ${name} × ${quantity}`)
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  const submitSale = () => {
    const qty = wholeCount(saleQty)
    if (!saleItem) {
      toast('danger', 'Pick a menu item')
      return
    }
    if (qty === null) {
      toast('danger', 'Quantity is a whole number of at least 1')
      return
    }
    recording.mutate({ menuItemId: saleItem, quantity: qty })
  }

  return (
    <>
      <PageHeader
        title="Sales Tracking"
        subtitle={
          locationId
            ? 'Record sales and track revenue & food costs'
            : 'Revenue and food costs of every location together. Choose a location in the header to record a sale: a sale is rung up at a location'
        }
      />

      <PendingReview type="sales" />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <KpiCard label="Sales" value={kpi.sales} tone="slate" icon={<Icon name="cart" />} />
        <KpiCard
          label="Revenue"
          value={formatMoney(kpi.revenue)}
          tone="success"
          icon={<Icon name="dollar" />}
        />
        <KpiCard
          label="Food Cost"
          value={formatMoney(kpi.cost)}
          tone="warning"
          icon={<Icon name="wallet" />}
        />
        <KpiCard
          label="Profit"
          value={formatMoney(kpi.profit)}
          tone="success"
          icon={<Icon name="trend" />}
        />
        <KpiCard
          label="Food Cost %"
          value={formatPercent(kpi.pct)}
          tone="success"
          icon={<Icon name="percent" />}
        />
      </div>

      {can('staff') && (
        <div className="mb-6 flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={!locationId}
            title={locationId ? undefined : 'Choose a location in the header first'}
            onClick={() => setRecordOpen(true)}
          >
            + Record New Sale
          </Button>
          <DocumentUploadButton type="sales" label="Import sales report" />
        </div>
      )}

      <Card className="mb-6 space-y-4">
        <div
          className="inline-flex flex-wrap gap-1 rounded-full bg-surface-subtle p-1"
          role="tablist"
          aria-label="Sales view"
        >
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-full px-3.5 py-2 text-sm font-semibold transition duration-150 active:scale-[0.97]',
                tab === t
                  ? 'bg-surface text-text shadow-sm ring-1 ring-border-strong'
                  : 'text-text-muted hover:text-text'
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Period presets">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={preset === p}
              onClick={() => {
                setPreset(p)
                const r = rangeOf(p)
                setFrom(r.from)
                setTo(r.to)
              }}
              className={cn(
                'rounded-full border px-3.5 py-2 text-sm font-medium transition duration-150 active:scale-[0.97]',
                preset === p
                  ? 'border-ink-800 bg-ink-800 font-semibold text-white dark:border-slate-100 dark:bg-slate-100 dark:text-ink-900'
                  : 'border-border-strong bg-surface text-text-muted hover:border-ink-600 hover:text-text'
              )}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            label="From"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <BackwardsPeriod from={from} to={to} />

        <div className="rounded-lg border border-border">
          <button
            type="button"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-bg"
          >
            Advanced Filters
            <span aria-hidden className={cn('transition-transform', advancedOpen && 'rotate-180')}>
              ▾
            </span>
          </button>
          {advancedOpen && (
            <div className="grid grid-cols-1 gap-3 border-t border-border p-4 sm:grid-cols-2 xl:grid-cols-4">
              <TextField
                label={`Min Revenue (${currencySymbol()})`}
                type="number"
                placeholder="0.00"
                value={minRevenue}
                onChange={(e) => setMinRevenue(e.target.value)}
              />
              <TextField
                label={`Max Revenue (${currencySymbol()})`}
                type="number"
                placeholder="No limit"
                value={maxRevenue}
                onChange={(e) => setMaxRevenue(e.target.value)}
              />
              <TextField
                label="Min Food Cost (%)"
                type="number"
                placeholder="0"
                value={minFoodCost}
                onChange={(e) => setMinFoodCost(e.target.value)}
              />
              <TextField
                label="Max Food Cost (%)"
                type="number"
                placeholder="100"
                value={maxFoodCost}
                onChange={(e) => setMaxFoodCost(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <SelectField
            label="Sort by"
            hideLabel
            options={SORT_FIELD_OPTIONS}
            value={sortField}
            onChange={(e) => setSortField(e.target.value)}
            className="w-40"
          />
          <SelectField
            label="Sort direction"
            hideLabel
            options={SORT_DIR_OPTIONS}
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value)}
            className="w-40"
          />
          <Button variant="secondary" onClick={clearFilters}>
            Clear Filters
          </Button>
        </div>
      </Card>

      {tab === 'Daily View' ? (
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Sales</TH>
              <TH>Revenue</TH>
              <TH>Cost</TH>
              <TH>Profit</TH>
              <TH>Food Cost %</TH>
            </TR>
          </THead>
          <TBody>
            {visibleDaily.length === 0 ? (
              <TableEmpty colSpan={6}>No sales data found for selected date range.</TableEmpty>
            ) : (
              visibleDaily.map((r) => (
                <TR key={r.date}>
                  <TD className="whitespace-nowrap font-medium">{formatDate(r.date)}</TD>
                  <TD>{r.sales}</TD>
                  <TD>{formatMoney(r.revenue)}</TD>
                  <TD>{formatMoney(r.cost)}</TD>
                  <TD>{formatMoney(r.profit)}</TD>
                  <TD>{formatPercent(percentOf(r.cost, r.revenue))}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Menu Item</TH>
              <TH>Quantity</TH>
              <TH>Price</TH>
              <TH>Total</TH>
              <TH>Date</TH>
            </TR>
          </THead>
          <TBody>
            {visibleIndividual.length === 0 ? (
              <TableEmpty colSpan={5}>No sales data found for selected date range.</TableEmpty>
            ) : (
              visibleIndividual.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium">{r.item}</TD>
                  <TD>{r.qty}</TD>
                  <TD>{formatMoney(r.price)}</TD>
                  <TD>{formatMoney(r.qty * r.price)}</TD>
                  <TD className="whitespace-nowrap text-text-muted">{formatDate(r.date)}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      )}
      {tab !== 'Daily View' && (
        <Pager page={linePage?.pagination} onOffset={setLineOffset} label="Sold item pages" />
      )}

      <Modal
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        title="Record New Sale"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRecordOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitSale} disabled={recording.isPending}>
              Record Sale
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <SelectField
            label="Menu Item"
            required
            placeholder="Select a menu item…"
            options={MENU_ITEM_OPTIONS}
            value={saleItem}
            onChange={(e) => setSaleItem(e.target.value)}
          />
          <TextField
            label="Quantity"
            required
            type="number"
            min={1}
            value={saleQty}
            onChange={(e) => setSaleQty(e.target.value)}
          />
          <TextField
            label="Date"
            required
            type="date"
            max={day.latest}
            value={saleDate || day.today}
            onChange={(e) => setSaleDate(e.target.value)}
          />
        </div>
      </Modal>
    </>
  )
}
