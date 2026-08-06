'use client'

import { useState } from 'react'
import { BarsH, Button, Card, KpiCard, PageHeader, TextField, useToast } from '@/components/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { analyticsService } from '@/lib/api/services'
import { formatMoney, formatPercent } from '@/lib/utils/format'

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
  dollar: I(
    'M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5s2 3 5 3.3 5 1.4 5 3.2-2.2 3.5-5 3.5-5-1.4-5-3.3'
  ),
  clipboard: I(
    'M9 4h6M9 4a2 2 0 0 0-2 2H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1a2 2 0 0 0-2-2'
  ),
  chart: I('M4 20V10M10 20V4M16 20v-7M20 20H3'),
  trend: I('M3 17l6-6 4 4 8-8M15 7h6v6'),
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10)
}

export default function FoodCostAnalysisPage() {
  const { data: costByCategory = [] } = useQuery({
    queryKey: ['cost-by-category'],
    queryFn: analyticsService.costByCategory,
  })
  const { data: wasteBreakdown = [] } = useQuery({
    queryKey: ['waste-breakdown'],
    queryFn: analyticsService.wasteBreakdown,
  })
  const totalWaste = wasteBreakdown.reduce((sum, w) => sum + w.cost, 0)
  const { data: revenueTrend = [] } = useQuery({
    queryKey: ['revenue-trend'],
    queryFn: analyticsService.revenueTrend,
  })
  const toast = useToast()
  const queryClient = useQueryClient()
  const [from, setFrom] = useState(() => toISODate(new Date(Date.now() - 7 * 86400000)))
  const [to, setTo] = useState(() => toISODate(new Date()))

  const inRange = revenueTrend.filter((d) => d.date >= from && d.date <= to)
  const totalSales = inRange.reduce((s, d) => s + d.revenue, 0)
  const actualCost = inRange.reduce((s, d) => s + d.cost, 0)
  const actualPct = totalSales > 0 ? (actualCost / totalSales) * 100 : 0

  return (
    <>
      <PageHeader
        title="Food Cost Analysis"
        subtitle="Track theoretical vs actual food costs to identify profit leaks"
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
            await queryClient.invalidateQueries({ queryKey: ['cost-by-category'] })
            await queryClient.invalidateQueries({ queryKey: ['waste-breakdown'] })
            await queryClient.invalidateQueries({ queryKey: ['revenue-trend'] })
            toast('success', 'Food cost data refreshed')
          }}
        >
          Refresh
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Sales"
          value={formatMoney(totalSales)}
          hint={`${inRange.length} day${inRange.length === 1 ? '' : 's'} in range`}
          tone="primary"
          icon={icons.dollar}
        />
        <KpiCard
          label="Theoretical Cost"
          value="—"
          hint="Not available yet"
          tone="info"
          icon={icons.clipboard}
        />
        <KpiCard
          label="Actual Cost"
          value={formatPercent(actualPct)}
          hint={formatMoney(actualCost)}
          tone="warning"
          icon={icons.chart}
        />
        <KpiCard
          label="Variance"
          value="—"
          hint="needs theoretical cost"
          tone="slate"
          icon={icons.trend}
        />
      </div>

      <div className="mb-6 rounded-lg border-l-4 border-info bg-info-100 p-4 text-info-700 dark:bg-info-900/40 dark:text-info-100">
        <p className="font-semibold">Variance analysis arrives with the costing engine</p>
        <p className="mt-1 text-sm">
          Actual cost above is calculated from recorded sales. Theoretical cost — what the food
          should have cost according to recipes and portions — is not available yet, and neither is
          the variance between them.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="section-title mb-5 text-base font-semibold">Actual Cost by Category</h2>
          <BarsH
            data={costByCategory.map((row) => ({ label: row.category, value: row.cost }))}
            format="money"
          />
        </Card>

        <Card>
          <h2 className="section-title mb-4 text-base font-semibold">Waste Analysis</h2>
          <p className="text-3xl font-bold text-danger-700 dark:text-danger-100">
            {formatMoney(totalWaste)}
          </p>
          <p className="mb-5 text-xs text-text-muted">Total Waste Cost</p>
          <BarsH
            data={wasteBreakdown.map((row) => ({ label: row.reason, value: row.cost }))}
            format="money"
          />
        </Card>
      </div>

      <Card>
        <h2 className="section-title mb-4 text-base font-semibold">
          Understanding Food Cost Variance
        </h2>
        <div className="space-y-3 text-sm text-text-muted">
          <p>
            <strong className="text-text">Theoretical Food Cost</strong> — what your food should
            cost based on recipe ingredients and portions for everything you sold.
          </p>
          <p>
            <strong className="text-text">Actual Food Cost</strong> — what you really spent,
            calculated from invoices, inventory changes, and recorded waste for the period.
          </p>
          <p>
            <strong className="text-text">Variance</strong> — the gap between the two. It usually
            comes from over-portioning, spoilage, prep waste, theft, or unrecorded transfers.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Under 2% — excellent cost control</li>
            <li>2–5% — acceptable, but worth monitoring</li>
            <li>Over 5% — investigate portioning, waste, and receiving practices</li>
          </ul>
        </div>
      </Card>
    </>
  )
}
