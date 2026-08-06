'use client'

import { useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Checkbox,
  KpiCard,
  Modal,
  PageHeader,
  SearchInput,
  SelectField,
  RowActions,
  Table,
  TableEmpty,
  TBody,
  TD,
  TextField,
  TH,
  THead,
  TR,
  useToast,
  Progress,
} from '@/components/ui'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { inventoryService } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { formatMoney } from '@/lib/utils/format'

const I = (d: string) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-6"
    aria-hidden
  >
    <path d={d} />
  </svg>
)
const icons = {
  box: I('M12 3 4 7v10l8 4 8-4V7l-8-4M4 7l8 4 8-4M12 11v10'),
  alert: I('M12 3 2 20h20L12 3zM12 9v5M12 17.5v.5'),
  dollar: I(
    'M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5s2 3 5 3.3 5 1.4 5 3.2-2.2 3.5-5 3.5-5-1.4-5-3.3'
  ),
  tag: I(
    'M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4zM7 7v.01'
  ),
}

const categoryOf = (i: { category?: string }) => i.category || 'Uncategorized'

export default function InventoryPage() {
  const { data: ingredients = [], isLoading } = useQuery({
    queryKey: ['inventory'],
    queryFn: inventoryService.list,
  })
  const [adjustFor, setAdjustFor] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [vendor, setVendor] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const toast = useToast()
  const queryClient = useQueryClient()
  const { can } = useCurrentUser()

  const [txType, setTxType] = useState<'COUNT' | 'ADJUST' | 'RECEIVE' | 'USE'>('COUNT')
  const [txQty, setTxQty] = useState('')
  const [txNote, setTxNote] = useState('')
  const [txBusy, setTxBusy] = useState(false)

  const low = ingredients.filter((i) => i.status === 'low')
  const totalValue = ingredients.reduce((s, i) => s + i.onHand * i.costPerUnit, 0)
  const categories = [...new Set(ingredients.map((i) => categoryOf(i)))].sort()
  const vendorNames = [...new Set(ingredients.map((i) => i.vendor))].filter(Boolean).sort()
  const item = ingredients.find((i) => i.id === adjustFor)

  const filtered = useMemo(
    () =>
      ingredients.filter(
        (i) =>
          i.name.toLowerCase().includes(search.trim().toLowerCase()) &&
          (!category || categoryOf(i) === category) &&
          (!vendor || i.vendor === vendor) &&
          (!lowOnly || i.status === 'low')
      ),
    [ingredients, search, category, vendor, lowOnly]
  )

  const openAdjust = (id: string) => {
    setAdjustFor(id)
    setTxType('COUNT')
    setTxQty('')
    setTxNote('')
  }

  async function saveAdjustment() {
    if (!item) return
    const qty = parseFloat(txQty)
    if (Number.isNaN(qty)) {
      toast('danger', 'Enter a quantity')
      return
    }
    if (txType !== 'ADJUST' && qty < 0) {
      toast('danger', 'This quantity cannot be negative — use “Correction (+/−)” to subtract')
      return
    }
    setTxBusy(true)
    try {
      await inventoryService.createTransaction({
        ingredientId: item.id,
        type: txType,
        quantity: qty,
        notes: txNote.trim() || undefined,
      })
      await queryClient.invalidateQueries({ queryKey: ['inventory'] })
      await queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      setAdjustFor(null)
      toast('success', `Stock updated for ${item.name}`)
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setTxBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Inventory Management"
        subtitle="Track ingredient stock levels, costs, and reorder points"
        actions={
          <>
            {can('staff') && (
              <>
                <Link
                  href="/ingredients"
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700"
                >
                  New Ingredient
                </Link>
                <Link
                  href="/documents"
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-surface px-4 text-sm font-medium text-text transition-colors hover:bg-bg"
                >
                  Import Invoice
                </Link>
              </>
            )}
            <Button
              variant="secondary"
              onClick={() => toast('info', 'Reconciliation arrives with invoice processing')}
            >
              Reconcile Inventory
            </Button>
            <Button
              variant="secondary"
              onClick={() => toast('info', 'A touch-optimized counting flow is not available yet')}
            >
              Mobile Count
            </Button>
            <Button
              variant="secondary"
              onClick={() => toast('info', 'Duplicate detection arrives with document processing')}
            >
              Find Duplicates
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Items" value={ingredients.length} tone="slate" icon={icons.box} />
        <KpiCard
          label="Low Stock Items"
          value={low.length}
          tone={low.length > 0 ? 'warning' : 'slate'}
          icon={icons.alert}
        />
        <KpiCard
          label="Inventory Value"
          value={formatMoney(totalValue)}
          tone="success"
          icon={icons.dollar}
        />
        <KpiCard label="Categories" value={categories.length} tone="primary" icon={icons.tag} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput
          label="Search ingredients"
          placeholder="Search ingredients"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56"
        />
        <SelectField
          label="Category"
          hideLabel
          placeholder="All Categories"
          options={categories.map((c) => ({ value: c, label: c }))}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-44"
        />
        <SelectField
          label="Vendor"
          hideLabel
          placeholder="All Vendors"
          options={vendorNames.map((v) => ({ value: v, label: v }))}
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
          className="w-52"
        />
        <Checkbox
          label="Low Stock Only"
          checked={lowOnly}
          onChange={(e) => setLowOnly(e.target.checked)}
        />
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Ingredient</TH>
            <TH>Category</TH>
            <TH>Vendor</TH>
            <TH>On hand</TH>
            <TH>Reorder level</TH>
            <TH>Value</TH>
            <TH>Status</TH>
            <TH className="text-right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {isLoading ? (
            <TableEmpty colSpan={8}>Loading inventory…</TableEmpty>
          ) : filtered.length === 0 ? (
            <TableEmpty colSpan={8}>No ingredients match the current filters.</TableEmpty>
          ) : (
            filtered.map((i) => (
              <TR key={i.id}>
                <TD className="font-medium">{i.name}</TD>
                <TD>{categoryOf(i)}</TD>
                <TD>{i.vendor}</TD>
                <TD>
                  <div className="min-w-28">
                    <p className="tabular">
                      {i.onHand} {i.unit}
                    </p>
                    <Progress
                      value={(i.onHand / (i.reorderLevel * 2)) * 100}
                      target={50}
                      tone={i.status === 'low' ? 'warning' : 'primary'}
                      size="sm"
                      animate={false}
                      className="mt-1 w-24"
                    />
                  </div>
                </TD>
                <TD>
                  {i.reorderLevel} {i.unit}
                </TD>
                <TD>{formatMoney(i.onHand * i.costPerUnit)}</TD>
                <TD>
                  {i.status === 'low' ? (
                    <Badge dot tone="warning">
                      Low stock
                    </Badge>
                  ) : (
                    <Badge dot tone="success">
                      OK
                    </Badge>
                  )}
                </TD>
                <TD className="text-right">
                  <RowActions className="justify-end">
                    {can('staff') && (
                      <Button variant="ghost" size="sm" onClick={() => openAdjust(i.id)}>
                        Adjust
                      </Button>
                    )}
                  </RowActions>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      <Modal
        open={!!adjustFor}
        onClose={() => setAdjustFor(null)}
        title={`Adjust — ${item?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdjustFor(null)}>
              Cancel
            </Button>
            <Button onClick={saveAdjustment} disabled={txBusy}>
              Save Adjustment
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Type"
            value={txType}
            onChange={(e) => setTxType(e.target.value as typeof txType)}
            options={[
              { value: 'COUNT', label: 'Physical count' },
              { value: 'ADJUST', label: 'Correction (+/−)' },
              { value: 'RECEIVE', label: 'Received' },
              { value: 'USE', label: 'Used' },
            ]}
          />
          <TextField
            label={
              txType === 'COUNT'
                ? `Counted quantity (${item?.unit ?? ''})`
                : `Quantity (${item?.unit ?? ''})`
            }
            type="number"
            step="0.1"
            min={txType === 'ADJUST' ? undefined : '0'}
            required
            value={txQty}
            onChange={(e) => setTxQty(e.target.value)}
            help={
              txType === 'COUNT'
                ? `Sets the stock level. Currently ${item?.onHand ?? 0} ${item?.unit ?? ''}.`
                : txType === 'ADJUST'
                  ? 'Positive adds, negative removes.'
                  : undefined
            }
          />
          <TextField
            label="Note"
            className="sm:col-span-2"
            placeholder="Optional comment"
            value={txNote}
            onChange={(e) => setTxNote(e.target.value)}
          />
        </div>
      </Modal>
    </>
  )
}
