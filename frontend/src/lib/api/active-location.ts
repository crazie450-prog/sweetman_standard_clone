const KEY = 'nexus.locationId'
const listeners = new Set<() => void>()
let chosenHere: string | null = null

export function getActiveLocationId(): string {
  if (typeof window === 'undefined') return ''
  if (chosenHere !== null) return chosenHere
  try {
    chosenHere = window.localStorage.getItem(KEY) ?? ''
  } catch {
    chosenHere = ''
  }
  return chosenHere
}

export function setActiveLocationId(id: string): void {
  if (typeof window === 'undefined') return
  chosenHere = id
  try {
    window.localStorage.setItem(KEY, id)
  } catch {
    /* ignore */
  }
  listeners.forEach((notify) => notify())
}

export function subscribeToActiveLocation(notify: () => void): () => void {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}
