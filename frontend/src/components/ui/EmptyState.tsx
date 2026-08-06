import type { ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  hint?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-2 overflow-hidden py-14 text-center',
        className
      )}
    >
      <span
        className="blob -top-8 left-[18%] size-36 bg-primary-100/50 dark:bg-primary-900/20"
        aria-hidden
      />
      <span
        className="blob right-[14%] -bottom-10 size-32 bg-info-100/40 dark:bg-info-900/15"
        aria-hidden
      />
      {icon && (
        <div className="relative mb-1 flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 [&>svg]:size-6">
          {icon}
        </div>
      )}
      <p className="relative text-[15px] font-semibold">{title}</p>
      {hint && <p className="relative max-w-sm text-[13px] text-text-muted">{hint}</p>}
      {action && <div className="relative mt-2">{action}</div>}
    </div>
  )
}
