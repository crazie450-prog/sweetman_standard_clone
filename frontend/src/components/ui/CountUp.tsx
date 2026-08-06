'use client'

import { useEffect, useRef, useState } from 'react'
import { formatMoney, formatPercent } from '@/lib/utils/format'

const FORMAT: Record<string, (v: number) => string> = {
  money: formatMoney,
  percent: (v) => formatPercent(v),
  number: (v) => new Intl.NumberFormat('en-US').format(Math.round(v)),
}

export function CountUp({
  value,
  format = 'number',
}: {
  value: number
  format?: 'money' | 'percent' | 'number'
}) {
  const [display, setDisplay] = useState(value)
  const raf = useRef(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      raf.current = requestAnimationFrame(() => setDisplay(value))
      return () => cancelAnimationFrame(raf.current)
    }
    const t0 = performance.now()
    const dur = 900
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(value * eased)
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [value])

  return <span className="tabular-nums">{FORMAT[format](display)}</span>
}
