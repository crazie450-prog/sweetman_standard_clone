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
  BackwardsPeriod,
  Icon,
  PAGE_SIZE,
  Pager,
  usePageOffset,
} from '@/components/ui'
import type { IconName } from '@/components/ui'
import { useQuery } from '@tanstack/react-query'
import { type InventoryTransaction } from '@/lib/api/services'
import { lastDays, endsBeforeBegins } from '@/lib/utils/date-range'

type TxType = InventoryTransaction['type']
import {
  formatChange,
  formatDate,
  formatDayShort,
  formatMoney,
  formatPercent,
} from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'
import { queries } from '@/lib/api/queries'

/* ---------- Icons ---------- */

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
  counted: {
    label: 'Counted',
    plate: 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-600',
    icon: 'M9 11l3 3 8-8M4 12a8 8 0 1 0 16 0',
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

const TAB_ICON: Record<Tab, IconName> = {
  'Inventory History': 'bars',
  'Usage Over Time': 'clock',
  'Production History': 'dollar',
  'Price Trends': 'trend',
}

const RANGE_AWARE_TABS: Tab[] = ['Inventory History', 'Usage Over Time', 'Production History']

export default function ReportsPage() {
  const { data: PRICE_ROWS = [] } = useQuery(queries.priceTrends())
  const [applied, setApplied] = useState(() => lastDays(30))
  const [from, setFrom] = useState(applied.from)
  const [to, setTo] = useState(applied.to)
  const backwards = endsBeforeBegins(applied)
  const [txOffset, setTxOffset] = usePageOffset(applied.from, applied.to)
  const [batchOffset, setBatchOffset] = usePageOffset(applied.from, applied.to)
  const { data: txPage } = useQuery({
    ...queries.inventoryTransactions({ ...applied, offset: txOffset, limit: PAGE_SIZE }),
    enabled: !backwards,
  })
  const { data: txSummary } = useQuery({
    ...queries.inventoryTransactionsSummary(applied),
    enabled: !backwards,
  })
  const { data: USAGE_ROWS = [] } = useQuery({
    ...queries.inventoryUsage(applied),
    enabled: !backwards,
  })
  const { data: batchPage } = useQuery({
    ...queries.production({ ...applied, offset: batchOffset, limit: PAGE_SIZE }),
    enabled: !backwards,
  })
  const { data: prodSummary } = useQuery({
    ...queries.productionSummary(applied),
    enabled: !backwards,
  })
  const [tab, setTab] = useState<Tab>('Inventory History')

  const usageStats = useMemo(() => {
    const total = USAGE_ROWS.reduce((s, r) => s + r.cost, 0)
    const weeks = new Set(USAGE_ROWS.map((r) => r.period))
    const byWeek = new Map<string, number>()
    for (const r of USAGE_ROWS) byWeek.set(r.period, (byWeek.get(r.period) ?? 0) + r.cost)
    const peak = [...byWeek.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    return {
      total,
      ingredients: new Set(USAGE_ROWS.map((r) => r.ingredient)).size,
      avgWeek: weeks.size ? total / weeks.size : 0,
      peak,
    }
  }, [USAGE_ROWS])

  const productionRows = batchPage?.data ?? []
  const prodStats = {
    batches: prodSummary?.batches ?? 0,
    total: prodSummary?.cost ?? 0,
    avg: prodSummary?.average ?? 0,
    recipes: prodSummary?.recipes ?? 0,
  }

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

  const transactions = txPage?.data ?? []
  const totals = {
    received: txSummary?.received ?? 0,
    used: txSummary?.used ?? 0,
    wasted: txSummary?.wasted ?? 0,
    net: txSummary?.net ?? 0,
  }

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
          <BackwardsPeriod from={applied.from} to={applied.to} className="mt-2" />
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
            <Icon name={TAB_ICON[t]} className="size-4" />
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
              icon={<Icon name="received" />}
            />
            <KpiCard
              label="Total Used"
              value={formatMoney(totals.used)}
              tone="info"
              icon={<Icon name="activity" />}
            />
            <KpiCard
              label="Total Wasted"
              value={formatMoney(totals.wasted)}
              tone="danger"
              icon={<Icon name="trash" />}
            />
            <KpiCard
              label="Net Change"
              value={formatMoney(totals.net)}
              tone={totals.net >= 0 ? 'success' : 'danger'}
              icon={<Icon name="trend" />}
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
                        {t.type === 'counted' && t.quantity > 0 ? '+' : ''}
                        {t.quantity} {t.unit}
                      </TD>
                      <TD className="text-right whitespace-nowrap">{formatMoney(t.cost)}</TD>
                      <TD className="text-text-muted">{t.notes}</TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
            <Pager page={txPage?.pagination} onOffset={setTxOffset} label="Transaction pages" />
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
              icon={<Icon name="dollar" />}
            />
            <KpiCard
              label="Ingredients Tracked"
              value={usageStats.ingredients}
              tone="primary"
              icon={<Icon name="box" />}
            />
            <KpiCard
              label="Avg Weekly Cost"
              value={formatMoney(usageStats.avgWeek)}
              tone="success"
              icon={<Icon name="calendar" />}
            />
            <KpiCard
              label="Peak Week"
              value={usageStats.peak ? `Week of ${formatDayShort(usageStats.peak)}` : '—'}
              tone="warning"
              icon={<Icon name="trend" />}
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
                {USAGE_ROWS.length === 0 && (
                  <TableEmpty colSpan={5}>No usage recorded in the selected date range.</TableEmpty>
                )}
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
              value={prodStats.batches}
              tone="primary"
              icon={<Icon name="box" />}
            />
            <KpiCard
              label="Recipes Produced"
              value={prodStats.recipes}
              tone="info"
              icon={<Icon name="activity" />}
            />
            <KpiCard
              label="Production Cost"
              value={formatMoney(prodStats.total)}
              tone="success"
              icon={<Icon name="dollar" />}
            />
            <KpiCard
              label="Avg Cost / Batch"
              value={formatMoney(prodStats.avg)}
              tone="warning"
              icon={<Icon name="bars" />}
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
            <Pager page={batchPage?.pagination} onOffset={setBatchOffset} label="Batch pages" />
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
              icon={<Icon name="box" />}
            />
            <KpiCard
              label="Prices Increased"
              value={priceStats.up}
              tone="danger"
              icon={<Icon name="trend" />}
            />
            <KpiCard
              label="Prices Decreased"
              value={priceStats.down}
              tone="success"
              icon={<Icon name="trendDown" />}
            />
            <KpiCard
              label="Avg Change"
              value={formatPercent(priceStats.avgChange)}
              tone="info"
              icon={<Icon name="percent" />}
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
                {PRICE_ROWS.length === 0 && (
                  <TableEmpty colSpan={5}>No price has been recorded yet.</TableEmpty>
                )}
                {PRICE_ROWS.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium">{r.ingredient}</TD>
                    <TD className="text-text-muted">{r.vendor}</TD>
                    <TD className="text-right whitespace-nowrap">{formatMoney(r.previous)}</TD>
                    <TD className="text-right whitespace-nowrap">{formatMoney(r.current)}</TD>
                    <TD className="text-right whitespace-nowrap">
                      <Badge tone={r.change > 0 ? 'danger' : 'success'}>
                        {formatChange(r.change)}
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
