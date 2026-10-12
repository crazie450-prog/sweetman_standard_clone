'use client'

import { RequireRole } from '@/components/layout/RequireRole'
import { useState } from 'react'
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Modal,
  PageHeader,
  SelectField,
  RowActions,
  Table,
  TableEmpty,
  TBody,
  TD,
  TextField,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  invitationsService,
  teamService,
  INVITABLE_ROLES,
  ROLE_LABELS,
  type InvitableRole,
  type TeamMember,
} from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { ROLE_RANK } from '@/lib/auth/roles'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

const ROLE_OPTIONS = INVITABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] ?? r }))

function TeamPage() {
  const { data: teamMembers = [], isLoading } = useQuery(queries.team())
  const { data: locations = [] } = useQuery(queries.locations())
  const invalidate = useInvalidate()
  const toast = useToast()
  const { can, user, mine } = useCurrentUser()

  const below = (r: string) => (ROLE_RANK[r] ?? 99) < (ROLE_RANK[user?.roleKey ?? ''] ?? -1)
  const reaches = (ids: string[]) =>
    mine.length === 0 || (ids.length > 0 && ids.every((id) => mine.includes(id)))
  const offered = mine.length === 0 ? locations : locations.filter((l) => mine.includes(l.id))
  const everywhereHint =
    mine.length === 0
      ? 'Leave everything unchecked to grant access to all locations.'
      : 'Choose at least one of the locations you work at.'
  const manageable = (m: TeamMember) =>
    below(m.role) && m.email !== user?.email && reaches(m.locations.map((l) => l.id))
  const ASSIGNABLE = ROLE_OPTIONS.filter((o) => below(o.value))

  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitableRole>('staff')
  const [locationIds, setLocationIds] = useState<string[]>([])

  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null)
  const [resetLink, setResetLink] = useState<{ email: string; url: string } | null>(null)
  const [pendingDeactivate, setPendingDeactivate] = useState<TeamMember | null>(null)

  const [editing, setEditing] = useState<TeamMember | null>(null)
  const [editRole, setEditRole] = useState<InvitableRole>('staff')
  const [editLocations, setEditLocations] = useState<string[]>([])

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  const invite = useMutation({
    mutationFn: (invited: string) =>
      invitationsService.create({
        email: invited,
        role,
        locationIds: locationIds.length > 0 ? locationIds : undefined,
      }),
    onSuccess: async (delivery, invited) => {
      await invalidate('team')
      setInviteOpen(false)
      setEmail('')
      setLocationIds([])
      if (delivery.emailDelivered) {
        toast('success', 'Invitation sent; the link expires in 7 days')
      } else if (delivery.acceptUrl) {
        setInviteLink({ email: invited, url: delivery.acceptUrl })
      }
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  function sendInvite() {
    if (!email.trim()) {
      toast('danger', 'Email is required')
      return
    }
    invite.mutate(email.trim())
  }

  const resending = useMutation({
    mutationFn: (m: TeamMember) => invitationsService.resend(m.id),
    onSuccess: async (delivery, m) => {
      await invalidate('team')
      if (delivery.emailDelivered) {
        toast('success', `Invitation re-sent to ${m.email}`)
      } else if (delivery.acceptUrl) {
        setInviteLink({ email: m.email, url: delivery.acceptUrl })
      }
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  const reactivation = useMutation({
    mutationFn: (m: TeamMember) => teamService.reactivate(m.id),
    onSuccess: async (_, m) => {
      await invalidate('team')
      toast('success', `${m.name} can sign in again`)
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  const passwordReset = useMutation({
    mutationFn: (m: TeamMember) => teamService.resetPassword(m.id),
    onSuccess: (delivery, m) => {
      if (delivery.emailDelivered) {
        toast('success', `Reset link sent to ${m.email}`)
      } else if (delivery.resetUrl) {
        setResetLink({ email: m.email, url: delivery.resetUrl })
      }
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  const revocation = useMutation({
    mutationFn: (m: TeamMember) => invitationsService.revoke(m.id),
    onSuccess: async (_, m) => {
      await invalidate('team')
      toast('success', `Invitation for ${m.email} revoked`)
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  const resend = (m: TeamMember) => resending.mutate(m)
  const reactivate = (m: TeamMember) => reactivation.mutate(m)
  const resetPassword = (m: TeamMember) => passwordReset.mutate(m)
  const revoke = (m: TeamMember) => revocation.mutate(m)

  function openEdit(m: TeamMember) {
    setEditing(m)
    setEditRole(
      (INVITABLE_ROLES as readonly string[]).includes(m.role) ? (m.role as InvitableRole) : 'staff'
    )
    setEditLocations(m.locations.map((l) => l.id))
  }

  const memberUpdate = useMutation({
    mutationFn: (m: TeamMember) =>
      teamService.update(m.id, { role: editRole, locationIds: editLocations }),
    onSuccess: async () => {
      await invalidate('team')
      setEditing(null)
      toast('success', 'Member updated')
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  const saveMember = () => editing && memberUpdate.mutate(editing)

  const deactivation = useMutation({
    mutationFn: (m: TeamMember) => teamService.deactivate(m.id),
    onSuccess: async (_, m) => {
      await invalidate('team')
      toast('success', `${m.name} deactivated`)
    },
    onError: (e) => toast('danger', serverMessage(e)),
    onSettled: () => setPendingDeactivate(null),
  })

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Users, roles, and location access"
        actions={
          can('manager') ? (
            <Button onClick={() => setInviteOpen(true)}>Invite Member</Button>
          ) : undefined
        }
      />

      <Table>
        <THead>
          <TR>
            <TH>User</TH>
            <TH>Role</TH>
            <TH>Locations</TH>
            <TH>Status</TH>
            {can('manager') && <TH className="text-right">Actions</TH>}
          </TR>
        </THead>
        <TBody>
          {isLoading && <TableEmpty colSpan={5}>Loading team…</TableEmpty>}
          {!isLoading &&
            teamMembers.map((m) => (
              <TR key={m.id}>
                <TD>
                  <div className="flex items-center gap-3">
                    <Avatar name={m.name} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{m.name}</p>
                      <p className="truncate text-xs text-text-muted">{m.email}</p>
                    </div>
                  </div>
                </TD>
                <TD>{ROLE_LABELS[m.role] ?? m.role}</TD>
                <TD className="text-text-muted">
                  {m.locations.length === 0
                    ? 'All locations'
                    : m.locations.map((l) => l.name).join(', ')}
                </TD>
                <TD>
                  {m.status === 'active' ? (
                    <Badge dot tone="success">
                      Active
                    </Badge>
                  ) : m.status === 'inactive' ? (
                    <Badge dot tone="neutral">
                      Inactive
                    </Badge>
                  ) : m.status === 'expired' ? (
                    <Badge dot tone="danger">
                      Expired
                    </Badge>
                  ) : (
                    <Badge dot tone="warning">
                      Invited
                    </Badge>
                  )}
                </TD>
                {can('manager') && (
                  <TD className="text-right">
                    <RowActions className="justify-end">
                      {!manageable(m) ? (
                        <span className="text-xs text-text-muted">—</span>
                      ) : m.status === 'invited' || m.status === 'expired' ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => resend(m)}
                            disabled={resending.isPending}
                          >
                            Resend
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => revoke(m)}
                            disabled={revocation.isPending}
                          >
                            Revoke
                          </Button>
                        </>
                      ) : m.status === 'inactive' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reactivate(m)}
                          disabled={reactivation.isPending}
                        >
                          Reactivate
                        </Button>
                      ) : (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(m)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => resetPassword(m)}
                            disabled={passwordReset.isPending}
                          >
                            Reset password
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger-700 dark:text-danger-100"
                            onClick={() => setPendingDeactivate(m)}
                          >
                            Deactivate
                          </Button>
                        </>
                      )}
                    </RowActions>
                  </TD>
                )}
              </TR>
            ))}
        </TBody>
      </Table>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite Team Member"
        footer={
          <>
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={sendInvite} disabled={invite.isPending}>
              Send Invite
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <TextField
            label="Email"
            type="email"
            placeholder="chef@restaurant.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <SelectField
            label="Role"
            required
            value={role}
            onChange={(e) => setRole(e.target.value as InvitableRole)}
            options={ASSIGNABLE}
          />
          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium">Location access</legend>
            <p className="mb-2 text-xs text-text-muted">{everywhereHint}</p>
            <div className="space-y-1.5">
              {offered.map((l) => (
                <Checkbox
                  key={l.id}
                  label={l.name}
                  checked={locationIds.includes(l.id)}
                  onChange={() => setLocationIds((ids) => toggle(ids, l.id))}
                />
              ))}
            </div>
          </fieldset>
        </div>
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Edit: ${editing?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveMember} disabled={memberUpdate.isPending}>
              Save Member
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <SelectField
            label="Role"
            value={editRole}
            onChange={(e) => setEditRole(e.target.value as InvitableRole)}
            options={ASSIGNABLE}
          />
          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium">Location access</legend>
            <p className="mb-2 text-xs text-text-muted">{everywhereHint}</p>
            <div className="space-y-1.5">
              {offered.map((l) => (
                <Checkbox
                  key={l.id}
                  label={l.name}
                  checked={editLocations.includes(l.id)}
                  onChange={() => setEditLocations((ids) => toggle(ids, l.id))}
                />
              ))}
            </div>
          </fieldset>
        </div>
      </Modal>

      <Modal
        open={inviteLink !== null}
        onClose={() => setInviteLink(null)}
        title="Share the invitation link"
        footer={
          <Button variant="secondary" onClick={() => setInviteLink(null)}>
            Close
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="text-sm">
            The invitation for <span className="font-medium">{inviteLink?.email}</span> is ready,
            but no mail provider is connected yet, so nothing was sent. Pass this link on yourself;
            it expires in 7 days.
          </p>
          <TextField
            label="Invitation link"
            readOnly
            value={inviteLink?.url ?? ''}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      </Modal>

      <Modal
        open={resetLink !== null}
        onClose={() => setResetLink(null)}
        title="Share the reset link"
        footer={
          <Button variant="secondary" onClick={() => setResetLink(null)}>
            Close
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="text-sm">
            A reset for <span className="font-medium">{resetLink?.email}</span> is ready, but no
            mail provider is connected yet, so nothing was sent. Pass this link on yourself; it
            expires in an hour, and using it signs the account out everywhere.
          </p>
          <TextField
            label="Reset link"
            readOnly
            value={resetLink?.url ?? ''}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDeactivate !== null}
        onClose={() => setPendingDeactivate(null)}
        onConfirm={() => pendingDeactivate && deactivation.mutate(pendingDeactivate)}
        title={`Deactivate ${pendingDeactivate?.name ?? ''}?`}
        confirmLabel="Deactivate"
        busy={deactivation.isPending}
      >
        They lose access immediately and every device is signed out. They stay in this list as
        inactive, and Reactivate brings them back with the same role and locations.
      </ConfirmDialog>
    </>
  )
}

export default function Page() {
  return (
    <RequireRole minRole="manager">
      <TeamPage />
    </RequireRole>
  )
}
