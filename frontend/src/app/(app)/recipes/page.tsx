'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Badge,
  Button,
  Card,
  IconButton,
  PageHeader,
  SearchInput,
  SelectField,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
  Progress,
} from '@/components/ui'
import { recipesService } from '@/lib/api/services'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { cn } from '@/lib/utils/cn'
import { formatDate, formatMoney, formatPercent } from '@/lib/utils/format'

type ViewMode = 'grid' | 'compact' | 'list' | 'table'

const GridIcon = (
  <svg
    viewBox="0 0 24 24"
    className="size-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
)
const CompactIcon = (
  <svg
    viewBox="0 0 24 24"
    className="size-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <rect x="14" y="14" width="6" height="6" rx="1" />
    <path d="M7 7h.01M17 7h.01M7 17h.01M17 17h.01" />
  </svg>
)
const ListIcon = (
  <svg
    viewBox="0 0 24 24"
    className="size-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
)
const TableIcon = (
  <svg
    viewBox="0 0 24 24"
    className="size-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M9 10v10M15 10v10" />
  </svg>
)
const FunnelIcon = (
  <svg
    viewBox="0 0 24 24"
    className="size-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 5h18l-7 8v5l-4 2v-7L3 5z" />
  </svg>
)
const DraftIcon = (
  <svg
    viewBox="0 0 24 24"
    className="size-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </svg>
)

const VIEW_MODES: { mode: ViewMode; label: string; icon: React.ReactNode }[] = [
  { mode: 'grid', label: 'Grid view', icon: GridIcon },
  { mode: 'compact', label: 'Compact view', icon: CompactIcon },
  { mode: 'list', label: 'List view', icon: ListIcon },
  { mode: 'table', label: 'Table view', icon: TableIcon },
]

