'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'
import { Button } from './Button'
import { SegmentedControl } from './Segmented'

export const PERIOD_PRESETS = ['Last 7 days', 'Last 30 days', 'Last 90 days'] as const
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]

export function FilterBar({
  preset,
  onPreset,
  children,
  onClear,
  className,
}: {
  preset?: PeriodPreset
  onPreset?: (p: PeriodPreset) => void
  children?: ReactNode
  onClear?: () => void
  className?: string
}) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-center gap-2', className)}>
      {onPreset && preset && (
        <SegmentedControl
          label="Period"
          options={PERIOD_PRESETS.map((p) => ({ value: p, label: p }))}
          value={preset}
          onChange={onPreset}
        />
      )}
      {children}
      {onClear && (
        <Button variant="ghost" size="sm" onClick={onClear} className="ml-auto">
          Clear Filters
        </Button>
      )}
    </div>
  )
}
