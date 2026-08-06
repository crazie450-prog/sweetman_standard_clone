'use client'

import { useMemo, useState } from 'react'
import {
  Badge,
  Card,
  EmptyState,
  KpiCard,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableEmpty,
  TextField,
} from '@/components/ui'
import { useQuery } from '@tanstack/react-query'
import { inventoryService, productionService, type InventoryTransaction } from '@/lib/api/services'
import { lastDays } from '@/lib/utils/date-range'

type TxType = InventoryTransaction['type']
import { formatDate, formatDayShort, formatMoney, formatPercent } from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'

/* ---------- Icons ---------- */

const I = (d: string, className = 'size-6') => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    <path d={d} />
  </svg>
)

const ICON = {
  received: 'M12 3v12m-4-4l4 4 4-4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m1 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
  trendingUp: 'M3 17l6-6 4 4 8-8m0 0h-5m5 0v5',
  trendingDown: 'M3 7l6 6 4-4 8 8m0 0h-5m5 0v-5',
  dollar: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  box: 'M20 7l-8-4-8 4v10l8 4 8-4V7zM4 7l8 4 8-4M12 11v10',
  calendar:
    'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  barChart: 'M18 20V10M12 20V4M6 20v-6',
  clock: 'M12 8v4l2.5 2.5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  percent:
    'M19 5L5 19M9 6.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM20 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
} as const

const TX_TYPE: Record<TxType, { label: string; plate: string; icon: string }> = {
  received: {
    label: 'Received',
    plate: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-600',
    icon: 'M12 4v12m-5-5 5 5 5-5',
  },
  used: {
    label: 'Used',
    plate: 'bg-info-100 text-info-700 dark:bg-info-900/40 dark:text-info-600',
    icon: 'M4 12h12m-5-5 5 5-5 5',
  },
  wasted: {
    label: 'Wasted',
    plate: 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-600',
    icon: 'm6 6 12 12M18 6 6 18',
  },
}

function TxTypeCell({ type }: { type: TxType }) {
  const t = TX_TYPE[type] ?? {
    label: String(type),
    plate: 'bg-surface-subtle text-text-muted',
    icon: 'M5 12h14',
  }
  return (
    <span className="flex items-center gap-2">
      <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md', t.plate)}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3.5"
          aria-hidden
        >
          <path d={t.icon} />
        </svg>
      </span>
      <span className="text-sm font-medium">{t.label}</span>
    </span>
  )
}

/* ---------- Tabs ---------- */

const TABS = ['Inventory History', 'Usage Over Time', 'Production History', 'Price Trends'] as const
type Tab = (typeof TABS)[number]

const TAB_ICON: Record<Tab, string> = {
  'Inventory History': ICON.barChart,
  'Usage Over Time': ICON.clock,
  'Production History': ICON.dollar,
  'Price Trends': ICON.trendingUp,
}

const RANGE_AWARE_TABS: Tab[] = ['Inventory History', 'Production History']

const DEFAULT_RANGE = lastDays(30)

