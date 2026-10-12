'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Modal, TextField, UnitField, useToast } from '@/components/ui'
import { ingredientsService, type Ingredient } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useActiveLocation } from '@/lib/api/useActiveLocation'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { CategoryField } from './CategoryField'

const EMPTY = { name: '', unit: 'kg', categoryId: '', costPerUnit: '' }

export function NewIngredientDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (ingredient: Ingredient) => void
}) {
  const [form, setForm] = useState(EMPTY)
  const toast = useToast()
  const invalidate = useInvalidate()
  const location = useActiveLocation()

  const close = () => {
    setForm(EMPTY)
    onClose()
  }

  const creation = useMutation({
    mutationFn: (cost: number) =>
      ingredientsService.create({
        name: form.name.trim(),
        unit: form.unit,
        costPerUnit: cost,
        categoryId: form.categoryId || null,
      }),
    onSuccess: async (created) => {
      await invalidate('ingredients')
      toast('success', `${created.name} added to the ingredients`)
      onCreated(created)
      close()
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  function submit() {
    const cost = form.costPerUnit.trim() === '' ? 0 : parseFloat(form.costPerUnit)
    if (!form.name.trim() || !form.unit || Number.isNaN(cost) || cost < 0) {
      toast('danger', 'A name and a base unit are required, and a cost cannot be negative')
      return
    }
    creation.mutate(cost)
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="New Ingredient"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={creation.isPending}>
            Add and use
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          required
          className="sm:col-span-2"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <UnitField
          label="Base unit"
          required
          help="The unit it is priced and counted in"
          value={form.unit}
          onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
        />
        <CategoryField
          kind="ingredient"
          value={form.categoryId}
          onChange={(categoryId) => setForm((f) => ({ ...f, categoryId }))}
        />
        <TextField
          label="Cost per unit"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          className="sm:col-span-2"
          help={
            location.name
              ? `What ${location.name} pays; leave empty to price it later on Ingredients`
              : 'Leave empty to price it later on Ingredients'
          }
          value={form.costPerUnit}
          onChange={(e) => setForm((f) => ({ ...f, costPerUnit: e.target.value }))}
        />
      </div>
    </Modal>
  )
}
