const KEY = 'nexus.locationId'

export function getActiveLocationId(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function setActiveLocationId(id: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, id)
  } catch {
    /* ignore */
  }
}