export default function RecipesPage() {
  const toast = useToast()
  const { can } = useCurrentUser()
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [showDrafts, setShowDrafts] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [view, setView] = useState<ViewMode>('grid')

  const { data: recipes = [], isLoading } = useQuery({
    queryKey: ['recipes'],
    queryFn: recipesService.list,
  })

  const rows = recipes.filter(
    (r) =>
      r.name.toLowerCase().includes(q.toLowerCase()) &&
      (!category || r.category === category) &&
      (!showDrafts || r.status === 'draft')
  )

  const perPortion = (r: { cost: number; portions?: number }) =>
    r.cost / Math.max(1, r.portions ?? 1)

  const overTarget = (r: { foodCostPct: number | null; targetFoodCostPct: number | null }) =>
    r.foodCostPct !== null && r.targetFoodCostPct !== null && r.foodCostPct > r.targetFoodCostPct

  const recipeLink = (r: (typeof recipes)[number]) => (
    <Link
      href={`/recipes/${r.id}`}
      className="line-clamp-2 font-medium text-text hover:text-primary-700 hover:underline dark:hover:text-primary-400"
    >
      {r.name}
    </Link>
  )

  return (
    <>
      <PageHeader
        title="Recipes"
        subtitle="Recipes and reusable components with live costing"
        actions={
          can('staff') ? (
            <>
              <Button
                variant="secondary"
                onClick={() => toast('info', 'Duplicate detection is not available yet')}
              >
                Find Duplicates
              </Button>
              <Link href="/recipes/import">
                <Button variant="secondary">Import</Button>
              </Link>
              <Link href="/recipes/new">
                <Button variant="primary">New Recipe</Button>
              </Link>
            </>
          ) : undefined
        }
      />

      <p className="mb-3 text-sm text-text-muted">
        {isLoading ? 'Loading…' : `${rows.length} recipe${rows.length === 1 ? '' : 's'} found`}
      </p>

      <div className="mb-3">
        <button
          type="button"
          aria-pressed={showDrafts}
          onClick={() => setShowDrafts((v) => !v)}
          className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition duration-150 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
            showDrafts
              ? 'border-primary-600 bg-primary-50 font-semibold text-primary-800'
              : 'border-border-strong bg-surface text-text hover:border-ink-600'
          }`}
        >
          {DraftIcon}
          Show My Drafts
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          placeholder="Search recipes by name or description…"
          className="min-w-56 flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div
          className="flex items-center gap-0.5 rounded-full bg-surface-subtle p-1 ring-1 ring-border ring-inset"
          role="group"
          aria-label="View mode"
        >
          {VIEW_MODES.map(({ mode, label, icon }) => (
            <IconButton
              key={mode}
              aria-label={label}
              aria-pressed={view === mode}
              variant="ghost"
              className={cn(
                'size-8 rounded-full',
                view === mode
                  ? 'bg-surface text-primary-700 shadow-sm ring-1 ring-border dark:text-primary-300'
                  : 'text-text-muted hover:text-text'
              )}
              onClick={() => setView(mode)}
            >
              {icon}
            </IconButton>
          ))}
        </div>
        <Button
          variant="secondary"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <span className="inline-flex items-center gap-2">
            {FunnelIcon}
            Filters
          </span>
        </Button>
      </div>

      {filtersOpen && (
        <Card className="mb-4 !p-4">
          <div className="flex flex-wrap items-end gap-3">
            <SelectField
              label="Category"
              className="w-56"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="All categories"
              options={[
                { value: 'Mains', label: 'Mains' },
                { value: 'Components', label: 'Components' },
                { value: 'Desserts', label: 'Desserts' },
              ]}
            />
            {category && (
              <Button variant="secondary" onClick={() => setCategory('')}>
                Clear
              </Button>
            )}
          </div>
        </Card>
      )}

      {isLoading ? (
        <Card>
          <div className="flex items-center justify-center gap-2 py-10 text-text-muted">
            <Spinner size="sm" /> Loading recipes…
          </div>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <div className="py-10 text-center text-text-muted">No recipes match your filters.</div>
        </Card>
      ) : view === 'table' ? (
        <Table>
          <THead>
            <TR>
              <TH>Recipe</TH>
              <TH>Category</TH>
              <TH>Cost / portion</TH>
              <TH>Food cost</TH>
              <TH>Nested</TH>
              <TH>Updated</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD>{recipeLink(r)}</TD>
                <TD>
                  <Badge tone={r.category === 'Components' ? 'primary' : 'neutral'}>
                    {r.category}
                  </Badge>
                </TD>
                <TD>{formatMoney(perPortion(r))}</TD>
                <TD>
                  <span className={overTarget(r) ? 'text-warning-700 font-medium' : ''}>
                    {formatPercent(r.foodCostPct, 0)}
                  </span>
                </TD>
                <TD>
                  {r.nested > 0 ? (
                    <Badge tone="info">{r.nested} sub-recipes</Badge>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </TD>
                <TD className="text-text-muted">{formatDate(r.updatedAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : view === 'list' ? (
        <Card className="!p-0">
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-6"
              >
                <div className="min-w-40 flex-1">{recipeLink(r)}</div>
                <Badge tone={r.category === 'Components' ? 'primary' : 'neutral'}>
                  {r.category}
                </Badge>
                <span className="text-sm">{formatMoney(perPortion(r))}</span>
                <span
                  className={`text-sm ${overTarget(r) ? 'text-warning-700 font-medium' : 'text-text-muted'}`}
                >
                  {formatPercent(r.foodCostPct, 0)} food cost
                </span>
                <span className="text-sm text-text-muted">{formatDate(r.updatedAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <div
          className={`grid grid-cols-1 gap-4 ${
            view === 'compact'
              ? 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
              : 'sm:grid-cols-2 xl:grid-cols-3'
          }`}
        >
          {rows.map((r, i) => (
            <Card
              key={r.id}
              className={`lift rise ${view === 'compact' ? '!p-4' : ''}`}
              style={{ '--i': i } as React.CSSProperties}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">{recipeLink(r)}</div>
                {r.category && (
                  <span className="max-w-[45%] shrink-0">
                    <Badge dot tone={r.category === 'Components' ? 'primary' : 'neutral'}>
                      {r.category}
                    </Badge>
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-[13px] text-text-muted">
                {r.nested > 0 && `${r.nested} sub-recipe${r.nested === 1 ? '' : 's'} · `}
                {formatDate(r.updatedAt)}
              </p>
              <div
                className={`flex items-end justify-between gap-3 ${view === 'compact' ? 'mt-3' : 'mt-5'}`}
              >
                <div>
                  <p
                    className={`font-bold tracking-tight ${view === 'compact' ? 'text-xl' : 'text-2xl'}`}
                  >
                    {formatMoney(perPortion(r))}
                  </p>
                  <p className="text-[13px] text-text-muted">cost / portion</p>
                </div>
                <div className="text-right">
                  <p
                    className={`font-bold tracking-tight ${view === 'compact' ? 'text-xl' : 'text-2xl'} ${overTarget(r) ? 'text-warning-700 dark:text-warning-100' : 'text-primary-700 dark:text-primary-300'}`}
                  >
                    {formatPercent(r.foodCostPct, 0)}
                  </p>
                  <p className="text-[13px] text-text-muted">food cost</p>
                </div>
              </div>
              <Progress
                value={((r.foodCostPct ?? 0) / 50) * 100}
                target={60}
                tone={overTarget(r) ? 'warning' : 'primary'}
                className="mt-3"
              />
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
