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
import { useMutation, useQuery } from '@tanstack/react-query'
import { menuService, type MenuItem } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { CategoryField } from '@/components/catalogue/CategoryField'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { formatMoney, formatPercent } from '@/lib/utils/format'
import { aboveTarget, percentOf } from '@/lib/utils/money'
import { useActiveLocationId } from '@/lib/api/useActiveLocation'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

const NO_MENU = '__none'

const costed = (m: MenuItem) => m.recipes.length > 0
const margin = (m: MenuItem) => m.price - m.cost
const marginPct = (m: MenuItem) => percentOf(margin(m), m.price)
const foodCostPct = (m: MenuItem) => percentOf(m.cost, m.price)

type RecipeLine = { recipeId: string; portions: string }

function MenuPage({ fromRecipe, onMenu }: { fromRecipe: string | null; onMenu: string | null }) {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [menuFilter, setMenuFilter] = useState('')
  const toast = useToast()
  const invalidate = useInvalidate()
  const { can, changesHere, worksEverywhere } = useCurrentUser()

  const { data: MENU_ITEMS = [], isLoading } = useQuery(queries.menuItems())
  const { data: recipes = [] } = useQuery(queries.recipes())
  const { data: kpis } = useQuery(queries.dashboardKpis())
  const overTarget = (m: MenuItem) => costed(m) && aboveTarget(foodCostPct(m), kpis?.foodCostTarget)
  const { data: locations = [] } = useQuery(queries.locations())

  const activeLocationId = useActiveLocationId()
  const { data: menus = [] } = useQuery(queries.menus())
  const [open, setOpen] = useState(Boolean(fromRecipe || onMenu))
  const [editing, setEditing] = useState<MenuItem | null>(null)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [pickedLocation, setLocationId] = useState('')
  const locationId = pickedLocation || (worksEverywhere ? '' : (locations[0]?.id ?? ''))
  const [menuIds, setMenuIds] = useState<string[]>(onMenu ? [onMenu] : [])
  const servingMenus = menus.filter(
    (x) =>
      menuIds.includes(x.id) ||
      !locationId ||
      x.locations.length === 0 ||
      x.locations.some((l) => l.id === locationId)
  )
  const [seeded, setSeeded] = useState(!fromRecipe && !onMenu)
  if (!seeded && activeLocationId) {
    setSeeded(true)
    setLocationId(activeLocationId)
  }
  const [isActive, setIsActive] = useState(true)
  const [lines, setLines] = useState<RecipeLine[]>([{ recipeId: fromRecipe ?? '', portions: '1' }])
  const [lineError, setLineError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<MenuItem | null>(null)

  const openCreate = () => {
    setEditing(null)
    setName('')
    setPrice('')
    setCategoryId('')
    setLocationId(activeLocationId)
    setIsActive(true)
    setLines([{ recipeId: '', portions: '1' }])
    setMenuIds([])
    setLineError('')
    setOpen(true)
  }

  const openEdit = (m: MenuItem) => {
    setEditing(m)
    setName(m.name)
    setPrice(String(m.price))
    setCategoryId(m.categoryId ?? '')
    setLocationId(m.locationId ?? '')
    setIsActive(m.active)
    setMenuIds(m.menus.map((x) => x.id))
    setLines(
      m.recipes.length > 0
        ? m.recipes.map((r) => ({ recipeId: r.id, portions: String(r.portions ?? 1) }))
        : [{ recipeId: '', portions: '1' }]
    )
    setLineError('')
    setOpen(true)
  }

  const save = useMutation({
    mutationFn: (priceValue: number) => {
      const payload = {
        name: name.trim(),
        price: priceValue,
        categoryId: categoryId || null,
        locationId: locationId || null,
        isActive,
        recipes: lines
          .filter((l) => l.recipeId)
          .map((l) => ({ recipeId: l.recipeId, portions: parseFloat(l.portions) })),
        ...(can('manager') && (editing || menuIds.length > 0) ? { menuIds } : {}),
      }
      return editing ? menuService.update(editing.id, payload) : menuService.create(payload)
    },
    onSuccess: async () => {
      await invalidate('dishes')
      setOpen(false)
      toast('success', editing ? 'Menu item saved' : 'Menu item created')
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  function submit() {
    const priceValue = parseFloat(price)
    if (!name.trim() || Number.isNaN(priceValue) || priceValue < 0) {
      toast('danger', 'Name and a selling price are required')
      return
    }
    const unfilled = lines.findIndex((l) => l.recipeId && !(parseFloat(l.portions) > 0))
    if (unfilled !== -1) {
      setLineError(`Recipe line ${unfilled + 1} needs portions above zero, or remove the line`)
      return
    }
    setLineError('')
    save.mutate(priceValue)
  }

  const removal = useMutation({
    mutationFn: (m: MenuItem) => menuService.remove(m.id),
    onSuccess: async (_, m) => {
      await invalidate('dishes')
      setPendingDelete(null)
      toast('success', `${m.name} deleted`)
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  const CATEGORIES = [...new Set(MENU_ITEMS.map((m) => m.category))].filter(Boolean).sort()

  const rows = MENU_ITEMS.filter(
    (m) =>
      m.name.toLowerCase().includes(q.toLowerCase()) &&
      (category === '' || m.category === category) &&
      (menuFilter === '' ||
        (menuFilter === NO_MENU
          ? m.menus.length === 0
          : m.menus.some((x) => x.id === menuFilter))) &&
      (!activeOnly || m.active)
  )

  const totalItems = MENU_ITEMS.length
  const activeItems = MENU_ITEMS.filter((m) => m.active).length
  const avgPrice = totalItems > 0 ? MENU_ITEMS.reduce((s, m) => s + m.price, 0) / totalItems : 0
  const marginable = MENU_ITEMS.filter((m) => costed(m) && m.price > 0)
  const avgMargin =
    marginable.length > 0
      ? marginable.reduce((s, m) => s + (marginPct(m) ?? 0), 0) / marginable.length
      : null

  return (
    <>
      <PageHeader
        title="Menu Management"
        subtitle="Menu items, prices and profit margins, costed on the organization's shared ingredient prices"
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Items" value={totalItems} />
        <KpiCard label="Active Items" value={activeItems} valueClass="text-success" />
        <KpiCard label="Avg Price" value={formatMoney(avgPrice)} />
        <KpiCard
          label="Avg Margin"
          value={formatPercent(avgMargin)}
          valueClass={avgMargin === null || avgMargin >= 0 ? 'text-success' : 'text-danger'}
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
        <SelectField
          label="Menu"
          hideLabel
          placeholder="All Menus"
          options={[
            ...menus.map((x) => ({ value: x.id, label: x.name })),
            { value: NO_MENU, label: 'On no menu' },
          ]}
          value={menuFilter}
          onChange={(e) => setMenuFilter(e.target.value)}
          className="w-44"
        />
        <Checkbox
          label="Active Only"
          checked={activeOnly}
          onChange={(e) => setActiveOnly(e.target.checked)}
        />
      </div>

      <Table pinActions>
        <THead>
          <TR>
            <TH>Name</TH>
            <TH>Category</TH>
            <TH>Location</TH>
            <TH>Recipe(s)</TH>
            <TH>Price</TH>
            <TH>Cost</TH>
            <TH>Margin</TH>
            <TH>Margin %</TH>
            <TH>Food cost %</TH>
            <TH>Menus</TH>
            <TH>Status</TH>
            <TH>Actions</TH>
          </TR>
        </THead>
        <TBody>
          {isLoading ? (
            <TableEmpty colSpan={12}>Loading menu items…</TableEmpty>
          ) : rows.length === 0 ? (
            <TableEmpty colSpan={12}>
              No menu items found. Create your first menu item to get started.
            </TableEmpty>
          ) : (
            rows.map((m) => (
              <TR key={m.id}>
                <TD className="font-medium">{m.name}</TD>
                <TD>{m.category}</TD>
                <TD className="text-text-muted">{m.location || 'All locations'}</TD>
                <TD className="text-text-muted">{m.recipes.map((r) => r.name).join(', ')}</TD>
                <TD>{formatMoney(m.price)}</TD>
                <TD>
                  {costed(m) ? (
                    formatMoney(m.cost)
                  ) : (
                    <span className="text-text-muted">No recipe</span>
                  )}
                </TD>
                <TD className="font-medium">{costed(m) ? formatMoney(margin(m)) : '—'}</TD>
                <TD>
                  {costed(m) && marginPct(m) !== null ? (
                    <div className="min-w-24">
                      <p
                        className={
                          (marginPct(m) ?? 0) >= 0
                            ? 'text-success-700 font-medium dark:text-success-100'
                            : 'text-danger-700 font-medium dark:text-danger-100'
                        }
                      >
                        {formatPercent(marginPct(m))}
                      </p>
                      <Progress
                        value={Math.max(0, marginPct(m) ?? 0)}
                        size="sm"
                        animate={false}
                        className="mt-1 w-20"
                      />
                    </div>
                  ) : (
                    '—'
                  )}
                </TD>
                <TD className="font-medium">
                  <span className={overTarget(m) ? 'text-warning-700' : ''}>
                    {costed(m) ? formatPercent(foodCostPct(m)) : '—'}
                  </span>
                </TD>
                <TD className="text-text-muted">
                  {m.menus.length > 0 ? m.menus.map((x) => x.name).join(', ') : 'On no menu'}
                </TD>
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
                    {can('staff') && changesHere(m.locationId) && (
                      <Button variant="ghost" size="sm" onClick={() => openEdit(m)}>
                        Edit
                      </Button>
                    )}
                    {can('manager') && changesHere(m.locationId) && (
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
            {lineError && (
              <p role="alert" className="mr-auto text-sm text-danger-700 dark:text-danger-100">
                {lineError}
              </p>
            )}
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={save.isPending}>
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
          <CategoryField kind="menu" value={categoryId} onChange={setCategoryId} />
          <SelectField
            label="Location"
            placeholder={worksEverywhere ? 'All locations' : undefined}
            help={
              worksEverywhere
                ? 'Leave empty to serve this item at every location'
                : 'An item for every location is added by someone who works at all of them'
            }
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
          {can('manager') && servingMenus.length > 0 && (
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 block text-sm font-semibold">On menus</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                {servingMenus.map((x) => (
                  <Checkbox
                    key={x.id}
                    label={x.name}
                    checked={menuIds.includes(x.id)}
                    onChange={() =>
                      setMenuIds((ids) =>
                        ids.includes(x.id) ? ids.filter((i) => i !== x.id) : [...ids, x.id]
                      )
                    }
                  />
                ))}
              </div>
            </fieldset>
          )}

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
                    options={recipes
                      .filter(
                        (r) =>
                          r.id === line.recipeId ||
                          r.location === null ||
                          r.location.id === locationId
                      )
                      .map((r) => ({ value: r.id, label: r.name }))}
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
        onConfirm={() => pendingDelete && removal.mutate(pendingDelete)}
        title={`Delete ${pendingDelete?.name ?? 'menu item'}?`}
        busy={removal.isPending}
      >
        The menu item and the recipes assigned to it go with it. The recipes themselves stay. This
        cannot be undone.
      </ConfirmDialog>
    </>
  )
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { recipe, menu } = use(searchParams)
  return (
    <MenuPage
      fromRecipe={typeof recipe === 'string' ? recipe : null}
      onMenu={typeof menu === 'string' ? menu : null}
    />
  )
}
