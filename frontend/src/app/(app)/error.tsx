'use client'

import { RouteError } from '@/components/layout/RouteError'

export default function AppError(props: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return <RouteError {...props} />
}
