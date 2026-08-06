'use client'

import { useMemo, useState } from 'react'
import { lastDays, today } from '@/lib/utils/date-range'

const DEFAULT_RANGE = lastDays(30)
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
} from '@/components/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { menuService, salesService } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { cn } from '@/lib/utils/cn'
import { formatDate, formatMoney, formatPercent } from '@/lib/utils/format'

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
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const startOfMonth = (offset: number) => new Date(now.getFullYear(), now.getMonth() + offset, 1)
  switch (preset) {
    case 'Last 7 Days':
      return lastDays(7)
    case 'Last 30 Days':
      return lastDays(30)
    case 'Last 90 Days':
      return lastDays(90)
    case 'This Month':
      return { from: iso(startOfMonth(0)), to: today() }
    case 'Last Month':
      return {
        from: iso(startOfMonth(-1)),
        to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      }
    case 'This Year':
      return { from: iso(new Date(now.getFullYear(), 0, 1)), to: today() }
  }
}

const inRange = (date: string, from: string, to: string) =>
  (!from || date >= from) && (!to || date <= to)

const numberOr = (raw: string, fallback: number) => {
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
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

const I = (d: string) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-6"
    aria-hidden
  >
    <path d={d} />
  </svg>
)
const icons = {
  cart: I(
    'M6 6h15l-1.5 9h-12zM6 6 5 3H3M9 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0M19 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0'
  ),
  dollar: I(
    'M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5s2 3 5 3.3 5 1.4 5 3.2-2.2 3.5-5 3.5-5-1.4-5-3.3'
  ),
  wallet: I('M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 12h2'),
  trend: I('M3 17l6-6 4 4 8-8M15 7h6v6'),
  percent: I('M19 5 5 19M7.5 8a1.5 1.5 0 1 1 0-.01M16.5 16a1.5 1.5 0 1 1 0-.01'),
}

