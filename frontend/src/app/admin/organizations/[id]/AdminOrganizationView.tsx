'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  PageHeader,
  Table,
  TableEmpty,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui'
import { adminService, ROLE_LABELS } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { formatDate } from '@/lib/utils/format'
import { AdminUserActions, userStatus } from '@/components/admin/AdminUserActions'
import {
  billingDate,
  planLabel,
  subscriptionLabel,
  subscriptionTone,
} from '../AdminOrganizationsView'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

const DOCUMENT_STATUSES: { key: string; label: string }[] = [
  { key: 'queued', label: 'Queued' },
  { key: 'processing', label: 'Processing' },
  { key: 'requires_review', label: 'Requires review' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'partially_processed', label: 'Partially processed' },
  { key: 'failed', label: 'Failed' },
]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-text-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}

export default function AdminOrganizationView({ id }: { id: string }) {
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  const toast = useToast()
  const [pendingAccess, setPendingAccess] = useState<boolean | null>(null)
  const { data: org, isLoading, error } = useQuery(queries.adminOrganization(id))

  const access = useMutation({
    mutationFn: (isActive: boolean) => adminService.updateOrganization(id, { isActive }),
    onSuccess: (next) => {
      qc.setQueryData(queries.adminOrganization(id).queryKey, next)
      void invalidate('admin-organizations')
      setPendingAccess(null)
      toast(
        'success',
        next.isActive
          ? `${next.name} can sign in again`
          : `${next.name} is deactivated; every member is signed out`
      )
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not change access')),
  })

  if (isLoading) return <p className="text-sm text-text-muted">Loading organization…</p>
  if (error || !org) {
    return (
      <p className="text-sm text-text-muted">
        {serverMessage(error, 'This organization could not be found.')}{' '}
        <Link href="/admin/organizations" className="text-primary-700 hover:underline">
          Back to organizations
        </Link>
      </p>
    )
  }

  const documentTotal = Object.values(org.documents).reduce((a, b) => a + b, 0)

  return (
    <>
      <PageHeader
        title={org.name}
        subtitle={`${org.ownerEmail} · ${org.slug}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={org.isActive ? 'success' : 'danger'}>
              {org.isActive ? 'Active' : 'Deactivated'}
            </Badge>
            {org.isActive ? (
              <Button variant="danger" onClick={() => setPendingAccess(false)}>
                Deactivate organization
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setPendingAccess(true)}>
                Reactivate organization
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Profile</h2>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Field label="Owner">{org.ownerName || org.ownerEmail}</Field>
            <Field label="Created">{formatDate(org.created)}</Field>
            <Field label="Country">{org.country}</Field>
            <Field label="Time zone">{org.timezone}</Field>
            <Field label="Currency">{org.currency}</Field>
            <Field label="Food-cost target">{org.subscription.foodCostTargetPct}%</Field>
          </dl>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Subscription</h2>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Field label="Status">
              <Badge
                tone={
                  subscriptionTone[org.subscription.status as keyof typeof subscriptionTone] ??
                  'neutral'
                }
              >
                {subscriptionLabel(org.subscription.status)}
              </Badge>
            </Field>
            <Field label="Plan">
              {planLabel(org.subscription.planId, org.subscription.status)}
            </Field>
            <Field label="Period">{billingDate(org.subscription)}</Field>
            <Field label="Billed locations">{org.subscription.seats ?? '—'}</Field>
            <Field label="Billing customer">
              {org.subscription.stripeCustomerId ?? (
                <span className="font-normal text-text-muted">Not connected to billing yet</span>
              )}
            </Field>
            <Field label="Documents">
              {documentTotal === 0 ? (
                <span className="font-normal text-text-muted">None uploaded</span>
              ) : (
                DOCUMENT_STATUSES.filter((s) => org.documents[s.key])
                  .map((s) => `${org.documents[s.key]} ${s.label.toLowerCase()}`)
                  .join(' · ')
              )}
            </Field>
          </dl>
        </Card>
      </div>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Locations</h2>
        <Table>
          <THead>
            <TR>
              <TH>Location</TH>
              <TH>Address</TH>
              <TH>Assigned members</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {org.locations.length === 0 && <TableEmpty colSpan={4}>No locations.</TableEmpty>}
            {org.locations.map((l) => (
              <TR key={l.id}>
                <TD className="font-medium">
                  {l.name}
                  {l.isDefault && (
                    <Badge tone="info" className="ml-2">
                      Default
                    </Badge>
                  )}
                </TD>
                <TD className="text-text-muted">{l.address || '—'}</TD>
                <TD>{l.assignedUsers === 0 ? 'Everyone' : l.assignedUsers}</TD>
                <TD>
                  <Badge tone={l.isActive ? 'success' : 'neutral'}>
                    {l.isActive ? 'Active' : 'Archived'}
                  </Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Members</h2>
        <Table>
          <THead>
            <TR>
              <TH>Member</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Last sign-in</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {org.users.length === 0 && <TableEmpty colSpan={5}>No members.</TableEmpty>}
            {org.users.map((u) => {
              const status = userStatus(u)
              return (
                <TR key={u.id}>
                  <TD>
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-text-muted">{u.email}</p>
                  </TD>
                  <TD>{ROLE_LABELS[u.role] ?? u.role}</TD>
                  <TD>
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {u.lockedUntil && u.isActive && (
                      <p className="mt-1 text-xs text-text-muted">
                        until {new Date(u.lockedUntil).toLocaleTimeString()}
                      </p>
                    )}
                  </TD>
                  <TD className="text-text-muted">
                    {u.lastSignIn ? formatDate(u.lastSignIn) : 'Never'}
                  </TD>
                  <TD className="text-right">
                    <AdminUserActions user={u} />
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      </section>

      <ConfirmDialog
        open={pendingAccess !== null}
        onClose={() => setPendingAccess(null)}
        onConfirm={() => access.mutate(pendingAccess === true)}
        title={pendingAccess ? `Reactivate ${org.name}?` : `Deactivate ${org.name}?`}
        confirmLabel={pendingAccess ? 'Reactivate' : 'Deactivate'}
        busy={access.isPending}
      >
        {pendingAccess
          ? 'Every member can sign in again with the password they already have.'
          : 'Every member is signed out immediately and cannot sign in until the organization is reactivated. Nothing they recorded is removed.'}
      </ConfirmDialog>
    </>
  )
}
