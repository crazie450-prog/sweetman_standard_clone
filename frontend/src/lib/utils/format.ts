const LOCALE = 'en-US'

const moneyIn = (currency: string) => new Intl.NumberFormat(LOCALE, { style: 'currency', currency })
const moneyCompactIn = (currency: string) =>
  new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  })

let currency = 'USD'
let money = moneyIn(currency)
let moneyCompact = moneyCompactIn(currency)

export function adoptedCurrency(): string {
  return currency
}

export function adoptCurrency(code: string | null | undefined): void {
  if (!code || code === currency) return
  try {
    money = moneyIn(code)
    moneyCompact = moneyCompactIn(code)
    currency = code
  } catch {
    return
  }
}
const date = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' })
const calendarDate = new Intl.DateTimeFormat(LOCALE, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/

const EMPTY = '—'

export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return EMPTY
  return money.format(value)
}

export function formatMoneyCompact(value: number): string {
  if (!Number.isFinite(value)) return EMPTY
  return moneyCompact.format(value)
}

export function formatDate(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY
  if (typeof value === 'string' && CALENDAR_DAY.test(value)) {
    const d = new Date(`${value}T00:00:00Z`)
    return Number.isNaN(d.getTime()) ? EMPTY : calendarDate.format(d)
  }
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return EMPTY
  return date.format(d)
}

const dateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' })

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return EMPTY
  return dateTime.format(d)
}

const shortDay = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric' })
const shortCalendarDay = new Intl.DateTimeFormat(LOCALE, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

export function formatDayShort(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY
  if (typeof value === 'string' && CALENDAR_DAY.test(value)) {
    const d = new Date(`${value}T00:00:00Z`)
    return Number.isNaN(d.getTime()) ? EMPTY : shortCalendarDay.format(d)
  }
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return EMPTY
  return shortDay.format(d)
}

const shortMonth = new Intl.DateTimeFormat(LOCALE, { month: 'short', timeZone: 'UTC' })

export function formatMonthShort(period: string): string {
  const d = new Date(`${period}-01T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return EMPTY
  return shortMonth.format(d)
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY
  return `${value.toFixed(digits)}%`
}

export function formatChange(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY
  const shown = Number(value.toFixed(digits)) || 0
  return `${shown > 0 ? '+' : ''}${shown.toFixed(digits)}%`
}

export function currencySymbol(): string {
  return money.formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency
}
