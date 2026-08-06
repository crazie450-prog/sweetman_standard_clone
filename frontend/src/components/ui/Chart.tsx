'use client'

import { useId, useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { formatMoneyCompact } from '@/lib/utils/format'

export type ValueFormat = 'money' | 'number'

const FORMATTERS: Record<ValueFormat, (v: number) => string> = {
  money: formatMoneyCompact,
  number: (v) => new Intl.NumberFormat('en-US').format(v),
}

const MARK = 'var(--color-primary-500)'

export function Sparkline({
  data,
  live = false,
  className,
  width = 96,
  height = 28,
}: {
  data: number[]
  live?: boolean
  className?: string
  width?: number
  height?: number
}) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const pad = 3
  const x = (i: number) => (i / (data.length - 1)) * (width - pad * 2) + pad
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2)

  const line = data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const lastX = x(data.length - 1)
  const lastY = y(data[data.length - 1])

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('overflow-visible', className)}
      aria-hidden
    >
      <path
        d={line}
        fill="none"
        stroke={MARK}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {live && <circle className="chart-pulse" cx={lastX} cy={lastY} r="4" fill={MARK} />}
      <circle cx={lastX} cy={lastY} r="4" fill={MARK} stroke="var(--surface)" strokeWidth="2" />
    </svg>
  )
}

export function AreaChart({
  data,
  valueKey = 'value',
  labelKey = 'label',
  height = 200,
  format = 'number',
  className,
}: {
  data: Record<string, string | number>[]
  valueKey?: string
  labelKey?: string
  height?: number
  format?: ValueFormat
  className?: string
}) {
  const formatValue = FORMATTERS[format]
  const gid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)

  if (data.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center text-[13px] text-text-muted', className)}
        style={{ height }}
      >
        No data for this period
      </div>
    )
  }

  const values = data.map((d) => Number(d[valueKey]))
  const max = Math.max(...values)
  const min = Math.min(...values)
  const top = Math.ceil(max / 1000) * 1000
  const bottom = Math.max(0, Math.floor(min / 1000) * 1000 - 1000)
  const W = 100
  const padT = 8
  const padB = 22

  const x = (i: number) => (values.length === 1 ? W / 2 : (i / (values.length - 1)) * W)
  const y = (v: number) => padT + (1 - (v - bottom) / (top - bottom || 1)) * (height - padT - padB)

  const line =
    values.length === 1
      ? `M0 ${y(values[0]).toFixed(1)} L${W} ${y(values[0]).toFixed(1)}`
      : values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)} ${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${W} ${height - padB} L0 ${height - padB} Z`

  const ticks = [bottom, bottom + (top - bottom) / 2, top]
  const active = hover ?? null

  return (
    <div className={cn('relative', className)}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Trend of ${values.length} points, from ${formatValue(values[0])} to ${formatValue(values[values.length - 1])}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const rel = (e.clientX - r.left) / r.width
          setHover(Math.max(0, Math.min(values.length - 1, Math.round(rel * (values.length - 1)))))
        }}
      >
        <defs>
          <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={MARK} stopOpacity="0.16" />
            <stop offset="100%" stopColor={MARK} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <line
            key={t}
            x1="0"
            x2={W}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--border)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path d={area} fill={`url(#fill-${gid})`} />
        <path
          d={line}
          fill="none"
          stroke={MARK}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="chart-draw"
        />

        {active !== null && (
          <line
            x1={x(active)}
            x2={x(active)}
            y1={padT}
            y2={height - padB}
            stroke="var(--border-strong)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {active !== null && (
        <span
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${x(active)}%`, top: y(values[active]) }}
          aria-hidden
        >
          <span className="chart-pulse absolute -inset-1.5 rounded-full border-2 border-primary-500" />
          <span className="block size-2.5 rounded-full bg-primary-500 ring-2 ring-surface" />
        </span>
      )}

      <div className="pointer-events-none absolute inset-0" style={{ paddingBottom: padB }}>
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute left-0 -translate-y-1/2 bg-surface pr-1 text-[11px] text-text-muted"
            style={{ top: y(t) }}
          >
            {formatValue(t)}
          </span>
        ))}
      </div>

      <div className="mt-1 flex justify-between text-[11px] text-text-muted">
        <span>{String(data[0][labelKey])}</span>
        <span>{String(data[Math.floor(data.length / 2)][labelKey])}</span>
        <span>{String(data[data.length - 1][labelKey])}</span>
      </div>

      {active !== null && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 rounded-lg border border-border bg-surface px-2.5 py-1.5 shadow-md"
          style={{
            left: `${x(active)}%`,
            top: y(values[active]) > 84 ? y(values[active]) - 68 : y(values[active]) + 16,
          }}
        >
          <p className="text-[11px] text-text-muted">{String(data[active][labelKey])}</p>
          <p className="text-sm font-semibold">{formatValue(values[active])}</p>
        </div>
      )}
    </div>
  )
}

export function BarsH({
  data,
  format = 'number',
  className,
}: {
  data: { label: string; value: number }[]
  format?: ValueFormat
  className?: string
}) {
  const formatValue = FORMATTERS[format]
  const max = Math.max(0, ...data.map((d) => (Number.isFinite(d.value) ? d.value : 0)))
  const widthOf = (v: number) =>
    !Number.isFinite(v) || v <= 0 || max <= 0 ? 0 : Math.max(2, (v / max) * 100)
  return (
    <ul className={cn('space-y-3', className)}>
      {data.map((d) => (
        <li
          key={d.label}
          className="group grid grid-cols-[minmax(5rem,8.5rem)_1fr_auto] items-center gap-3"
        >
          <span className="truncate text-[13px] text-text-muted">{d.label}</span>
          <span className="h-2.5 rounded-full bg-primary-100 dark:bg-primary-900/40">
            <span
              className="chart-grow block h-full rounded-r-[4px] bg-primary-500 transition-[filter] group-hover:brightness-95"
              style={{ width: `${widthOf(d.value)}%` }}
            />
          </span>
          <span className="tabular text-[13px] font-medium">{formatValue(d.value)}</span>
        </li>
      ))}
    </ul>
  )
}
