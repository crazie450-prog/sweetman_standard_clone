'use client'

import { useQuery } from '@tanstack/react-query'
import {
  analyticsService,
  dashboardService,
  ingredientsService,
  locationsService,
  menuService,
  organizationService,
  recipesService,
  type ActivityEvent,
} from '@/lib/api/services'
import { getActiveLocationId } from '@/lib/api/active-location'
import { useCurrentUser } from '@/lib/api/useCurrentUser'

import Link from 'next/link'
import { AreaChart, BarsH, Card, CountUp, KpiCard, Skeleton, SkeletonKpiRow } from '@/components/ui'
import { formatDayShort, formatMoneyCompact, formatPercent } from '@/lib/utils/format'

const I = (d: string, sw = 1.8) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-5"
    aria-hidden
  >
    <path d={d} />
  </svg>
)
const icons = {
  dollar: I(
    'M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5s2 3 5 3.3 5 1.4 5 3.2-2.2 3.5-5 3.5-5-1.4-5-3.3'
  ),
  trend: I('M3 17l6-6 4 4 8-8M15 7h6v6'),
  chart: I('M4 20V10M10 20V4M16 20v-7M20 20H3'),
  alert: I('M12 3 2 20h20L12 3zM12 9v5M12 17.5v.5'),
  clipboard: I(
    'M9 4h6M9 4a2 2 0 0 0-2 2H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1a2 2 0 0 0-2-2'
  ),
  book: I('M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2v14', 1.6),
  box: I('M12 3 4 7v10l8 4 8-4V7l-8-4M4 7l8 4 8-4M12 11v10', 1.6),
  clock: I('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 3', 1.6),
}

const activityIcon: Record<ActivityEvent['type'], { icon: React.ReactNode; box: string }> = {
  production: {
    icon: I('M7 3h7l4 4v14H7zM14 3v4h4M10 13h5M10 17h5', 1.6),
    box: 'bg-info-100 text-info-700 dark:bg-info-900/40 dark:text-info-100',
  },
  recipe: {
    icon: icons.book,
    box: 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200',
  },
  waste: {
    icon: I('M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13h8l1-13M10 11v6M14 11v6', 1.6),
    box: 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-100',
  },
  team: {
    icon: I('M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 20c.5-3.5 3.4-5 7-5s6.5 1.5 7 5', 1.6),
    box: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-100',
  },
}

