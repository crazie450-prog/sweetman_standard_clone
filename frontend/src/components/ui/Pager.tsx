'use client'

import { useState } from 'react'
import { useActiveLocationId } from '@/lib/api/useActiveLocation'
import { Button } from './Button'

export const PAGE_SIZE = 50

type Pagination = { limit: number; offset: number; total: number }

export function usePageOffset(...resetWhen: unknown[]) {
  const locationId = useActiveLocationId()
  const key = JSON.stringify([locationId, ...resetWhen])
  const [state, setState] = useState({ key, offset: 0 })
  if (state.key !== key) setState({ key, offset: 0 })
  const offset = state.key === key ? state.offset : 0
  return [offset, (next: number) => setState({ key, offset: next })] as const
}

export function Pager({
  page,
  onOffset,
  label = 'Pages',
}: {
  page?: Pagination
  onOffset: (offset: number) => void
  label?: string
}) {
  if (!page || page.total <= page.limit) return null
  const first = Math.min(page.offset + 1, page.total)
  const last = Math.min(page.offset + page.limit, page.total)
  return (
    <nav
      aria-label={label}
      className="mt-3 flex items-center justify-center gap-3 text-sm text-text-muted"
    >
      <Button
        variant="secondary"
        size="sm"
        disabled={page.offset === 0}
        onClick={() => onOffset(Math.max(0, page.offset - page.limit))}
      >
        Previous
      </Button>
      <span>
        {first} to {last} of {page.total}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={last >= page.total}
        onClick={() => onOffset(page.offset + page.limit)}
      >
        Next
      </Button>
    </nav>
  )
}
