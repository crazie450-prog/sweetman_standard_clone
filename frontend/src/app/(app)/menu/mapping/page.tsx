'use client'

import { RequireRole } from '@/components/layout/RequireRole'
import { useState } from 'react'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Modal,
  PageHeader,
  SelectField,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TextField,
  useToast,
} from '@/components/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { documentsService, type MenuItemAlias } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { useActiveLocationId } from '@/lib/api/useActiveLocation'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

const EMPTY = { rawName: '', menuItemId: '' }

function SalesMappingPage() {
  const { data: aliases = [], isLoading } = useQuery(queries.menuItemAliases())
  const { data: menuItems = [] } = useQuery(queries.menuItems())
  const invalidate = useInvalidate()
  const { can, changesHere } = useCurrentUser()
  const toast = useToast()
  const activeLocationId = useActiveLocationId()
  const mayAdd = can('manager') && changesHere(activeLocationId || null)
  const mayChange = (row: MenuItemAlias) => can('manager') && changesHere(row.locationId)

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [pendingRemove, setPendingRemove] = useState<MenuItemAlias | null>(null)

  const optionsFor = (locationId: string | null) => [
    { value: '', label: 'Not mapped' },
    ...menuItems
      .filter((m) => m.locationId === null || m.locationId === locationId)
      .map((m) => ({ value: m.id, label: m.name })),
  ]
  const unmapped = aliases.filter((a) => !a.menuItemId).length

  const mapping = useMutation({
    mutationFn: ({ row, menuItemId }: { row: MenuItemAlias; menuItemId: string }) =>
      documentsService.mapMenuAlias(row.id, menuItemId || null),
    onSuccess: async (_, { row, menuItemId }) => {
      await invalidate('menu-item-aliases')
      toast(
        'success',
        menuItemId
          ? `"${row.rawName}" now reads as ${menuItems.find((x) => x.id === menuItemId)?.name}`
          : `"${row.rawName}" is no longer mapped`
      )
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not save the mapping')),
  })
  const savingId = mapping.isPending ? mapping.variables.row.id : null

  const map = (row: MenuItemAlias, menuItemId: string) => mapping.mutate({ row, menuItemId })

  const adding = useMutation({
    mutationFn: () =>
      documentsService.createMenuAlias(form.rawName.trim(), form.menuItemId || undefined),
    onSuccess: async () => {
      await invalidate('menu-item-aliases')
      toast('success', 'Name added')
      setOpen(false)
      setForm(EMPTY)
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not add the name')),
  })

  function submit() {
    if (!form.rawName.trim()) {
      toast('danger', 'A name is required')
      return
    }
    adding.mutate()
  }

  const removal = useMutation({
    mutationFn: (row: MenuItemAlias) => documentsService.removeMenuAlias(row.id),
    onSuccess: async () => {
      await invalidate('menu-item-aliases')
      toast('success', 'Name removed')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not remove the name')),
    onSettled: () => setPendingRemove(null),
  })

  return (
    <>
      <PageHeader
        title="Sales Mapping"
        subtitle="Dish names as a sales file writes them, against the menu items they mean. A name an imported sales file reaches no menu item by is parked here until someone maps it, under the location whose file carried it, because a dish belongs to the location that serves it. From then on every file from that location is counted. Sales already recorded are not replayed."
        actions={
          mayAdd ? (
            <Button variant="primary" onClick={() => setOpen(true)}>
              + Add Name
            </Button>
          ) : undefined
        }
      />

      {isLoading && <p className="text-sm text-text-muted">Loading…</p>}

      {!isLoading && aliases.length === 0 && (
        <EmptyState
          title="No dish names recorded"
          hint="A sales file naming a dish differently adds itself here the first time it is confirmed. Add one ahead of time when you already know the wording."
          action={mayAdd ? <Button onClick={() => setOpen(true)}>+ Add Name</Button> : undefined}
        />
      )}

      {aliases.length > 0 && (
        <>
          {unmapped > 0 && (
            <p className="mb-4 text-sm text-text-muted">
              {unmapped} {unmapped === 1 ? 'name reaches' : 'names reach'} no menu item yet.
            </p>
          )}
          <Table>
            <THead>
              <TR>
                <TH>Name in sales files</TH>
                <TH>Serves</TH>
                <TH>Reads as</TH>
                {can('manager') && <TH>Actions</TH>}
              </TR>
            </THead>
            <TBody>
              {aliases.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <span className="font-medium">{a.rawName}</span>
                    {!a.menuItemId && (
                      <Badge tone="warning" className="ml-2">
                        Unmapped
                      </Badge>
                    )}
                  </TD>
                  <TD>{a.locationName ?? 'All locations'}</TD>
                  <TD>
                    {mayChange(a) ? (
                      <SelectField
                        label="Reads as"
                        hideLabel
                        value={a.menuItemId ?? ''}
                        disabled={savingId === a.id}
                        onChange={(e) => map(a, e.target.value)}
                        options={optionsFor(a.locationId)}
                      />
                    ) : (
                      (a.menuItemName ?? '—')
                    )}
                  </TD>
                  {can('manager') && (
                    <TD>
                      {mayChange(a) && (
                        <Button variant="ghost" size="sm" onClick={() => setPendingRemove(a)}>
                          Remove
                        </Button>
                      )}
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add Name">
        <div className="grid gap-4">
          <TextField
            label="Name in sales files"
            help="Exactly as the sales file writes it"
            placeholder="CAESAR SALAD LG"
            value={form.rawName}
            onChange={(e) => setForm({ ...form, rawName: e.target.value })}
          />
          <SelectField
            label="Reads as"
            help={`Leave empty to record the name now and map it later. The name is parked ${activeLocationId ? 'at the location in the header' : 'for every location'}, so only dishes sold there are offered`}
            value={form.menuItemId}
            onChange={(e) => setForm({ ...form, menuItemId: e.target.value })}
            options={optionsFor(activeLocationId || null)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={adding.isPending}>
              {adding.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingRemove !== null}
        title="Remove this name?"
        confirmLabel="Remove"
        onClose={() => setPendingRemove(null)}
        onConfirm={() => pendingRemove && removal.mutate(pendingRemove)}
        busy={removal.isPending}
      >
        A sales file that uses it again will park it here once more, unmapped.
      </ConfirmDialog>
    </>
  )
}

export default function Page() {
  return (
    <RequireRole minRole="manager">
      <SalesMappingPage />
    </RequireRole>
  )
}
