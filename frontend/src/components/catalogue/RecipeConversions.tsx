'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Button,
  Card,
  ConfirmDialog,
  Modal,
  SelectField,
  Table,
  TBody,
  TD,
  TextField,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui'
import { unitConversionsService, type UnitConversion } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'
import { useUnits } from '@/lib/api/useUnits'

const EMPTY = { ingredientId: '', fromUnit: '', toUnit: '', factor: '' }
const EVERY = 'Every ingredient and sub-recipe'

export function RecipeConversions({
  recipe,
  manage,
}: {
  recipe: { id: string; name: string; ingredients: { ingredientId: string; name: string }[] }
  manage: boolean
}) {
  const { data: conversions = [] } = useQuery(queries.unitConversions())
  const own = conversions.filter((c) => c.recipeId === recipe.id)
  const units = useUnits()
  const invalidate = useInvalidate()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [pendingRemove, setPendingRemove] = useState<UnitConversion | null>(null)

  const unitChoices = [
    { value: '', label: 'Choose a unit' },
    ...units.map((u) => ({ value: u.value, label: `${u.label} (${u.value})` })),
  ]
  const lineChoices = [
    { value: '', label: EVERY },
    ...[...new Map(recipe.ingredients.map((i) => [i.ingredientId, i.name])).entries()].map(
      ([value, label]) => ({ value, label })
    ),
  ]

  const creation = useMutation({
    mutationFn: (factor: number) =>
      unitConversionsService.create({
        recipeId: recipe.id,
        ingredientId: form.ingredientId || undefined,
        fromUnit: form.fromUnit,
        toUnit: form.toUnit,
        factor,
      }),
    onSuccess: async () => {
      await invalidate('units')
      toast('success', `Conversion saved for ${recipe.name}`)
      setOpen(false)
      setForm(EMPTY)
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not save the conversion')),
  })

  function submit() {
    const factor = Number(form.factor.trim().replace(',', '.'))
    if (!form.fromUnit || !form.toUnit) {
      toast('danger', 'Both units are required')
      return
    }
    if (!Number.isFinite(factor) || factor <= 0) {
      toast('danger', 'The factor must be a positive number')
      return
    }
    creation.mutate(factor)
  }

  const removal = useMutation({
    mutationFn: (row: UnitConversion) => unitConversionsService.remove(row.id),
    onSuccess: async () => {
      await invalidate('units')
      toast('success', 'Conversion removed and the recipe recosted')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not remove the conversion')),
    onSettled: () => setPendingRemove(null),
  })

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="section-title font-semibold">Unit conversions in this recipe</h2>
        {manage && (
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto"
            onClick={() => {
              setForm(EMPTY)
              setOpen(true)
            }}
          >
            + Add conversion
          </Button>
        )}
      </div>
      <p className="mt-1 text-sm text-text-muted">
        Read here before the ingredient&apos;s own rules and the shared ones, and nowhere else: a
        cup of oil in this recipe, a portion of a sub-recipe measured by the piece.
      </p>
      {own.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">None recorded for this recipe.</p>
      ) : (
        <div className="mt-3">
          <Table compact pinActions={manage}>
            <THead>
              <TR>
                <TH>Applies to</TH>
                <TH>One of</TH>
                <TH>Equals</TH>
                <TH>Factor</TH>
                {manage && <TH className="text-right">Actions</TH>}
              </TR>
            </THead>
            <TBody>
              {own.map((c) => (
                <TR key={c.id}>
                  <TD>{c.ingredient || EVERY}</TD>
                  <TD>{c.fromUnit}</TD>
                  <TD>{c.toUnit}</TD>
                  <TD>{c.factor}</TD>
                  {manage && (
                    <TD className="text-right">
                      <button
                        type="button"
                        className="text-[13px] font-medium text-danger-700 hover:underline dark:text-danger-100"
                        onClick={() => setPendingRemove(c)}
                      >
                        Remove
                      </button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Conversion for ${recipe.name}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={creation.isPending}>
              Save
            </Button>
          </>
        }
      >
        {open && (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Applies to"
              help="An ingredient of this recipe, or every line and sub-recipe in it"
              className="sm:col-span-2"
              value={form.ingredientId}
              onChange={(e) => setForm({ ...form, ingredientId: e.target.value })}
              options={lineChoices}
            />
            <SelectField
              label="From unit"
              value={form.fromUnit}
              onChange={(e) => setForm({ ...form, fromUnit: e.target.value })}
              options={unitChoices}
            />
            <SelectField
              label="To unit"
              value={form.toUnit}
              onChange={(e) => setForm({ ...form, toUnit: e.target.value })}
              options={unitChoices}
            />
            <TextField
              label="Factor"
              help="How many of the second unit one of the first weighs or fills"
              placeholder="0.22"
              className="sm:col-span-2"
              value={form.factor}
              onChange={(e) => setForm({ ...form, factor: e.target.value })}
            />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={pendingRemove !== null}
        title="Remove this conversion?"
        confirmLabel="Remove"
        onClose={() => setPendingRemove(null)}
        onConfirm={() => pendingRemove && removal.mutate(pendingRemove)}
        busy={removal.isPending}
      >
        {recipe.name} is recosted without it. A line that only this rule converts has to change
        first, and the removal says which.
      </ConfirmDialog>
    </Card>
  )
}
