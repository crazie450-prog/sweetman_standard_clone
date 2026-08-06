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
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { productionService, recipesService } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { today } from '@/lib/utils/date-range'
import { formatDate, formatMoney } from '@/lib/utils/format'

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
  dollar: I(
    'M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5s2 3 5 3.3 5 1.4 5 3.2-2.2 3.5-5 3.5-5-1.4-5-3.3'
  ),
  chart: I('M4 20V10M10 20V4M16 20v-7M20 20H3'),
  layers: I('M12 2 2 7l10 5 10-5-10-5M2 12l10 5 10-5M2 17l10 5 10-5'),
}

export default function ProductionPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { can } = useCurrentUser()
  const { data: batches = [] } = useQuery({
    queryKey: ['production'],
    queryFn: productionService.batches,
  })
  const { data: recipes = [] } = useQuery({ queryKey: ['recipes'], queryFn: recipesService.list })

  const [open, setOpen] = useState(false)
  const [recipeId, setRecipeId] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('ea')
  const [date, setDate] = useState(today())
  const [busy, setBusy] = useState(false)

  async function record() {
    const amount = parseFloat(qty)
    if (!recipeId || !amount || amount <= 0) {
      toast('danger', 'Pick a recipe and a quantity')
      return
    }
    setBusy(true)
    try {
      await productionService.create({
        recipeId,
        quantity: amount,
        unit: unit || 'ea',
        date: date || undefined,
      })
      await queryClient.invalidateQueries({ queryKey: ['production'] })
      setOpen(false)
      setQty('')
      toast('success', 'Production batch recorded')
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const totalCost = batches.reduce((s, b) => s + b.cost, 0)
  const avgBatchCost = batches.length ? totalCost / batches.length : 0
  const uniqueRecipes = new Set(batches.map((b) => b.recipe)).size

  return (
    <>
      <PageHeader
        title="Production History"
        subtitle="Track recipe batches and their cost"
        actions={
          can('staff') ? (
            <Button variant="primary" onClick={() => setOpen(true)}>
              Record Batch
            </Button>
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Batches" value={batches.length} tone="slate" icon={icons.box} />
        <KpiCard
          label="Total Cost"
          value={formatMoney(totalCost)}
          tone="success"
          icon={icons.dollar}
        />
        <KpiCard
          label="Avg Batch Cost"
          value={formatMoney(avgBatchCost)}
          tone="info"
          icon={icons.chart}
        />
        <KpiCard label="Unique Recipes" value={uniqueRecipes} tone="primary" icon={icons.layers} />
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
                <div className="flex items-center gap-2.5">
                  <Avatar name={b.madeBy} size="sm" />
                  <span className="text-text-muted">{b.madeBy}</span>
                </div>
              </TD>
              <TD className="text-text-muted">{formatDate(b.date)}</TD>
              <TD>{formatMoney(b.cost)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record Production Batch"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={record} disabled={busy}>
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
            help="Records the batch and its cost. Stock usage tracking is not available yet."
            value={recipeId}
            onChange={(e) => setRecipeId(e.target.value)}
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
          <TextField label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <TextField
            label="Date"
            type="date"
            className="sm:col-span-2"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </Modal>
    </>
  )
}
