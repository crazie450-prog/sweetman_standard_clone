'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  KpiCard,
  Badge,
  Button,
  PageHeader,
  SearchInput,
  Table,
  TableEmpty,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui'
import { useQuery } from '@tanstack/react-query'
import { recipesService } from '@/lib/api/services'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { formatMoney } from '@/lib/utils/format'

export default function ComponentsPage() {
  const { data: recipes = [], isLoading } = useQuery({
    queryKey: ['recipes'],
    queryFn: recipesService.list,
  })
  const toast = useToast()
  const { can } = useCurrentUser()
  const [q, setQ] = useState('')

  const components = recipes.filter((r) => r.category === 'Components')
  const rows = components.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <PageHeader
        title="Component Library"
        subtitle="Manage reusable recipe components across your organization"
        actions={
          can('staff') ? (
            <>
              <Button
                variant="secondary"
                onClick={() => toast('info', 'Duplicate detection is not available yet')}
              >
                Find Duplicates
              </Button>
              <Link href="/recipes/new">
                <Button variant="primary">New Component</Button>
              </Link>
            </>
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Components" value={components.length} tone="primary" />
        <KpiCard
          label="Avg Batch Cost"
          value={formatMoney(components.reduce((t, c) => t + c.cost, 0) / (components.length || 1))}
          tone="info"
        />
        <KpiCard
          label="Used in Recipes"
          value={components.reduce((t, c) => t + c.usedIn, 0)}
          hint="parent links"
          tone="success"
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput
          label="Search components"
          placeholder="Search components..."
          className="w-64 grow sm:grow-0"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Component</TH>
            <TH>Batch cost</TH>
            <TH>Used in</TH>
            <TH>Status</TH>
          </TR>
        </THead>
        <TBody>
          {isLoading ? (
            <TableEmpty colSpan={4}>Loading components…</TableEmpty>
          ) : rows.length === 0 ? (
            <TableEmpty colSpan={4}>No components found.</TableEmpty>
          ) : (
            rows.map((c) => (
              <TR key={c.id}>
                <TD>
                  <Link
                    href={`/recipes/${c.id}`}
                    className="font-medium text-primary-700 underline dark:text-primary-400"
                  >
                    {c.name}
                  </Link>
                </TD>
                <TD>{formatMoney(c.cost)}</TD>
                <TD>
                  {c.usedIn > 0 ? (
                    <Badge tone="info">
                      {c.usedIn} parent recipe{c.usedIn === 1 ? '' : 's'}
                    </Badge>
                  ) : (
                    <span className="text-text-muted">not used yet</span>
                  )}
                </TD>
                <TD>
                  <Badge tone="success">Active</Badge>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </>
  )
}
