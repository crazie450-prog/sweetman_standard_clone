'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { recipesService, type RecipeDetail } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { CategoryField } from '@/components/catalogue/CategoryField'
import { useCurrentUser } from '@/lib/api/useCurrentUser'

import Link from 'next/link'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  KpiCard,
  Modal,
  PageHeader,
  SelectField,
  Spinner,
  Table,
  TBody,
  TD,
  TextAreaField,
  TextField,
  UnitField,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui'
import { currencySymbol, formatMoney, formatPercent } from '@/lib/utils/format'
import { wholeCount } from '@/lib/utils/money'
import { ingredientChoices, keepingCurrent } from '@/lib/utils/options'
import { NewIngredientDialog } from '@/components/catalogue/NewIngredientDialog'
import { RecipeConversions } from '@/components/catalogue/RecipeConversions'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

type Line = { ingredientId: string; qty: string; unit: string; prepNote: string }

const PORTION = [{ value: 'portion', label: 'Portion' }]

function ComponentUnitField({
  yields,
  recipeIds,
  value,
  onChange,
}: {
  yields?: { name: string; yieldAmount: number | null; yieldUnit: string | null }
  recipeIds: string[]
  value: string
  onChange: (unit: string) => void
}) {
  if (!yields) {
    return (
      <SelectField
        label="Unit"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={PORTION}
      />
    )
  }
  if (!yields.yieldUnit || !yields.yieldAmount) {
    return (
      <SelectField
        label="Unit"
        help={`${yields.name} states no yield, so it goes in by the portion`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={PORTION}
      />
    )
  }
  return (
    <UnitField
      label="Unit"
      pricedIn={yields.yieldUnit}
      recipeIds={recipeIds}
      extraOptions={PORTION}
      help={`A batch makes ${yields.yieldAmount} ${yields.yieldUnit}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

const linesOf = (r: RecipeDetail): Line[] =>
  r.ingredients.map((i) => ({
    ingredientId: i.ingredientId,
    qty: String(i.qty),
    unit: i.unit,
    prepNote: i.prepNote,
  }))

export default function RecipeDetailView({ id }: { id: string }) {
  const {
    data: r,
    isLoading,
    isError,
  } = useQuery({
    ...queries.recipeDetail(id),
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-text-muted">
        <Spinner size="sm" /> Loading recipe…
      </div>
    )
  }

  if (isError || !r) {
    return (
      <div className="py-16">
        <EmptyState
          title="Recipe not found"
          hint="It may have been deleted, or the link belongs to another organization or to another location you do not work at."
          action={
            <Link
              href="/recipes"
              className="inline-flex h-10 items-center rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
            >
              Back to recipes
            </Link>
          }
        />
      </div>
    )
  }

  return <RecipeDetailLoaded key={r.id} recipe={r} />
}

function RecipeDetailLoaded({ recipe: r }: { recipe: RecipeDetail }) {
  const invalidate = useInvalidate()
  const router = useRouter()
  const toast = useToast()
  const { can: role, mine, changesHere } = useCurrentUser()
  const can = (minRole: Parameters<typeof role>[0]) => role(minRole) && changesHere(r.locationId)

  const { data: ingredients = [] } = useQuery(queries.ingredients())

  const optionsFor = (ingredientId: string) => {
    const offered = ingredientChoices(ingredients)
    return keepingCurrent(
      offered,
      ingredientId,
      r.ingredients.find((i) => i.ingredientId === ingredientId)?.name
    )
  }
  const { data: recipes = [] } = useQuery(queries.recipes())

  const { data: locations = [] } = useQuery(queries.locations())
  const movable = locations.filter((l) => mine.length === 0 || mine.includes(l.id))
  const mayMove =
    can('manager') &&
    (mine.length === 0 ||
      (r.locationId !== null && mine.includes(r.locationId) && movable.length > 1))
  const { data: org } = useQuery(queries.organization())
  const target = r.targetFoodCostPct ?? org?.foodCostTargetPct ?? null
  const targetHint =
    r.targetFoodCostPct !== null
      ? `recipe target ${formatPercent(r.targetFoodCostPct, 0)}`
      : `organization target ${formatPercent(target, 0)}`

  const [editOpen, setEditOpen] = useState(false)
  const [lineError, setLineError] = useState('')
  const [name, setName] = useState(r.name)
  const [description, setDescription] = useState(r.description)
  const [categoryId, setCategoryId] = useState(r.categoryId ?? '')
  const [locationId, setLocationId] = useState(r.locationId ?? '')
  const [portions, setPortions] = useState(String(r.portions))
  const [targetPct, setTargetPct] = useState(
    r.targetFoodCostPct === null ? '' : String(r.targetFoodCostPct)
  )
  const [yieldAmount, setYieldAmount] = useState(
    r.yieldAmount === null ? '' : String(r.yieldAmount)
  )
  const [yieldUnit, setYieldUnit] = useState(r.yieldUnit ?? '')
  const [lines, setLines] = useState<Line[]>(() => linesOf(r))
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [pendingComponent, setPendingComponent] = useState<{
    componentId: string
    name: string
  } | null>(null)

  const [creatingIngredient, setCreatingIngredient] = useState(false)
  const [componentOpen, setComponentOpen] = useState(false)
  const [componentId, setComponentId] = useState('')
  const [componentQty, setComponentQty] = useState('')
  const [componentUnit, setComponentUnit] = useState('portion')
  const [changing, setChanging] = useState<{ componentId: string; name: string } | null>(null)

  const ingredientsCost = r.ingredients.reduce((s, i) => s + i.cost, 0)
  const componentsCost = r.components.reduce((s, c) => s + c.cost, 0)
  const total = ingredientsCost + componentsCost

  const setLine = (idx: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))

  const openEdit = () => {
    setName(r.name)
    setDescription(r.description)
    setCategoryId(r.categoryId ?? '')
    setLocationId(r.locationId ?? '')
    setPortions(String(r.portions))
    setTargetPct(r.targetFoodCostPct === null ? '' : String(r.targetFoodCostPct))
    setYieldAmount(r.yieldAmount === null ? '' : String(r.yieldAmount))
    setYieldUnit(r.yieldUnit ?? '')
    setLines(linesOf(r))
    setLineError('')
    setEditOpen(true)
  }

  const edit = useMutation({
    mutationFn: (payload: Parameters<typeof recipesService.update>[1]) =>
      recipesService.update(r.id, payload),
    onSuccess: async () => {
      await invalidate('recipes')
      setEditOpen(false)
      toast('success', 'Recipe saved')
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  function saveEdit() {
    if (!name.trim()) {
      toast('danger', 'Recipe name is required')
      return
    }
    const portionCount = portions.trim() === '' ? null : wholeCount(portions)
    if (portions.trim() !== '' && portionCount === null) {
      toast('danger', 'Portions is a whole number of at least 1')
      return
    }
    const unfilled = lines.findIndex((l) => l.ingredientId && !(parseFloat(l.qty) > 0))
    if (unfilled !== -1) {
      setLineError(`Line ${unfilled + 1} needs a quantity above zero, or remove the line`)
      return
    }
    setLineError('')
    edit.mutate({
      name: name.trim(),
      description: description.trim(),
      categoryId: categoryId || null,
      ...(mayMove && locationId !== (r.locationId ?? '') ? { locationId: locationId || null } : {}),
      portions: portionCount ?? 1,
      targetFoodCostPct: targetPct === '' ? null : parseFloat(targetPct),
      yieldAmount: yieldAmount === '' ? null : parseFloat(yieldAmount),
      yieldUnit: yieldAmount === '' ? null : yieldUnit || null,
      ingredients: lines
        .filter((l) => l.ingredientId && parseFloat(l.qty) > 0)
        .map((l) => ({
          ingredientId: l.ingredientId,
          quantity: parseFloat(l.qty),
          unit: l.unit || 'ea',
          ...(l.prepNote.trim() ? { prepNote: l.prepNote.trim() } : {}),
        })),
    })
  }

  const removal = useMutation({
    mutationFn: () => recipesService.remove(r.id),
    onSuccess: async () => {
      await invalidate('recipes')
      setDeleteOpen(false)
      toast('success', `${r.name} deleted`)
      router.push('/recipes')
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  const componentAdd = useMutation({
    mutationFn: (quantity: number) =>
      recipesService.addComponent(r.id, {
        componentId,
        quantity,
        unit: componentUnit || 'portion',
      }),
    onSuccess: async () => {
      await invalidate('recipes')
      setComponentOpen(false)
      setComponentId('')
      setComponentQty('')
      toast('success', 'Sub-recipe added')
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  function addComponent() {
    const qty = parseFloat(componentQty)
    if (!componentId || !qty || qty <= 0) {
      toast('danger', 'Pick a sub-recipe and a quantity')
      return
    }
    componentAdd.mutate(qty)
  }

  const componentChange = useMutation({
    mutationFn: (change: { componentId: string; name: string; quantity: number }) =>
      recipesService.updateComponent(r.id, change.componentId, {
        quantity: change.quantity,
        unit: componentUnit || 'portion',
      }),
    onSuccess: async (_, { name }) => {
      await invalidate('recipes')
      toast('success', `${name} changed`)
      setChanging(null)
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  function changeComponent() {
    if (!changing) return
    const qty = parseFloat(componentQty)
    if (!qty || qty <= 0) {
      toast('danger', 'Enter a quantity above zero')
      return
    }
    componentChange.mutate({
      componentId: changing.componentId,
      name: changing.name,
      quantity: qty,
    })
  }

  const componentRemoval = useMutation({
    mutationFn: (component: { componentId: string; name: string }) =>
      recipesService.removeComponent(r.id, component.componentId),
    onSuccess: async (_, { name }) => {
      await invalidate('recipes')
      toast('success', `${name} removed`)
    },
    onError: (e) => toast('danger', serverMessage(e)),
    onSettled: () => setPendingComponent(null),
  })

  return (
    <>
      <PageHeader
        title={r.name}
        subtitle={`${r.category || 'Uncategorized'} · ${r.location?.name ?? 'All locations'} · ${r.portions} portions${r.yieldAmount !== null && r.yieldUnit ? ` · ${r.yieldAmount} ${r.yieldUnit} a batch` : ''}`}
        actions={
          <>
            {can('staff') && (
              <Button variant="secondary" onClick={openEdit}>
                Edit Recipe
              </Button>
            )}
            {can('manager') && (
              <Button
                variant="ghost"
                className="text-danger-700 dark:text-danger-100"
                onClick={() => setDeleteOpen(true)}
              >
                Delete
              </Button>
            )}
            <Link
              href={`/menu?recipe=${r.id}`}
              className="inline-flex h-10 items-center rounded-lg bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700"
            >
              Add to Menu Item
            </Link>
          </>
        }
      />

      {r.description && (
        <Card className="mb-6">
          <h2 className="section-title font-semibold">Description</h2>
          <p className="mt-2 whitespace-pre-line text-sm">{r.description}</p>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label="Total cost"
          value={formatMoney(total)}
          tone="primary"
          icon={<span>{currencySymbol()}</span>}
        />
        <KpiCard
          label="Cost / portion"
          value={formatMoney(total / Math.max(1, r.portions))}
          tone="info"
          icon={<span>÷</span>}
        />
        <KpiCard
          label="Food cost"
          value={formatPercent(r.foodCostPct)}
          hint={targetHint}
          tone={
            r.foodCostPct !== null && target !== null && r.foodCostPct > target
              ? 'warning'
              : 'success'
          }
          icon={<span>%</span>}
        />
        <KpiCard
          label="Sub-recipes"
          value={r.components.length}
          tone="primary"
          icon={<span>🧩</span>}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-0">
          <h2 className="section-title px-4 pt-4 font-semibold sm:px-6">Ingredients</h2>
          <div className="p-4 sm:p-6">
            <Table>
              <THead>
                <TR>
                  <TH>Ingredient</TH>
                  <TH>Qty</TH>
                  <TH>Cost</TH>
                </TR>
              </THead>
              <TBody>
                {r.ingredients.map((i) => (
                  <TR key={i.ingredientId}>
                    <TD>
                      <span className="font-medium">{i.name}</span>
                      {i.prepNote && (
                        <span className="block text-[13px] text-text-muted">{i.prepNote}</span>
                      )}
                    </TD>
                    <TD>
                      {i.qty} {i.unit}
                    </TD>
                    <TD>{formatMoney(i.cost)}</TD>
                  </TR>
                ))}
                <TR>
                  <TD className="font-semibold" colSpan={2}>
                    Subtotal
                  </TD>
                  <TD className="font-semibold">{formatMoney(ingredientsCost)}</TD>
                </TR>
              </TBody>
            </Table>
          </div>
        </Card>

        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-6">
            <h2 className="section-title font-semibold">Nested recipes</h2>
            <Badge tone="info">cost recalculates with parents</Badge>
            {can('staff') && (
              <Button
                variant="ghost"
                size="sm"
                className="ms-auto"
                onClick={() => {
                  setComponentId('')
                  setComponentQty('')
                  setComponentUnit('portion')
                  setComponentOpen(true)
                }}
              >
                + Add sub-recipe
              </Button>
            )}
          </div>
          <div className="p-4 sm:p-6">
            {r.components.length === 0 ? (
              <p className="text-sm text-text-muted">
                This recipe uses no sub-recipes. A sub-recipe is any other recipe, such as a sauce
                or a dough, costed into this one.
              </p>
            ) : (
              <Table pinActions={can('staff')} compact>
                <THead>
                  <TR>
                    <TH>Sub-recipe</TH>
                    <TH>Qty</TH>
                    <TH>Cost</TH>
                    {can('staff') && <TH className="text-right">Actions</TH>}
                  </TR>
                </THead>
                <TBody>
                  {r.components.map((c) => (
                    <TR key={c.componentId}>
                      <TD>
                        <Link
                          href={`/recipes/${c.link}`}
                          className="font-medium text-primary-700 underline dark:text-primary-400"
                        >
                          {c.name}
                        </Link>
                      </TD>
                      <TD>
                        {c.qty} {c.unit}
                        {can('staff') && (
                          <button
                            type="button"
                            className="ms-2 text-[13px] font-medium text-primary-700 hover:underline dark:text-primary-300"
                            onClick={() => {
                              setComponentQty(String(c.qty))
                              setComponentUnit(c.yieldUnit ? c.unit : 'portion')
                              setChanging({ componentId: c.componentId, name: c.name })
                            }}
                          >
                            Change
                          </button>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap">{formatMoney(c.cost)}</TD>
                      {can('staff') && (
                        <TD className="text-right">
                          <button
                            type="button"
                            className="text-[13px] font-medium text-danger-700 hover:underline dark:text-danger-100"
                            onClick={() =>
                              setPendingComponent({ componentId: c.componentId, name: c.name })
                            }
                          >
                            Remove
                          </button>
                        </TD>
                      )}
                    </TR>
                  ))}
                  <TR>
                    <TD className="font-semibold" colSpan={2}>
                      Subtotal
                    </TD>
                    <TD className="font-semibold">{formatMoney(componentsCost)}</TD>
                    {can('staff') && <TD />}
                  </TR>
                </TBody>
              </Table>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="section-title font-semibold">Used in</h2>
        {r.usedBy.recipes.length === 0 && r.usedBy.dishes.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">
            No recipe or dish is built on this recipe yet. Open another recipe and use + Add
            sub-recipe to make this one a component of it.
          </p>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[13px] font-semibold text-text-muted">Recipes</p>
              {r.usedBy.recipes.length === 0 ? (
                <p className="mt-1 text-sm text-text-muted">None</p>
              ) : (
                <ul className="mt-1 space-y-1 text-sm">
                  {r.usedBy.recipes.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/recipes/${p.id}`}
                        className="text-primary-700 hover:underline dark:text-primary-300"
                      >
                        {p.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[13px] font-semibold text-text-muted">Dishes</p>
              {r.usedBy.dishes.length === 0 ? (
                <p className="mt-1 text-sm text-text-muted">None</p>
              ) : (
                <ul className="mt-1 space-y-1 text-sm">
                  {r.usedBy.dishes.map((d) => (
                    <li key={d.id}>{d.name}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>

      <RecipeConversions recipe={r} manage={can('manager')} />

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Recipe"
        size="xl"
        footer={
          <>
            {lineError && (
              <p role="alert" className="mr-auto text-sm text-danger-700 dark:text-danger-100">
                {lineError}
              </p>
            )}
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={edit.isPending}>
              Save Recipe
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Recipe name"
            required
            className="sm:col-span-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <CategoryField kind="recipe" value={categoryId} onChange={setCategoryId} />
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
          {mayMove && (
            <SelectField
              label="Location"
              placeholder={mine.length === 0 ? 'All locations' : undefined}
              help={
                mine.length === 0
                  ? 'Leave empty to share this recipe across locations'
                  : 'Move it to another location you work at'
              }
              className="sm:col-span-2"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              options={movable.map((l) => ({ value: l.id, label: l.name }))}
            />
          )}
          <TextField
            label="Target food-cost %"
            type="number"
            min="0"
            max="100"
            className="sm:col-span-2"
            value={targetPct}
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

          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-semibold">Ingredients</p>
            <div className="space-y-3">
              {lines.map((line, idx) => (
                <div
                  key={idx}
                  className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1.5fr_auto] sm:items-end"
                >
                  <SelectField
                    label="Ingredient"
                    hideLabel={idx > 0}
                    placeholder="Select…"
                    value={line.ingredientId}
                    onChange={(e) => {
                      const ing = ingredients.find((i) => i.id === e.target.value)
                      setLine(idx, { ingredientId: e.target.value, unit: ing?.unit ?? line.unit })
                    }}
                    options={optionsFor(line.ingredientId)}
                    searchable
                  />
                  <TextField
                    label="Qty"
                    hideLabel={idx > 0}
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.qty}
                    onChange={(e) => setLine(idx, { qty: e.target.value })}
                  />
                  <UnitField
                    label="Unit"
                    hideLabel={idx > 0}
                    pricedIn={ingredients.find((i) => i.id === line.ingredientId)?.unit}
                    ingredientId={line.ingredientId || undefined}
                    recipeIds={[r.id]}
                    value={line.unit}
                    onChange={(e) => setLine(idx, { unit: e.target.value })}
                  />
                  <TextField
                    label="Prep"
                    hideLabel={idx > 0}
                    placeholder="e.g. diced"
                    maxLength={120}
                    value={line.prepNote}
                    onChange={(e) => setLine(idx, { prepNote: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mb-1"
                    onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setLines((ls) => [...ls, { ingredientId: '', qty: '', unit: '', prepNote: '' }])
                }
              >
                + Add ingredient
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCreatingIngredient(true)}>
                + New ingredient
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <NewIngredientDialog
        open={creatingIngredient}
        onClose={() => setCreatingIngredient(false)}
        onCreated={(created) =>
          setLines((ls) => {
            const line = { ingredientId: created.id, qty: '', unit: created.unit, prepNote: '' }
            const empty = ls.findIndex((l) => !l.ingredientId)
            return empty === -1 ? [...ls, line] : ls.map((l, i) => (i === empty ? line : l))
          })
        }
      />

      <Modal
        open={componentOpen}
        onClose={() => setComponentOpen(false)}
        title="Add sub-recipe"
        footer={
          <>
            <Button variant="secondary" onClick={() => setComponentOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addComponent} disabled={componentAdd.isPending}>
              Add
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            label="Sub-recipe"
            className="sm:col-span-3"
            placeholder="Select…"
            help="A recipe cannot contain itself, directly or through a chain, so the recipes this one is already part of are not offered, nor the ones already in it. Only recipes for all locations or for this recipe's location are."
            value={componentId}
            onChange={(e) => {
              setComponentId(e.target.value)
              setComponentUnit('portion')
            }}
            options={recipes
              .filter(
                (rec) =>
                  rec.id !== r.id &&
                  !r.containedBy.includes(rec.id) &&
                  !r.components.some((c) => c.componentId === rec.id) &&
                  (rec.location === null || rec.location.id === r.locationId)
              )
              .map((rec) => ({ value: rec.id, label: rec.name }))}
          />
          <TextField
            label="Qty"
            type="number"
            min="0"
            step="0.01"
            className="sm:col-span-2"
            value={componentQty}
            onChange={(e) => setComponentQty(e.target.value)}
          />
          <ComponentUnitField
            yields={recipes.find((rec) => rec.id === componentId)}
            recipeIds={[r.id, componentId]}
            value={componentUnit}
            onChange={setComponentUnit}
          />
        </div>
      </Modal>

      <Modal
        open={changing !== null}
        onClose={() => setChanging(null)}
        title={`How much ${changing?.name ?? ''} goes into ${r.name}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setChanging(null)}>
              Cancel
            </Button>
            <Button onClick={changeComponent} disabled={componentChange.isPending}>
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Qty"
            type="number"
            min="0"
            step="0.01"
            className="sm:col-span-2"
            value={componentQty}
            onChange={(e) => setComponentQty(e.target.value)}
          />
          <ComponentUnitField
            yields={r.components.find((c) => c.componentId === changing?.componentId)}
            recipeIds={[r.id, changing?.componentId ?? '']}
            value={componentUnit}
            onChange={setComponentUnit}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingComponent !== null}
        onClose={() => setPendingComponent(null)}
        onConfirm={() => pendingComponent && componentRemoval.mutate(pendingComponent)}
        busy={componentRemoval.isPending}
        title={`Remove ${pendingComponent?.name ?? ''} from ${r.name}?`}
        confirmLabel="Remove"
      >
        The sub-recipe itself stays. This recipe, every recipe built on it and the menu items that
        use them are recosted without it.
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => removal.mutate()}
        title={`Delete ${r.name}?`}
        busy={removal.isPending}
      >
        Its ingredient list, its steps and its links to sub-recipes go with it. Recipes and menu
        items built on this recipe will refuse the deletion instead. This cannot be undone.
      </ConfirmDialog>
    </>
  )
}
