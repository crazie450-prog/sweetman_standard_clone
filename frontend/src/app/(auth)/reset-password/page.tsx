'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState, type FormEvent } from 'react'
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
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setLoading(true)
    await authService.forgotPassword(String(form.get('email'))).catch(() => undefined)
    setSent(true)
  }

  return (
    <Shell title="Reset your password">
      {sent ? (
        <p className="text-sm">
          If an account exists for that email, a reset link has been generated. Email delivery is
          not connected yet — ask an administrator for the link.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <TextField
            label="Email"
            name="email"
            type="email"
            required
            autoComplete="email"
            help="A secure reset link is generated for this address"
          />
          <Button type="submit" loading={loading} className="w-full">
            Send Reset Link
          </Button>
        </form>
      )}
    </Shell>
  )
}

function SetNewPassword({ token }: { token: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const password = String(form.get('password'))
    if (password !== String(form.get('confirm'))) {
      setError('The two passwords do not match.')
      return
    }
    setError('')
    setLoading(true)
    try {
      await authService.resetPassword(token, password)
      setDone(true)
      setTimeout(() => router.push('/login'), 1800)
    } catch (err) {
      setError(serverMessage(err, 'This reset link is invalid or has expired.'))
      setLoading(false)
    }
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
          <Button type="submit" loading={loading} className="w-full">
            Set New Password
          </Button>
        </form>
      )}
    </Shell>
  )
}
