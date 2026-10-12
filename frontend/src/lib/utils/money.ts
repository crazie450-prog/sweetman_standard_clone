export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return value
  const [digits, exponent = '0'] = Math.abs(value).toPrecision(15).split('e')
  const scaled = Math.round(Number(`${digits}e${Number(exponent) + 2}`))
  return scaled === 0 ? 0 : Math.sign(value) * Number(`${scaled}e-2`)
}

export function percentOf(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null
}

export function shownShare(share: number): number {
  return Number(share.toFixed(1))
}

export function aboveTarget(
  share: number | null | undefined,
  target: number | null | undefined
): boolean {
  if (share === null || share === undefined || target === null || target === undefined) return false
  return shownShare(share) > target
}

export function wholeCount(raw: string): number | null {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return null
  const value = Number(text)
  return value >= 1 && Number.isSafeInteger(value) ? value : null
}