export default function SalesPage() {
  const { data: dailyRows = [] } = useQuery({
    queryKey: ['sales-daily'],
    queryFn: salesService.daily,
  })
  const { data: individualRows = [] } = useQuery({
    queryKey: ['sales-individual'],
    queryFn: salesService.individual,
  })
  const { data: menuItems = [] } = useQuery({
    queryKey: ['menu-items'],
    queryFn: menuService.list,
  })
  const MENU_ITEM_OPTIONS = menuItems.map((m) => ({ value: m.id, label: m.name }))
  const queryClient = useQueryClient()
  const { can } = useCurrentUser()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('Daily View')
  const [preset, setPreset] = useState<Preset>('Last 30 Days')
  const [from, setFrom] = useState(DEFAULT_RANGE.from)
  const [to, setTo] = useState(DEFAULT_RANGE.to)
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
  const [saleDate, setSaleDate] = useState(today())
  const [saving, setSaving] = useState(false)

  const visibleDaily = useMemo(() => {
    const minRev = numberOr(minRevenue, -Infinity)
    const maxRev = numberOr(maxRevenue, Infinity)
    const minPct = numberOr(minFoodCost, -Infinity)
    const maxPct = numberOr(maxFoodCost, Infinity)
    const dir = sortDir === 'asc' ? 1 : -1
    return dailyRows
      .filter((r) => {
        const pct = r.revenue ? (r.cost / r.revenue) * 100 : 0
        return (
          inRange(r.date, from, to) &&
          r.revenue >= minRev &&
          r.revenue <= maxRev &&
          pct >= minPct &&
          pct <= maxPct
        )
      })
      .sort((a, b) => {
        if (sortField === 'revenue') return (a.revenue - b.revenue) * dir
        if (sortField === 'profit') return (a.profit - b.profit) * dir
        return a.date < b.date ? -dir : a.date > b.date ? dir : 0
      })
  }, [dailyRows, from, to, minRevenue, maxRevenue, minFoodCost, maxFoodCost, sortField, sortDir])

  const visibleIndividual = useMemo(() => {
    const minRev = numberOr(minRevenue, -Infinity)
    const maxRev = numberOr(maxRevenue, Infinity)
    const dir = sortDir === 'asc' ? 1 : -1
    return individualRows
      .filter((r) => {
        const total = r.qty * r.price
        return inRange(r.date.slice(0, 10), from, to) && total >= minRev && total <= maxRev
      })
      .sort((a, b) => {
        if (sortField === 'revenue' || sortField === 'profit') {
          return (a.qty * a.price - b.qty * b.price) * dir
        }
        return a.date < b.date ? -dir : a.date > b.date ? dir : 0
      })
  }, [individualRows, from, to, minRevenue, maxRevenue, sortField, sortDir])

  const kpi = useMemo(() => {
    const revenue = visibleDaily.reduce((s, r) => s + r.revenue, 0)
    const cost = visibleDaily.reduce((s, r) => s + r.cost, 0)
    const profit = visibleDaily.reduce((s, r) => s + r.profit, 0)
    const todayKey = today()
    const salesToday = dailyRows.find((r) => r.date === todayKey)?.sales ?? 0
    return { today: salesToday, revenue, cost, profit, pct: revenue ? (cost / revenue) * 100 : 0 }
  }, [visibleDaily, dailyRows])

  const clearFilters = () => {
    setPreset('Last 30 Days')
    setFrom(DEFAULT_RANGE.from)
    setTo(DEFAULT_RANGE.to)
    setMinRevenue('')
    setMaxRevenue('')
    setMinFoodCost('')
    setMaxFoodCost('')
    setSortField('date')
    setSortDir('desc')
  }

  const submitSale = async () => {
    const qty = parseInt(saleQty, 10)
    if (!saleItem || !qty || qty < 1) {
      toast('danger', 'Pick a menu item and a quantity')
      return
    }
    setSaving(true)
    try {
      await salesService.create({
        date: saleDate || undefined,
        items: [{ menuItemId: saleItem, quantity: qty }],
      })
      await queryClient.invalidateQueries({ queryKey: ['sales-daily'] })
      await queryClient.invalidateQueries({ queryKey: ['sales-individual'] })
      setRecordOpen(false)
      const name = menuItems.find((m) => m.id === saleItem)?.name ?? 'item'
      toast('success', `Sale recorded: ${name} × ${qty}`)
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="Sales Tracking" subtitle="Record sales and track revenue & food costs" />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <KpiCard label="Today's Sales" value={kpi.today} tone="slate" icon={icons.cart} />
        <KpiCard
          label="Revenue"
          value={formatMoney(kpi.revenue)}
          tone="success"
          icon={icons.dollar}
        />
        <KpiCard
          label="Food Cost"
          value={formatMoney(kpi.cost)}
          tone="warning"
          icon={icons.wallet}
        />
        <KpiCard label="Profit" value={formatMoney(kpi.profit)} tone="success" icon={icons.trend} />
        <KpiCard
          label="Food Cost %"
          value={formatPercent(kpi.pct)}
          tone="success"
          icon={icons.percent}
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {can('staff') && (
          <Button variant="primary" onClick={() => setRecordOpen(true)}>
            + Record New Sale
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => toast('info', 'CSV export is not available yet')}
        >
          Export
        </Button>
        <Button
          variant="secondary"
          onClick={() => toast('info', 'Column settings are not available yet')}
        >
          Columns
        </Button>
      </div>

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

        {/* From / To */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            label="From"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

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
                label="Min Revenue ($)"
                type="number"
                placeholder="0.00"
                value={minRevenue}
                onChange={(e) => setMinRevenue(e.target.value)}
              />
              <TextField
                label="Max Revenue ($)"
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
                  <TD className="font-medium">{formatDate(r.date)}</TD>
                  <TD>{r.sales}</TD>
                  <TD>{formatMoney(r.revenue)}</TD>
                  <TD>{formatMoney(r.cost)}</TD>
                  <TD>{formatMoney(r.profit)}</TD>
                  <TD>{formatPercent((r.cost / r.revenue) * 100)}</TD>
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
                  <TD className="text-text-muted">{formatDate(r.date)}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
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
            <Button onClick={submitSale} disabled={saving}>
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
            value={saleDate}
            onChange={(e) => setSaleDate(e.target.value)}
          />
        </div>
      </Modal>
    </>
  )
}
