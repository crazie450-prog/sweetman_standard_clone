'use client'

import { useQuery } from '@tanstack/react-query'
import { organizationService } from './services'
import { allowed, type Role } from '../auth/roles'

export function useCurrentUser() {
  const { data: user, isLoading } = useQuery({
    queryKey: ['org-current'],
    queryFn: organizationService.current,
  })

  return {
    user,
    isLoading,
    role: user?.roleKey,
    can: (minRole?: Role) => (isLoading ? false : allowed(user?.roleKey, minRole)),
  }
}
