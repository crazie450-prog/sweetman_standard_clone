'use client'

import { useState } from 'react'
import {
  BarsH,
  Button,
  Card,
  KpiCard,
  PageHeader,
  TextField,
  useToast,
  BackwardsPeriod,
  Icon,
} from '@/components/ui'
import { useQuery } from '@tanstack/react-query'
import { formatMoney, formatPercent } from '@/lib/utils/format'
import { percentOf } from '@/lib/utils/money'
import { lastDays, endsBeforeBegins } from '@/lib/utils/date-range'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

export default function FoodCostAnalysisPage() {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [from, setFrom] = useState(() => lastDays(7).from)
  const [to, setTo] = useState(() => lastDays(7).to)

  const backwards = endsBeforeBegins({ from, to })

  const { data: salesByDay = [] } = useQuery({
    ...queries.salesDaily(from, to),
    enabled: !backwards,
  })

  const { data: variance } = useQuery({
    ...queries.foodCostVariance(from, to),
    enabled: !backwards,
  })

  const { data: wasteRows = [] } = useQuery({
    ...queries.wasteBreakdown(from, to),
    enabled: !backwards,
  })
  const wasteBreakdown = backwards ? [] : wasteRows
  const totalWaste = wasteBreakdown.reduce((sum, w) => sum + w.cost, 0)

  const shown = backwards ? undefined : variance
  const inRange = backwards
    ? []
    : salesByDay.filter((d) => (!from || d.date >= from) && (!to || d.date <= to))
  const totalSales = inRange.reduce((s, d) => s + d.revenue, 0)
  const actualPct = shown ? percentOf(shown.actualCost, totalSales) : null

  return (
    <>
      <PageHeader
        title="Food Cost Analysis"
        subtitle="Track theoretical vs actual food costs, both on the organization's shared ingredient prices"
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">Date Range:</span>
        <TextField
          label="From date"
          hideLabel
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="w-40"
        />
        <span className="text-sm text-text-muted">to</span>
        <TextField
          label="To date"
          hideLabel
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="w-40"
        />
        <Button
          variant="secondary"
          onClick={async () => {
            await invalidate('reports')
            toast('success', 'Food cost data refreshed')
          }}
        >
          Refresh
        </Button>
      </div>

      <BackwardsPeriod from={from} to={to} className="mb-6" />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Sales"
          value={formatMoney(totalSales)}
          hint={`${inRange.length} day${inRange.length === 1 ? '' : 's'} in range`}
          tone="primary"
          icon={<Icon name="dollar" />}
        />
        <KpiCard
          label="Theoretical Cost"
          value={shown ? formatMoney(shown.theoreticalCost) : '—'}
          hint="Implied by recipes and sales"
          tone="info"
          icon={<Icon name="clipboard" />}
        />
        <KpiCard
          label="Actual Cost"
          value={shown ? formatMoney(shown.actualCost) : '—'}
          hint={
            actualPct === null ? 'Recorded usage and waste' : `${formatPercent(actualPct)} of sales`
          }
          tone="warning"
          icon={<Icon name="chart" />}
        />
        <KpiCard
          label="Variance"
          value={shown ? formatMoney(shown.variance) : '—'}
          hint={
            shown && shown.variancePct !== null
              ? `${formatPercent(shown.variancePct)} vs theoretical · ${formatMoney(shown.wasteCost)} wasted`
              : 'actual − theoretical'
          }
          tone={shown && shown.variance > 0 ? 'danger' : 'slate'}
          icon={<Icon name="trend" />}
        />
      </div>

      <Card className="mb-6">
        <h2 className="section-title mb-4 text-base font-semibold">Variance by Category</h2>
        {shown && shown.byCategory.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="whitespace-nowrap px-2 pb-2 font-medium">Category</th>
                  <th className="whitespace-nowrap px-2 pb-2 text-right font-medium">
                    Theoretical
                  </th>
                  <th className="whitespace-nowrap px-2 pb-2 text-right font-medium">Actual</th>
                  <th className="whitespace-nowrap px-2 pb-2 text-right font-medium">Variance</th>
                </tr>
              </thead>
              <tbody>
                {shown.byCategory.map((row) => (
                  <tr key={row.category} className="border-t border-border">
                    <td className="whitespace-nowrap px-2 py-2">{row.category}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {formatMoney(row.theoretical)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {formatMoney(row.actual)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-2 py-2 text-right font-medium ${row.variance > 0 ? 'text-danger-700 dark:text-danger-100' : 'text-success-700 dark:text-success-100'}`}
                    >
                      {formatMoney(row.variance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            No sales or inventory movement in this range, so there is nothing to compare yet.
          </p>
        )}
      </Card>

      <Card className="mb-6">
        <h2 className="section-title mb-1 text-base font-semibold">Variance by Dish</h2>
        <p className="mb-4 text-[13px] text-text-muted">
          Standard cost is what the recipes say a dish should cost. Actual cost and waste are
          recorded per ingredient, so each dish carries the share its recipes account for.
        </p>
        {shown && shown.byDish.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="whitespace-nowrap px-2 pb-2 font-medium">Dish</th>
                  <th className="whitespace-nowrap px-2 pb-2 text-right font-medium">Sold</th>
                  <th className="whitespace-nowrap px-2 pb-2 text-right font-medium">Standard</th>
                  <th className="whitespace-nowrap px-2 pb-2 text-right font-medium">Actual</th>
                  <th className="whitespace-nowrap px-2 pb-2 text-right font-medium">Waste</th>
                  <th className="whitespace-nowrap px-2 pb-2 text-right font-medium">Variance</th>
                </tr>
              </thead>
              <tbody>
                {shown.byDish.map((row) => (
                  <tr key={row.menuItemId} className="border-t border-border">
                    <td className="whitespace-nowrap px-2 py-2">{row.name}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                      {row.quantity}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {formatMoney(row.standardCost)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {formatMoney(row.actualCost)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {formatMoney(row.wasteCost)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-2 py-2 text-right font-medium ${row.variance > 0 ? 'text-danger-700 dark:text-danger-100' : 'text-success-700 dark:text-success-100'}`}
                    >
                      {formatMoney(row.variance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            Nothing was sold in this range, so no dish has a cost to compare yet.
          </p>
        )}
      </Card>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="section-title mb-5 text-base font-semibold">Actual Cost by Category</h2>
          {shown && shown.byCategory.some((row) => row.actual > 0) ? (
            <BarsH
              data={shown.byCategory
                .filter((row) => row.actual > 0)
                .map((row) => ({ label: row.category, value: row.actual }))}
              format="money"
            />
          ) : (
            <p className="text-sm text-text-muted">No usage or waste was recorded in this range.</p>
          )}
        </Card>

        <Card>
          <h2 className="section-title mb-4 text-base font-semibold">Waste Analysis</h2>
          <p className="text-3xl font-bold text-danger-700 dark:text-danger-100">
            {formatMoney(totalWaste)}
          </p>
          <p className="mb-5 text-xs text-text-muted">Total Waste Cost</p>
          {wasteBreakdown.length > 0 ? (
            <BarsH
              data={wasteBreakdown.map((row) => ({ label: row.reason, value: row.cost }))}
              format="money"
            />
          ) : (
            <p className="text-sm text-text-muted">No waste was recorded in this range.</p>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="section-title mb-4 text-base font-semibold">
          Understanding Food Cost Variance
        </h2>
        <div className="space-y-3 text-sm text-text-muted">
          <p>
            <strong className="text-text">Theoretical Food Cost</strong>: what your food should cost
            based on recipe ingredients and portions for everything you sold.
          </p>
          <p>
            <strong className="text-text">Actual Food Cost</strong>: the ingredients recorded as
            used or wasted in the period, valued at what they cost when they were recorded.
          </p>
          <p>
            <strong className="text-text">Variance</strong>: the gap between the two. It usually
            comes from over-portioning, spoilage, prep waste, theft, or unrecorded transfers.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Under 2%: excellent cost control</li>
            <li>2 to 5%: acceptable, but worth monitoring</li>
            <li>Over 5%: investigate portioning, waste, and receiving practices</li>
          </ul>
        </div>
      </Card>
    </>
  )
}
