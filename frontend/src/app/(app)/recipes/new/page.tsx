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
  UnitField,
  useToast,
  TextAreaField,
} from '@/components/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { recipesService, type RecipeIngredientInput, type RecipeInput } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { CategoryField } from '@/components/catalogue/CategoryField'
import { convertWithin, useUnits } from '@/lib/api/useUnits'
import { formatMoney } from '@/lib/utils/format'
import { wholeCount } from '@/lib/utils/money'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { useActiveLocationId } from '@/lib/api/useActiveLocation'
import { queries } from '@/lib/api/queries'
import { ingredientChoices } from '@/lib/utils/options'
import { NewIngredientDialog } from '@/components/catalogue/NewIngredientDialog'

const STEPS = ['Details', 'Ingredients', 'Review']

type Line = { ingredientId: string; qty: string; unit: string }

const EMPTY_LINE: Line = { ingredientId: '', qty: '', unit: '' }

function NewRecipePage() {
  const { data: ingredients = [] } = useQuery(queries.ingredients())
  const { data: locations = [] } = useQuery(queries.locations())
  const [step, setStep] = useState(0)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [pickedLocation, setLocationId] = useState('')
  const { worksEverywhere } = useCurrentUser()
  const activeLocationId = useActiveLocationId()
  const locationId =
    pickedLocation || (worksEverywhere ? '' : activeLocationId || locations[0]?.id || '')
  const [description, setDescription] = useState('')
  const [portions, setPortions] = useState('4')
  const [targetPct, setTargetPct] = useState('')
  const [yieldAmount, setYieldAmount] = useState('')
  const [yieldUnit, setYieldUnit] = useState('')
  const { data: org } = useQuery(queries.organization())
  const [lines, setLines] = useState<Line[]>([EMPTY_LINE])
  const [lineError, setLineError] = useState('')
  const router = useRouter()
  const toast = useToast()
  const units = useUnits()

  const ingredientById = (id: string) => ingredients.find((i) => i.id === id)

  const setLine = (idx: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))

  const filled = lines.filter((l) => l.ingredientId && parseFloat(l.qty) > 0)

  const priced = filled.map((l) => {
    const ing = ingredientById(l.ingredientId)
    if (!ing) return 0
    const qty = parseFloat(l.qty)
    const inPricedUnit = convertWithin(units, qty, l.unit || ing.unit, ing.unit)
    return inPricedUnit === null ? null : inPricedUnit * ing.sharedCostPerUnit
  })
  const estimate = priced.every((c) => c !== null)
    ? formatMoney(priced.reduce((sum, c) => sum + (c ?? 0), 0))
    : 'Costed on save'

  const creation = useMutation({
    mutationFn: (recipe: RecipeInput) => recipesService.create(recipe),
    onSuccess: (created) => {
      toast('success', 'Recipe created')
      router.push(`/recipes/${created.id}`)
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  function create() {
    if (!name.trim()) {
      toast('danger', 'Recipe name is required')
      setStep(0)
      return
    }
    const portionCount = portions.trim() === '' ? null : wholeCount(portions)
    if (portions.trim() !== '' && portionCount === null) {
      toast('danger', 'Portions is a whole number of at least 1')
      setStep(0)
      return
    }
    const unfilled = lines.findIndex((l) => l.ingredientId && !(parseFloat(l.qty) > 0))
    if (unfilled !== -1) {
      setLineError(`Line ${unfilled + 1} needs a quantity above zero, or remove the line`)
      setStep(1)
      return
    }
    setLineError('')
    const payload: RecipeIngredientInput[] = filled.map((l) => ({
      ingredientId: l.ingredientId,
      quantity: parseFloat(l.qty),
      unit: l.unit || ingredientById(l.ingredientId)?.unit || 'ea',
    }))
    creation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      portions: portionCount ?? 1,
      categoryId: categoryId || undefined,
      locationId: locationId || undefined,
      targetFoodCostPct: targetPct === '' ? undefined : parseFloat(targetPct),
      ...(yieldAmount !== ''
        ? { yieldAmount: parseFloat(yieldAmount), yieldUnit: yieldUnit || undefined }
        : {}),
      ingredients: payload,
    })
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
            <CategoryField kind="recipe" value={categoryId} onChange={setCategoryId} />
            <SelectField
              label="Location"
              placeholder={worksEverywhere ? 'All locations' : undefined}
              help={
                worksEverywhere
                  ? 'Leave empty to share this recipe across locations'
                  : 'A recipe for every location is added by someone who works at all of them'
              }
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
              label="Batch yield"
              type="number"
              min="0"
              step="0.01"
              help="What one batch makes, such as 3 l of sauce, so another recipe can take a share by weight or volume. Empty: by the portion only"
              value={yieldAmount}
              onChange={(e) => setYieldAmount(e.target.value)}
            />
            <UnitField
              label="Yield measured in"
              placeholder="Not stated"
              value={yieldUnit}
              onChange={(e) => setYieldUnit(e.target.value)}
            />
            <TextField
              label="Target food-cost %"
              type="number"
              min="0"
              max="100"
              value={targetPct}
              help={`Empty follows the organization target${org ? ` (${org.foodCostTargetPct}%)` : ''}`}
              onChange={(e) => setTargetPct(e.target.value)}
            />
            <TextAreaField
              label="Description"
              help="Method, plating, or anything the kitchen should know"
              className="sm:col-span-2"
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
                  options={ingredientChoices(ingredients)}
                  searchable
                />
                <TextField
                  label="Qty"
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.qty}
                  onChange={(e) => setLine(idx, { qty: e.target.value })}
                />
                <UnitField
                  label="Unit"
                  pricedIn={ingredientById(line.ingredientId)?.unit}
                  ingredientId={line.ingredientId || undefined}
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
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLines((ls) => [...ls, EMPTY_LINE])}
              >
                + Add another line
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
                + New ingredient
              </Button>
            </div>
            <NewIngredientDialog
              open={creating}
              onClose={() => setCreating(false)}
              onCreated={(created) =>
                setLines((ls) => {
                  const line = { ingredientId: created.id, qty: '', unit: created.unit }
                  const empty = ls.findIndex((l) => !l.ingredientId)
                  return empty === -1 ? [...ls, line] : ls.map((l, i) => (i === empty ? line : l))
                })
              }
            />
            {lineError && (
              <p role="alert" className="text-sm text-danger-700 dark:text-danger-100">
                {lineError}
              </p>
            )}
            <p className="text-sm text-text-muted">
              A recipe can also include another recipe as a costed component; add those on the
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
              {yieldAmount !== '' && (
                <>
                  <dt className="text-text-muted">Yield</dt>
                  <dd>
                    {yieldAmount} {yieldUnit}
                  </dd>
                </>
              )}
              <dt className="text-text-muted">Ingredients</dt>
              <dd>{filled.length}</dd>
              <dt className="text-text-muted">Estimated cost</dt>
              <dd>{estimate}</dd>
            </dl>
            <p className="text-text-muted">
              Estimated at the organization&apos;s shared ingredient prices, the prices recipes are
              costed at; final costing is calculated on save.
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
            <Button onClick={create} disabled={creation.isPending}>
              {creation.isPending ? 'Creating…' : 'Create Recipe'}
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
