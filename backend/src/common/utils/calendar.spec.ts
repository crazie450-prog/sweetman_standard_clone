import { dayKey, daysBetween, weekStartKey } from './calendar'

describe('weekStartKey', () => {
  test('returns the Monday that starts the week', () => {
    expect(weekStartKey(new Date('2026-07-29T14:00:00Z'))).toBe('2026-07-27')
    expect(weekStartKey(new Date('2026-07-27T00:00:00Z'))).toBe('2026-07-27')
    expect(weekStartKey(new Date('2026-08-02T23:59:00Z'))).toBe('2026-07-27')
  })

  test('keeps weeks of different years apart', () => {
    const lastYear = weekStartKey(new Date('2025-01-02T12:00:00Z'))
    const thisYear = weekStartKey(new Date('2026-01-02T12:00:00Z'))
    expect(lastYear).toBe('2024-12-30')
    expect(thisYear).toBe('2025-12-29')
    expect(lastYear).not.toBe(thisYear)
  })
})

describe('daysBetween', () => {
  test('counts whole calendar days, not elapsed milliseconds', () => {
    expect(daysBetween(dayKey(new Date('2026-07-27T23:59:00Z')), '2026-07-28')).toBe(1)
    expect(daysBetween(dayKey(new Date('2026-07-28T00:01:00Z')), '2026-07-28')).toBe(0)
  })

  test('spans a month and a year boundary', () => {
    expect(daysBetween('2026-07-31', '2026-08-01')).toBe(1)
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1)
  })
})
