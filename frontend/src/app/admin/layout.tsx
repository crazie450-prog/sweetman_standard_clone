'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils/cn'
import { ToastProvider } from '@/components/ui'
import { queries } from '@/lib/api/queries'

const TABS = [
  { href: '/admin/organizations', label: 'Organizations' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/queue', label: 'Processing Queue' },
  { href: '/admin/services', label: 'Services' },
]

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { data: currentUser, isLoading } = useQuery(queries.orgCurrent())

  const denied = !isLoading && !currentUser?.isPlatformAdmin
  useEffect(() => {
    if (denied) router.replace('/dashboard')
  }, [denied, router])

  if (isLoading || denied) return null

  return (
    <ToastProvider>
      <div className="min-h-dvh">
        <header className="border-b border-border bg-primary-900 text-white">
          <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-white/15 text-sm font-bold">
              N
            </span>
            <span className="font-semibold">Nexus Platform Admin</span>
            <nav
              className="order-last flex basis-full gap-1 overflow-x-auto whitespace-nowrap sm:order-none sm:ml-6 sm:basis-auto"
              aria-label="Admin"
            >
              {TABS.map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={pathname.startsWith(t.href) ? 'page' : undefined}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm transition-colors',
                    pathname.startsWith(t.href)
                      ? 'bg-white/15 font-medium'
                      : 'text-white/70 hover:bg-white/10'
                  )}
                >
                  {t.label}
                </Link>
              ))}
            </nav>
            <Link href="/dashboard" className="ml-auto text-sm text-white/70 hover:text-white">
              Exit admin
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
      </div>
    </ToastProvider>
  )
}
