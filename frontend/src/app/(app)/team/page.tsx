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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  invitationsService,
  locationsService,
  teamService,
  INVITABLE_ROLES,
  ROLE_LABELS,
  type InvitableRole,
  type TeamMember,
} from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'

const ROLE_OPTIONS = INVITABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] ?? r }))

function TeamPage() {
  const { data: teamMembers = [], isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: teamService.list,
  })
  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: locationsService.list,
  })
  const queryClient = useQueryClient()
  const toast = useToast()
  const { can, user } = useCurrentUser()

  const editable = (m: TeamMember) => m.role !== 'owner' && m.email !== user?.email

  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitableRole>('staff')
  const [locationIds, setLocationIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null)
  const [pendingDeactivate, setPendingDeactivate] = useState<TeamMember | null>(null)

  const [editing, setEditing] = useState<TeamMember | null>(null)
  const [editRole, setEditRole] = useState<InvitableRole>('staff')
  const [editLocations, setEditLocations] = useState<string[]>([])

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  async function sendInvite() {
    if (!email.trim()) {
      toast('danger', 'Email is required')
      return
    }
    setBusy(true)
    try {
      const invited = email.trim()
      const delivery = await invitationsService.create({
        email: invited,
        role,
        locationIds: locationIds.length > 0 ? locationIds : undefined,
      })
      await queryClient.invalidateQueries({ queryKey: ['team'] })
      setInviteOpen(false)
      setEmail('')
      setLocationIds([])
      if (delivery.emailDelivered) {
        toast('success', 'Invitation sent — the link expires in 7 days')
      } else if (delivery.acceptUrl) {
        setInviteLink({ email: invited, url: delivery.acceptUrl })
      }
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function resend(m: TeamMember) {
    try {
      const delivery = await invitationsService.resend(m.id)
      await queryClient.invalidateQueries({ queryKey: ['team'] })
      if (delivery.emailDelivered) {
        toast('success', `Invitation re-sent to ${m.email}`)
      } else if (delivery.acceptUrl) {
        setInviteLink({ email: m.email, url: delivery.acceptUrl })
      }
    } catch (e) {
      toast('danger', serverMessage(e))
    }
  }

  async function revoke(m: TeamMember) {
    try {
      await invitationsService.revoke(m.id)
      await queryClient.invalidateQueries({ queryKey: ['team'] })
      toast('success', `Invitation for ${m.email} revoked`)
    } catch (e) {
      toast('danger', serverMessage(e))
    }
  }

  function openEdit(m: TeamMember) {
    setEditing(m)
    setEditRole(
      (INVITABLE_ROLES as readonly string[]).includes(m.role) ? (m.role as InvitableRole) : 'staff'
    )
    setEditLocations(m.locations.map((l) => l.id))
  }

  async function saveMember() {
    if (!editing) return
    setBusy(true)
    try {
      await teamService.update(editing.id, { role: editRole, locationIds: editLocations })
      await queryClient.invalidateQueries({ queryKey: ['team'] })
      setEditing(null)
      toast('success', 'Member updated')
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function deactivate() {
    if (!pendingDeactivate) return
    const member = pendingDeactivate
    setBusy(true)
    try {
      await teamService.deactivate(member.id)
      await queryClient.invalidateQueries({ queryKey: ['team'] })
      toast('success', `${member.name} deactivated`)
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setBusy(false)
      setPendingDeactivate(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Users, roles, and location access"
        actions={
          can('admin') ? (
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
            {can('admin') && <TH className="text-right">Actions</TH>}
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
                  ) : (
                    <Badge dot tone="warning">
                      Invited
                    </Badge>
                  )}
                </TD>
                {can('admin') && (
                  <TD className="text-right">
                    <RowActions className="justify-end">
                      {m.status === 'invited' ? (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => resend(m)}>
                            Resend
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => revoke(m)}>
                            Revoke
                          </Button>
                        </>
                      ) : editable(m) ? (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(m)}>
                            Edit
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
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
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
            <Button onClick={sendInvite} disabled={busy}>
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
            options={ROLE_OPTIONS}
          />
          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium">Location access</legend>
            <p className="mb-2 text-xs text-text-muted">
              Leave everything unchecked to grant access to all locations.
            </p>
            <div className="space-y-1.5">
              {locations.map((l) => (
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
        title={`Edit — ${editing?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveMember} disabled={busy}>
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
            options={ROLE_OPTIONS}
          />
          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium">Location access</legend>
            <p className="mb-2 text-xs text-text-muted">
              Leave everything unchecked to grant access to all locations.
            </p>
            <div className="space-y-1.5">
              {locations.map((l) => (
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
            but no mail provider is connected yet, so nothing was sent. Pass this link on yourself —
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

      <ConfirmDialog
        open={pendingDeactivate !== null}
        onClose={() => setPendingDeactivate(null)}
        onConfirm={deactivate}
        title={`Deactivate ${pendingDeactivate?.name ?? ''}?`}
        confirmLabel="Deactivate"
        busy={busy}
      >
        They lose access immediately, every device is signed out, and they leave this list. Only a
        new invitation brings them back.
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
