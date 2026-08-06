'use client'

import { useRouter } from 'next/navigation'
import { RequireRole } from '@/components/layout/RequireRole'
import { useState } from 'react'
import {
  Button,
  Card,
  PageHeader,
  SelectField,
  Stepper,
  TextField,
  useToast,
} from '@/components/ui'
import { useQuery } from '@tanstack/react-query'
import {
  categoriesService,
  ingredientsService,
  locationsService,
  recipesService,
  type RecipeIngredientInput,
} from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { formatMoney } from '@/lib/utils/format'

const STEPS = ['Details', 'Ingredients', 'Review']

type Line = { ingredientId: string; qty: string; unit: string }

const EMPTY_LINE: Line = { ingredientId: '', qty: '', unit: '' }

function NewRecipePage() {
  const { data: ingredients = [] } = useQuery({
    queryKey: ['ingredients'],
    queryFn: ingredientsService.list,
  })
  const { data: categories = [] } = useQuery({
    queryKey: ['categories', 'recipe'],
    queryFn: () => categoriesService.list('recipe'),
  })
  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: locationsService.list,
  })
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [portions, setPortions] = useState('4')
  const [targetPct, setTargetPct] = useState('30')
  const [lines, setLines] = useState<Line[]>([EMPTY_LINE])
  const [saving, setSaving] = useState(false)
  const router = useRouter()
  const toast = useToast()

  const ingredientById = (id: string) => ingredients.find((i) => i.id === id)

  const setLine = (idx: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))

  const filled = lines.filter((l) => l.ingredientId && parseFloat(l.qty) > 0)

  const estimate = filled.reduce((sum, l) => {
    const ing = ingredientById(l.ingredientId)
    return sum + (ing ? ing.costPerUnit * parseFloat(l.qty) : 0)
  }, 0)

  async function create() {
    if (!name.trim()) {
      toast('danger', 'Recipe name is required')
      setStep(0)
      return
    }
    setSaving(true)
    try {
      const payload: RecipeIngredientInput[] = filled.map((l) => ({
        ingredientId: l.ingredientId,
        quantity: parseFloat(l.qty),
        unit: l.unit || ingredientById(l.ingredientId)?.unit || 'ea',
      }))
      const created = await recipesService.create({
        name: name.trim(),
        portions: parseInt(portions, 10) || 1,
        categoryId: categoryId || undefined,
        locationId: locationId || undefined,
        targetFoodCostPct: targetPct === '' ? undefined : parseFloat(targetPct),
        ingredients: payload,
      })
      toast('success', 'Recipe created')
      router.push(`/recipes/${created.id}`)
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="New Recipe" subtitle="Create a recipe or a reusable component" />

      <div className="mb-6">
        <Stepper steps={STEPS} current={step} />
      </div>

      <Card className="max-w-2xl">
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Recipe name"
              required
              className="sm:col-span-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <SelectField
              label="Category"
              placeholder="Uncategorized"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
            <SelectField
              label="Location"
              placeholder="All locations"
              help="Leave empty to share this recipe across locations"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              options={locations.map((l) => ({ value: l.id, label: l.name }))}
            />
            <TextField
              label="Portions"
              type="number"
              min="1"
              value={portions}
              onChange={(e) => setPortions(e.target.value)}
            />
            <TextField
              label="Target food-cost %"
              type="number"
              min="0"
              max="100"
              value={targetPct}
              onChange={(e) => setTargetPct(e.target.value)}
            />
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            {lines.map((line, idx) => (
              <div key={idx} className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                <SelectField
                  label="Ingredient"
                  placeholder="Select…"
                  value={line.ingredientId}
                  onChange={(e) => {
                    const ing = ingredientById(e.target.value)
                    setLine(idx, { ingredientId: e.target.value, unit: ing?.unit ?? line.unit })
                  }}
                  options={ingredients.map((i) => ({ value: i.id, label: i.name }))}
                />
                <TextField
                  label="Qty"
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.qty}
                  onChange={(e) => setLine(idx, { qty: e.target.value })}
                />
                <TextField
                  label="Unit"
                  value={line.unit}
                  onChange={(e) => setLine(idx, { unit: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-1"
                  onClick={() =>
                    setLines((ls) =>
                      ls.length === 1 ? [EMPTY_LINE] : ls.filter((_, i) => i !== idx)
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, EMPTY_LINE])}>
              + Add another line
            </Button>
            <p className="text-sm text-text-muted">
              A recipe can also include another recipe as a costed component — add those on the
              recipe page once it exists.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3 text-sm">
            <p className="font-medium">Review &amp; confirm</p>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
              <dt className="text-text-muted">Name</dt>
              <dd className="font-medium">{name || '—'}</dd>
              <dt className="text-text-muted">Portions</dt>
              <dd>{portions || '1'}</dd>
              <dt className="text-text-muted">Ingredients</dt>
              <dd>{filled.length}</dd>
              <dt className="text-text-muted">Estimated cost</dt>
              <dd>{formatMoney(estimate)}</dd>
            </dl>
            <p className="text-text-muted">
              Final costing is calculated on save from current ingredient prices.
            </p>
          </div>
        )}

        <div className="mt-6 flex justify-between border-t border-border pt-4">
          <Button variant="secondary" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)}>Continue</Button>
          ) : (
            <Button onClick={create} disabled={saving}>
              {saving ? 'Creating…' : 'Create Recipe'}
            </Button>
          )}
        </div>
      </Card>
    </>
  )
}

export default function Page() {
  return (
    <RequireRole minRole="staff">
      <NewRecipePage />
    </RequireRole>
  )
}
