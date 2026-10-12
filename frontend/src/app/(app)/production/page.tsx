'use client'

import { useState } from 'react'
import {
  Avatar,
  Button,
  KpiCard,
  Modal,
  PageHeader,
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
  Icon,
  PAGE_SIZE,
  Pager,
  usePageOffset,
} from '@/components/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { productionService } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { useActiveLocationId } from '@/lib/api/useActiveLocation'
import { useRestaurantDay } from '@/lib/utils/restaurant-day'
import { formatDate, formatMoney } from '@/lib/utils/format'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

export default function ProductionPage() {
  const toast = useToast()
  const invalidate = useInvalidate()
  const { can, user } = useCurrentUser()
  const locationId = useActiveLocationId()
  const [offset, setOffset] = usePageOffset()
  const { data: page } = useQuery(queries.production({ offset, limit: PAGE_SIZE }))
  const { data: summary } = useQuery(queries.productionSummary())
  const batches = page?.data ?? []
  const { data: recipes = [] } = useQuery(queries.recipes())

  const [open, setOpen] = useState(false)
  const [recipeId, setRecipeId] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('portion')
  const day = useRestaurantDay()
  const [date, setDate] = useState('')
  const [madeBy, setMadeBy] = useState('')
  const chosen = recipes.find((r) => r.id === recipeId)

  const recording = useMutation({
    mutationFn: (quantity: number) =>
      productionService.create({
        recipeId,
        quantity,
        unit: unit || 'portion',
        date: date || day.today,
        madeBy: madeBy.trim() || undefined,
      }),
    onSuccess: async () => {
      await invalidate('production')
      setOpen(false)
      setQty('')
      setMadeBy('')
      toast('success', 'Production batch recorded')
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  function record() {
    const amount = parseFloat(qty)
    if (!recipeId || !amount || amount <= 0) {
      toast('danger', 'Pick a recipe and a quantity')
      return
    }
    recording.mutate(amount)
  }

  const totalCost = summary?.cost ?? 0
  const avgBatchCost = summary?.average ?? 0
  const uniqueRecipes = summary?.recipes ?? 0

  return (
    <>
      <PageHeader
        title="Production History"
        subtitle={
          locationId
            ? 'Track recipe batches and their cost'
            : 'Batches of every location together. Choose a location in the header to record one: a batch is made at a location'
        }
        actions={
          can('staff') ? (
            <Button
              variant="primary"
              disabled={!locationId}
              title={locationId ? undefined : 'Choose a location in the header first'}
              onClick={() => setOpen(true)}
            >
              Record Batch
            </Button>
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Batches"
          value={summary?.batches ?? 0}
          tone="slate"
          icon={<Icon name="box" />}
        />
        <KpiCard
          label="Total Cost"
          value={formatMoney(totalCost)}
          tone="success"
          icon={<Icon name="dollar" />}
        />
        <KpiCard
          label="Avg Batch Cost"
          value={formatMoney(avgBatchCost)}
          tone="info"
          icon={<Icon name="chart" />}
        />
        <KpiCard
          label="Unique Recipes"
          value={uniqueRecipes}
          tone="primary"
          icon={<Icon name="layers" />}
        />
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Recipe / component</TH>
            <TH>Quantity</TH>
            <TH>Made by</TH>
            <TH>Date</TH>
            <TH>Batch cost</TH>
          </TR>
        </THead>
        <TBody>
          {batches.length === 0 && (
            <TableEmpty colSpan={5}>No production batches recorded yet.</TableEmpty>
          )}
          {batches.map((b) => (
            <TR key={b.id}>
              <TD className="font-medium">{b.recipe}</TD>
              <TD>{b.qty}</TD>
              <TD>
                {b.madeBy ? (
                  <div className="flex items-center gap-2.5">
                    <Avatar name={b.madeBy} size="sm" />
                    <span className="text-text-muted">{b.madeBy}</span>
                  </div>
                ) : (
                  <span className="text-text-muted">Not recorded</span>
                )}
              </TD>
              <TD className="whitespace-nowrap text-text-muted">{formatDate(b.date)}</TD>
              <TD>{formatMoney(b.cost)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Pager page={page?.pagination} onOffset={setOffset} label="Batch pages" />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record Production Batch"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={record} disabled={recording.isPending}>
              Record Batch
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Recipe"
            required
            className="sm:col-span-2"
            placeholder="Select…"
            help="Records the batch and its cost. It does not move stock: what the batch used is recorded on Inventory."
            value={recipeId}
            onChange={(e) => {
              setRecipeId(e.target.value)
              setUnit('portion')
            }}
            options={recipes.map((r) => ({ value: r.id, label: r.name }))}
          />
          <TextField
            label="Quantity"
            type="number"
            min="0"
            step="0.1"
            required
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          {chosen?.yieldUnit ? (
            <UnitField
              label="Unit"
              pricedIn={chosen.yieldUnit}
              extraOptions={[{ value: 'portion', label: 'Portion' }]}
              help={`The batch is costed as a share of the recipe's yield of ${chosen.yieldAmount} ${chosen.yieldUnit}`}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          ) : (
            <SelectField
              label="Unit"
              help="The recipe states no yield, so the batch is counted in its portions"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              options={[{ value: 'portion', label: 'Portion' }]}
            />
          )}
          <TextField
            label="Date"
            type="date"
            max={day.latest}
            value={date || day.today}
            onChange={(e) => setDate(e.target.value)}
          />
          <TextField
            label="Made by"
            placeholder={user?.name}
            help="Leave empty to record the batch as yours"
            maxLength={120}
            value={madeBy}
            onChange={(e) => setMadeBy(e.target.value)}
          />
        </div>
      </Modal>
    </>
  )
}
