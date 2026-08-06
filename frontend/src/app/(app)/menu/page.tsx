'use client'

import { use, useState } from 'react'
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  KpiCard,
  Modal,
  PageHeader,
  Progress,
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
} from '@/components/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  categoriesService,
  locationsService,
  menuService,
  recipesService,
  type MenuItem,
} from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { formatMoney, formatPercent } from '@/lib/utils/format'

const margin = (m: MenuItem) => m.price - m.cost
const marginPct = (m: MenuItem) => (m.price > 0 ? (margin(m) / m.price) * 100 : 0)
const foodCostPct = (m: MenuItem) => (m.price > 0 ? (m.cost / m.price) * 100 : 0)

type RecipeLine = { recipeId: string; portions: string }

function MenuPage({ fromRecipe }: { fromRecipe: string | null }) {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const toast = useToast()
  const queryClient = useQueryClient()
  const { can } = useCurrentUser()

  const { data: MENU_ITEMS = [], isLoading } = useQuery({
    queryKey: ['menu-items'],
    queryFn: menuService.list,
  })
  const { data: recipes = [] } = useQuery({ queryKey: ['recipes'], queryFn: recipesService.list })
  const { data: categories = [] } = useQuery({
    queryKey: ['categories', 'menu'],
    queryFn: () => categoriesService.list('menu'),
  })
  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: locationsService.list,
  })

  const [open, setOpen] = useState(Boolean(fromRecipe))
  const [editing, setEditing] = useState<MenuItem | null>(null)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [lines, setLines] = useState<RecipeLine[]>([
    { recipeId: fromRecipe ?? '', portions: '1' },
  ])
  const [busy, setBusy] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<MenuItem | null>(null)

  const openCreate = () => {
    setEditing(null)
    setName('')
    setPrice('')
    setCategoryId('')
    setLocationId('')
    setIsActive(true)
    setLines([{ recipeId: '', portions: '1' }])
    setOpen(true)
  }

  const openEdit = (m: MenuItem) => {
    setEditing(m)
    setName(m.name)
    setPrice(String(m.price))
    setCategoryId(m.categoryId ?? '')
    setLocationId(m.locationId ?? '')
    setIsActive(m.active)
    setLines(
      m.recipes.length > 0
        ? m.recipes.map((r) => ({ recipeId: r.id, portions: String(r.portions ?? 1) }))
        : [{ recipeId: '', portions: '1' }]
    )
    setOpen(true)
  }

  async function submit() {
    const priceValue = parseFloat(price)
    if (!name.trim() || Number.isNaN(priceValue) || priceValue < 0) {
      toast('danger', 'Name and a selling price are required')
      return
    }
    setBusy(true)
    try {
      const payload = {
        name: name.trim(),
        price: priceValue,
        categoryId: categoryId || undefined,
        locationId: locationId || undefined,
        isActive,
        recipes: lines
          .filter((l) => l.recipeId)
          .map((l) => ({ recipeId: l.recipeId, portions: parseFloat(l.portions) || 1 })),
      }
      if (editing) await menuService.update(editing.id, payload)
      else await menuService.create(payload)
      await queryClient.invalidateQueries({ queryKey: ['menu-items'] })
      setOpen(false)
      toast('success', editing ? 'Menu item saved' : 'Menu item created')
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const m = pendingDelete
    if (!m) return
    setBusy(true)
    try {
      await menuService.remove(m.id)
      await queryClient.invalidateQueries({ queryKey: ['menu-items'] })
      setPendingDelete(null)
      toast('success', `${m.name} deleted`)
    } catch (e) {
      toast('danger', serverMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const CATEGORIES = [...new Set(MENU_ITEMS.map((m) => m.category))].filter(Boolean).sort()

  const rows = MENU_ITEMS.filter(
    (m) =>
      m.name.toLowerCase().includes(q.toLowerCase()) &&
      (category === '' || m.category === category) &&
      (!activeOnly || m.active)
  )

  const totalItems = MENU_ITEMS.length
  const activeItems = MENU_ITEMS.filter((m) => m.active).length
  const avgPrice = totalItems > 0 ? MENU_ITEMS.reduce((s, m) => s + m.price, 0) / totalItems : 0
  const avgMargin =
    totalItems > 0 ? MENU_ITEMS.reduce((s, m) => s + marginPct(m), 0) / totalItems : 0

  return (
    <>
      <PageHeader
        title="Menu Management"
        subtitle="Manage menu items, prices, and profit margins"
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Items" value={totalItems} />
        <KpiCard label="Active Items" value={activeItems} valueClass="text-success" />
        <KpiCard label="Avg Price" value={formatMoney(avgPrice)} />
        <KpiCard
          label="Avg Margin"
          value={formatPercent(avgMargin)}
          valueClass={avgMargin >= 0 ? 'text-success' : 'text-danger'}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {can('staff') && (
          <Button variant="primary" onClick={openCreate}>
            + New Menu Item
          </Button>
        )}
        <SearchInput
          placeholder="Search menu items…"
          className="min-w-56 flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <SelectField
          label="Category"
          hideLabel
          placeholder="All Categories"
          options={CATEGORIES.map((c) => ({ value: c, label: c }))}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-44"
        />
        <Checkbox
          label="Active Only"
          checked={activeOnly}
          onChange={(e) => setActiveOnly(e.target.checked)}
        />
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Name</TH>
            <TH>Category</TH>
            <TH>Recipe(s)</TH>
            <TH>Price</TH>
            <TH>Cost</TH>
            <TH>Margin</TH>
            <TH>Margin %</TH>
            <TH>Food cost %</TH>
            <TH>Status</TH>
            <TH>Actions</TH>
          </TR>
        </THead>
        <TBody>
          {isLoading ? (
            <TableEmpty colSpan={10}>Loading menu items…</TableEmpty>
          ) : rows.length === 0 ? (
            <TableEmpty colSpan={10}>
              No menu items found. Create your first menu item to get started.
            </TableEmpty>
          ) : (
            rows.map((m) => (
              <TR key={m.id}>
                <TD className="font-medium">{m.name}</TD>
                <TD>{m.category}</TD>
                <TD className="text-text-muted">{m.recipes.map((r) => r.name).join(', ')}</TD>
                <TD>{formatMoney(m.price)}</TD>
                <TD>{formatMoney(m.cost)}</TD>
                <TD className="font-medium">{formatMoney(margin(m))}</TD>
                <TD>
                  <div className="min-w-24">
                    <p
                      className={
                        marginPct(m) >= 0
                          ? 'text-success-700 font-medium dark:text-success-100'
                          : 'text-danger-700 font-medium dark:text-danger-100'
                      }
                    >
                      {formatPercent(marginPct(m))}
                    </p>
                    <Progress
                      value={Math.max(0, marginPct(m))}
                      size="sm"
                      animate={false}
                      className="mt-1 w-20"
                    />
                  </div>
                </TD>
                <TD className="font-medium">{formatPercent(foodCostPct(m))}</TD>
                <TD>
                  {m.active ? (
                    <Badge dot tone="success">
                      Active
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Inactive</Badge>
                  )}
                </TD>
                <TD>
                  <RowActions>
                    {can('staff') && (
                      <Button variant="ghost" size="sm" onClick={() => openEdit(m)}>
                        Edit
                      </Button>
                    )}
                    {can('manager') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger-700 dark:text-danger-100"
                        onClick={() => setPendingDelete(m)}
                      >
                        Delete
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
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit Menu Item' : 'New Menu Item'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {editing ? 'Save Item' : 'Create Item'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Name"
            required
            className="sm:col-span-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label="Selling price"
            type="number"
            min="0"
            step="0.01"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
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
            help="Leave empty to serve this item at every location"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            options={locations.map((l) => ({ value: l.id, label: l.name }))}
          />
          <div className="sm:col-span-2">
            <Checkbox
              label="Active on the menu"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
          </div>

          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-semibold">Recipes</p>
            <div className="space-y-3">
              {lines.map((line, idx) => (
                <div key={idx} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
                  <SelectField
                    label="Recipe"
                    hideLabel={idx > 0}
                    placeholder="Select…"
                    value={line.recipeId}
                    onChange={(e) =>
                      setLines((ls) =>
                        ls.map((l, i) => (i === idx ? { ...l, recipeId: e.target.value } : l))
                      )
                    }
                    options={recipes.map((r) => ({ value: r.id, label: r.name }))}
                  />
                  <TextField
                    label="Portions"
                    hideLabel={idx > 0}
                    type="number"
                    min="0"
                    step="0.1"
                    value={line.portions}
                    onChange={(e) =>
                      setLines((ls) =>
                        ls.map((l, i) => (i === idx ? { ...l, portions: e.target.value } : l))
                      )
                    }
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
              onClick={() => setLines((ls) => [...ls, { recipeId: '', portions: '1' }])}
            >
              + Add recipe
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={remove}
        title={`Delete ${pendingDelete?.name ?? 'menu item'}?`}
        busy={busy}
      >
        The menu item and the recipes assigned to it go with it. The recipes themselves stay.
        This cannot be undone.
      </ConfirmDialog>
    </>
  )
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const recipe = use(searchParams).recipe
  return <MenuPage fromRecipe={typeof recipe === 'string' ? recipe : null} />
}
