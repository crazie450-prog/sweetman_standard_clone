'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  KpiCard,
  Modal,
  PageHeader,
  Table,
  TableEmpty,
  TBody,
  TD,
  TDNum,
  TextField,
  TH,
  THead,
  TR,
  useToast,
  PAGE_SIZE,
  Pager,
  usePageOffset,
} from '@/components/ui'
import { inputCls, NumericInput } from '@/components/documents/ExtractionEditor'
import { cn } from '@/lib/utils/cn'
import { purchasingService } from '@/lib/api/services'
import type { PurchaseDraft, PurchaseRecommendation } from '@/lib/api/types'
import { serverMessage } from '@/lib/api/error'
import { useActiveLocationId } from '@/lib/api/useActiveLocation'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { formatDate, formatMoney } from '@/lib/utils/format'
import { wholeCount } from '@/lib/utils/money'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

const DAYS_DEFAULT = 28
const HORIZON_DEFAULT = 7

const basisLabel: Record<PurchaseRecommendation['basis'], string> = {
  sales: 'from sales',
  usage: 'from recorded use',
  waste: 'waste only',
  receipts: 'from deliveries received',
  none: 'below reorder level',
}

function cover(days: number | null) {
  if (days === null) return '—'
  if (days === 0) return 'out'
  return `${days} d`
}

/* ===== One draft ===== */

