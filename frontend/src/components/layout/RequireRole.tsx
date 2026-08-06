'use client'

import { useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { Spinner } from '@/components/ui'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import type { Role } from '@/lib/auth/roles'

export function RequireRole({ minRole, children }: { minRole: Role; children: ReactNode }) {
  const router = useRouter()
  const { can, isLoading } = useCurrentUser()
  const denied = !isLoading && !can(minRole)

  useEffect(() => {
    if (denied) router.replace('/dashboard')
  }, [denied, router])

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }
  return denied ? null : <>{children}</>
}
