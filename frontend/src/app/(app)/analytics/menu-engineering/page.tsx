'use client'

import { Card, EmptyState, PageHeader } from '@/components/ui'

const quadrants = [
  {
    name: 'Stars',
    desc: 'High profit · high popularity — promote them',
    dot: 'bg-success',
    tint: 'bg-success-50 ring-success-100 dark:bg-success-900/15 dark:ring-success-900/30',
  },
  {
    name: 'Plow Horses',
    desc: 'Low profit · high popularity — rework cost',
    dot: 'bg-warning',
    tint: 'bg-warning-50 ring-warning-100 dark:bg-warning-900/15 dark:ring-warning-900/30',
  },
  {
    name: 'Puzzles',
    desc: 'High profit · low popularity — reposition on menu',
    dot: 'bg-info',
    tint: 'bg-info-50 ring-info-100 dark:bg-info-900/15 dark:ring-info-900/30',
  },
  {
    name: 'Dogs',
    desc: 'Low profit · low popularity — consider removing',
    dot: 'bg-danger',
    tint: 'bg-danger-50 ring-danger-100 dark:bg-danger-900/15 dark:ring-danger-900/30',
  },
]

export default function MenuEngineeringPage() {
  return (
    <>
      <PageHeader
        title="Menu Engineering Analysis"
        subtitle="Strategic performance analysis of your menu items based on profitability and popularity."
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {quadrants.map((q) => (
          <Card key={q.name} className={`border-0 ring-1 ${q.tint}`}>
            <div className="flex items-center gap-2">
              <span className={`size-2.5 shrink-0 rounded-full ${q.dot}`} aria-hidden />
              <h2 className="text-lg font-semibold">{q.name}</h2>
            </div>
            <p className="mt-2 text-sm text-text-muted">{q.desc}</p>
          </Card>
        ))}
      </div>

      <Card>
        <EmptyState
          title="Quadrant mapping arrives with the costing engine"
          hint="Sales and item costs are already recorded. What is missing is the analysis that places each item into a quadrant — it is not built yet."
        />
      </Card>
    </>
  )
}
