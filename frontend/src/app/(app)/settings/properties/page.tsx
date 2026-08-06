'use client'

import { RequireRole } from '@/components/layout/RequireRole'
import { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Modal,
  PageHeader,
  TextField,
  useToast,
} from '@/components/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { locationsService, type LocationDetail } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'

const EMPTY = { name: '', address: '', phone: '' }

function LocationsPage() {
  const { data: locations = [] } = useQuery({
    queryKey: ['locations-all'],
    queryFn: locationsService.listAll,
  })
  const queryClient = useQueryClient()
  const { can } = useCurrentUser()
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<LocationDetail | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [pendingArchive, setPendingArchive] = useState<LocationDetail | null>(null)

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY)
    setOpen(true)
  }

  const openEdit = (l: LocationDetail) => {
    setEditing(l)
    setForm({ name: l.name, address: l.address ?? '', phone: l.phone ?? '' })
    setOpen(true)
  }

  async function submit() {
    if (!form.name.trim()) {
      toast('danger', 'Property name is required')
      return
    }
    setBusy(true)
    try {
      const payload = {
        name: form.name.trim(),
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
      }
      if (editing) await locationsService.update(editing.id, payload)
      else await locationsService.create(payload)
      await queryClient.invalidateQueries({ queryKey: ['locations-all'] })
      await queryClient.invalidateQueries({ queryKey: ['locations'] })
      setOpen(false)
      toast('success', editing ? 'Property updated' : 'Property created')
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function archive() {
    const l = pendingArchive
    if (!l) return
    setBusy(true)
    try {
      await locationsService.remove(l.id)
      await queryClient.invalidateQueries({ queryKey: ['locations-all'] })
      await queryClient.invalidateQueries({ queryKey: ['locations'] })
      setPendingArchive(null)
      toast('success', `${l.name} archived`)
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function restore(l: LocationDetail) {
    try {
      await locationsService.restore(l.id)
      await queryClient.invalidateQueries({ queryKey: ['locations-all'] })
      await queryClient.invalidateQueries({ queryKey: ['locations'] })
      toast('success', `${l.name} restored`)
    } catch (e) {
      toast('danger', serverMessage(e))
    }
  }

  return (
    <>
      <PageHeader
        title="Property Management"
        subtitle="Manage your restaurant locations and properties"
        actions={
          can('admin') ? (
            <Button variant="primary" onClick={openCreate}>
              + Add Property
            </Button>
          ) : undefined
        }
      />

      {locations.length === 0 && (
        <EmptyState
          title="No properties found"
          action={
            can('admin') ? (
              <Button onClick={openCreate}>+ Create Your First Property</Button>
            ) : undefined
          }
        />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {locations.map((l, i) => (
          <Card key={l.id} className="lift rise" style={{ '--i': i } as React.CSSProperties}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary-100 to-primary-50 text-primary-800 dark:from-primary-900/50 dark:to-primary-900/20 dark:text-primary-200"
                  aria-hidden
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-4"
                  >
                    <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <h2 className="line-clamp-2 text-lg font-semibold">{l.name}</h2>
                  {l.address && <p className="mt-0.5 text-sm text-text-muted">{l.address}</p>}
                  {l.phone && <p className="text-sm text-text-muted">{l.phone}</p>}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {l.isDefault && (
                  <Badge dot tone="primary">
                    Default
                  </Badge>
                )}
                {!l.isActive && (
                  <Badge dot tone="slate">
                    Archived
                  </Badge>
                )}
              </div>
            </div>
            {can('admin') && (
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => openEdit(l)}>
                  Edit
                </Button>
                {l.isActive ? (
                  <Button variant="ghost" size="sm" onClick={() => setPendingArchive(l)}>
                    Archive
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => restore(l)}>
                    Restore
                  </Button>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit Property' : 'Add Property'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {editing ? 'Save Property' : 'Create Property'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <TextField
            label="Property name"
            placeholder="e.g. Golden Fork — Harbor"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <TextField
            label="Address"
            placeholder="Street, city"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          />
          <TextField
            label="Phone"
            type="tel"
            placeholder="(555) 123-4567"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingArchive !== null}
        onClose={() => setPendingArchive(null)}
        onConfirm={archive}
        title={`Archive ${pendingArchive?.name ?? 'property'}?`}
        confirmLabel="Archive"
        busy={busy}
      >
        The property disappears from location pickers across the app. Its data stays and you can
        restore it from this page.
      </ConfirmDialog>
    </>
  )
}

export default function Page() {
  return (
    <RequireRole minRole="manager">
      <LocationsPage />
    </RequireRole>
  )
}
