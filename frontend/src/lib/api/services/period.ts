export const periodQuery = (period?: { from?: string; to?: string }) =>
  searchOf({ from: period?.from, to: period?.to })

export const searchOf = (params: Record<string, string | number | undefined | null>) => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  }
  const text = query.toString()
  return text ? `?${text}` : ''
}
