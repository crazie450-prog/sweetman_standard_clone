'use client'

import { RouteError } from '@/components/layout/RouteError'

export default function AdminError(props: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return <RouteError {...props} home={{ href: '/admin/organizations', label: 'Organizations' }} />
}
