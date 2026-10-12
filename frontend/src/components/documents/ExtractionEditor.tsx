'use client'

import { useState } from 'react'
import { Button, Table, TBody, TD, TH, THead, TR } from '@/components/ui'
import { useRestaurantDay } from '@/lib/utils/restaurant-day'
import type { ExtractionPayload, ReviewIssue, SubRecipe } from '@/lib/api/types'
import { roundMoney } from '@/lib/utils/money'
import { useUnits } from '@/lib/api/useUnits'
import { IssueNotes, LineWithNotes, issuesAt, markOf } from './issues'

export const inputCls =
  'w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm focus:border-primary-500 focus:outline-none'

export function UnitPicker({
  value,
  onUnit,
  label,
  mark = '',
}: {
  value: string
  onUnit: (next: string) => void
  label: string
  mark?: string
}) {
  const units = useUnits()
  const spelled = value.trim().toLowerCase()
  const alias = units.find(
    (u) =>
      u.value !== value &&
      [u.value, u.label.toLowerCase()].some((name) => spelled === name || spelled === `${name}s`)
  )
  const portion = spelled === 'portion' || spelled === 'portions'
  const known = !value || portion || !!alias || units.some((u) => u.value === value)
  const invalid = mark.includes('danger')
  return (
    <select
      aria-label={label}
      aria-invalid={invalid}
      className={`${inputCls} ${mark}`}
      value={value}
      onChange={(e) => onUnit(e.target.value)}
    >
      <option value="">No unit</option>
      {!known && <option value={value}>{value} (as written)</option>}
      {portion && <option value={value}>Portion ({value})</option>}
      {alias && (
        <option value={value}>
          {alias.label} ({value})
        </option>
      )}
      {units.map((u) => (
        <option key={u.value} value={u.value}>
          {u.label} ({u.value})
        </option>
      ))}
    </select>
  )
}

