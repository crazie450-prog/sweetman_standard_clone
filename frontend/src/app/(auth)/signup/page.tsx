'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button, Card, Spinner, TextField } from '@/components/ui'
import { authService, invitationsService, ROLE_LABELS } from '@/lib/api/services'
import { ApiError } from '@/lib/api/client'
import { serverMessage } from '@/lib/api/error'
import { queries } from '@/lib/api/queries'

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      }
    >
      <SignupOrInvite />
    </Suspense>
  )
}

function SignupOrInvite() {
  const inviteToken = useSearchParams().get('invite')
  return inviteToken ? <AcceptInvite token={inviteToken} /> : <CreateOrganization />
}

function CreateOrganization() {
  const router = useRouter()
  const [error, setError] = useState('')

  const registration = useMutation({
    mutationFn: authService.register,
    onSuccess: () => router.push('/dashboard'),
    onError: (err) =>
      setError(
        err instanceof ApiError && err.status === 409
          ? 'An account with this email already exists.'
          : serverMessage(err, 'Could not create the organization. Check the form and try again.')
      ),
  })

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setError('')
    registration.mutate({
      organizationName: String(form.get('organizationName')),
      fullName: String(form.get('fullName')),
      email: String(form.get('email')),
      password: String(form.get('password')),
    })
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex flex-col items-center gap-2">
        <span className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-xl font-bold text-white shadow-sm lg:hidden">
          N
        </span>
        <h1 className="text-2xl font-semibold">Create your organization</h1>
        <p className="text-sm text-text-muted">Free 14-day trial. No credit card required.</p>
      </div>

      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <TextField
            label="Organization name"
            name="organizationName"
            placeholder="e.g. The Golden Fork Group"
            required
          />
          <TextField label="Your full name" name="fullName" required autoComplete="name" />
          <TextField label="Email" name="email" type="email" required autoComplete="email" />
          <TextField
            label="Password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            help="At least 8 characters"
            error={error}
          />
          <Button
            type="submit"
            loading={registration.isPending || registration.isSuccess}
            className="w-full"
          >
            Create Organization
          </Button>
        </form>
      </Card>

      <p className="mt-4 text-center text-sm text-text-muted">
        Already have an account?{' '}
        <Link href="/login" className="text-primary-700 underline dark:text-primary-400">
          Sign in
        </Link>
      </p>
    </div>
  )
}

function AcceptInvite({ token }: { token: string }) {
  const router = useRouter()
  const [error, setError] = useState('')

  const {
    data: invite,
    isLoading,
    error: previewError,
  } = useQuery({
    ...queries.invitation(token),
    retry: false,
  })

  const acceptance = useMutation({
    mutationFn: (account: { fullName: string; password: string }) =>
      invitationsService.accept(token, account),
    onSuccess: () => router.push('/dashboard'),
    onError: (err) => setError(serverMessage(err, 'Could not accept the invitation. Try again.')),
  })

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setError('')
    acceptance.mutate({
      fullName: String(form.get('fullName')),
      password: String(form.get('password')),
    })
  }

  if (isLoading) {
    return (
      <div className="flex w-full max-w-sm justify-center py-16">
        <Spinner />
      </div>
    )
  }

  if (previewError || !invite) {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-2 text-2xl font-semibold">This invitation is no longer valid</h1>
        <p className="text-sm text-text-muted">
          It may have been used already, revoked, or it has expired. Ask your administrator to send
          a new one.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/login" className="text-primary-700 underline dark:text-primary-400">
            Back to sign in
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-xl font-bold text-white shadow-sm lg:hidden">
          N
        </span>
        <h1 className="text-2xl font-semibold">Join {invite.organizationName}</h1>
        <p className="text-sm text-text-muted">
          You were invited as {ROLE_LABELS[invite.role] ?? invite.role}. Set a password to finish.
        </p>
      </div>

      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <TextField label="Email" value={invite.email} disabled readOnly />
          <TextField label="Your full name" name="fullName" required autoComplete="name" />
          <TextField
            label="Password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            help="At least 8 characters"
            error={error}
          />
          <Button
            type="submit"
            loading={acceptance.isPending || acceptance.isSuccess}
            className="w-full"
          >
            Accept Invitation
          </Button>
        </form>
      </Card>

      <p className="mt-4 text-center text-sm text-text-muted">
        Already have an account?{' '}
        <Link href="/login" className="text-primary-700 underline dark:text-primary-400">
          Sign in
        </Link>
      </p>
    </div>
  )
}
