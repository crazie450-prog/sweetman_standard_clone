'use client'

import { useState } from 'react'
import {
  Badge,
  Button,
  ConfirmDialog,
  Modal,
  PageHeader,
  RowActions,
  SearchInput,
  SelectField,
  Table,
  TableEmpty,
  TBody,
  TD,
  TextField,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  categoriesService,
  ingredientsService,
  inventoryService,
  vendorsService,
  type Ingredient,
} from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { formatDate, formatMoney } from '@/lib/utils/format'

const UNITS = [
  { value: 'kg', label: 'Kilogram' },
  { value: 'g', label: 'Gram' },
  { value: 'l', label: 'Litre' },
  { value: 'ml', label: 'Millilitre' },
  { value: 'ea', label: 'Each' },
]

const EMPTY = {
  name: '',
  unit: 'kg',
  costPerUnit: '',
  onHand: '',
  reorderLevel: '',
  categoryId: '',
  vendorId: '',
  sku: '',
}

export default function IngredientsPage() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Ingredient | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [historyFor, setHistoryFor] = useState<Ingredient | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Ingredient | null>(null)
  const toast = useToast()
  const queryClient = useQueryClient()
  const { can } = useCurrentUser()

  const { data: ingredients = [], isLoading } = useQuery({
    queryKey: ['ingredients'],
    queryFn: ingredientsService.list,
  })
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: vendorsService.list })
  const { data: categories = [] } = useQuery({
    queryKey: ['categories', 'ingredient'],
    queryFn: () => categoriesService.list('ingredient'),
  })

  const rows = ingredients.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()))

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY)
    setOpen(true)
  }

  const openEdit = (i: Ingredient) => {
    setEditing(i)
    setForm({
      name: i.name,
      unit: i.unit,
      costPerUnit: String(i.costPerUnit),
      onHand: String(i.onHand),
      reorderLevel: String(i.reorderLevel),
      categoryId: i.categoryId ?? '',
      vendorId: i.vendorId ?? '',
      sku: i.sku ?? '',
    })
    setOpen(true)
  }

  async function submit() {
    const cost = parseFloat(form.costPerUnit)
    if (!form.name.trim() || !form.unit || Number.isNaN(cost) || cost < 0) {
      toast('danger', 'Name, unit and a cost per unit are required')
      return
    }
    setBusy(true)
    try {
      const payload = {
        name: form.name.trim(),
        unit: form.unit,
        costPerUnit: cost,
        reorderLevel: form.reorderLevel === '' ? undefined : parseFloat(form.reorderLevel),
        categoryId: form.categoryId || undefined,
        vendorId: form.vendorId || undefined,
        sku: form.sku.trim() || undefined,
      }
      if (editing) await ingredientsService.update(editing.id, payload)
      else
        await ingredientsService.create({
          ...payload,
          onHand: form.onHand === '' ? undefined : parseFloat(form.onHand),
        })
      await queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      await queryClient.invalidateQueries({ queryKey: ['inventory'] })
      setOpen(false)
      toast('success', editing ? 'Ingredient updated' : 'Ingredient added')
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const i = pendingDelete
    if (!i) return
    setBusy(true)
    try {
      await ingredientsService.remove(i.id)
      await queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      await queryClient.invalidateQueries({ queryKey: ['inventory'] })
      setPendingDelete(null)
      toast('success', `${i.name} deleted`)
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Ingredients"
        subtitle="Master list with prices and vendor relationships"
        actions={can('staff') ? <Button onClick={openCreate}>Add Ingredient</Button> : undefined}
      />

      <div className="mb-4">
        <SearchInput
          placeholder="Search ingredients…"
          className="w-64"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Ingredient</TH>
            <TH>Unit</TH>
            <TH>Cost / unit</TH>
            <TH>On hand</TH>
            <TH>Vendor</TH>
            <TH>Status</TH>
            {can('staff') && <TH className="text-right">Actions</TH>}
          </TR>
        </THead>
        <TBody>
          {isLoading ? (
            <TableEmpty colSpan={7}>Loading ingredients…</TableEmpty>
          ) : rows.length === 0 ? (
            <TableEmpty colSpan={7}>No ingredients found.</TableEmpty>
          ) : (
            rows.map((i) => (
              <TR key={i.id}>
                <TD className="font-medium">{i.name}</TD>
                <TD>{i.unit}</TD>
                <TD>{formatMoney(i.costPerUnit)}</TD>
                <TD>
                  {i.onHand} {i.unit}
                </TD>
                <TD className="text-text-muted">{i.vendor}</TD>
                <TD>
                  {i.status === 'low' ? (
                    <Badge dot tone="warning">
                      Low stock
                    </Badge>
                  ) : (
                    <Badge dot tone="success">
                      In stock
                    </Badge>
                  )}
                </TD>
                {can('staff') && (
                  <TD className="text-right">
                    <RowActions className="justify-end">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(i)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setHistoryFor(i)}>
                        Price history
                      </Button>
                      {can('manager') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger-700 dark:text-danger-100"
                          onClick={() => setPendingDelete(i)}
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

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit Ingredient' : 'Add Ingredient'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {editing ? 'Save Ingredient' : 'Add Ingredient'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Name"
            placeholder="e.g. Olive Oil"
            required
            className="sm:col-span-2"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <SelectField
            label="Unit"
            required
            value={form.unit}
            onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
            options={UNITS}
          />
          <TextField
            label="Cost per unit"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            required
            value={form.costPerUnit}
            onChange={(e) => setForm((f) => ({ ...f, costPerUnit: e.target.value }))}
          />
          <SelectField
            label="Category"
            placeholder="Uncategorized"
            value={form.categoryId}
            onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
          <SelectField
            label="Vendor"
            placeholder="No vendor"
            value={form.vendorId}
            onChange={(e) => setForm((f) => ({ ...f, vendorId: e.target.value }))}
            options={vendors.map((v) => ({ value: v.id, label: v.name }))}
          />
          {editing ? (
            <div className="text-sm text-text-muted">
              <p className="font-medium text-text">On hand</p>
              <p className="mt-1">
                {editing.onHand} {editing.unit} — change it from Inventory, so the movement is
                recorded.
              </p>
            </div>
          ) : (
            <TextField
              label="On hand"
              help="Opening balance"
              type="number"
              min="0"
              step="0.1"
              value={form.onHand}
              onChange={(e) => setForm((f) => ({ ...f, onHand: e.target.value }))}
            />
          )}
          <TextField
            label="Reorder level"
            type="number"
            min="0"
            step="0.1"
            value={form.reorderLevel}
            onChange={(e) => setForm((f) => ({ ...f, reorderLevel: e.target.value }))}
          />
          <TextField
            label="SKU"
            help="Optional vendor code"
            className="sm:col-span-2"
            value={form.sku}
            onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={remove}
        title={`Delete ${pendingDelete?.name ?? 'ingredient'}?`}
        busy={busy}
      >
        The ingredient, its stock on every location and its recorded price history go with it.
        Recipes that use it will refuse the deletion instead. This cannot be undone.
      </ConfirmDialog>

      <PriceHistoryModal ingredient={historyFor} onClose={() => setHistoryFor(null)} />
    </>
  )
}

function PriceHistoryModal({
  ingredient,
  onClose,
}: {
  ingredient: Ingredient | null
  onClose: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['price-history', ingredient?.id],
    queryFn: () => inventoryService.priceHistory(ingredient!.id),
    enabled: Boolean(ingredient),
  })
  const records = data?.records ?? []

  return (
    <Modal
      open={Boolean(ingredient)}
      onClose={onClose}
      title={ingredient ? `Price history — ${ingredient.name}` : 'Price history'}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {isLoading ? (
        <p className="py-6 text-center text-sm text-text-muted">Loading…</p>
      ) : records.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">
          No price records yet. They appear when the cost is edited or stock is received with a
          known invoice amount.
        </p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Cost / unit</TH>
              <TH>Vendor</TH>
              <TH>Location</TH>
              <TH>Source</TH>
            </TR>
          </THead>
          <TBody>
            {records.map((r) => (
              <TR key={r.id}>
                <TD>{formatDate(r.recordedAt)}</TD>
                <TD className="tabular-nums">{formatMoney(r.costPerUnit)}</TD>
                <TD className="text-text-muted">{r.vendor || '—'}</TD>
                <TD className="text-text-muted">{r.location || 'All locations'}</TD>
                <TD>
                  <Badge tone={r.source === 'receipt' ? 'info' : 'neutral'}>
                    {r.source === 'receipt' ? 'Received' : 'Manual'}
                  </Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Modal>
  )
}
