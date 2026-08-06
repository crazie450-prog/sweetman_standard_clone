'use client'

import { useQuery } from '@tanstack/react-query'
import { adminService } from '@/lib/api/services'

import { Badge, PageHeader, Table, TableEmpty, TBody, TD, TH, THead, TR } from '@/components/ui'
import { formatDate } from '@/lib/utils/format'

const statusTone = {
  active: 'success',
  trial: 'info',
  past_due: 'danger',
  canceled: 'neutral',
} as const

export default function AdminOrganizationsView() {
  const { data: adminOrganizations = [], isLoading } = useQuery({
    queryKey: ['admin-organizations'],
    queryFn: adminService.organizations,
  })

  return (
    <>
      <PageHeader title="Organizations" subtitle="Tenant organizations across the platform" />

      <Table>
        <THead>
          <TR>
            <TH>Organization</TH>
            <TH>Locations</TH>
            <TH>Users</TH>
            <TH>Subscription</TH>
            <TH>Trial ends</TH>
            <TH>Created</TH>
          </TR>
        </THead>
        <TBody>
          {isLoading && <TableEmpty colSpan={6}>Loading organizations…</TableEmpty>}
          {!isLoading && adminOrganizations.length === 0 && (
            <TableEmpty colSpan={6}>No organizations yet.</TableEmpty>
          )}
          {!isLoading &&
            adminOrganizations.map((o) => (
              <TR key={o.id}>
                <TD className="font-medium">{o.name}</TD>
                <TD>{o.locations}</TD>
                <TD>{o.users}</TD>
                <TD>
                  <Badge tone={statusTone[o.status as keyof typeof statusTone] ?? 'neutral'}>
                    {o.status === 'past_due' ? 'Past due' : o.status}
                  </Badge>
                </TD>
                <TD className="text-text-muted">
                  {o.trialEndsAt ? formatDate(o.trialEndsAt) : '—'}
                </TD>
                <TD className="text-text-muted">{formatDate(o.created)}</TD>
              </TR>
            ))}
        </TBody>
      </Table>
    </>
  )
}
