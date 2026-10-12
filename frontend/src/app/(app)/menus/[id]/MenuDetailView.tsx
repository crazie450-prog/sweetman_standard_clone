'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Badge,
  Button,
  Checkbox,
  KpiCard,
  Modal,
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
import { menusService } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { formatMoney, formatPercent } from '@/lib/utils/format'
import { aboveTarget, percentOf } from '@/lib/utils/money'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

export default function MenuDetailView({ id }: { id: string }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const { can } = useCurrentUser()
  const manage = can('manager')

  const { data: menu, isLoading, isError } = useQuery(queries.menu(id))
  const { data: allItems = [] } = useQuery({
    ...queries.menuAvailableItems(id),
    enabled: manage,
  })

  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [q, setQ] = useState('')

  const itemsChange = useMutation({
    mutationFn: ({ menuItemIds }: { menuItemIds: string[]; message: string }) =>
      menusService.update(id, { menuItemIds }),
    onSuccess: async (_, { message }) => {
      await invalidate('menus')
      toast('success', message)
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  if (isError) {
    return (
      <p className="text-sm text-text-muted">
        This menu could not be found.{' '}
        <Link href="/menus" className="underline">
          Back to Menus
        </Link>
      </p>
    )
  }
  if (isLoading || !menu) return <p className="text-sm text-text-muted">Loading menu…</p>

  const onMenu = new Set(menu.items.map((i) => i.id))
  const available = allItems.filter(
    (i) => !onMenu.has(i.id) && i.name.toLowerCase().includes(q.trim().toLowerCase())
  )

  const openAdd = () => {
    setPicked([])
    setQ('')
    setAdding(true)
  }

  function addPicked() {
    itemsChange.mutate(
      {
        menuItemIds: [...menu!.items.map((i) => i.id), ...picked],
        message: `${picked.length} ${picked.length === 1 ? 'dish' : 'dishes'} added to ${menu!.name}`,
      },
      { onSuccess: () => setAdding(false) }
    )
  }

  return (
    <>
      <Link
        href="/menus"
        className="mb-3 inline-block text-sm text-text-muted underline hover:text-text"
      >
        All menus
      </Link>
      <PageHeader
        title={menu.name}
        subtitle={
          menu.locations.length > 0
            ? `Served at ${menu.locations.map((l) => l.name).join(', ')}`
            : 'Not served at any location yet'
        }
        actions={
          manage ? (
            <div className="flex flex-wrap gap-2">
              <Link href={`/menu?menu=${menu.id}`}>
                <Button variant="secondary">New dish on this menu</Button>
              </Link>
              <Button onClick={openAdd}>Add dishes</Button>
            </div>
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Dishes served"
          value={String(menu.analytics.items)}
          valueClass="text-2xl"
          hint={
            menu.items.length > menu.analytics.items
              ? `${menu.items.length - menu.analytics.items} not served`
              : undefined
          }
        />
        <KpiCard
          label="Menu price"
          value={formatMoney(menu.analytics.price)}
          valueClass="text-2xl"
        />
        <KpiCard label="Menu cost" value={formatMoney(menu.analytics.cost)} valueClass="text-2xl" />
        <KpiCard
          label="Food cost %"
          value={formatPercent(menu.analytics.foodCostPct)}
          valueClass="text-2xl"
          hint={`Target ${menu.analytics.target}%`}
        />
      </div>

      <Table pinActions={manage}>
        <THead>
          <TR>
            <TH>Dish</TH>
            <TH>Section</TH>
            <TH>Location</TH>
            <TH className="text-right">Price</TH>
            <TH className="text-right">Cost</TH>
            <TH className="text-right">Food cost %</TH>
            {manage && <TH className="text-right">Actions</TH>}
          </TR>
        </THead>
        <TBody>
          {menu.items.length === 0 ? (
            <TableEmpty colSpan={manage ? 7 : 6}>
              No dishes on this menu yet.
              {manage ? ' Add dishes or upload the menu from a file.' : ''}
            </TableEmpty>
          ) : (
            menu.items.map((i) => {
              const costed = i.recipes.length > 0
              const share = costed ? percentOf(i.cost, i.price) : null
              return (
                <TR key={i.id}>
                  <TD className="font-medium">
                    {i.name}
                    {!i.active && (
                      <Badge tone="slate" className="ml-2">
                        Not served
                      </Badge>
                    )}
                  </TD>
                  <TD className="text-text-muted">{i.category || '—'}</TD>
                  <TD className="text-text-muted">{i.location || 'All locations'}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(i.price)}</TD>
                  <TD className="text-right tabular-nums">
                    {costed ? (
                      formatMoney(i.cost)
                    ) : (
                      <span className="text-text-muted">No recipe</span>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {share === null ? (
                      '—'
                    ) : aboveTarget(share, menu.analytics.target) ? (
                      <Badge tone="warning">{formatPercent(share)}</Badge>
                    ) : (
                      formatPercent(share)
                    )}
                  </TD>
                  {manage && (
                    <TD className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={itemsChange.isPending}
                        onClick={() =>
                          itemsChange.mutate({
                            menuItemIds: menu.items.filter((x) => x.id !== i.id).map((x) => x.id),
                            message: `${i.name} taken off ${menu.name}`,
                          })
                        }
                      >
                        Remove
                      </Button>
                    </TD>
                  )}
                </TR>
              )
            })
          )}
        </TBody>
      </Table>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title={`Add dishes to ${menu.name}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button onClick={addPicked} disabled={itemsChange.isPending || picked.length === 0}>
              Add {picked.length > 0 ? picked.length : ''} to menu
            </Button>
          </>
        }
      >
        {adding && (
          <div className="space-y-3">
            <SearchInput
              placeholder="Search dishes…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {available.length === 0 ? (
              <p className="text-sm text-text-muted">
                Every dish is already on this menu, or none matches the search.
              </p>
            ) : (
              <div className="max-h-72 space-y-1.5 overflow-y-auto">
                {available.map((i) => (
                  <Checkbox
                    key={i.id}
                    label={`${i.name} · ${formatMoney(i.price)}${i.location ? ` · ${i.location}` : ''}`}
                    checked={picked.includes(i.id)}
                    onChange={() =>
                      setPicked((ids) =>
                        ids.includes(i.id) ? ids.filter((x) => x !== i.id) : [...ids, i.id]
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
