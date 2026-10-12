import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { QueryProvider } from '@/lib/api/QueryProvider'
import { ErrorReporting } from '@/lib/errors/ErrorReporting'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: { default: 'Nexus', template: '%s · Nexus' },
  description: 'Nexus Restaurant Management Platform',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('nexus.theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col font-sans antialiased">
        <ErrorReporting />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
