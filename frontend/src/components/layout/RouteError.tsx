'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button, EmptyState } from '@/components/ui'

export function reportRenderError(error: Error) {
  void import('@bugsnag/browser').then(({ default: Bugsnag }) => {
    if (Bugsnag.isStarted()) Bugsnag.notify(error)
  })
}

export function RouteError({
  error,
  unstable_retry,
  home = { href: '/dashboard', label: 'Dashboard' },
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
  home?: { href: string; label: string }
}) {
  useEffect(() => {
    reportRenderError(error)
  }, [error])

  return (
    <div role="alert" className="page-enter">
      <EmptyState
        title="This screen could not be shown"
        hint="Something failed while it was being drawn. Your data is unchanged. Try again, or go back to the start."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => unstable_retry()}>Try again</Button>
            <Link
              href={home.href}
              className="rounded-lg px-4 py-2 text-sm font-medium text-primary-700 hover:underline dark:text-primary-400"
            >
              Go to {home.label}
            </Link>
          </div>
        }
      />
    </div>
  )
}
