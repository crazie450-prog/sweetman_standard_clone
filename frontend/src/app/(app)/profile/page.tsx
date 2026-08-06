'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, PageHeader, TextField, useToast } from '@/components/ui'
import { authService, organizationService, ROLE_LABELS } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'

export default function ProfilePage() {
  const { data: me } = useQuery({ queryKey: ['org-current'], queryFn: organizationService.current })
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
          </Card>
        </div>
      </div>
    </>
  )
}

function ProfileForm({ name, email }: { name: string; email: string }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ fullName: name, email })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await authService.updateProfile(form)
      await queryClient.invalidateQueries({ queryKey: ['org-current'] })
      toast('success', 'Profile updated')
    } catch (e) {
      toast('danger', serverMessage(e, 'Could not update the profile'))
    } finally {
      setSaving(false)
    }
  }

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
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="primary" onClick={save} disabled={saving || !form.fullName.trim()}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </Card>
  )
}

function PasswordForm() {
  const toast = useToast()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [saving, setSaving] = useState(false)
  const mismatch = form.confirm.length > 0 && form.next !== form.confirm
  const ready = form.current.length > 0 && form.next.length >= 8 && !mismatch

  const save = async () => {
    setSaving(true)
    try {
      await authService.changePassword(form.current, form.next)
      setForm({ current: '', next: '', confirm: '' })
      toast('success', 'Password changed. Other devices were signed out.')
    } catch (e) {
      toast('danger', serverMessage(e, 'Could not change the password'))
    } finally {
      setSaving(false)
    }
  }

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
        <Button variant="primary" onClick={save} disabled={saving || !ready}>
          {saving ? 'Saving…' : 'Change password'}
        </Button>
      </div>
    </Card>
  )
}
