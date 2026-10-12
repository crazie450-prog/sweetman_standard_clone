'use client'

import { RequireRole } from '@/components/layout/RequireRole'
import { useState } from 'react'
import {
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
import { useMutation, useQuery } from '@tanstack/react-query'
import { unitConversionsService, type UnitConversion } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { ingredientChoices, keepingCurrent } from '@/lib/utils/options'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'
import { useUnits } from '@/lib/api/useUnits'

const EMPTY = { ingredientId: '', fromUnit: '', toUnit: '', factor: '' }

function UnitsPage() {
  const { data: conversions = [], isLoading } = useQuery(queries.unitConversions())
  const { data: ingredients = [] } = useQuery(queries.ingredients())
  const invalidate = useInvalidate()
  const { can } = useCurrentUser()
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const units = useUnits()
  const unitChoices = (current: string) => {
    const options = [
      { value: '', label: 'Choose a unit' },
      ...units.map((u) => ({ value: u.value, label: `${u.label} (${u.value})` })),
    ]
    return !current || options.some((o) => o.value === current)
      ? options
      : [...options, { value: current, label: `${current} (recorded before the list)` }]
  }
  const [pendingRemove, setPendingRemove] = useState<UnitConversion | null>(null)
  const [editing, setEditing] = useState<UnitConversion | null>(null)

  function startCreate() {
    setEditing(null)
    setForm(EMPTY)
    setOpen(true)
  }

  function startEdit(row: UnitConversion) {
    setEditing(row)
    setForm({
      ingredientId: row.ingredientId ?? '',
      fromUnit: row.fromUnit,
      toUnit: row.toUnit,
      factor: String(row.factor),
    })
    setOpen(true)
  }

  const save = useMutation({
    mutationFn: (factor: number) => {
      const rule = { fromUnit: form.fromUnit.trim(), toUnit: form.toUnit.trim(), factor }
      return editing
        ? unitConversionsService.update(editing.id, {
            ...rule,
            ingredientId: form.ingredientId || null,
          })
        : unitConversionsService.create({ ...rule, ingredientId: form.ingredientId || undefined })
    },
    onSuccess: async () => {
      await invalidate('units')
      toast('success', 'Conversion saved and recipes recosted')
      setOpen(false)
      setForm(EMPTY)
      setEditing(null)
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not save the conversion')),
  })

  function submit() {
    const factor = Number(form.factor.trim().replace(',', '.'))
    if (!form.fromUnit.trim() || !form.toUnit.trim()) {
      toast('danger', 'Both units are required')
      return
    }
    if (!Number.isFinite(factor) || factor <= 0) {
      toast('danger', 'The factor must be a positive number')
      return
    }
    save.mutate(factor)
  }

  const removal = useMutation({
    mutationFn: (row: UnitConversion) => unitConversionsService.remove(row.id),
    onSuccess: async () => {
      await invalidate('units')
      toast('success', 'Conversion removed and recipes recosted')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not remove the conversion')),
    onSettled: () => setPendingRemove(null),
  })

  return (
    <>
      <PageHeader
        title="Unit Conversions"
        subtitle="Bridge a unit a recipe is written in to the unit its ingredient is priced in. Units of the same kind (grams and kilograms, millilitres and litres) already convert on their own."
        actions={
          can('manager') ? (
            <Button variant="primary" onClick={startCreate}>
              + Add Conversion
            </Button>
          ) : undefined
        }
      />

      {isLoading && <p className="text-sm text-text-muted">Loading…</p>}

      {!isLoading && conversions.length === 0 && (
        <EmptyState
          title="No conversions recorded"
          hint="Add one when a recipe measures an ingredient in a unit its price does not use: eggs by the piece, flour by the litre."
          action={
            can('manager') ? <Button onClick={startCreate}>+ Add Conversion</Button> : undefined
          }
        />
      )}

      {conversions.length > 0 && (
        <Table>
          <THead>
            <TR>
              <TH>Applies to</TH>
              <TH>One of</TH>
              <TH>Equals</TH>
              <TH>Factor</TH>
              {can('manager') && <TH>Actions</TH>}
            </TR>
          </THead>
          <TBody>
            {conversions.map((c) => (
              <TR key={c.id}>
                <TD>
                  {c.recipe
                    ? `${c.ingredient || 'Every ingredient'} in ${c.recipe}`
                    : c.ingredient || 'Every ingredient'}
                </TD>
                <TD>{c.fromUnit}</TD>
                <TD>{c.toUnit}</TD>
                <TD>{c.factor}</TD>
                {can('manager') && (
                  <TD>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => startEdit(c)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setPendingRemove(c)}>
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

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit Conversion' : 'Add Conversion'}
      >
        <div className="grid gap-4">
          <SelectField
            label="Ingredient"
            help={
              editing?.recipe
                ? `Applies inside ${editing.recipe} only; leave empty for every ingredient there`
                : 'Leave empty to apply the rule across the organization'
            }
            searchable
            value={form.ingredientId}
            onChange={(e) => setForm({ ...form, ingredientId: e.target.value })}
            options={keepingCurrent(
              [{ value: '', label: 'Every ingredient' }, ...ingredientChoices(ingredients)],
              editing?.ingredientId,
              editing?.ingredient
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="From unit"
              value={form.fromUnit}
              onChange={(e) => setForm({ ...form, fromUnit: e.target.value })}
              options={unitChoices(form.fromUnit)}
            />
            <SelectField
              label="To unit"
              value={form.toUnit}
              onChange={(e) => setForm({ ...form, toUnit: e.target.value })}
              options={unitChoices(form.toUnit)}
            />
          </div>
          <TextField
            label="Factor"
            help="How many of the second unit one of the first weighs or fills"
            placeholder="0.05"
            value={form.factor}
            onChange={(e) => setForm({ ...form, factor: e.target.value })}
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
        title="Remove this conversion?"
        confirmLabel="Remove"
        onClose={() => setPendingRemove(null)}
        onConfirm={() => pendingRemove && removal.mutate(pendingRemove)}
        busy={removal.isPending}
      >
        Recipes that relied on it will be costed without it, which may change their totals.
      </ConfirmDialog>
    </>
  )
}

export default function Page() {
  return (
    <RequireRole minRole="manager">
      <UnitsPage />
    </RequireRole>
  )
}
