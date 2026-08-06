import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'
import { Sparkline } from './Chart'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6', className)}
      {...rest}
    />
  )
}

export type Semantic = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'slate'

const iconBox: Record<Semantic, string> = {
  primary:
    'bg-gradient-to-br from-primary-100 to-primary-50 text-primary-800 dark:from-primary-900/50 dark:to-primary-900/20 dark:text-primary-200',
  success:
    'bg-gradient-to-br from-success-100 to-success-50 text-success-700 dark:from-success-900/50 dark:to-success-900/20 dark:text-success-100',
  warning:
    'bg-gradient-to-br from-warning-100 to-warning-50 text-warning-700 dark:from-warning-900/50 dark:to-warning-900/20 dark:text-warning-100',
  danger:
    'bg-gradient-to-br from-danger-100 to-danger-50 text-danger-700 dark:from-danger-900/50 dark:to-danger-900/20 dark:text-danger-100',
  info: 'bg-gradient-to-br from-info-100 to-info-50 text-info-700 dark:from-info-900/50 dark:to-info-900/20 dark:text-info-100',
  slate: 'bg-surface-subtle text-text-muted dark:bg-slate-800',
}

const DeltaArrow = ({ up }: { up: boolean }) => (
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
    {up ? <path d="M2 8.5 6 4l4 4.5M6 4v0" /> : <path d="M2 3.5 6 8l4-4.5" />}
  </svg>
)

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = 'primary',
  valueClass,
  delta,
  trend,
  trendLive = false,
  className,
  style,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: Semantic
  valueClass?: string
  delta?: { value: string; direction: 'up' | 'down'; negative?: boolean }
  trend?: number[]
  trendLive?: boolean
  className?: string
  style?: CSSProperties
}) {
  return (
    <Card className={cn('lift', className)} style={style}>
      <div className="flex items-center gap-2">
        {icon && (
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-md [&_svg]:size-4',
              iconBox[tone]
            )}
          >
            {icon}
          </span>
        )}
        <p className="truncate text-[13px] font-medium text-text-muted">{label}</p>
      </div>

      <p className={cn('mt-2.5 text-3xl font-bold tracking-tight text-text', valueClass)}>
        {value}
      </p>

      {(delta || hint || trend) && (
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {delta && (
              <span
                className={cn(
                  'flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                  (delta.negative ?? delta.direction === 'down')
                    ? 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-100'
                    : 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200'
                )}
              >
                <DeltaArrow up={delta.direction === 'up'} />
                {delta.value}
              </span>
            )}
            {hint && <span className="text-[13px] text-text-muted">{hint}</span>}
          </div>
          {trend && trend.length > 1 && (
            <Sparkline data={trend} live={trendLive} className="max-w-full shrink" />
          )}
        </div>
      )}
    </Card>
  )
}
