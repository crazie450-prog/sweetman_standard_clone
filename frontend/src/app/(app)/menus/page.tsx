'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Modal,
  PageHeader,
  RowActions,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TextField,
  useToast,
} from '@/components/ui'
import { menusService, type Menu } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { useActiveLocation } from '@/lib/api/useActiveLocation'
import { formatMoney, formatPercent } from '@/lib/utils/format'
import { DocumentUploadButton, PendingReview } from '@/components/documents/DocumentUpload'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

const EMPTY = {
  name: '',
  description: '',
  isActive: true,
  locationIds: [] as string[],
  menuItemIds: [] as string[],
}

const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]

const servedAt = (dish: { locationId: string | null }, locationIds: string[]) =>
  dish.locationId === null || locationIds.length === 0 || locationIds.includes(dish.locationId)

export default function MenusPage() {
  const invalidate = useInvalidate()
  const toast = useToast()
  const { can, changesHere, worksEverywhere } = useCurrentUser()
  const mayChange = (menu: Menu) =>
    menu.locations.length === 0 ? worksEverywhere : menu.locations.some((l) => changesHere(l.id))
  const mayDelete = (menu: Menu) =>
    menu.locations.length === 0 ? worksEverywhere : menu.locations.every((l) => changesHere(l.id))
  const activeLocation = useActiveLocation()

  const { data: menus = [], isLoading } = useQuery(queries.menus())
  const { data: locations = [] } = useQuery(queries.locations())
  const { data: menuItems = [] } = useQuery(queries.menuItems())

  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Menu | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [pendingDelete, setPendingDelete] = useState<Menu | null>(null)

  function openCreate() {
    setEditing(null)
    const start = activeLocation.id || (worksEverywhere ? '' : (locations[0]?.id ?? ''))
    setForm({ ...EMPTY, locationIds: start ? [start] : [] })
    setOpen(true)
  }

  async function openEdit(menu: Menu) {
    setEditing(menu)
    try {
      const full = await queryClient.fetchQuery(queries.menu(menu.id))
      setForm({
        name: full.name,
        description: full.description,
        isActive: full.isActive,
        locationIds: full.locations.map((l) => l.id),
        menuItemIds: full.items.map((i) => i.id),
      })
      setOpen(true)
    } catch (e) {
      toast('danger', serverMessage(e, 'Could not open the menu'))
    }
  }

  const saving = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        description: form.description || undefined,
        isActive: form.isActive,
        locationIds: form.locationIds,
        menuItemIds: form.menuItemIds,
      }
      return editing ? menusService.update(editing.id, payload) : menusService.create(payload)
    },
    onSuccess: async () => {
      await invalidate('menus')
      setOpen(false)
      toast('success', editing ? 'Menu updated' : 'Menu created')
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  const removal = useMutation({
    mutationFn: (menu: Menu) => menusService.remove(menu.id),
    onSuccess: async (_, menu) => {
      await invalidate('menus')
      setPendingDelete(null)
      toast('success', `${menu.name} deleted`)
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  return (
    <>
      <PageHeader
        title="Menus"
        subtitle={
          activeLocation.name
            ? `Menus served at ${activeLocation.name}, and menus not assigned to any location yet`
            : 'Named collections of menu items, assigned to the locations that serve them'
        }
        actions={
          <>
            <DocumentUploadButton type="menu" label="Upload menu" />
            {can('manager') && <Button onClick={openCreate}>New Menu</Button>}
          </>
        }
      />

      <PendingReview type="menu" />

      {!isLoading && menus.length === 0 ? (
        <EmptyState
          title={activeLocation.name ? `No menus at ${activeLocation.name} yet` : 'No menus yet'}
          hint="A menu groups the items a location serves, and reports what they cost together."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Menu</TH>
              <TH>Locations</TH>
              <TH className="text-right">Items</TH>
              <TH className="text-right">Menu price</TH>
              <TH className="text-right">Menu cost</TH>
              <TH className="text-right">Food cost %</TH>
              <TH className="text-right">Over target</TH>
              {can('manager') && <TH className="text-right">Actions</TH>}
            </TR>
          </THead>
          <TBody>
            {isLoading ? (
              <TR>
                <TD colSpan={8}>Loading menus…</TD>
              </TR>
            ) : (
              menus.map((m) => (
                <TR key={m.id}>
                  <TD className="font-medium">
                    <Link
                      href={`/menus/${m.id}`}
                      className="text-primary-700 hover:underline dark:text-primary-300"
                    >
                      {m.name}
                    </Link>
                    {!m.isActive && (
                      <Badge tone="neutral" className="ml-2">
                        Inactive
                      </Badge>
                    )}
                  </TD>
                  <TD className="text-text-muted">
                    {m.locations.length === 0
                      ? 'Not assigned'
                      : m.locations.map((l) => l.name).join(', ')}
                  </TD>
                  <TD className="text-right tabular-nums">{m.analytics.items}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(m.analytics.price)}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(m.analytics.cost)}</TD>
                  <TD className="text-right tabular-nums">
                    {formatPercent(m.analytics.foodCostPct)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {m.analytics.overTarget > 0 ? (
                      <Badge tone="warning">{m.analytics.overTarget}</Badge>
                    ) : (
                      <span className="text-text-muted">0</span>
                    )}
                  </TD>
                  {can('manager') && (
                    <TD className="text-right">
                      <RowActions className="!flex-nowrap justify-end">
                        {mayChange(m) && (
                          <Button variant="ghost" size="sm" onClick={() => void openEdit(m)}>
                            Edit
                          </Button>
                        )}
                        {mayDelete(m) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger-700 dark:text-danger-100"
                            onClick={() => setPendingDelete(m)}
                          >
                            Delete
                          </Button>
                        )}
                      </RowActions>
                    </TD>
                  )}
                </TR>
              ))
            )}
          </TBody>
        </Table>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit: ${editing.name}` : 'New menu'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saving.mutate()}
              disabled={saving.isPending || !form.name.trim()}
            >
              {editing ? 'Save Menu' : 'Create Menu'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <TextField
            label="Name"
            required
            placeholder="e.g. Dinner"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <TextField
            label="Description"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium">Served at</legend>
            <p className="mb-2 text-xs text-text-muted">
              A menu with no location is a draft nobody serves yet. All locations ticks every
              location there is now; one added later is ticked here by hand.
            </p>
            <div className="space-y-1.5">
              <Checkbox
                label="All locations"
                checked={
                  locations.length > 0 && locations.every((l) => form.locationIds.includes(l.id))
                }
                onChange={() =>
                  setForm((f) => ({
                    ...f,
                    locationIds: locations.every((l) => f.locationIds.includes(l.id))
                      ? []
                      : locations.map((l) => l.id),
                  }))
                }
              />
              {locations.map((l) => (
                <Checkbox
                  key={l.id}
                  label={l.name}
                  checked={form.locationIds.includes(l.id)}
                  onChange={() =>
                    setForm((f) => ({ ...f, locationIds: toggle(f.locationIds, l.id) }))
                  }
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium">Status</legend>
            <Checkbox
              label="Active: the menu is in service"
              checked={form.isActive}
              onChange={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
            />
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium">Items on this menu</legend>
            <p className="mb-2 text-xs text-text-muted">
              Dishes sold at every location, or at a location ticked above.
            </p>
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {menuItems
                .filter((i) => servedAt(i, form.locationIds) || form.menuItemIds.includes(i.id))
                .map((i) => (
                  <Checkbox
                    key={i.id}
                    label={`${i.name}${i.location ? ` (${i.location})` : ''}${
                      servedAt(i, form.locationIds) ? '' : ' · not served where this menu is'
                    }`}
                    checked={form.menuItemIds.includes(i.id)}
                    onChange={() =>
                      setForm((f) => ({ ...f, menuItemIds: toggle(f.menuItemIds, i.id) }))
                    }
                  />
                ))}
            </div>
          </fieldset>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && removal.mutate(pendingDelete)}
        title={`Delete ${pendingDelete?.name ?? 'menu'}?`}
        busy={removal.isPending}
      >
        The menu itself goes; the items it grouped stay in the catalogue, with their recipes and
        prices.
      </ConfirmDialog>
    </>
  )
}
