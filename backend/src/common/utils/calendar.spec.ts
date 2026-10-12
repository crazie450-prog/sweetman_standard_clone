import {
  lastDays,
  dayKey,
  daysBetween,
  isZone,
  monthKey,
  recordedAt,
  reportingPeriod,
  startOfDay,
  statedPeriod,
  weekStartKey,
} from './calendar'

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

describe('reportingPeriod', () => {
  it('reads a stated range from the first moment of one day to the last of the other', () => {
    const { from, to } = reportingPeriod('2026-08-01', '2026-08-31')
    expect(from.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(to.toISOString()).toBe('2026-08-31T23:59:59.999Z')
  })

  it('refuses a period that ends before it begins', () => {
    expect(() => reportingPeriod('2026-09-30', '2026-08-01')).toThrow(/ends before it begins/)
  })

  it('refuses a string that is not a date instead of making an invalid one', () => {
    expect(() => reportingPeriod('not-a-date', '2026-08-01')).toThrow(/not a date/)
    expect(() => reportingPeriod('2026-08-01', 'whenever')).toThrow(/not a date/)
  })

  it('falls back to the last thirty days when nothing is stated', () => {
    const { from, to } = reportingPeriod()
    expect(to.getTime() - from.getTime()).toBeGreaterThan(29 * 86400000)
    expect(to.getTime() - from.getTime()).toBeLessThan(31 * 86400000)
  })
})

describe('statedPeriod', () => {
  it('states nothing when no bound is given', () => {
    expect(statedPeriod()).toEqual({})
  })

  it('reads either bound alone, and both together', () => {
    expect(statedPeriod('2026-08-01').gte?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(statedPeriod('2026-08-01').lte).toBeUndefined()
    expect(statedPeriod(undefined, '2026-08-31').lte?.toISOString()).toBe(
      '2026-08-31T23:59:59.999Z',
    )
    expect(statedPeriod(undefined, '2026-08-31').gte).toBeUndefined()
    const both = statedPeriod('2026-08-01', '2026-08-31')
    expect([both.gte?.toISOString(), both.lte?.toISOString()]).toEqual([
      '2026-08-01T00:00:00.000Z',
      '2026-08-31T23:59:59.999Z',
    ])
  })

  it('refuses what reportingPeriod refuses', () => {
    expect(() => statedPeriod('2026-09-30', '2026-08-01')).toThrow(/ends before it begins/)
    expect(() => statedPeriod('whenever')).toThrow(/not a date/)
  })
})

describe('days in the organization timezone', () => {
  const NY = 'America/New_York'

  it('names the day a moment falls on where the restaurant is', () => {
    expect(dayKey(new Date('2026-09-28T02:00:00Z'), NY)).toBe('2026-09-27')
    expect(dayKey(new Date('2026-09-28T02:00:00Z'))).toBe('2026-09-28')
    expect(monthKey(new Date('2026-10-01T03:00:00Z'), NY)).toBe('2026-09')
    expect(weekStartKey(new Date('2026-09-28T02:00:00Z'), NY)).toBe('2026-09-21')
  })

  it('reads a stated range from local midnight to the last local moment', () => {
    const { from, to } = reportingPeriod('2026-09-27', '2026-09-27', NY)
    expect(from.toISOString()).toBe('2026-09-27T04:00:00.000Z')
    expect(to.toISOString()).toBe('2026-09-28T03:59:59.999Z')
    const winter = reportingPeriod('2026-12-01', '2026-12-01', NY)
    expect(winter.from.toISOString()).toBe('2026-12-01T05:00:00.000Z')
  })

  it('keeps a day across a clock change whole', () => {
    const { from, to } = reportingPeriod('2026-11-01', '2026-11-01', NY)
    expect((to.getTime() + 1 - from.getTime()) / 3600000).toBe(25)
  })

  it('files a stated calendar day at its local midday, so every screen reads the same day', () => {
    const at = recordedAt('2026-09-27', NY)
    expect(at.toISOString()).toBe('2026-09-27T16:00:00.000Z')
    expect(dayKey(at, NY)).toBe('2026-09-27')
    expect(dayKey(at)).toBe('2026-09-27')
  })

  it('refuses tomorrow as the restaurant counts it', () => {
    const tomorrow = dayKey(new Date(Date.now() + 86400000), NY)
    expect(() => recordedAt(tomorrow, NY)).toThrow(/future/)
    expect(recordedAt(dayKey(new Date(), NY), NY)).toBeInstanceOf(Date)
  })

  it('refuses a moment that falls on tomorrow as the restaurant counts it', () => {
    const tomorrow = dayKey(new Date(Date.now() + 86400000), NY)
    const early = new Date(startOfDay(tomorrow, NY).getTime() + 60000).toISOString()
    expect(() => recordedAt(early, NY)).toThrow(/future/)
    expect(
      recordedAt(new Date(Date.now() + 60000).toISOString(), 'Pacific/Kiritimati'),
    ).toBeInstanceOf(Date)
  })

  it('knows a timezone from a word that is not one', () => {
    expect(isZone(NY)).toBe(true)
    expect(isZone('Mars/Olympus')).toBe(false)
  })
})

describe('lastDays', () => {
  const now = new Date('2026-10-03T02:30:00Z')

  it('starts the last day at midnight where the restaurant is', () => {
    expect(lastDays(1, 'America/New_York', now).toISOString()).toBe('2026-10-02T04:00:00.000Z')
  })

  it('counts whole days back from that day', () => {
    expect(lastDays(30, 'America/New_York', now).toISOString()).toBe('2026-09-03T04:00:00.000Z')
    expect(lastDays(7, 'UTC', now).toISOString()).toBe('2026-09-27T00:00:00.000Z')
  })
})