export function NumericInput({
  value,
  onValue,
  className,
  allowEmpty = false,
  label,
}: {
  value: number | undefined
  onValue: (next: number | undefined) => void
  className?: string
  allowEmpty?: boolean
  label?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      inputMode="decimal"
      aria-label={label}
      className={className}
      value={draft ?? (value === undefined ? '' : String(value))}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        if (raw.trim() === '') {
          if (allowEmpty) onValue(undefined)
          return
        }
        const parsed = Number(raw.replace(',', '.'))
        if (Number.isFinite(parsed)) onValue(parsed)
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

export function ExtractionEditor({
  payload,
  onChange,
  issues = [],
}: {
  payload: ExtractionPayload
  onChange: (next: ExtractionPayload) => void
  issues?: ReviewIssue[]
}) {
  const { latest } = useRestaurantDay()
  const at = (line: number | undefined, field?: string) => issuesAt(issues, { line, field })
  if (payload.kind === 'invoice') {
    const setItem = (i: number, patch: Partial<(typeof payload.items)[number]>) =>
      onChange({
        ...payload,
        items: payload.items.map((it, j) => (j === i ? { ...it, ...patch } : it)),
      })
    const setPricing = (i: number, patch: { quantity?: number; unitPrice?: number }) => {
      const line = { ...payload.items[i], ...patch }
      setItem(
        i,
        line.lineTotal === undefined
          ? patch
          : { ...patch, lineTotal: roundMoney(line.quantity * line.unitPrice) }
      )
    }
    return (
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">Vendor</span>
            <input
              className={`${inputCls} ${markOf(at(undefined, 'vendorName'))}`}
              value={payload.vendorName ?? ''}
              onChange={(e) => onChange({ ...payload, vendorName: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">Invoice number</span>
            <input
              className={`${inputCls} ${markOf(at(undefined, 'number'))}`}
              value={payload.number ?? ''}
              onChange={(e) => onChange({ ...payload, number: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">Invoice date</span>
            <input
              type="date"
              className={`${inputCls} ${markOf(at(undefined, 'invoiceDate'))}`}
              max={latest}
              value={payload.invoiceDate ?? ''}
              onChange={(e) => onChange({ ...payload, invoiceDate: e.target.value || undefined })}
            />
          </label>
        </div>
        <IssueNotes
          issues={[
            ...at(undefined, 'vendorName'),
            ...at(undefined, 'number'),
            ...at(undefined, 'invoiceDate'),
          ]}
        />
        <Table>
          <THead>
            <TR>
              <TH>Item</TH>
              <TH>Code</TH>
              <TH className="text-right">Qty</TH>
              <TH>Unit</TH>
              <TH className="text-right">Unit price</TH>
              <TH className="text-right">Total price</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {payload.items.map((it, i) => (
              <LineWithNotes key={i} issues={at(i)} span={7}>
                <TR>
                  <TD className="w-1/3 min-w-48">
                    <input
                      className={`${inputCls} ${markOf(at(i, 'rawName'))}`}
                      value={it.rawName}
                      onChange={(e) => setItem(i, { rawName: e.target.value })}
                    />
                  </TD>
                  <TD className="min-w-24">
                    <input
                      className={inputCls}
                      value={it.sku ?? ''}
                      onChange={(e) => setItem(i, { sku: e.target.value })}
                    />
                  </TD>
                  <TD className="min-w-24">
                    <NumericInput
                      className={`${inputCls} text-right ${markOf(at(i, 'quantity'))}`}
                      value={it.quantity}
                      onValue={(n) => setPricing(i, { quantity: n ?? 0 })}
                    />
                  </TD>
                  <TD className="min-w-24">
                    <input
                      className={`${inputCls} ${markOf(at(i, 'unit'))}`}
                      value={it.unit}
                      onChange={(e) => setItem(i, { unit: e.target.value })}
                    />
                  </TD>
                  <TD className="min-w-28">
                    <NumericInput
                      className={`${inputCls} text-right ${markOf(at(i, 'unitPrice'))}`}
                      value={it.unitPrice}
                      onValue={(n) => setPricing(i, { unitPrice: n ?? 0 })}
                    />
                  </TD>
                  <TD className="min-w-28">
                    <NumericInput
                      allowEmpty
                      className={`${inputCls} text-right`}
                      value={it.lineTotal}
                      onValue={(n) => setItem(i, { lineTotal: n })}
                    />
                  </TD>
                  <TD className="w-10 text-right">
                    <button
                      type="button"
                      aria-label="Remove line"
                      className="text-text-muted hover:text-danger-700"
                      onClick={() =>
                        onChange({ ...payload, items: payload.items.filter((_, j) => j !== i) })
                      }
                    >
                      ✕
                    </button>
                  </TD>
                </TR>
              </LineWithNotes>
            ))}
          </TBody>
        </Table>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onChange({
              ...payload,
              items: [...payload.items, { rawName: '', quantity: 0, unit: '', unitPrice: 0 }],
            })
          }
        >
          Add line
        </Button>
      </div>
    )
  }

  if (payload.kind === 'sales') {
    const setItem = (i: number, patch: Partial<(typeof payload.items)[number]>) =>
      onChange({
        ...payload,
        items: payload.items.map((it, j) => (j === i ? { ...it, ...patch } : it)),
      })
    return (
      <div className="space-y-3">
        <label className="block text-sm sm:w-56">
          <span className="mb-1 block text-text-muted">Sales date</span>
          <input
            type="date"
            className={`${inputCls} ${markOf(at(undefined, 'date'))}`}
            max={latest}
            value={payload.date ?? ''}
            onChange={(e) => onChange({ ...payload, date: e.target.value || undefined })}
          />
          <span className="mt-1 block text-xs text-text-muted">
            Empty records the sales on the day they are confirmed
          </span>
        </label>
        <IssueNotes issues={at(undefined, 'date')} />
        <Table>
          <THead>
            <TR>
              <TH>Menu item</TH>
              <TH className="text-right">Qty</TH>
              <TH className="text-right">Unit price</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {payload.items.map((it, i) => (
              <LineWithNotes key={i} issues={at(i)} span={4}>
                <TR>
                  <TD>
                    <input
                      className={`${inputCls} ${markOf(at(i, 'menuItemName'))}`}
                      value={it.menuItemName}
                      onChange={(e) => setItem(i, { menuItemName: e.target.value })}
                    />
                  </TD>
                  <TD className="min-w-24">
                    <NumericInput
                      className={`${inputCls} text-right ${markOf(at(i, 'quantity'))}`}
                      value={it.quantity}
                      onValue={(n) => setItem(i, { quantity: n ?? 0 })}
                    />
                  </TD>
                  <TD className="min-w-28">
                    <NumericInput
                      className={`${inputCls} text-right`}
                      value={it.unitPrice}
                      onValue={(n) => setItem(i, { unitPrice: n ?? 0 })}
                    />
                  </TD>
                  <TD className="w-10 text-right">
                    <button
                      type="button"
                      aria-label="Remove line"
                      className="text-text-muted hover:text-danger-700"
                      onClick={() =>
                        onChange({ ...payload, items: payload.items.filter((_, j) => j !== i) })
                      }
                    >
                      ✕
                    </button>
                  </TD>
                </TR>
              </LineWithNotes>
            ))}
          </TBody>
        </Table>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onChange({
              ...payload,
              items: [...payload.items, { menuItemName: '', quantity: 0, unitPrice: 0 }],
            })
          }
        >
          Add line
        </Button>
      </div>
    )
  }

  if (payload.kind === 'recipe') {
    const subs = payload.subRecipes ?? []
    const setSub = (i: number, next: SubRecipe) =>
      onChange({ ...payload, subRecipes: subs.map((s, j) => (j === i ? next : s)) })
    return (
      <div className="space-y-5">
        <RecipeFields
          recipe={payload}
          onRecipe={(next) => onChange({ ...payload, ...next })}
          title="Recipe name"
          part={null}
          issues={issues}
        />
        {subs.map((sub, i) => (
          <section
            key={i}
            aria-label={`Sub-recipe ${sub.name || i + 1}`}
            className="space-y-3 rounded-lg border border-border p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Sub-recipe, used in {payload.name || 'this recipe'}
              </p>
              <button
                type="button"
                className="shrink-0 whitespace-nowrap text-sm text-text-muted hover:text-danger-700"
                onClick={() => onChange({ ...payload, subRecipes: subs.filter((_, j) => j !== i) })}
              >
                Remove sub-recipe
              </button>
            </div>
            <RecipeFields
              recipe={sub}
              onRecipe={(next) => setSub(i, next)}
              title="Name of the sub-recipe"
              part={i}
              issues={issues}
            />
          </section>
        ))}
      </div>
    )
  }

  const setDish = (i: number, patch: Partial<(typeof payload.items)[number]>) =>
    onChange({
      ...payload,
      items: payload.items.map((it, j) => (j === i ? { ...it, ...patch } : it)),
    })

  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block text-text-muted">Menu name</span>
        <input
          className={`${inputCls} ${markOf(at(undefined, 'name'))}`}
          value={payload.name}
          onChange={(e) => onChange({ ...payload, name: e.target.value })}
        />
        <IssueNotes issues={at(undefined, 'name')} />
      </label>
      <Table>
        <THead>
          <TR>
            <TH>Dish</TH>
            <TH className="text-right">Price</TH>
            <TH>Section</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {payload.items.map((it, i) => (
            <LineWithNotes key={i} issues={at(i)} span={4}>
              <TR>
                <TD className="w-3/5 min-w-48">
                  <input
                    aria-label={`Dish ${i + 1}`}
                    className={`${inputCls} ${markOf(at(i, 'name'))}`}
                    value={it.name}
                    onChange={(e) => setDish(i, { name: e.target.value })}
                  />
                </TD>
                <TD className="w-28 min-w-24">
                  <NumericInput
                    label={`Price of dish ${i + 1}`}
                    className={`${inputCls} text-right ${markOf(at(i, 'price'))}`}
                    value={it.price}
                    onValue={(n) => setDish(i, { price: n ?? 0 })}
                  />
                </TD>
                <TD className="w-40 min-w-32">
                  <input
                    aria-label={`Section of dish ${i + 1}`}
                    className={inputCls}
                    value={it.section ?? ''}
                    onChange={(e) => setDish(i, { section: e.target.value })}
                  />
                </TD>
                <TD className="w-10 text-right">
                  <button
                    type="button"
                    aria-label="Remove dish"
                    className="text-text-muted hover:text-danger-700"
                    onClick={() =>
                      onChange({ ...payload, items: payload.items.filter((_, j) => j !== i) })
                    }
                  >
                    ✕
                  </button>
                </TD>
              </TR>
            </LineWithNotes>
          ))}
        </TBody>
      </Table>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onChange({ ...payload, items: [...payload.items, { name: '', price: 0 }] })}
      >
        Add dish
      </Button>
    </div>
  )
}

function RecipeFields({
  recipe,
  onRecipe,
  title,
  part,
  issues,
}: {
  recipe: SubRecipe
  onRecipe: (next: SubRecipe) => void
  title: string
  part: number | null
  issues: ReviewIssue[]
}) {
  const at = (line: number | undefined, field?: string) => issuesAt(issues, { part, line, field })
  const setItem = (i: number, patch: Partial<SubRecipe['items'][number]>) =>
    onRecipe({
      ...recipe,
      items: recipe.items.map((it, j) => (j === i ? { ...it, ...patch } : it)),
    })
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-sm sm:col-span-4">
          <span className="mb-1 block text-text-muted">{title}</span>
          <input
            className={`${inputCls} ${markOf(at(undefined, 'name'))}`}
            value={recipe.name}
            onChange={(e) => onRecipe({ ...recipe, name: e.target.value })}
          />
          <IssueNotes issues={at(undefined, 'name')} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-text-muted">Portions</span>
          <NumericInput
            allowEmpty
            className={inputCls}
            value={recipe.portions}
            onValue={(n) => onRecipe({ ...recipe, portions: n })}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-text-muted">Yield qty</span>
          <NumericInput
            allowEmpty
            className={inputCls}
            value={recipe.yieldQty}
            onValue={(n) => onRecipe({ ...recipe, yieldQty: n })}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-text-muted">Yield unit</span>
          <UnitPicker
            label={`Yield unit of ${recipe.name || 'the recipe'}`}
            value={recipe.yieldUnit ?? ''}
            onUnit={(unit) => onRecipe({ ...recipe, yieldUnit: unit })}
            mark={markOf(at(undefined, 'yield'))}
          />
        </label>
        <div className="sm:col-span-4">
          <IssueNotes issues={at(undefined, 'yield')} />
        </div>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Ingredient</TH>
            <TH className="text-right">Qty</TH>
            <TH>Unit</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {recipe.items.map((it, i) => (
            <LineWithNotes key={i} issues={at(i)} span={4}>
              <TR>
                <TD className="w-3/5 min-w-48">
                  <input
                    aria-label={`Line ${i + 1} name`}
                    className={`${inputCls} ${markOf(at(i, 'rawName'))}`}
                    value={it.rawName}
                    onChange={(e) => setItem(i, { rawName: e.target.value })}
                  />
                </TD>
                <TD className="w-28 min-w-24">
                  <NumericInput
                    className={`${inputCls} text-right ${markOf(at(i, 'quantity'))}`}
                    value={it.quantity}
                    onValue={(n) => setItem(i, { quantity: n ?? 0, quantityText: undefined })}
                  />
                </TD>
                <TD className="w-56 min-w-48">
                  <UnitPicker
                    label={`Unit of ${it.rawName || `line ${i + 1}`}`}
                    value={it.unit}
                    onUnit={(unit) => setItem(i, { unit })}
                    mark={markOf(at(i, 'unit'))}
                  />
                </TD>
                <TD className="w-10 text-right">
                  <button
                    type="button"
                    aria-label="Remove line"
                    className="text-text-muted hover:text-danger-700"
                    onClick={() =>
                      onRecipe({ ...recipe, items: recipe.items.filter((_, j) => j !== i) })
                    }
                  >
                    ✕
                  </button>
                </TD>
              </TR>
            </LineWithNotes>
          ))}
        </TBody>
      </Table>
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          onRecipe({ ...recipe, items: [...recipe.items, { rawName: '', quantity: 0, unit: '' }] })
        }
      >
        Add line
      </Button>
    </div>
  )
}
