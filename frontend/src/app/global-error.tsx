'use client'

import './globals.css'
import { RouteError } from '@/components/layout/RouteError'

export default function GlobalError(props: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col items-center justify-center p-4 font-sans antialiased">
        <title>Something went wrong · Nexus</title>
        <RouteError {...props} />
      </body>
    </html>
  )
}
