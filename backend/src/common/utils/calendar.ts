import { BadRequestException } from '@nestjs/common'

export const UTC = 'UTC'

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

const clocks = new Map<string, Intl.DateTimeFormat>()

function clock(zone: string): Intl.DateTimeFormat {
  let format = clocks.get(zone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    clocks.set(zone, format)
  }
  return format
}

function wallClock(date: Date, zone: string) {
  const parts: Record<string, number> = {}
  for (const p of clock(zone).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>
}

const pad = (n: number, size = 2) => String(n).padStart(size, '0')

export function isZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export function isCalendarDay(value: string): boolean {
  if (!CALENDAR_DAY.test(value)) return false
  const midnight = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(midnight.getTime()) && midnight.toISOString().slice(0, 10) === value
}

export function dayKey(date: Date, zone = UTC): string {
  const { year, month, day } = wallClock(date, zone)
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

export function monthKey(date: Date, zone = UTC): string {
  return dayKey(date, zone).slice(0, 7)
}

export function weekStartKey(date: Date, zone = UTC): string {
  const monday = new Date(`${dayKey(date, zone)}T00:00:00Z`)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  return monday.toISOString().slice(0, 10)
}

export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / DAY_MS)
}

function offsetAt(instant: number, zone: string): number {
  const t = wallClock(new Date(instant), zone)
  const asUtc = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)
  return asUtc - Math.floor(instant / 1000) * 1000
}

export function startOfDay(key: string, zone = UTC): Date {
  const midnight = Date.parse(`${key}T00:00:00Z`)
  const first = midnight - offsetAt(midnight, zone)
  return new Date(midnight - offsetAt(first, zone))
}

export function endOfDay(key: string, zone = UTC): Date {
  const next = new Date(Date.parse(`${key}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)
  return new Date(startOfDay(next, zone).getTime() - 1)
}

export function middayOf(key: string, zone = UTC): Date {
  return new Date(startOfDay(key, zone).getTime() + DAY_MS / 2)
}

/* ===== A date a person states for something that already happened ===== */

export function lastDays(days: number, zone = UTC, now = new Date()): Date {
  const today = middayOf(dayKey(now, zone), zone)
  return startOfDay(dayKey(new Date(today.getTime() - (days - 1) * DAY_MS), zone), zone)
}

export function statedInstant(value: string, zone = UTC): Date {
  if (CALENDAR_DAY.test(value)) return isCalendarDay(value) ? middayOf(value, zone) : new Date(NaN)
  return new Date(value)
}

export function recordedAt(value?: string, zone = UTC): Date {
  if (!value) return new Date()
  const date = statedInstant(value, zone)
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({ code: 'DATE_INVALID', message: 'That is not a date' })
  }
  const future = (CALENDAR_DAY.test(value) ? value : dayKey(date, zone)) > dayKey(new Date(), zone)
  if (future) {
    throw new BadRequestException({
      code: 'DATE_IN_FUTURE',
      message: 'A record cannot be dated in the future',
    })
  }
  return date
}

export function statedPeriod(
  fromISO?: string,
  toISO?: string,
  zone = UTC,
): { gte?: Date; lte?: Date } {
  if (!fromISO && !toISO) return {}
  if (fromISO && toISO) {
    const { from, to } = reportingPeriod(fromISO, toISO, zone)
    return { gte: from, lte: to }
  }
  const { from, to } = reportingPeriod(fromISO ?? toISO, toISO ?? fromISO, zone)
  return fromISO ? { gte: from } : { lte: to }
}

export function reportingPeriod(
  fromISO?: string,
  toISO?: string,
  zone = UTC,
): { from: Date; to: Date } {
  const bound = (value: string, endOfPeriod: boolean) => {
    if (!isCalendarDay(value)) {
      throw new BadRequestException({ code: 'DATE_INVALID', message: `${value} is not a date` })
    }
    return endOfPeriod ? endOfDay(value, zone) : startOfDay(value, zone)
  }
  const to = toISO ? bound(toISO, true) : new Date()
  const from = fromISO ? bound(fromISO, false) : new Date(Date.now() - 30 * DAY_MS)
  if (from > to) {
    throw new BadRequestException({
      code: 'PERIOD_BACKWARDS',
      message: 'This reporting period ends before it begins',
    })
  }
  return { from, to }
}
