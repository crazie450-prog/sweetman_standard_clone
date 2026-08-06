'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  categoriesService,
  ingredientsService,
  recipeDetailService,
  recipesService,
  type RecipeDetail,
} from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
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
  TextField,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui'
import { formatMoney, formatPercent } from '@/lib/utils/format'

type Line = { ingredientId: string; qty: string; unit: string }

export default function RecipeDetailView({ id }: { id: string }) {
  const {
    data: r,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['recipe-detail', id],
    queryFn: () => recipeDetailService.get(id),
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
          hint="It may have been deleted, or the link belongs to another organization."
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
  const queryClient = useQueryClient()
  const router = useRouter()
  const toast = useToast()
  const { can } = useCurrentUser()

  const { data: ingredients = [] } = useQuery({
    queryKey: ['ingredients'],
    queryFn: ingredientsService.list,
  })
  const { data: recipes = [] } = useQuery({ queryKey: ['recipes'], queryFn: recipesService.list })
  const { data: categories = [] } = useQuery({
    queryKey: ['categories', 'recipe'],
    queryFn: () => categoriesService.list('recipe'),
  })

  const [editOpen, setEditOpen] = useState(false)
  const [name, setName] = useState(r.name)
  const [categoryId, setCategoryId] = useState(r.categoryId ?? '')
  const [portions, setPortions] = useState(String(r.portions))
  const [targetPct, setTargetPct] = useState(
    r.targetFoodCostPct === null ? '' : String(r.targetFoodCostPct)
  )
  const [lines, setLines] = useState<Line[]>(
    r.ingredients.map((i) => ({ ingredientId: i.ingredientId, qty: String(i.qty), unit: i.unit }))
  )
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [pendingComponent, setPendingComponent] = useState<{
    componentId: string
    name: string
  } | null>(null)

  const [componentOpen, setComponentOpen] = useState(false)
  const [componentId, setComponentId] = useState('')
  const [componentQty, setComponentQty] = useState('')
  const [componentUnit, setComponentUnit] = useState('ea')

  const ingredientsCost = r.ingredients.reduce((s, i) => s + i.cost, 0)
  const componentsCost = r.components.reduce((s, c) => s + c.cost, 0)
  const total = ingredientsCost + componentsCost

  const setLine = (idx: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))

  const openEdit = () => {
    setName(r.name)
    setCategoryId(r.categoryId ?? '')
    setPortions(String(r.portions))
    setTargetPct(r.targetFoodCostPct === null ? '' : String(r.targetFoodCostPct))
    setLines(
      r.ingredients.map((i) => ({ ingredientId: i.ingredientId, qty: String(i.qty), unit: i.unit }))
    )
    setEditOpen(true)
  }

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['recipe-detail', r.id] })
    await queryClient.invalidateQueries({ queryKey: ['recipes'] })
  }

  async function saveEdit() {
    if (!name.trim()) {
      toast('danger', 'Recipe name is required')
      return
    }
    setBusy(true)
    try {
      await recipesService.update(r.id, {
        name: name.trim(),
        categoryId: categoryId || undefined,
        portions: parseInt(portions, 10) || 1,
        targetFoodCostPct: targetPct === '' ? undefined : parseFloat(targetPct),
        ingredients: lines
          .filter((l) => l.ingredientId && parseFloat(l.qty) > 0)
          .map((l) => ({
            ingredientId: l.ingredientId,
            quantity: parseFloat(l.qty),
            unit: l.unit || 'ea',
          })),
      })
      await refresh()
      setEditOpen(false)
      toast('success', 'Recipe saved')
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function removeRecipe() {
    setBusy(true)
    try {
      await recipesService.remove(r.id)
      await refresh()
      setDeleteOpen(false)
      toast('success', `${r.name} deleted`)
      router.push('/recipes')
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function addComponent() {
    const qty = parseFloat(componentQty)
    if (!componentId || !qty || qty <= 0) {
      toast('danger', 'Pick a sub-recipe and a quantity')
      return
    }
    setBusy(true)
    try {
      await recipesService.addComponent(r.id, {
        componentId,
        quantity: qty,
        unit: componentUnit || 'ea',
      })
      await refresh()
      setComponentOpen(false)
      setComponentId('')
      setComponentQty('')
      toast('success', 'Sub-recipe added')
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function removeComponent() {
    if (!pendingComponent) return
    const { componentId, name } = pendingComponent
    try {
      await recipesService.removeComponent(r.id, componentId)
      await refresh()
      toast('success', `${name} removed`)
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setPendingComponent(null)
    }
  }

  return (
    <>
      <PageHeader
        title={r.name}
        subtitle={`${r.category || 'Uncategorized'} · ${r.portions} portions`}
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

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label="Total cost"
          value={formatMoney(total)}
          tone="primary"
          icon={<span>$</span>}
        />
        <KpiCard
          label="Cost / portion"
          value={formatMoney(total / Math.max(1, r.portions))}
          tone="info"
          icon={<span>÷</span>}
        />
        <KpiCard
          label="Food cost"
          value={formatPercent(r.foodCostPct, 0)}
          hint={`target ${formatPercent(r.targetFoodCostPct, 0)}`}
          tone={
            r.foodCostPct !== null &&
            r.targetFoodCostPct !== null &&
            r.foodCostPct > r.targetFoodCostPct
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
                    <TD className="font-medium">{i.name}</TD>
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
                  setComponentUnit('ea')
                  setComponentOpen(true)
                }}
              >
                + Add sub-recipe
              </Button>
            )}
          </div>
          <div className="p-4 sm:p-6">
            <Table>
              <THead>
                <TR>
                  <TH>Sub-recipe</TH>
                  <TH>Qty</TH>
                  <TH>Contribution</TH>
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
                    </TD>
                    <TD>{formatMoney(c.cost)}</TD>
                    {can('staff') && (
                      <TD className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPendingComponent({ componentId: c.componentId, name: c.name })}
                        >
                          Remove
                        </Button>
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
          </div>
        </Card>
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Recipe"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={busy}>
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
          <SelectField
            label="Category"
            placeholder="Uncategorized"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
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
            className="sm:col-span-2"
            value={targetPct}
            onChange={(e) => setTargetPct(e.target.value)}
          />

          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-semibold">Ingredients</p>
            <div className="space-y-3">
              {lines.map((line, idx) => (
                <div key={idx} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                  <SelectField
                    label="Ingredient"
                    hideLabel={idx > 0}
                    placeholder="Select…"
                    value={line.ingredientId}
                    onChange={(e) => {
                      const ing = ingredients.find((i) => i.id === e.target.value)
                      setLine(idx, { ingredientId: e.target.value, unit: ing?.unit ?? line.unit })
                    }}
                    options={ingredients.map((i) => ({ value: i.id, label: i.name }))}
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
                  <TextField
                    label="Unit"
                    hideLabel={idx > 0}
                    value={line.unit}
                    onChange={(e) => setLine(idx, { unit: e.target.value })}
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
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setLines((ls) => [...ls, { ingredientId: '', qty: '', unit: '' }])}
            >
              + Add ingredient
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={componentOpen}
        onClose={() => setComponentOpen(false)}
        title="Add sub-recipe"
        footer={
          <>
            <Button variant="secondary" onClick={() => setComponentOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addComponent} disabled={busy}>
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
            help="A recipe cannot contain itself, directly or through a chain."
            value={componentId}
            onChange={(e) => setComponentId(e.target.value)}
            options={recipes
              .filter((rec) => rec.id !== r.id)
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
          <TextField
            label="Unit"
            value={componentUnit}
            onChange={(e) => setComponentUnit(e.target.value)}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingComponent !== null}
        onClose={() => setPendingComponent(null)}
        onConfirm={removeComponent}
        title={`Remove ${pendingComponent?.name ?? ''} from ${r.name}?`}
        confirmLabel="Remove"
      >
        The sub-recipe itself stays. This recipe, every recipe built on it and the menu items that
        use them are recosted without it.
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={removeRecipe}
        title={`Delete ${r.name}?`}
        busy={busy}
      >
        Its ingredient list, its steps and its links to sub-recipes go with it. Menu items built on
        this recipe will refuse the deletion instead. This cannot be undone.
      </ConfirmDialog>
    </>
  )
}
