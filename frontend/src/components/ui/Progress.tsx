import { cn } from '@/lib/utils/cn'
import type { Semantic } from './Card'

const barTone: Record<Semantic, string> = {
  primary: 'bg-primary-500',
  success: 'bg-success',
  warning: 'bg-warning-600',
  danger: 'bg-danger-600',
  info: 'bg-info',
  slate: 'bg-border-strong',
}

const trackSize = { sm: 'h-1', md: 'h-1.5' } as const

export function Progress({
  value = 0,
  target,
  tone = 'primary',
  size = 'md',
  animate = true,
  indeterminate = false,
  label,
  className,
}: {
  value?: number
  target?: number
  tone?: Semantic
  size?: keyof typeof trackSize
  animate?: boolean
  indeterminate?: boolean
  label?: string
  className?: string
}) {
  const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0

  const a11y = label
    ? ({
        role: 'progressbar',
        'aria-label': label,
        ...(indeterminate
          ? {}
          : { 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 }),
      } as const)
    : ({ 'aria-hidden': true } as const)

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-full bg-surface-subtle ring-1 ring-border/60 ring-inset',
        trackSize[size],
        className
      )}
      {...a11y}
    >
      {indeterminate ? (
        <span className={cn('progress-slide block h-full w-1/3 rounded-full', barTone[tone])} />
      ) : (
        <span
          className={cn('block h-full rounded-full', animate && 'chart-grow', barTone[tone])}
          style={{ width: `${pct}%` }}
        />
      )}

      {target !== undefined && !indeterminate && (
        <span
          className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-border-strong"
          style={{ left: `${Math.max(0, Math.min(100, target))}%` }}
          aria-hidden
        />
      )}
    </div>
  )
}
