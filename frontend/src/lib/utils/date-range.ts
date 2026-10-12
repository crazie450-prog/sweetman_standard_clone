export const isoDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function lastDays(days: number): { from: string; to: string } {
  const now = new Date()
  return {
    from: isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))),
    to: isoDay(now),
  }
}

export const today = (): string => isoDay(new Date())

export function dayIn(zone?: string, at = new Date()): string {
  if (!zone) return isoDay(at)
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(at)
  } catch {
    return isoDay(at)
  }
}

export const dayOf = (value: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : isoDay(new Date(value))

export const endsBeforeBegins = (period: { from?: string; to?: string }): boolean =>
  Boolean(period.from && period.to && period.from > period.to)