function DraftWindow({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  const toast = useToast()
  const { can } = useCurrentUser()
  const { data: draft, isLoading } = useQuery(queries.purchaseDraft(id))
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [note, setNote] = useState('')
  const [syncedFor, setSyncedFor] = useState<string | null>(null)
  const [pendingApprove, setPendingApprove] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)

  if (draft && syncedFor !== draft.id) {
    setSyncedFor(draft.id)
    setQuantities(Object.fromEntries(draft.lines.map((l) => [l.ingredientId, l.quantity])))
    setNote(draft.note)
  }

  const settle = (next: PurchaseDraft) => {
    qc.setQueryData(queries.purchaseDraft(id).queryKey, next)
    void invalidate('purchasing')
  }

  const save = useMutation({
    mutationFn: () =>
      purchasingService.updateDraft(id, {
        note,
        lines: Object.entries(quantities).map(([ingredientId, quantity]) => ({
          ingredientId,
          quantity,
        })),
      }),
    onSuccess: (next) => {
      settle(next)
      setSyncedFor(null)
      toast('success', 'Draft order saved')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not save the draft')),
  })

  const approve = useMutation({
    mutationFn: () => purchasingService.approveDraft(id),
    onSuccess: (next) => {
      settle(next)
      setPendingApprove(false)
      toast('success', 'Order approved. Stock will move when the delivery is confirmed.')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not approve the order')),
  })

  const remove = useMutation({
    mutationFn: () => purchasingService.deleteDraft(id),
    onSuccess: () => {
      void invalidate('purchasing')
      toast('info', 'Draft order deleted')
      onClose()
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not delete the draft')),
  })

  if (isLoading || !draft) return <p className="text-sm text-text-muted">Loading draft…</p>

  const open = draft.status === 'draft'
  const editable = open && can('staff')
  const remaining = Object.values(quantities).filter((q) => q > 0).length

  return (
    <>
      <dl className="mb-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-text-muted">Vendor</dt>
          <dd className="font-medium">{draft.vendorName ?? 'No vendor on file'}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Status</dt>
          <dd>
            <Badge tone={open ? 'info' : 'success'}>{open ? 'Draft' : 'Approved'}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">Based on</dt>
          <dd className="font-medium">
            {draft.days} days of history, {draft.horizon} days to cover
          </dd>
        </div>
      </dl>

      <Table>
        <THead>
          <TR>
            <TH>Ingredient</TH>
            <TH className="text-right">On hand then</TH>
            <TH className="text-right">Suggested</TH>
            <TH className="text-right">Quantity</TH>
            <TH className="text-right">Unit price</TH>
            <TH className="text-right">Line total</TH>
            {editable && <TH className="text-right">Actions</TH>}
          </TR>
        </THead>
        <TBody>
          {draft.lines.map((l) => {
            const qty = quantities[l.ingredientId] ?? 0
            return (
              <TR key={l.id} className={qty <= 0 ? 'opacity-50' : undefined}>
                <TD className="font-medium">{l.name}</TD>
                <TDNum>
                  {l.onHand} {l.unit}
                </TDNum>
                <TDNum>
                  {l.suggested} {l.unit}
                </TDNum>
                <TDNum>
                  {editable ? (
                    <span className="inline-flex items-center gap-1">
                      <NumericInput
                        label={`Quantity of ${l.name}`}
                        value={qty}
                        onValue={(next) =>
                          setQuantities((q) => ({ ...q, [l.ingredientId]: next ?? 0 }))
                        }
                        className={cn(inputCls, 'w-24 text-right')}
                      />
                      <span className="text-text-muted">{l.unit}</span>
                    </span>
                  ) : (
                    `${l.quantity} ${l.unit}`
                  )}
                </TDNum>
                <TDNum>{l.unitPrice === null ? '—' : formatMoney(l.unitPrice)}</TDNum>
                <TDNum>
                  {l.unitPrice === null
                    ? '—'
                    : formatMoney((editable ? qty : l.quantity) * l.unitPrice)}
                </TDNum>
                {editable && (
                  <TD className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setQuantities((q) => ({ ...q, [l.ingredientId]: 0 }))}
                      disabled={qty <= 0}
                    >
                      Remove
                    </Button>
                  </TD>
                )}
              </TR>
            )
          })}
        </TBody>
      </Table>

      <div className="mt-4">
        <TextField
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          readOnly={!editable}
          placeholder="Delivery day, packaging, anything the person ordering should know"
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">
          {open
            ? 'Approving records the decision only; stock still arrives through a confirmed invoice.'
            : `Approved ${draft.approvedAt ? formatDate(draft.approvedAt) : ''}`}
        </p>
        {open && (
          <div className="flex gap-2">
            {can('manager') && (
              <Button
                variant="danger"
                onClick={() => setPendingDelete(true)}
                disabled={remove.isPending}
              >
                Delete
              </Button>
            )}
            {editable && (
              <Button
                variant="secondary"
                onClick={() => save.mutate()}
                disabled={save.isPending || remaining === 0}
              >
                Save
              </Button>
            )}
            {can('manager') && (
              <Button variant="primary" onClick={() => setPendingApprove(true)}>
                Approve
              </Button>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingApprove}
        onClose={() => setPendingApprove(false)}
        onConfirm={() => approve.mutate()}
        title="Approve this order?"
        confirmLabel="Approve"
        tone="primary"
        busy={approve.isPending}
      >
        The order is recorded as decided and can no longer be changed. Nothing is sent to the vendor
        and no stock moves; the delivery is received through its invoice, as before.
        {remaining > 0 && Object.values(quantities).some((q, i) => q !== draft.lines[i]?.quantity)
          ? ' Unsaved quantity changes are not part of it, so save first.'
          : ''}
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingDelete}
        onClose={() => setPendingDelete(false)}
        onConfirm={() => remove.mutate()}
        title="Delete this draft order?"
        busy={remove.isPending}
      >
        The draft and its lines are removed. The recommendation can be generated again at any time.
      </ConfirmDialog>
    </>
  )
}

/* ===== Screen ===== */

export default function PurchasingPage() {
  const invalidate = useInvalidate()
  const toast = useToast()
  const { can } = useCurrentUser()
  const locationId = useActiveLocationId()

  const [days, setDays] = useState(String(DAYS_DEFAULT))
  const [horizon, setHorizon] = useState(String(HORIZON_DEFAULT))
  const [applied, setApplied] = useState({ days: DAYS_DEFAULT, horizon: HORIZON_DEFAULT })
  const [picked, setPicked] = useState<Record<string, number>>({})
  const [syncedFor, setSyncedFor] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const recs = useQuery({
    ...queries.purchaseRecommendations(applied),
    enabled: !!locationId,
  })
  const [draftOffset, setDraftOffset] = usePageOffset()
  const { data: draftPage, isLoading: draftsLoading } = useQuery({
    ...queries.purchaseDrafts({ offset: draftOffset, limit: PAGE_SIZE }),
    enabled: !!locationId,
  })
  const drafts = draftPage?.data ?? []

  const stamp = recs.data
    ? [
        locationId,
        recs.data.days,
        recs.data.horizon,
        recs.data.from,
        ...recs.data.rows.map((r) => `${r.ingredientId}=${r.suggested}`),
      ].join('|')
    : null
  if (recs.data && stamp !== syncedFor) {
    setSyncedFor(stamp)
    setPicked(Object.fromEntries(recs.data.rows.map((r) => [r.ingredientId, r.suggested])))
  }

  const create = useMutation({
    mutationFn: () =>
      purchasingService.createDrafts({
        ...applied,
        lines: Object.entries(picked)
          .filter(([, q]) => q > 0)
          .map(([ingredientId, quantity]) => ({ ingredientId, quantity })),
      }),
    onSuccess: (created) => {
      setPicked({})
      void invalidate('purchasing')
      toast(
        'success',
        created.length === 1
          ? 'One draft order created'
          : `${created.length} draft orders created, one per vendor`
      )
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not create the draft orders')),
  })

  const apply = () => {
    const d = wholeCount(days)
    const h = wholeCount(horizon)
    if (d === null || h === null || d < 7 || d > 90 || h > 60) {
      toast('danger', 'History is 7 to 90 whole days, cover is 1 to 60 whole days')
      return
    }
    setApplied({ days: d, horizon: h })
  }

  const rows = recs.data?.rows ?? []
  const chosen = rows.filter((r) => (picked[r.ingredientId] ?? 0) > 0)
  const estimated = chosen.reduce((sum, r) => sum + (picked[r.ingredientId] ?? 0) * r.unitPrice, 0)
  const vendors = new Set(chosen.map((r) => r.vendorId ?? '')).size
  const openDraft = drafts.find((d) => d.id === openId)

  return (
    <>
      <PageHeader
        title="Purchasing"
        subtitle="What to order for this location, from what it sold, used, wasted and received. Usage is the higher of sales-implied and recorded use, plus waste, over the chosen days; where nothing was sold or used, deliveries set the pace. A draft moves no stock and is sent nowhere."
      />

      {!locationId ? (
        <EmptyState
          title="Choose a location in the header"
          hint="A recommendation is made for one kitchen: its stock, its sales and the vendor it buys from."
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <TextField
              label="Days of history"
              type="number"
              min={7}
              max={90}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-36"
            />
            <TextField
              label="Days to cover"
              type="number"
              min={1}
              max={60}
              value={horizon}
              onChange={(e) => setHorizon(e.target.value)}
              className="w-36"
            />
            <Button variant="secondary" onClick={apply} disabled={recs.isFetching}>
              Recalculate
            </Button>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label="Ingredients examined"
              value={recs.data?.examined ?? 0}
              tone="slate"
              hint={recs.data ? `${recs.data.from} to ${recs.data.to}` : undefined}
            />
            <KpiCard label="Need ordering" value={rows.length} tone="warning" />
            <KpiCard label="Chosen" value={chosen.length} tone="primary" />
            <KpiCard
              label="Estimated cost"
              value={formatMoney(estimated)}
              tone="info"
              hint={vendors > 0 ? `${vendors} vendor${vendors === 1 ? '' : 's'}` : undefined}
            />
          </div>

          <Table>
            <THead>
              <TR>
                <TH>Order</TH>
                <TH>Ingredient</TH>
                <TH className="text-right">On hand</TH>
                <TH className="text-right">Daily use</TH>
                <TH className="text-right">Cover</TH>
                <TH className="text-right">Suggested</TH>
                <TH className="text-right">Quantity</TH>
                <TH>Vendor</TH>
                <TH className="text-right">Est. cost</TH>
              </TR>
            </THead>
            <TBody>
              {recs.isLoading && <TableEmpty colSpan={9}>Loading recommendations…</TableEmpty>}
              {!recs.isLoading && rows.length === 0 && (
                <TableEmpty colSpan={9}>
                  Nothing needs ordering: every ingredient with recorded use or sales covers the
                  chosen days above its reorder level.
                </TableEmpty>
              )}
              {rows.map((r) => {
                const qty = picked[r.ingredientId] ?? 0
                return (
                  <TR key={r.ingredientId}>
                    <TD>
                      <Checkbox
                        label=""
                        aria-label={`Order ${r.name}`}
                        checked={qty > 0}
                        onChange={(e) =>
                          setPicked((p) => ({
                            ...p,
                            [r.ingredientId]: e.target.checked ? r.suggested : 0,
                          }))
                        }
                      />
                    </TD>
                    <TD>
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-text-muted">
                        {r.category || 'Uncategorized'} · {basisLabel[r.basis]}
                      </p>
                    </TD>
                    <TDNum>
                      {r.onHand} {r.unit}
                    </TDNum>
                    <TDNum>
                      {r.dailyRate} {r.unit}
                    </TDNum>
                    <TDNum>
                      <Badge tone={r.coverDays !== null && r.coverDays < 2 ? 'danger' : 'neutral'}>
                        {cover(r.coverDays)}
                      </Badge>
                    </TDNum>
                    <TDNum>
                      {r.suggested} {r.unit}
                    </TDNum>
                    <TDNum>
                      <span className="inline-flex items-center gap-1">
                        <NumericInput
                          label={`Quantity of ${r.name}`}
                          value={qty}
                          onValue={(next) =>
                            setPicked((p) => ({ ...p, [r.ingredientId]: next ?? 0 }))
                          }
                          className={cn(inputCls, 'w-24 text-right')}
                        />
                        <span className="text-text-muted">{r.unit}</span>
                      </span>
                    </TDNum>
                    <TD>{r.vendorName ?? <span className="text-text-muted">No vendor</span>}</TD>
                    <TDNum>{formatMoney(qty * r.unitPrice)}</TDNum>
                  </TR>
                )
              })}
            </TBody>
          </Table>

          {can('staff') && (
            <div className="mt-4 flex justify-end">
              <Button
                variant="primary"
                onClick={() => create.mutate()}
                disabled={create.isPending || chosen.length === 0}
              >
                Create draft orders
              </Button>
            </div>
          )}

          <section className="mt-10">
            <h2 className="mb-2 text-lg font-semibold">Draft orders</h2>
            <Table>
              <THead>
                <TR>
                  <TH>Vendor</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Lines</TH>
                  <TH className="text-right">Total</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {draftsLoading && <TableEmpty colSpan={6}>Loading draft orders…</TableEmpty>}
                {!draftsLoading && drafts.length === 0 && (
                  <TableEmpty colSpan={6}>
                    No draft orders yet. Pick recommendations above to create them.
                  </TableEmpty>
                )}
                {drafts.map((d) => (
                  <TR key={d.id}>
                    <TD className="font-medium">{d.vendorName ?? 'No vendor on file'}</TD>
                    <TD>
                      <Badge tone={d.status === 'draft' ? 'info' : 'success'}>
                        {d.status === 'draft' ? 'Draft' : 'Approved'}
                      </Badge>
                    </TD>
                    <TDNum>{d.lines}</TDNum>
                    <TDNum>{formatMoney(d.total)}</TDNum>
                    <TD className="whitespace-nowrap text-text-muted">{formatDate(d.created)}</TD>
                    <TD className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setOpenId(d.id)}>
                        Open
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pager
              page={draftPage?.pagination}
              onOffset={setDraftOffset}
              label="Draft order pages"
            />
          </section>
        </>
      )}

      <Modal
        open={!!openId}
        onClose={() => setOpenId(null)}
        title={openDraft ? `Order: ${openDraft.vendorName ?? 'No vendor on file'}` : 'Order'}
        size="xl"
      >
        {openId && <DraftWindow id={openId} onClose={() => setOpenId(null)} />}
      </Modal>
    </>
  )
}
