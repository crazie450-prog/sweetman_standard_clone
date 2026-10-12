'use client'

import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getActiveLocationId, subscribeToActiveLocation } from './active-location'
import { queries } from '@/lib/api/queries'

export function useActiveLocationId(): string {
  return useSyncExternalStore(subscribeToActiveLocation, getActiveLocationId, () => '')
}

export function useActiveLocation(): { id: string; name: string } {
  const id = useActiveLocationId()
  const { data: locations = [] } = useQuery(queries.locations())
  return { id, name: locations.find((l) => l.id === id)?.name ?? '' }
}
