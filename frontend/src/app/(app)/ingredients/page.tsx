'use client'

import { useState, type ReactNode } from 'react'
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
  UnitField,
  TH,
  THead,
  TR,
  useToast,
  PAGE_SIZE,
  Pager,
  usePageOffset,
} from '@/components/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ingredientsService, type Ingredient } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { CategoryField } from '@/components/catalogue/CategoryField'
import { useActiveLocation } from '@/lib/api/useActiveLocation'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { formatDate, formatMoney } from '@/lib/utils/format'
import { vendorChoices } from '@/lib/utils/options'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

const EMPTY = {
  name: '',
  unit: 'kg',
  costPerUnit: '',
  onHand: '',
  reorderLevel: '',
  categoryId: '',
  vendorId: '',
  sku: '',
  vendorSku: '',
}

export default function IngredientsPage() {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Ingredient | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [initial, setInitial] = useState(EMPTY)
  const [historyFor, setHistoryFor] = useState<Ingredient | null>(null)
  const [breakdownFor, setBreakdownFor] = useState<Ingredient | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Ingredient | null>(null)
  const [pendingArchive, setPendingArchive] = useState<Ingredient | null>(null)
  const toast = useToast()
  const invalidate = useInvalidate()
  const { can, worksEverywhere } = useCurrentUser()
  const location = useActiveLocation()
  const defaultsLocked = !!editing && !location.id && !worksEverywhere

  const { data: ingredients = [], isLoading } = useQuery(queries.ingredientsWithArchived())
  const { data: vendors = [] } = useQuery(queries.vendors())

  const categories = [...new Set(ingredients.map((i) => i.category))].sort((a, b) =>
    a.localeCompare(b)
  )
  const rows = ingredients.filter(
    (i) => i.name.toLowerCase().includes(q.toLowerCase()) && (!category || i.category === category)
  )

  const costLabel = (i: Ingredient) => {
    if (location.id || i.costLow === null || i.costHigh === null) return formatMoney(i.costPerUnit)
    return i.costLow === i.costHigh
      ? formatMoney(i.costLow)
      : `${formatMoney(i.costLow)} to ${formatMoney(i.costHigh)}`
  }

  const vendorLabel = (i: Ingredient) =>
    !location.id && i.vendors > 1 ? `${i.vendors} vendors` : i.vendor

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY)
    setOpen(true)
  }

  const openEdit = (i: Ingredient) => {
    const values = {
      name: i.name,
      unit: i.unit,
      costPerUnit: String(i.costPerUnit),
      onHand: String(i.onHand),
      reorderLevel: String(i.reorderLevel),
      categoryId: i.categoryId ?? '',
      vendorId: i.vendorId ?? '',
      sku: i.sku ?? '',
      vendorSku: i.vendorSku ?? '',
    }
    setEditing(i)
    setForm(values)
    setInitial(values)
    setOpen(true)
  }

  const save = useMutation({
    mutationFn: (cost: number) => {
      const payload = {
        name: form.name.trim(),
        unit: form.unit,
        costPerUnit: cost,
        reorderLevel:
          form.reorderLevel === '' ? (editing ? 0 : undefined) : parseFloat(form.reorderLevel),
        categoryId: form.categoryId || null,
        vendorId: form.vendorId || null,
        sku: form.sku.trim() || undefined,
        vendorSku: location.id ? form.vendorSku.trim() : undefined,
      }
      if (editing) {
        const changed = (key: keyof typeof form) => form[key] !== initial[key]
        return ingredientsService.update(editing.id, {
          ...(changed('name') ? { name: payload.name } : {}),
          ...(changed('unit') ? { unit: payload.unit } : {}),
          ...(changed('costPerUnit') ? { costPerUnit: payload.costPerUnit } : {}),
          ...(changed('reorderLevel') ? { reorderLevel: payload.reorderLevel } : {}),
          ...(changed('categoryId') ? { categoryId: payload.categoryId } : {}),
          ...(changed('vendorId') ? { vendorId: payload.vendorId } : {}),
          ...(changed('sku') ? { sku: payload.sku } : {}),
          ...(changed('vendorSku') ? { vendorSku: payload.vendorSku } : {}),
        })
      }
      return ingredientsService.create({
        ...payload,
        onHand: !location.id || form.onHand === '' ? undefined : parseFloat(form.onHand),
      })
    },
    onSuccess: async (saved) => {
      await invalidate('ingredients')
      setOpen(false)
      const relabelled = (saved as { relabelled?: string[] }).relabelled ?? []
      if (relabelled.length > 0) {
        toast(
          'warning',
          `Unit changed to ${saved.unit}. Check the quantities in ${relabelled.join(', ')}: their lines now read in ${saved.unit}`
        )
      } else {
        toast('success', editing ? 'Ingredient updated' : 'Ingredient added')
      }
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  function submit() {
    const cost = parseFloat(form.costPerUnit)
    if (!form.name.trim() || !form.unit || Number.isNaN(cost) || cost < 0) {
      toast('danger', 'Name, unit and a cost per unit are required')
      return
    }
    save.mutate(cost)
  }

  const activation = useMutation({
    mutationFn: ({ i, isActive }: { i: Ingredient; isActive: boolean }) =>
      ingredientsService.update(i.id, { isActive }),
    onSuccess: async (_, { i, isActive }) => {
      await invalidate('ingredients')
      setPendingArchive(null)
      toast('success', isActive ? `${i.name} restored` : `${i.name} archived`)
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  const setActive = (i: Ingredient, isActive: boolean) => activation.mutate({ i, isActive })

  const removal = useMutation({
    mutationFn: (i: Ingredient) => ingredientsService.remove(i.id),
    onSuccess: async (_, i) => {
      await invalidate('ingredients')
      setPendingDelete(null)
      toast('success', `${i.name} deleted`)
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  return (
    <>
      <PageHeader
        title="Ingredients"
        subtitle={
          location.name
            ? `Shared across the organization; vendor, cost and reorder level as ${location.name} has them`
            : 'Shared across the organization, with what every location pays and holds'
        }
        actions={can('staff') ? <Button onClick={openCreate}>Add Ingredient</Button> : undefined}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchInput
          placeholder="Search ingredients…"
          className="w-64"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <SelectField
          label="Show only"
          hideLabel
          className="w-56"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={[
            { value: '', label: 'All categories' },
            ...categories.map((c) => ({ value: c, label: c })),
          ]}
        />
      </div>

      <Table pinActions>
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
                <TD className="tabular-nums">{costLabel(i)}</TD>
                <TD className="tabular-nums">
                  {i.onHand} {i.unit}
                </TD>
                <TD className="text-text-muted">{vendorLabel(i)}</TD>
                <TD>
                  {!i.isActive ? (
                    <Badge dot tone="slate">
                      Archived
                    </Badge>
                  ) : i.status === 'low' ? (
                    <div>
                      <Badge dot tone="warning">
                        Low stock
                      </Badge>
                      {i.lowAt.length > 0 && (
                        <p className="mt-1 text-xs text-text-muted">at {i.lowAt.join(', ')}</p>
                      )}
                    </div>
                  ) : (
                    <Badge dot tone="success">
                      In stock
                    </Badge>
                  )}
                </TD>
                {can('staff') && (
                  <TD className="text-right">
                    <RowActions className="!flex-nowrap justify-end [&>*]:whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(i)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setBreakdownFor(i)}>
                        Locations
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setHistoryFor(i)}>
                        Price history
                      </Button>
                      {can('manager') &&
                        (i.isActive ? (
                          <Button variant="ghost" size="sm" onClick={() => setPendingArchive(i)}>
                            Archive
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActive(i, true)}
                            disabled={activation.isPending}
                          >
                            Restore
                          </Button>
                        ))}
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
            <Button onClick={submit} disabled={save.isPending}>
              {editing ? 'Save Ingredient' : 'Add Ingredient'}
            </Button>
          </>
        }
      >
        <div className="grid gap-6">
          <FormSection
            title="Shared by the whole organization"
            note="Every location sees the same values here. Changing them changes the ingredient everywhere."
          >
            <TextField
              label="Name"
              placeholder="e.g. Olive Oil"
              required
              className="sm:col-span-2"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <UnitField
              label="Base unit"
              required
              help={
                editing
                  ? 'The unit this ingredient is priced and counted in. Changing it converts stock, prices and reorder levels; a unit it does not convert to needs a conversion first.'
                  : 'The unit this ingredient is priced and counted in.'
              }
              value={form.unit}
              onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
            />
            <CategoryField
              kind="ingredient"
              value={form.categoryId}
              onChange={(categoryId) => setForm((f) => ({ ...f, categoryId }))}
            />
            <TextField
              label="SKU"
              help="The organization's own product identifier"
              className="sm:col-span-2"
              value={form.sku}
              onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
            />
          </FormSection>

          <FormSection
            divided
            title={location.name ? `${location.name} only` : 'Organization defaults'}
            note={
              location.name
                ? 'Vendor, cost and reorder level are written for this location alone. Every other location keeps what it had.'
                : defaultsLocked
                  ? 'These are what every location falls back on, set by someone who works at all of them. Choose your location in the header to set its own.'
                  : 'A location that has not set its own vendor, cost or reorder level falls back to these. Choose a location in the header to price for it alone.'
            }
          >
            <SelectField
              label="Vendor"
              placeholder="No vendor"
              disabled={defaultsLocked}
              value={form.vendorId}
              onChange={(e) => setForm((f) => ({ ...f, vendorId: e.target.value }))}
              options={vendorChoices(vendors, form.vendorId)}
            />
            <TextField
              label="Cost per unit"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              required
              disabled={defaultsLocked}
              value={form.costPerUnit}
              onChange={(e) => setForm((f) => ({ ...f, costPerUnit: e.target.value }))}
            />
            {location.id && (
              <TextField
                label="Vendor SKU"
                help="The code this vendor uses for it"
                value={form.vendorSku}
                onChange={(e) => setForm((f) => ({ ...f, vendorSku: e.target.value }))}
              />
            )}
            <TextField
              label="Reorder level"
              type="number"
              min="0"
              step="0.1"
              help="Empty means no reorder level, so the item is low only when nothing is left"
              disabled={defaultsLocked}
              value={form.reorderLevel}
              onChange={(e) => setForm((f) => ({ ...f, reorderLevel: e.target.value }))}
            />
            {editing ? (
              <div className="text-sm text-text-muted">
                <p className="font-medium text-text">On hand</p>
                <p className="mt-1">
                  {editing.onHand} {editing.unit}; change it from Inventory, so the movement is
                  recorded.
                </p>
              </div>
            ) : location.id ? (
              <TextField
                label="On hand"
                help={`Opening balance at ${location.name}, recorded on Inventory as a count`}
                type="number"
                min="0"
                step="0.1"
                value={form.onHand}
                onChange={(e) => setForm((f) => ({ ...f, onHand: e.target.value }))}
              />
            ) : (
              <div className="text-sm text-text-muted">
                <p className="font-medium text-text">On hand</p>
                <p className="mt-1">
                  Stock is held by a location. Choose one in the header to state an opening balance.
                </p>
              </div>
            )}
          </FormSection>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingArchive !== null}
        onClose={() => setPendingArchive(null)}
        onConfirm={() => pendingArchive && setActive(pendingArchive, false)}
        title={`Archive ${pendingArchive?.name ?? 'ingredient'}?`}
        confirmLabel="Archive"
        busy={activation.isPending}
      >
        It stops being offered when a recipe, a count or a waste entry is written, and keeps its
        stock, its price history and the recipes it already belongs to. It can be restored.
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && removal.mutate(pendingDelete)}
        title={`Delete ${pendingDelete?.name ?? 'ingredient'}?`}
        busy={removal.isPending}
      >
        The ingredient, its stock on every location and its recorded price history go with it.
        Recipes, invoices, counts, waste entries and draft orders that refer to it will refuse the
        deletion instead; archive it then. This cannot be undone.
      </ConfirmDialog>

      <PriceHistoryModal ingredient={historyFor} onClose={() => setHistoryFor(null)} />

      <LocationBreakdownModal ingredient={breakdownFor} onClose={() => setBreakdownFor(null)} />
    </>
  )
}

function FormSection({
  title,
  note,
  divided,
  children,
}: {
  title: string
  note: string
  divided?: boolean
  children: ReactNode
}) {
  return (
    <section className={divided ? 'border-t border-border pt-5' : undefined}>
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      <p className="mt-1 text-xs text-text-muted">{note}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function LocationBreakdownModal({
  ingredient,
  onClose,
}: {
  ingredient: Ingredient | null
  onClose: () => void
}) {
  const { data, isLoading } = useQuery({
    ...queries.ingredientLocations(ingredient?.id ?? ''),
    enabled: Boolean(ingredient),
  })

  const range =
    data && data.totals.costLow !== null && data.totals.costHigh !== null
      ? data.totals.costLow === data.totals.costHigh
        ? formatMoney(data.totals.costLow)
        : `${formatMoney(data.totals.costLow)} to ${formatMoney(data.totals.costHigh)}`
      : '—'

  return (
    <Modal
      open={Boolean(ingredient)}
      onClose={onClose}
      size="xl"
      title={ingredient ? `Across locations: ${ingredient.name}` : 'Across locations'}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {isLoading ? (
        <p className="py-6 text-center text-sm text-text-muted">Loading…</p>
      ) : !data ? null : (
        <div className="grid gap-5">
          <section>
            <h3 className="text-sm font-semibold text-text">Shared ingredient</h3>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <Fact label="Name" value={data.shared.name} />
              <Fact label="Category" value={data.shared.category} />
              <Fact label="Base unit" value={data.shared.unit} />
              <Fact label="SKU" value={data.shared.sku || '—'} />
              <Fact label="Locations" value={String(data.totals.locations)} />
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-text">Location details</h3>
            <Table>
              <THead>
                <TR>
                  <TH>Location</TH>
                  <TH>Vendor</TH>
                  <TH>Vendor SKU</TH>
                  <TH>Cost / unit</TH>
                  <TH>On hand</TH>
                  <TH>Reorder level</TH>
                </TR>
              </THead>
              <TBody>
                {data.locations.length === 0 ? (
                  <TableEmpty colSpan={6}>This organization has no active locations.</TableEmpty>
                ) : (
                  data.locations.map((r) => (
                    <TR key={r.locationId}>
                      <TD className="font-medium whitespace-nowrap">
                        {r.location}
                        {!r.ownSettings && (
                          <span className="block text-xs font-normal text-text-muted">
                            uses the organization defaults
                          </span>
                        )}
                      </TD>
                      <TD className="text-text-muted">{r.vendor || '—'}</TD>
                      <TD className="whitespace-nowrap text-text-muted">{r.vendorSku || '—'}</TD>
                      <TD className="tabular-nums">{formatMoney(r.costPerUnit)}</TD>
                      <TD className="tabular-nums">
                        {r.onHand} {data.shared.unit}
                      </TD>
                      <TD className="tabular-nums">
                        {r.reorderLevel} {data.shared.unit}
                      </TD>
                    </TR>
                  ))
                )}
                <TR>
                  <TD className="font-semibold">Total / Range</TD>
                  <TD className="text-text-muted">
                    {data.totals.vendors} {data.totals.vendors === 1 ? 'vendor' : 'vendors'}
                  </TD>
                  <TD className="text-text-muted">—</TD>
                  <TD className="font-semibold whitespace-nowrap tabular-nums">{range}</TD>
                  <TD className="font-semibold tabular-nums">
                    {data.totals.onHand} {data.shared.unit}
                  </TD>
                  <TD className="text-text-muted">—</TD>
                </TR>
              </TBody>
            </Table>
          </section>
        </div>
      )}
    </Modal>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-text-muted">{label}:</dt>
      <dd className="font-medium text-text">{value}</dd>
    </div>
  )
}

function PriceHistoryModal({
  ingredient,
  onClose,
}: {
  ingredient: Ingredient | null
  onClose: () => void
}) {
  const [offset, setOffset] = usePageOffset(ingredient?.id)
  const { data, isLoading } = useQuery({
    ...queries.priceHistory(ingredient?.id ?? '', { offset, limit: PAGE_SIZE }),
    enabled: Boolean(ingredient),
  })
  const records = data?.data ?? []

  return (
    <Modal
      open={Boolean(ingredient)}
      onClose={onClose}
      title={ingredient ? `Price history: ${ingredient.name}` : 'Price history'}
      size="lg"
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
                <TD className="whitespace-nowrap">{formatDate(r.recordedAt)}</TD>
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
      <Pager page={data?.pagination} onOffset={setOffset} label="Price history pages" />
    </Modal>
  )
}
