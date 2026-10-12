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
  Icon,
} from '@/components/ui'
import Link from 'next/link'
import { useMutation, useQuery } from '@tanstack/react-query'
import { inventoryService } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { useActiveLocationId } from '@/lib/api/useActiveLocation'
import { formatMoney } from '@/lib/utils/format'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

const categoryOf = (i: { category?: string }) => i.category || 'Uncategorized'

export default function InventoryPage() {
  const { data: ingredients = [], isLoading } = useQuery(queries.inventory())
  const [adjustFor, setAdjustFor] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [vendor, setVendor] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const toast = useToast()
  const invalidate = useInvalidate()
  const { can } = useCurrentUser()
  const locationId = useActiveLocationId()

  const [txType, setTxType] = useState<'COUNT' | 'ADJUST' | 'RECEIVE' | 'USE'>('COUNT')
  const [txQty, setTxQty] = useState('')
  const [txNote, setTxNote] = useState('')
  const [txCost, setTxCost] = useState('')

  const low = ingredients.filter((i) => i.status === 'low')
  const totalValue = ingredients.reduce((s, i) => s + i.value, 0)
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
    setTxCost('')
  }

  const adjustment = useMutation({
    mutationFn: (change: Parameters<typeof inventoryService.createTransaction>[0]) =>
      inventoryService.createTransaction(change),
    onSuccess: async () => {
      await invalidate('stock')
      setAdjustFor(null)
      toast('success', `Stock updated for ${item?.name ?? 'the ingredient'}`)
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  function saveAdjustment() {
    if (!item) return
    const qty = parseFloat(txQty)
    if (Number.isNaN(qty)) {
      toast('danger', 'Enter a quantity')
      return
    }
    if (txType !== 'ADJUST' && qty < 0) {
      toast('danger', 'This quantity cannot be negative; use “Correction (+/−)” to subtract')
      return
    }
    const cost = txType === 'RECEIVE' && txCost.trim() !== '' ? parseFloat(txCost) : undefined
    if (cost !== undefined && (Number.isNaN(cost) || cost < 0)) {
      toast('danger', 'The total cost must be a positive amount')
      return
    }
    adjustment.mutate({
      ingredientId: item.id,
      type: txType,
      quantity: qty,
      cost,
      notes: txNote.trim() || undefined,
    })
  }

  return (
    <>
      <PageHeader
        title="Inventory Management"
        subtitle={
          locationId
            ? 'Track ingredient stock levels, costs, and reorder points'
            : 'Stock held by every location together. Choose a location in the header to record a count or a movement: stock is held by a location'
        }
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
          </>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Items"
          value={ingredients.length}
          tone="slate"
          icon={<Icon name="box" />}
        />
        <KpiCard
          label="Low Stock Items"
          value={low.length}
          tone={low.length > 0 ? 'warning' : 'slate'}
          icon={<Icon name="alert" />}
        />
        <KpiCard
          label="Inventory Value"
          value={formatMoney(totalValue)}
          tone="success"
          icon={<Icon name="dollar" />}
        />
        <KpiCard
          label="Categories"
          value={categories.length}
          tone="primary"
          icon={<Icon name="tag" />}
        />
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

      <Table pinActions>
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
                <TD className="font-medium">
                  {i.name}
                  {!i.isActive && (
                    <Badge tone="neutral" className="ml-2">
                      Archived
                    </Badge>
                  )}
                </TD>
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
                <TD>{formatMoney(i.value)}</TD>
                <TD>
                  {i.status === 'low' ? (
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
                      OK
                    </Badge>
                  )}
                </TD>
                <TD className="text-right">
                  <RowActions className="justify-end">
                    {can('staff') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!locationId}
                        title={locationId ? undefined : 'Choose a location in the header first'}
                        onClick={() => openAdjust(i.id)}
                      >
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
        title={`Adjust: ${item?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdjustFor(null)}>
              Cancel
            </Button>
            <Button onClick={saveAdjustment} disabled={adjustment.isPending}>
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
          {txType === 'RECEIVE' && (
            <TextField
              label="Total cost"
              type="number"
              min="0"
              step="0.01"
              className="sm:col-span-2"
              placeholder="Optional"
              help="What this delivery cost in total. It is recorded in the price history; leave it empty to value the delivery at the current price."
              value={txCost}
              onChange={(e) => setTxCost(e.target.value)}
            />
          )}
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
