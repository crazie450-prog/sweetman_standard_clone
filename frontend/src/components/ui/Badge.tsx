import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils/cn'
import type { Semantic } from './Card'

const tones: Record<Semantic | 'neutral', string> = {
  neutral: 'bg-surface-subtle text-text-muted border border-border dark:bg-slate-800',
  primary: 'bg-primary-50 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200',
  success: 'bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-100',
  warning: 'bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-100',
  danger: 'bg-danger-50 text-danger-700 dark:bg-danger-900/30 dark:text-danger-100',
  info: 'bg-info-50 text-info-700 dark:bg-info-900/30 dark:text-info-100',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}

function StatusDot({ pulse = false }: { pulse?: boolean }) {
  if (!pulse) return <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
  return (
    <span className="relative flex size-1.5 shrink-0" aria-hidden>
      <span className="status-ping absolute inset-0 rounded-full bg-current" />
      <span className="relative size-1.5 rounded-full bg-current" />
    </span>
  )
}

export function Badge({
  tone = 'neutral',
  dot = false,
  pulse = false,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: keyof typeof tones
  dot?: boolean
  pulse?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium whitespace-nowrap',
        tones[tone],
        className
      )}
      {...rest}
    >
      {(dot || pulse) && <StatusDot pulse={pulse} />}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  )
}

export type DocumentStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'confirmed'
  | 'failed'
  | 'requires_review'
  | 'partially_processed'

const statusMap: Record<DocumentStatus, { label: string; tone: keyof typeof tones }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  processing: { label: 'Processing', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  requires_review: { label: 'Requires Review', tone: 'warning' },
  partially_processed: { label: 'Partially Processed', tone: 'warning' },
}

export function StatusBadge({ status, className }: { status: DocumentStatus; className?: string }) {
  const { label, tone } = statusMap[status]
  return (
    <Badge tone={tone} dot pulse={status === 'processing'} className={className}>
      {label}
    </Badge>
  )
}
