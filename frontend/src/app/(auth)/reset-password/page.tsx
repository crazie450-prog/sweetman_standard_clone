'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Card, Spinner, TextField } from '@/components/ui'
import { authService } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      }
    >
      <ResetFlow />
    </Suspense>
  )
}

function ResetFlow() {
  const token = useSearchParams().get('token')
  return token ? <SetNewPassword token={token} /> : <RequestLink />
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex flex-col items-center gap-2">
        <span className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-xl font-bold text-white shadow-sm lg:hidden">
          N
        </span>
        <h1 className="text-2xl font-semibold">{title}</h1>
      </div>
      <Card>{children}</Card>
      <p className="mt-4 text-center text-sm text-text-muted">
        <Link href="/login" className="text-primary-700 underline dark:text-primary-400">
          Back to sign in
        </Link>
      </p>
    </div>
  )
}

function RequestLink() {
  const [sent, setSent] = useState(false)

  const request = useMutation({
    mutationFn: (email: string) => authService.forgotPassword(email).catch(() => undefined),
    onSettled: () => setSent(true),
  })

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    request.mutate(String(form.get('email')))
  }

  return (
    <Shell title="Reset your password">
      {sent ? (
        <p className="text-sm">
          If an account uses that address, a reset link is on its way. If nothing arrives, an
          administrator of your organization can reset your password from the Team screen.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <TextField
            label="Email"
            name="email"
            type="email"
            required
            autoComplete="email"
            help="The reset link is sent to this address"
          />
          <Button type="submit" loading={request.isPending} className="w-full">
            Send Reset Link
          </Button>
        </form>
      )}
    </Shell>
  )
}

function SetNewPassword({ token }: { token: string }) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const reset = useMutation({
    mutationFn: (password: string) => authService.resetPassword(token, password),
    onSuccess: () => {
      setDone(true)
      setTimeout(() => router.push('/login'), 1800)
    },
    onError: (err) => setError(serverMessage(err, 'This reset link is invalid or has expired.')),
  })

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const password = String(form.get('password'))
    if (password !== String(form.get('confirm'))) {
      setError('The two passwords do not match.')
      return
    }
    setError('')
    reset.mutate(password)
  }

  return (
    <Shell title="Choose a new password">
      {done ? (
        <p className="text-sm">Your password has been changed. Taking you to the sign-in page…</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <TextField
            label="New password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            help="At least 8 characters"
          />
          <TextField
            label="Confirm new password"
            name="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            error={error}
          />
          <Button type="submit" loading={reset.isPending || reset.isSuccess} className="w-full">
            Set New Password
          </Button>
        </form>
      )}
    </Shell>
  )
}
