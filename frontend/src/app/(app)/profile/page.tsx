'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Badge, Button, Card, PageHeader, TextField, useToast } from '@/components/ui'
import { authService, ROLE_LABELS } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

export default function ProfilePage() {
  const { data: me } = useQuery(queries.orgCurrent())
  const { role } = useCurrentUser()

  return (
    <>
      <PageHeader title="My Profile" subtitle="Your name, sign-in email and password" />
      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileForm key={me?.email ?? 'loading'} name={me?.name ?? ''} email={me?.email ?? ''} />
        <div className="grid gap-6">
          <PasswordForm />
          <Card className="p-5">
            <h2 className="mb-1 text-base font-semibold">Access</h2>
            <p className="mb-4 text-sm text-text-muted">
              Role and location access are managed by your administrator.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{ROLE_LABELS[role ?? ''] ?? role ?? '—'}</Badge>
              <span className="text-sm text-text-muted">{me?.organization ?? ''}</span>
            </div>
            <p className="mt-3 text-sm">
              <span className="text-text-muted">Locations you work at: </span>
              {me && me.locations.length > 0
                ? me.locations.map((l) => l.name).join(', ')
                : 'none yet; ask your administrator'}
            </p>
          </Card>
        </div>
      </div>
    </>
  )
}

function ProfileForm({ name, email }: { name: string; email: string }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [form, setForm] = useState({ fullName: name, email })
  const [currentPassword, setCurrentPassword] = useState('')
  const emailChanged = form.email.trim().toLowerCase() !== email.toLowerCase()

  const saving = useMutation({
    mutationFn: () =>
      authService.updateProfile({
        fullName: form.fullName,
        ...(emailChanged ? { email: form.email, currentPassword } : {}),
      }),
    onSuccess: async () => {
      setCurrentPassword('')
      await invalidate('profile')
      toast('success', 'Profile updated')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not update the profile')),
  })
  const save = () => saving.mutate()

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-base font-semibold">Details</h2>
      <p className="mb-4 text-sm text-text-muted">The email here is the one you sign in with.</p>
      <div className="grid gap-4">
        <TextField
          label="Full name"
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
        />
        <TextField
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        {emailChanged && (
          <TextField
            label="Current password"
            type="password"
            name="current-for-email"
            help="Changing the sign-in email needs your current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        )}
      </div>
      <div className="mt-5 flex justify-end">
        <Button
          variant="primary"
          onClick={save}
          disabled={saving.isPending || !form.fullName.trim() || (emailChanged && !currentPassword)}
        >
          {saving.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </Card>
  )
}

function PasswordForm() {
  const toast = useToast()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const mismatch = form.confirm.length > 0 && form.next !== form.confirm
  const ready = form.current.length > 0 && form.next.length >= 8 && !mismatch

  const saving = useMutation({
    mutationFn: () => authService.changePassword(form.current, form.next),
    onSuccess: () => {
      setForm({ current: '', next: '', confirm: '' })
      toast('success', 'Password changed. Other devices were signed out.')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not change the password')),
  })
  const save = () => saving.mutate()

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-base font-semibold">Password</h2>
      <p className="mb-4 text-sm text-text-muted">Changing it signs out every other device.</p>
      <div className="grid gap-4">
        <TextField
          label="Current password"
          type="password"
          name="current"
          value={form.current}
          onChange={(e) => setForm({ ...form, current: e.target.value })}
        />
        <TextField
          label="New password"
          type="password"
          name="password"
          help="At least 8 characters"
          value={form.next}
          onChange={(e) => setForm({ ...form, next: e.target.value })}
        />
        <TextField
          label="Confirm new password"
          type="password"
          name="confirm"
          error={mismatch ? 'Passwords do not match' : undefined}
          value={form.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
        />
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="primary" onClick={save} disabled={saving.isPending || !ready}>
          {saving.isPending ? 'Saving…' : 'Change password'}
        </Button>
      </div>
    </Card>
  )
}
