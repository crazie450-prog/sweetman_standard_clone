'use client'

import { cn } from '@/lib/utils/cn'

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  label: string
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-surface-subtle p-1 ring-1 ring-border ring-inset',
        className
      )}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-full font-medium whitespace-nowrap transition-colors',
              size === 'sm' ? 'px-3 py-1 text-[13px]' : 'px-3.5 py-1.5 text-sm',
              active
                ? 'bg-surface font-semibold text-text shadow-sm ring-1 ring-border'
                : 'text-text-muted hover:text-text'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
