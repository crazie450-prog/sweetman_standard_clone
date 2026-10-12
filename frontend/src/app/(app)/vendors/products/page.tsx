'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
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
import {
  vendorProductsService,
  type VendorProduct,
  type VendorProductInput,
} from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { formatDate, formatMoney } from '@/lib/utils/format'
import { ingredientChoices, keepingCurrent, vendorChoices } from '@/lib/utils/options'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

const EMPTY = { name: '', vendorId: '', sku: '', ingredientId: '' }

export default function VendorProductsPage() {
  const [vendorFilter, setVendorFilter] = useState('')

  const { data: products = [], isLoading } = useQuery(queries.vendorProducts())
  const { data: vendors = [] } = useQuery(queries.vendors())
  const { data: ingredients = [] } = useQuery(queries.ingredients())

  const invalidate = useInvalidate()
  const { can } = useCurrentUser()
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState<VendorProduct | null>(null)
  const [pendingRemove, setPendingRemove] = useState<VendorProduct | null>(null)

  const vendorOptions = vendors.map((v) => ({ value: v.id, label: v.name }))
  const ingredientOptions = [{ value: '', label: 'Not mapped' }, ...ingredientChoices(ingredients)]

  const optionsFor = (row: VendorProduct) =>
    keepingCurrent(ingredientOptions, row.ingredientId, row.ingredientName)

  const rows = useMemo(
    () => (vendorFilter ? products.filter((p) => p.vendorId === vendorFilter) : products),
    [products, vendorFilter]
  )
  const unmapped = rows.filter((p) => !p.ingredientId).length

  const rowChange = useMutation({
    mutationFn: (change: {
      row: VendorProduct
      patch: Partial<VendorProductInput>
      done: string
      failed: string
    }) => vendorProductsService.update(change.row.id, change.patch),
    onSuccess: async (_, { done }) => {
      await invalidate('vendor-products')
      toast('success', done)
    },
    onError: (e, { failed }) => toast('danger', serverMessage(e, failed)),
  })
  const savingId = rowChange.isPending ? rowChange.variables.row.id : null

  const map = (row: VendorProduct, ingredientId: string) =>
    rowChange.mutate({
      row,
      patch: { ingredientId: ingredientId || null },
      done: ingredientId
        ? `${row.name} is received as ${ingredients.find((i) => i.id === ingredientId)?.name}`
        : `${row.name} is no longer mapped`,
      failed: 'Could not save the mapping',
    })

  const toggleActive = (row: VendorProduct) =>
    rowChange.mutate({
      row,
      patch: { isActive: !row.isActive },
      done: row.isActive ? `${row.name} is inactive` : `${row.name} is active again`,
      failed: 'Could not change the product',
    })

  function startCreate() {
    setEditing(null)
    setForm({
      ...EMPTY,
      vendorId: vendorFilter || vendors.find((v) => v.status !== 'inactive')?.id || '',
    })
    setOpen(true)
  }

  function startEdit(row: VendorProduct) {
    setEditing(row)
    setForm({
      name: row.name,
      vendorId: row.vendorId,
      sku: row.sku,
      ingredientId: row.ingredientId ?? '',
    })
    setOpen(true)
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        vendorId: form.vendorId,
        sku: form.sku.trim(),
        ingredientId: form.ingredientId || null,
      }
      return editing
        ? vendorProductsService.update(editing.id, payload)
        : vendorProductsService.create(payload)
    },
    onSuccess: async () => {
      await invalidate('vendor-products')
      toast('success', editing ? 'Product saved' : 'Product added')
      setOpen(false)
      setForm(EMPTY)
      setEditing(null)
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not save the product')),
  })

  function submit() {
    if (!form.name.trim() || !form.vendorId) {
      toast('danger', 'A product needs a name and a vendor')
      return
    }
    save.mutate()
  }

  const removal = useMutation({
    mutationFn: (row: VendorProduct) => vendorProductsService.remove(row.id),
    onSuccess: async () => {
      await invalidate('vendor-products')
      toast('success', 'Product removed')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not remove the product')),
    onSettled: () => setPendingRemove(null),
  })

  return (
    <>
      <PageHeader
        title="Vendor Products"
        subtitle="What each vendor sells, under the name and code it prints on its own paperwork, against the ingredient it is received as. An invoice line is read here first, so two vendors may use the same wording for different things. A name a document reaches no ingredient by is parked in that vendor's catalogue until someone maps it; lines already recorded keep the name they arrived under. The last price is the one this location paid."
        actions={
          can('manager') && vendors.length > 0 ? (
            <Button variant="primary" onClick={startCreate}>
              + Add Product
            </Button>
          ) : undefined
        }
      />

      {isLoading && <p className="text-sm text-text-muted">Loading…</p>}

      {!isLoading && products.length === 0 && (
        <EmptyState
          title="No vendor products recorded"
          hint="A name on an invoice that reaches no ingredient adds itself here, under the vendor that sent it. Add one ahead of time when you already know the wording."
          action={
            can('manager') && vendors.length > 0 ? (
              <Button onClick={startCreate}>+ Add Product</Button>
            ) : undefined
          }
        />
      )}

      {products.length > 0 && (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-4">
            <SelectField
              label="Vendor"
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              options={[{ value: '', label: 'All vendors' }, ...vendorOptions]}
            />
            {unmapped > 0 && (
              <p className="pb-2 text-sm text-text-muted">
                {unmapped} {unmapped === 1 ? 'product reaches' : 'products reach'} no ingredient
                yet.
              </p>
            )}
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="Nothing in this catalogue yet"
              hint="This vendor has no products recorded."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Vendor</TH>
                  <TH>Product</TH>
                  <TH>Code</TH>
                  <TH>Received as</TH>
                  <TH className="text-right">Last price</TH>
                  {can('manager') && <TH>Actions</TH>}
                </TR>
              </THead>
              <TBody>
                {rows.map((p) => (
                  <TR key={p.id}>
                    <TD>{p.vendorName}</TD>
                    <TD>
                      <span className="font-medium">{p.name}</span>
                      {!p.ingredientId && (
                        <Badge tone="warning" className="ml-2">
                          Unmapped
                        </Badge>
                      )}
                      {!p.isActive && (
                        <Badge tone="neutral" className="ml-2">
                          Inactive
                        </Badge>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap">{p.sku || '—'}</TD>
                    <TD>
                      {can('manager') ? (
                        <SelectField
                          label="Received as"
                          hideLabel
                          value={p.ingredientId ?? ''}
                          disabled={savingId === p.id}
                          onChange={(e) => map(p, e.target.value)}
                          options={optionsFor(p)}
                          searchable
                        />
                      ) : (
                        (p.ingredientName ?? '—')
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-right">
                      {p.lastPrice === null ? (
                        '—'
                      ) : (
                        <>
                          {formatMoney(p.lastPrice)}
                          {p.ingredientUnit ? ` / ${p.ingredientUnit}` : ''}
                          {p.lastReceived ? (
                            <span className="block text-xs text-text-muted">
                              {formatDate(p.lastReceived)}
                            </span>
                          ) : null}
                        </>
                      )}
                    </TD>
                    {can('manager') && (
                      <TD>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="sm" onClick={() => startEdit(p)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={savingId === p.id}
                            onClick={() => toggleActive(p)}
                          >
                            {p.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setPendingRemove(p)}>
                            Remove
                          </Button>
                        </div>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit Product' : 'Add Product'}
      >
        <div className="grid gap-4">
          <SelectField
            label="Vendor"
            value={form.vendorId}
            onChange={(e) => setForm({ ...form, vendorId: e.target.value })}
            options={vendorChoices(vendors, form.vendorId)}
          />
          <TextField
            label="Product name"
            help="Exactly as this vendor writes it"
            placeholder="Butter, Unsalted 36ct"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <TextField
            label="Code"
            help="The item number this vendor prints, if it prints one"
            placeholder="DD-1147"
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
          />
          <SelectField
            label="Received as"
            help="Leave empty to record the product now and map it later"
            value={form.ingredientId}
            onChange={(e) => setForm({ ...form, ingredientId: e.target.value })}
            options={editing ? optionsFor(editing) : ingredientOptions}
            searchable
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingRemove !== null}
        title="Remove this product?"
        confirmLabel="Remove"
        onClose={() => setPendingRemove(null)}
        onConfirm={() => pendingRemove && removal.mutate(pendingRemove)}
        busy={removal.isPending}
      >
        An invoice that names it again will park it here once more, unmapped.
      </ConfirmDialog>
    </>
  )
}
