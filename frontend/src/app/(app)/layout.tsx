import type { ReactNode } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { ToastProvider } from '@/components/ui'

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AppShell>{children}</AppShell>
    </ToastProvider>
  )
}
