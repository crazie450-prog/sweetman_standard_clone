'use client'

import { useQuery } from '@tanstack/react-query'
import { allowed, type Role } from '../auth/roles'
import { queries } from '@/lib/api/queries'

export function useCurrentUser() {
  const { data: user, isLoading } = useQuery(queries.orgCurrent())

  const mine = user?.assigned ? user.locations.map((l) => l.id) : []

  return {
    user,
    isLoading,
    role: user?.roleKey,
    can: (minRole?: Role) => (isLoading ? false : allowed(user?.roleKey, minRole)),
    mine,
    changesHere: (locationId: string | null | undefined) =>
      !isLoading && (!user?.assigned || (!!locationId && mine.includes(locationId))),
    worksEverywhere: !isLoading && !user?.assigned,
  }
}