function ago(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d}d ago`
}

function StatInline({
  icon,
  box,
  value,
  label,
  valueClass = 'text-xl',
}: {
  icon: React.ReactNode
  box: string
  value: React.ReactNode
  label: string
  valueClass?: string
}) {
  return (
    <Card className="lift flex items-center gap-3.5 p-4 sm:p-4">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${box}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className={`truncate font-semibold tracking-tight ${valueClass}`}>{value}</p>
        <p className="truncate text-[13px] text-text-muted">{label}</p>
      </div>
    </Card>
  )
}

export default function DashboardView() {
  const { data: kpis } = useQuery({ queryKey: ['dashboard-kpis'], queryFn: dashboardService.kpis })
  const { data: kpiTrends } = useQuery({
    queryKey: ['dashboard-trends'],
    queryFn: dashboardService.trends,
  })
  const { data: currentUser } = useQuery({
    queryKey: ['org-current'],
    queryFn: organizationService.current,
  })
  const { data: ingredients = [] } = useQuery({
    queryKey: ['ingredients'],
    queryFn: ingredientsService.list,
  })
  const { data: recipes = [] } = useQuery({ queryKey: ['recipes'], queryFn: recipesService.list })
  const { data: menuItems = [] } = useQuery({ queryKey: ['menu-items'], queryFn: menuService.list })
  const { data: revenueTrend = [] } = useQuery({
    queryKey: ['revenue-trend'],
    queryFn: analyticsService.revenueTrend,
  })
  const { data: spendByCategory = [] } = useQuery({
    queryKey: ['spend-by-category'],
    queryFn: analyticsService.spendByCategory,
  })
  const { data: activity = [] } = useQuery({
    queryKey: ['dashboard-activity'],
    queryFn: dashboardService.activity,
  })
  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: locationsService.list,
  })
  const { can } = useCurrentUser()

  if (!kpis || !kpiTrends || !currentUser) {
    return (
      <>
        <SkeletonKpiRow />
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </>
    )
  }

  const TREND_WINDOW_DAYS = 30
  const totalRevenue30 = revenueTrend.reduce((s, d) => s + d.revenue, 0)
  const now = new Date()
  const today = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const activeId = getActiveLocationId()
  const activeLocation = activeId
    ? (locations.find((l) => l.id === activeId)?.name ?? currentUser.organization)
    : currentUser.organization

  const delta = (series: number[]) => {
    const [prev, last] = [series.at(-2) ?? 0, series.at(-1) ?? 0]
    if (!prev || !last) return undefined
    const pct = ((last - prev) / prev) * 100
    return {
      value: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
      direction: pct >= 0 ? ('up' as const) : ('down' as const),
    }
  }
  const trendDelta = (() => {
    if (revenueTrend.length < 4) return undefined
    const mid = Math.floor(revenueTrend.length / 2)
    const first = revenueTrend.slice(0, mid).reduce((s, d) => s + d.revenue, 0)
    const second = revenueTrend.slice(mid).reduce((s, d) => s + d.revenue, 0)
    return first > 0 ? ((second - first) / first) * 100 : undefined
  })()

  const revenueDelta = kpis.todayRevenue > 0 ? delta(kpiTrends.revenue) : undefined
  const profitDelta = kpis.todayProfit !== 0 ? delta(kpiTrends.profit) : undefined
  const foodCostDelta = delta(kpiTrends.foodCost)

  return (
    <>
      <div className="hero-dawn relative mb-8 flex flex-wrap items-end justify-between gap-4 overflow-hidden rounded-2xl p-6 shadow-sm ring-1 ring-border sm:p-7">
        <span
          className="blob -top-14 right-24 size-48 bg-primary-200/50 dark:bg-primary-900/30"
          aria-hidden
        />
        <span
          className="blob -right-10 -bottom-20 size-56 bg-info-100/60 dark:bg-info-900/20"
          aria-hidden
        />
        <span
          className="blob -bottom-16 left-1/3 size-40 bg-danger-50 dark:bg-danger-900/10"
          aria-hidden
        />
        <div className="relative">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-text-muted">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              className="size-4 text-warning-600"
              aria-hidden
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
            <span suppressHydrationWarning>{today}</span>
            <span aria-hidden>·</span>
            <span suppressHydrationWarning>{activeLocation}</span>
          </p>
          <h1
            className="mt-1.5 text-2xl font-bold tracking-tight md:text-[27px] md:leading-9"
            suppressHydrationWarning
          >
            {greeting}, {currentUser.name.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Here&apos;s what&apos;s happening in your kitchen today.
          </p>
        </div>
        <div className="relative flex flex-wrap items-center gap-2">
          {can('staff') && (
          <Link
            href="/documents"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border-strong bg-surface px-4 text-sm font-semibold text-text shadow-xs transition-colors hover:border-ink-600 hover:bg-surface-subtle"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4"
              aria-hidden
            >
              <path d="M12 15V3m0 0 4 4m-4-4L8 7M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            Upload invoice
          </Link>
          )}
          {can('staff') && (
          <Link
            href="/recipes/new"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="size-4"
              aria-hidden
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Recipe
          </Link>
          )}
        </div>
      </div>

      <section className="mb-6">
        <h2 className="section-title mb-4 text-base font-semibold">Today&apos;s Performance</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Today's Revenue"
            value={<CountUp value={kpis.todayRevenue} format="money" />}
            tone="primary"
            icon={icons.dollar}
            delta={revenueDelta}
            trend={kpiTrends.revenue}
            trendLive
            className="rise"
            style={{ '--i': 0 } as React.CSSProperties}
          />
          <KpiCard
            label="Today's Profit"
            value={<CountUp value={kpis.todayProfit} format="money" />}
            tone="primary"
            icon={icons.trend}
            delta={profitDelta}
            trend={kpiTrends.profit}
            className="rise"
            style={{ '--i': 1 } as React.CSSProperties}
          />
          <KpiCard
            label="Food Cost % · 30 days"
            value={<CountUp value={kpis.foodCostPct} format="percent" />}
            hint={`target ${formatPercent(kpis.foodCostTarget, 0)}`}
            tone={kpis.foodCostPct > kpis.foodCostTarget ? 'warning' : 'success'}
            icon={icons.chart}
            delta={
              foodCostDelta && { ...foodCostDelta, negative: foodCostDelta.direction === 'up' }
            }
            trend={kpiTrends.foodCost}
            className="rise"
            style={{ '--i': 2 } as React.CSSProperties}
          />
          <KpiCard
            label="Low Stock Alerts"
            value={kpis.lowStockCount}
            hint="items below reorder level"
            tone={kpis.lowStockCount > 0 ? 'danger' : 'slate'}
            icon={icons.alert}
            className="rise"
            style={{ '--i': 3 } as React.CSSProperties}
          />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="section-title mb-4 text-base font-semibold">System Overview</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatInline
            icon={icons.clipboard}
            box="bg-surface-subtle text-text-muted dark:bg-slate-800"
            value={menuItems.length}
            label="Menu Items"
          />
          <StatInline
            icon={icons.book}
            box="bg-info-100 text-info-700 dark:bg-info-900/40 dark:text-info-100"
            value={recipes.length}
            label="Recipes"
          />
          <StatInline
            icon={icons.box}
            box="bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-100"
            value={ingredients.length}
            label="Inventory Items"
          />
          <StatInline
            icon={icons.clock}
            box="bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200"
            value={kpis.recentRecipe ?? '—'}
            label="Recently updated"
            valueClass="text-[15px]"
          />
        </div>
      </section>

      <section className="mb-6 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card className="lift rise xl:col-span-2" style={{ '--i': 4 } as React.CSSProperties}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="section-title text-base font-semibold">Revenue trend</h2>
              <div className="mt-1.5 flex items-center gap-2">
                <p className="text-2xl font-semibold tracking-tight">
                  {formatMoneyCompact(totalRevenue30)}
                </p>
                {trendDelta !== undefined && (
                  <span
                    className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${trendDelta >= 0 ? 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200' : 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-100'}`}
                  >
                    <svg
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="size-3"
                      aria-hidden
                    >
                      <path d={trendDelta >= 0 ? 'M2 8.5 6 4l4 4.5' : 'M2 4 6 8.5 10 4'} />
                    </svg>
                    {trendDelta >= 0 ? '+' : ''}
                    {trendDelta.toFixed(1)}%
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[13px] text-text-muted">
                Last 30 days · vs previous period
              </p>
            </div>
            <div className="flex items-center gap-3">
              <p className="tabular text-[13px] text-text-muted">
                avg{' '}
                {revenueTrend.length
                  ? formatMoneyCompact(totalRevenue30 / TREND_WINDOW_DAYS)
                  : '—'}{' '}
                / day
              </p>
              <Link
                href="/reports"
                aria-label="Open reports"
                className="flex size-9 items-center justify-center rounded-full border border-border text-text-muted transition duration-150 hover:bg-surface-subtle hover:text-text active:scale-95"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-4"
                  aria-hidden
                >
                  <path d="M7 17 17 7M9 7h8v8" />
                </svg>
              </Link>
            </div>
          </div>
          <AreaChart
            data={revenueTrend.map((d) => ({ label: formatDayShort(d.date), value: d.revenue }))}
            format="money"
            height={190}
          />
        </Card>

        <Card className="lift rise" style={{ '--i': 5 } as React.CSSProperties}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="section-title text-base font-semibold">Spend by category</h2>
              <p className="mt-0.5 text-[13px] text-text-muted">Last 30 days</p>
            </div>
            <Link
              href="/analytics/food-cost"
              aria-label="Open food cost analysis"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-text-muted transition duration-150 hover:bg-surface-subtle hover:text-text active:scale-95"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-4"
                aria-hidden
              >
                <path d="M7 17 17 7M9 7h8v8" />
              </svg>
            </Link>
          </div>
          <div className="mb-5" />
          <BarsH
            data={spendByCategory.map((c) => ({ label: c.category, value: c.amount }))}
            format="money"
          />
        </Card>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="section-title text-base font-semibold">Recent Activity</h2>
          <Link
            href="/reports"
            className="flex items-center gap-1 text-[13px] font-semibold text-text-muted transition-colors hover:text-text"
          >
            View all
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5" aria-hidden>
              <path
                fillRule="evenodd"
                d="M7.22 4.22a.75.75 0 011.06 0l5.25 5.25a.75.75 0 010 1.06l-5.25 5.25a.75.75 0 01-1.06-1.06L11.94 10 7.22 5.28a.75.75 0 010-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </Link>
        </div>
        <Card className="p-0 sm:p-0">
          {activity.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-text-muted">
              Nothing has happened yet — log waste, record production or update a recipe.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {activity.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-surface-subtle sm:px-5"
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full ${activityIcon[a.type].box}`}
                  >
                    {activityIcon[a.type].icon}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">{a.text}</span>
                  <span className="shrink-0 text-xs text-text-muted" suppressHydrationWarning>
                    {ago(a.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </>
  )
}
