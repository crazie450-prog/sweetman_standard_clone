'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  Badge,
  PageHeader,
  SearchInput,
  SelectField,
  Table,
  TableEmpty,
  TBody,
  TD,
  TH,
  THead,
  TR,
  PAGE_SIZE,
  Pager,
  usePageOffset,
} from '@/components/ui'
import { formatDate } from '@/lib/utils/format'
import { queries } from '@/lib/api/queries'

export const subscriptionTone = {
  active: 'success',
  trial: 'info',
  past_due: 'danger',
  canceled: 'neutral',
} as const

export function subscriptionLabel(status: string) {
  return status === 'past_due' ? 'Past due' : status
}

export function planLabel(planId: string | null, status: string) {
  if (status === 'canceled') return '—'
  if (!planId) return status === 'trial' ? 'Trial' : '—'
  return planId.charAt(0).toUpperCase() + planId.slice(1)
}

export function billingDate(o: {
  status: string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
}) {
  if (o.status === 'trial') return o.trialEndsAt ? `Trial ends ${formatDate(o.trialEndsAt)}` : '—'
  if (o.status === 'canceled') return '—'
  return o.currentPeriodEnd ? `Period ends ${formatDate(o.currentPeriodEnd)}` : '—'
}

const STATUS_OPTIONS = [
  { value: '', label: 'Any subscription' },
  { value: 'trial', label: 'Trial' },
  { value: 'active', label: 'Active' },
  { value: 'past_due', label: 'Past due' },
  { value: 'canceled', label: 'Canceled' },
]

export default function AdminOrganizationsView() {
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [offset, setOffset] = usePageOffset(status, q)
  const { data: page, isLoading } = useQuery(
    queries.adminOrganizations({ status, q, offset, limit: PAGE_SIZE })
  )
  const adminOrganizations = page?.data ?? []

  return (
    <>
      <PageHeader
        title="Organizations"
        subtitle="Tenant organizations across the platform. Open one to see its locations, members and subscription."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchInput
          label="Search organizations"
          placeholder="Name or owner email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full sm:w-72"
        />
        <SelectField
          label="Subscription"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full sm:w-48"
          options={STATUS_OPTIONS}
        />
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Organization</TH>
            <TH>Locations</TH>
            <TH>Users</TH>
            <TH>Subscription</TH>
            <TH>Plan</TH>
            <TH>Period</TH>
            <TH>Access</TH>
            <TH>Created</TH>
          </TR>
        </THead>
        <TBody>
          {isLoading && <TableEmpty colSpan={8}>Loading organizations…</TableEmpty>}
          {!isLoading && adminOrganizations.length === 0 && (
            <TableEmpty colSpan={8}>No organizations match.</TableEmpty>
          )}
          {!isLoading &&
            adminOrganizations.map((o) => (
              <TR key={o.id}>
                <TD>
                  <Link
                    href={`/admin/organizations/${o.id}`}
                    className="font-medium text-primary-700 hover:underline dark:text-primary-300"
                  >
                    {o.name}
                  </Link>
                  <p className="text-xs text-text-muted">{o.ownerEmail}</p>
                </TD>
                <TD>{o.locations}</TD>
                <TD>{o.users}</TD>
                <TD>
                  <Badge
                    tone={subscriptionTone[o.status as keyof typeof subscriptionTone] ?? 'neutral'}
                  >
                    {subscriptionLabel(o.status)}
                  </Badge>
                </TD>
                <TD>{planLabel(o.planId, o.status)}</TD>
                <TD className="text-text-muted">{billingDate(o)}</TD>
                <TD>
                  <Badge tone={o.isActive ? 'success' : 'danger'}>
                    {o.isActive ? 'Active' : 'Deactivated'}
                  </Badge>
                </TD>
                <TD className="whitespace-nowrap text-text-muted">{formatDate(o.created)}</TD>
              </TR>
            ))}
        </TBody>
      </Table>
      <Pager page={page?.pagination} onOffset={setOffset} label="Organization pages" />
    </>
  )
}
