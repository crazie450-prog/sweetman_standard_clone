export const isoDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function lastDays(days: number): { from: string; to: string } {
  return {
    from: isoDay(new Date(Date.now() - days * 86400000)),
    to: isoDay(new Date()),
  }
}

export const today = (): string => isoDay(new Date())
