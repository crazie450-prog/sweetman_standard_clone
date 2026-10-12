'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Badge,
  PageHeader,
  SearchInput,
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
import { ROLE_LABELS } from '@/lib/api/services'
import { formatDate } from '@/lib/utils/format'
import { AdminUserActions, userStatus } from '@/components/admin/AdminUserActions'
import { queries } from '@/lib/api/queries'

export default function AdminUsersPage() {
  const [q, setQ] = useState('')
  const needle = q.trim()
  const [offset, setOffset] = usePageOffset(needle)
  const { data: page, isLoading } = useQuery({
    ...queries.adminUsers(needle, { offset, limit: PAGE_SIZE }),
    enabled: needle.length > 0,
  })
  const users = needle ? (page?.data ?? []) : []

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Find an account in any organization by its email or name, then unlock it, reset its password or switch its access."
      />

      <SearchInput
        label="Search users"
        placeholder="Email or name"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-4 w-full sm:w-96"
        autoFocus
      />

      <Table>
        <THead>
          <TR>
            <TH>User</TH>
            <TH>Organization</TH>
            <TH>Role</TH>
            <TH>Status</TH>
            <TH>Last sign-in</TH>
            <TH className="text-right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {!needle && (
            <TableEmpty colSpan={6}>Type part of an email or a name to search.</TableEmpty>
          )}
          {needle && isLoading && <TableEmpty colSpan={6}>Searching…</TableEmpty>}
          {needle && !isLoading && users.length === 0 && (
            <TableEmpty colSpan={6}>No account matches.</TableEmpty>
          )}
          {needle &&
            !isLoading &&
            users.map((u) => {
              const status = userStatus(u)
              return (
                <TR key={u.id}>
                  <TD>
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-text-muted">{u.email}</p>
                  </TD>
                  <TD>
                    <Link
                      href={`/admin/organizations/${u.organization.id}`}
                      className="text-primary-700 hover:underline dark:text-primary-300"
                    >
                      {u.organization.name}
                    </Link>
                    {!u.organization.isActive && (
                      <Badge tone="danger" className="ml-2">
                        Deactivated
                      </Badge>
                    )}
                  </TD>
                  <TD>{ROLE_LABELS[u.role] ?? u.role}</TD>
                  <TD>
                    <Badge tone={status.tone}>{status.label}</Badge>
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
      <Pager
        page={needle ? page?.pagination : undefined}
        onOffset={setOffset}
        label="Account pages"
      />
    </>
  )
}
