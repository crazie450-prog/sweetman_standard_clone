'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button, Card, TextField } from '@/components/ui'
import { authService } from '@/lib/api/services'
import { ApiError } from '@/lib/api/client'
import { serverMessage } from '@/lib/api/error'
import { queries } from '@/lib/api/queries'

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState('')

  const { data: signedIn } = useQuery({
    ...queries.orgCurrent(),
    retry: false,
  })

  useEffect(() => {
    if (signedIn) router.replace('/dashboard')
  }, [signedIn, router])

  const signIn = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authService.login(email, password),
    onSuccess: () => router.push('/dashboard'),
    onError: (err) => {
      const status = err instanceof ApiError ? err.status : 0
      setError(
        status === 401
          ? 'Incorrect email or password.'
          : status === 423
            ? 'Too many attempts. Try again in a few minutes.'
            : serverMessage(err, 'Could not sign in. Try again.')
      )
    },
  })

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setError('')
    signIn.mutate({ email: String(form.get('email')), password: String(form.get('password')) })
  }

  return (
    <div className="w-full max-w-sm">
      <Card className="relative overflow-hidden">
        <span className="dawn-strip absolute inset-x-0 top-0" aria-hidden />
        <div className="mb-6 flex flex-col items-center gap-2">
          <span className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm lg:hidden">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-6"
              aria-hidden="true"
            >
              <rect x="4" y="2" width="16" height="20" rx="2" />
              <path d="M9 22v-4h6v4" />
              <path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" />
            </svg>
          </span>
          <h1 className="text-2xl font-semibold">Welcome back</h1>
          <p className="text-sm text-text-muted">Sign in to your kitchen workspace</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <TextField
            label="Email"
            name="email"
            type="email"
            required
            placeholder="you@restaurant.com"
            autoComplete="username"
          />
          <TextField
            label="Password"
            name="password"
            type="password"
            required
            placeholder="Enter your password"
            autoComplete="current-password"
            error={error}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link
              href="/reset-password"
              className="text-sm text-primary-700 underline dark:text-primary-400"
            >
              Forgot password?
            </Link>
          </div>
          <Button type="submit" loading={signIn.isPending || signIn.isSuccess} className="w-full">
            Sign In
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-text-muted">
          New to Nexus?{' '}
          <Link href="/signup" className="text-primary-700 underline dark:text-primary-400">
            Create an organization
          </Link>
        </p>
      </Card>

      <p className="mt-4 text-center text-sm text-text-muted lg:hidden">
        Nexus Restaurant Manager v0.1.0
      </p>
    </div>
  )
}
