'use client'

import { useState } from 'react'
import {
  AreaChart,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  KpiCard,
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
  PAGE_SIZE,
  Pager,
  usePageOffset,
} from '@/components/ui'
import { cn } from '@/lib/utils/cn'
import { formatDate, formatMoney, formatMonthShort } from '@/lib/utils/format'
import { useMutation, useQuery } from '@tanstack/react-query'
import { vendorsService, type Vendor } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

const TABS = ['Vendors', 'Analytics'] as const

const EMPTY = { name: '', contact: '', phone: '', notes: '', status: 'active' as const }

export default function VendorsPage() {
  const [q, setQ] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [tab, setTab] = useState<(typeof TABS)[number]>('Vendors')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Vendor | null>(null)
  const [form, setForm] = useState<{
    name: string
    contact: string
    phone: string
    notes: string
    status: 'active' | 'inactive'
  }>(EMPTY)
  const [pendingDelete, setPendingDelete] = useState<Vendor | null>(null)
  const [invoicesOf, setInvoicesOf] = useState<Vendor | null>(null)
  const toast = useToast()
  const invalidate = useInvalidate()
  const { can } = useCurrentUser()

  const { data: vendors = [], isLoading } = useQuery(queries.vendors())

  const { data: spend = [], isFetching: spendLoading } = useQuery({
    ...queries.vendorSpend(),
    enabled: tab === 'Analytics',
  })

  const [invoiceOffset, setInvoiceOffset] = usePageOffset(invoicesOf?.id)
  const { data: invoicePage, isLoading: invoicesLoading } = useQuery({
    ...queries.invoices(invoicesOf?.id ?? '', { offset: invoiceOffset, limit: PAGE_SIZE }),
    enabled: invoicesOf !== null,
  })
  const invoices = invoicePage?.data ?? []

  const rows = vendors.filter(
    (v) => v.name.toLowerCase().includes(q.toLowerCase()) && (!activeOnly || v.status === 'active')
  )

  const activeCount = vendors.filter((v) => v.status === 'active').length
  const productsTracked = vendors.reduce((s, v) => s + v.products, 0)
  const spend30 = vendors.reduce((s, v) => s + v.spend30, 0)
  const topByProducts = [...vendors].sort((a, b) => b.products - a.products)[0]

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY)
    setOpen(true)
  }

  const openEdit = (v: Vendor) => {
    setEditing(v)
    setForm({
      name: v.name,
      contact: v.contact,
      phone: v.phone,
      notes: v.notes,
      status: v.status === 'inactive' ? 'inactive' : 'active',
    })
    setOpen(true)
  }

  const save = useMutation({
    mutationFn: () => {
      const cleared = editing ? null : undefined
      const payload = {
        name: form.name.trim(),
        contact: form.contact.trim() || cleared,
        phone: form.phone.trim() || cleared,
        notes: form.notes.trim() || cleared,
        status: form.status,
      }
      return editing ? vendorsService.update(editing.id, payload) : vendorsService.create(payload)
    },
    onSuccess: async () => {
      await invalidate('vendors')
      setOpen(false)
      toast('success', editing ? 'Vendor updated' : 'Vendor added')
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  const removal = useMutation({
    mutationFn: (v: Vendor) => vendorsService.remove(v.id),
    onSuccess: async (_, v) => {
      await invalidate('vendors')
      setPendingDelete(null)
      toast('success', `${v.name} deleted`)
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  function submit() {
    if (!form.name.trim()) {
      toast('danger', 'Vendor name is required')
      return
    }
    save.mutate()
  }

  return (
    <>
      <PageHeader
        title="Vendor Management"
        subtitle="Manage suppliers and track ingredient pricing"
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Vendors"
          value={vendors.length}
          hint={
            <span className="text-primary-700 dark:text-primary-400">{activeCount} active</span>
          }
        />
        <KpiCard label="Products Tracked" value={productsTracked} />
        <KpiCard label="30-Day Spend" value={formatMoney(spend30)} />
        <KpiCard
          label="Largest Catalog"
          value={topByProducts?.name ?? '—'}
          hint={topByProducts ? `${topByProducts.products} products` : undefined}
        />
      </div>

      <div
        className="mb-4 flex gap-1 border-b border-border"
        role="tablist"
        aria-label="Vendors view"
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-t-lg px-4 py-2 text-sm font-medium transition-colors',
              tab === t
                ? 'border border-b-0 border-border bg-surface text-primary-800 dark:text-primary-300'
                : 'text-text-muted hover:text-text'
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Vendors' ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SearchInput
              placeholder="Search vendors…"
              className="w-64"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Checkbox
              label="Active only"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
            />
            <div className="ms-auto flex flex-wrap gap-2">
              {can('manager') && <Button onClick={openCreate}>Add Vendor</Button>}
            </div>
          </div>

          <Table pinActions>
            <THead>
              <TR>
                <TH>Vendor</TH>
                <TH>Contact</TH>
                <TH>Products</TH>
                <TH>Ingredients</TH>
                <TH>Last invoice</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {isLoading ? (
                <TableEmpty colSpan={7}>Loading vendors…</TableEmpty>
              ) : rows.length === 0 ? (
                <TableEmpty colSpan={7}>
                  No vendors found. Add your first vendor to get started.
                </TableEmpty>
              ) : (
                rows.map((v) => (
                  <TR key={v.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <Avatar name={v.name} size="sm" />
                        <span className="font-medium">{v.name}</span>
                      </div>
                    </TD>
                    <TD>
                      <p>{v.contact}</p>
                      <p className="text-xs text-text-muted">{v.phone}</p>
                    </TD>
                    <TD>{v.products}</TD>
                    <TD>{v.ingredients}</TD>
                    <TD className="whitespace-nowrap">
                      {v.lastInvoice ? (
                        formatDate(v.lastInvoice)
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </TD>
                    <TD>
                      {v.status === 'active' ? (
                        <Badge dot tone="success">
                          Active
                        </Badge>
                      ) : (
                        <Badge>Inactive</Badge>
                      )}
                    </TD>
                    <TD className="text-right">
                      <RowActions className="justify-end">
                        <Button variant="ghost" size="sm" onClick={() => setInvoicesOf(v)}>
                          Invoices
                        </Button>
                        {can('manager') && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => openEdit(v)}>
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-danger-700 dark:text-danger-100"
                              onClick={() => setPendingDelete(v)}
                            >
                              Delete
                            </Button>
                          </>
                        )}
                      </RowActions>
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="mb-3 text-sm font-semibold">Catalog size by vendor</h3>
            {vendors.length === 0 ? (
              <EmptyState title="No vendors yet" hint="Add a vendor to see its catalog here." />
            ) : (
              <ul className="divide-y divide-border text-sm">
                {[...vendors]
                  .sort((a, b) => b.products - a.products)
                  .map((v) => (
                    <li key={v.id} className="flex items-center justify-between py-2">
                      <span>{v.name}</span>
                      <span className="font-medium">{v.products} products</span>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
          <Card>
            <h3 className="mb-3 text-sm font-semibold">Spend over time</h3>
            {spend.some((p) => p.total > 0) ? (
              <AreaChart
                data={spend.map((p) => ({ label: formatMonthShort(p.period), value: p.total }))}
                format="money"
                height={180}
              />
            ) : spendLoading ? (
              <div style={{ height: 180 }} />
            ) : (
              <EmptyState
                title="No invoices yet"
                hint="Spend appears once a confirmed invoice is on file."
              />
            )}
          </Card>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit Vendor' : 'Add Vendor'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={save.isPending}>
              {editing ? 'Save Vendor' : 'Add Vendor'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Vendor name"
            required
            className="sm:col-span-2"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <TextField
            label="Email"
            type="email"
            value={form.contact}
            onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
          />
          <TextField
            label="Phone"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <SelectField
            label="Status"
            value={form.status}
            onChange={(e) =>
              setForm((f) => ({ ...f, status: e.target.value as 'active' | 'inactive' }))
            }
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />
          <TextField
            label="Notes"
            className="sm:col-span-2"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>
      </Modal>

      <Modal
        open={invoicesOf !== null}
        onClose={() => setInvoicesOf(null)}
        title={`Invoices from ${invoicesOf?.name ?? 'this vendor'}`}
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setInvoicesOf(null)}>
            Close
          </Button>
        }
      >
        {invoicesOf === null ? null : invoicesLoading ? (
          <p className="text-sm text-text-muted">Loading invoices…</p>
        ) : invoices.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            hint="Invoices this vendor sent to the active location appear here once confirmed or entered."
          />
        ) : (
          <>
            <p className="mb-3 text-sm text-text-muted">
              What this vendor sent to the active location, newest first. A confirmed invoice is the
              record of what it moved and stays as written.
            </p>
            <Table>
              <THead>
                <TR>
                  <TH>Number</TH>
                  <TH>Date</TH>
                  <TH>Status</TH>
                  <TH>Lines</TH>
                  <TH className="text-right">Total</TH>
                </TR>
              </THead>
              <TBody>
                {invoices.map((i) => (
                  <TR key={i.id}>
                    <TD className="font-medium">{i.number || '—'}</TD>
                    <TD className="whitespace-nowrap">{formatDate(i.invoiceDate)}</TD>
                    <TD>
                      {i.status === 'confirmed' ? (
                        <Badge dot tone="success">
                          Confirmed
                        </Badge>
                      ) : (
                        <Badge>Draft</Badge>
                      )}
                    </TD>
                    <TD>{i.items.length}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(i.total)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pager
              page={invoicePage?.pagination}
              onOffset={setInvoiceOffset}
              label="Invoice pages"
            />
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && removal.mutate(pendingDelete)}
        title={`Delete ${pendingDelete?.name ?? 'vendor'}?`}
        busy={removal.isPending}
      >
        {pendingDelete && (pendingDelete.ingredients > 0 || pendingDelete.products > 0) ? (
          <>
            {pendingDelete.ingredients > 0 && (
              <>
                {pendingDelete.ingredients} ingredient
                {pendingDelete.ingredients === 1 ? '' : 's'} will keep their prices but lose this
                vendor, and so will their recorded price history.{' '}
              </>
            )}
            {pendingDelete.products > 0 && (
              <>
                Its {pendingDelete.products} product
                {pendingDelete.products === 1 ? '' : 's'} will be removed with it, so an invoice
                naming them will park them again.{' '}
              </>
            )}
            This cannot be undone.
          </>
        ) : (
          <>This vendor will be removed permanently. This cannot be undone.</>
        )}
      </ConfirmDialog>
    </>
  )
}
