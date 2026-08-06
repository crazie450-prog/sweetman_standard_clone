const LOCALE = 'en-US'
const CURRENCY = 'USD'

const money = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY })
const date = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' })

const EMPTY = '—'

export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return EMPTY
  return money.format(value)
}

const moneyCompact = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatMoneyCompact(value: number): string {
  if (!Number.isFinite(value)) return EMPTY
  return moneyCompact.format(value)
}

export function formatDate(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return EMPTY
  return date.format(d)
}

const shortDay = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric' })

export function formatDayShort(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return EMPTY
  return shortDay.format(d)
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY
  return `${value.toFixed(digits)}%`
}