export default function ReportsPage() {
  const { data: TRANSACTIONS = [] } = useQuery({
    queryKey: ['inventory-transactions'],
    queryFn: inventoryService.transactions,
  })
  const { data: USAGE_ROWS = [] } = useQuery({
    queryKey: ['inventory-usage'],
    queryFn: inventoryService.usage,
  })
  const { data: PRICE_ROWS = [] } = useQuery({
    queryKey: ['price-trends'],
    queryFn: inventoryService.priceTrends,
  })
  const { data: batches = [] } = useQuery({
    queryKey: ['production'],
    queryFn: productionService.batches,
  })
  const [from, setFrom] = useState(DEFAULT_RANGE.from)
  const [to, setTo] = useState(DEFAULT_RANGE.to)
  const [applied, setApplied] = useState(DEFAULT_RANGE)
  const [tab, setTab] = useState<Tab>('Inventory History')

  const usageStats = useMemo(() => {
    const total = USAGE_ROWS.reduce((s, r) => s + r.cost, 0)
    const weeks = new Set(USAGE_ROWS.map((r) => r.period))
    const byWeek = new Map<string, number>()
    for (const r of USAGE_ROWS) byWeek.set(r.period, (byWeek.get(r.period) ?? 0) + r.cost)
    const peak = [...byWeek.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    return {
      total,
      ingredients: new Set(USAGE_ROWS.map((r) => r.ingredient)).size,
      avgWeek: weeks.size ? total / weeks.size : 0,
      peak,
    }
  }, [USAGE_ROWS])

  const productionRows = useMemo(
    () =>
      batches.filter((b) => {
        const day = b.date.slice(0, 10)
        return (!applied.from || day >= applied.from) && (!applied.to || day <= applied.to)
      }),
    [batches, applied]
  )

  const prodStats = useMemo(() => {
    const total = productionRows.reduce((s, b) => s + b.cost, 0)
    return {
      total,
      avg: productionRows.length ? total / productionRows.length : 0,
      recipes: new Set(productionRows.map((b) => b.recipe)).size,
    }
  }, [productionRows])

  const priceStats = useMemo(
    () => ({
      tracked: PRICE_ROWS.length,
      up: PRICE_ROWS.filter((r) => r.change > 0).length,
      down: PRICE_ROWS.filter((r) => r.change < 0).length,
      avgChange: PRICE_ROWS.length
        ? PRICE_ROWS.reduce((s, r) => s + r.change, 0) / PRICE_ROWS.length
        : 0,
    }),
    [PRICE_ROWS]
  )

  const transactions = useMemo(
    () =>
      TRANSACTIONS.filter((t) => {
        const day = t.date.slice(0, 10)
        return (!applied.from || day >= applied.from) && (!applied.to || day <= applied.to)
      }),
    [TRANSACTIONS, applied]
  )

  const totals = useMemo(() => {
    const sum = (type: TxType) =>
      transactions.filter((t) => t.type === type).reduce((acc, t) => acc + t.cost, 0)
    const received = sum('received')
    const used = sum('used')
    const wasted = sum('wasted')
    return { received, used, wasted, net: received - used - wasted }
  }, [transactions])

  return (
    <>
      <PageHeader
        title="Comprehensive Reports & Analytics"
        subtitle="Deep insights into inventory, production, and price trends"
      />

      {RANGE_AWARE_TABS.includes(tab) && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-end gap-3">
            <span className="pb-2 text-sm font-semibold">Date Range:</span>
            <TextField
              label="From"
              hideLabel
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value)
                setApplied({ from: e.target.value, to })
              }}
              className="w-44"
            />
            <span className="pb-2 text-sm text-text-muted">to</span>
            <TextField
              label="To"
              hideLabel
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value)
                setApplied({ from, to: e.target.value })
              }}
              className="w-44"
            />
          </div>
        </Card>
      )}

      <div
        className="mb-6 flex flex-wrap gap-1 border-b border-border"
        role="tablist"
        aria-label="Report tabs"
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'inline-flex items-center gap-2 rounded-t-md border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              tab === t
                ? 'border-primary-600 bg-surface text-primary-700 dark:text-primary-300'
                : 'border-transparent text-text-muted hover:text-text'
            )}
          >
            {I(TAB_ICON[t], 'size-4')}
            {t}
          </button>
        ))}
      </div>

      {tab === 'Inventory History' && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Total Received"
              value={formatMoney(totals.received)}
              tone="success"
              icon={I(ICON.received)}
            />
            <KpiCard
              label="Total Used"
              value={formatMoney(totals.used)}
              tone="info"
              icon={I(ICON.activity)}
            />
            <KpiCard
              label="Total Wasted"
              value={formatMoney(totals.wasted)}
              tone="danger"
              icon={I(ICON.trash)}
            />
            <KpiCard
              label="Net Change"
              value={formatMoney(totals.net)}
              tone={totals.net >= 0 ? 'success' : 'danger'}
              icon={I(ICON.trendingUp)}
            />
          </div>
          <Card className="mt-6">
            <h2 className="section-title mb-4 text-base font-semibold text-text">
              Transaction History
            </h2>
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Type</TH>
                  <TH>Ingredient</TH>
                  <TH>Category</TH>
                  <TH className="text-right">Quantity</TH>
                  <TH className="text-right">Cost</TH>
                  <TH>Notes</TH>
                </TR>
              </THead>
              <TBody>
                {transactions.length === 0 ? (
                  <TableEmpty colSpan={7}>No transactions in the selected date range.</TableEmpty>
                ) : (
                  transactions.map((t) => (
                    <TR key={t.id}>
                      <TD className="whitespace-nowrap">{formatDate(t.date)}</TD>
                      <TD>
                        <TxTypeCell type={t.type} />
                      </TD>
                      <TD className="font-medium">{t.ingredient}</TD>
                      <TD className="text-text-muted">{t.category}</TD>
                      <TD className="text-right whitespace-nowrap">
                        {t.quantity} {t.unit}
                      </TD>
                      <TD className="text-right whitespace-nowrap">{formatMoney(t.cost)}</TD>
                      <TD className="text-text-muted">{t.notes}</TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </Card>
        </>
      )}

      {tab === 'Usage Over Time' && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Total Usage Cost"
              value={formatMoney(usageStats.total)}
              tone="info"
              icon={I(ICON.dollar)}
            />
            <KpiCard
              label="Ingredients Tracked"
              value={usageStats.ingredients}
              tone="primary"
              icon={I(ICON.box)}
            />
            <KpiCard
              label="Avg Weekly Cost"
              value={formatMoney(usageStats.avgWeek)}
              tone="success"
              icon={I(ICON.calendar)}
            />
            <KpiCard
              label="Peak Week"
              value={usageStats.peak}
              tone="warning"
              icon={I(ICON.trendingUp)}
            />
          </div>
          <Card className="mt-6">
            <h2 className="section-title mb-4 text-base font-semibold text-text">
              Usage Over Time
            </h2>
            <Table>
              <THead>
                <TR>
                  <TH>Period</TH>
                  <TH>Ingredient</TH>
                  <TH>Category</TH>
                  <TH className="text-right">Used</TH>
                  <TH className="text-right">Cost</TH>
                </TR>
              </THead>
              <TBody>
                {USAGE_ROWS.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap">Week of {formatDayShort(r.period)}</TD>
                    <TD className="font-medium">{r.ingredient}</TD>
                    <TD className="text-text-muted">{r.category}</TD>
                    <TD className="text-right whitespace-nowrap">
                      {r.used} {r.unit}
                    </TD>
                    <TD className="text-right whitespace-nowrap">{formatMoney(r.cost)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </>
      )}

      {tab === 'Production History' && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Batches Produced"
              value={productionRows.length}
              tone="primary"
              icon={I(ICON.box)}
            />
            <KpiCard
              label="Recipes Produced"
              value={prodStats.recipes}
              tone="info"
              icon={I(ICON.activity)}
            />
            <KpiCard
              label="Production Cost"
              value={formatMoney(prodStats.total)}
              tone="success"
              icon={I(ICON.dollar)}
            />
            <KpiCard
              label="Avg Cost / Batch"
              value={formatMoney(prodStats.avg)}
              tone="warning"
              icon={I(ICON.barChart)}
            />
          </div>
          <Card className="mt-6">
            <h2 className="section-title mb-4 text-base font-semibold text-text">
              Production History
            </h2>
            {productionRows.length === 0 ? (
              <EmptyState
                title="No production records"
                hint="Production batches will appear here once recipes are produced within the selected date range."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Recipe</TH>
                    <TH>Quantity</TH>
                    <TH>Made by</TH>
                    <TH className="text-right">Cost</TH>
                  </TR>
                </THead>
                <TBody>
                  {productionRows.map((b) => (
                    <TR key={b.id}>
                      <TD className="whitespace-nowrap">{formatDate(b.date)}</TD>
                      <TD className="font-medium">{b.recipe}</TD>
                      <TD className="whitespace-nowrap">{b.qty}</TD>
                      <TD className="text-text-muted">{b.madeBy}</TD>
                      <TD className="text-right whitespace-nowrap">{formatMoney(b.cost)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </>
      )}

      {tab === 'Price Trends' && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Ingredients Tracked"
              value={priceStats.tracked}
              tone="primary"
              icon={I(ICON.box)}
            />
            <KpiCard
              label="Prices Increased"
              value={priceStats.up}
              tone="danger"
              icon={I(ICON.trendingUp)}
            />
            <KpiCard
              label="Prices Decreased"
              value={priceStats.down}
              tone="success"
              icon={I(ICON.trendingDown)}
            />
            <KpiCard
              label="Avg Change"
              value={formatPercent(priceStats.avgChange)}
              tone="info"
              icon={I(ICON.percent)}
            />
          </div>
          <Card className="mt-6">
            <h2 className="section-title mb-4 text-base font-semibold text-text">Price Trends</h2>
            <Table>
              <THead>
                <TR>
                  <TH>Ingredient</TH>
                  <TH>Vendor</TH>
                  <TH className="text-right">Previous Price</TH>
                  <TH className="text-right">Current Price</TH>
                  <TH className="text-right">Change</TH>
                </TR>
              </THead>
              <TBody>
                {PRICE_ROWS.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium">{r.ingredient}</TD>
                    <TD className="text-text-muted">{r.vendor}</TD>
                    <TD className="text-right whitespace-nowrap">{formatMoney(r.previous)}</TD>
                    <TD className="text-right whitespace-nowrap">{formatMoney(r.current)}</TD>
                    <TD className="text-right whitespace-nowrap">
                      <Badge tone={r.change > 0 ? 'danger' : 'success'}>
                        {r.change > 0 ? '+' : ''}
                        {formatPercent(r.change)}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </>
      )}
    </>
  )
}
