'use client'

import { RequireRole } from '@/components/layout/RequireRole'
import { useState } from 'react'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Modal,
  PageHeader,
  SelectField,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TextField,
  useToast,
} from '@/components/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { documentsService, type IngredientAlias } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { ingredientChoices, keepingCurrent } from '@/lib/utils/options'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

const EMPTY = { rawName: '', ingredientId: '' }

function MappingPage() {
  const { data: aliases = [], isLoading } = useQuery(queries.ingredientAliases())
  const { data: ingredients = [] } = useQuery(queries.ingredients())
  const invalidate = useInvalidate()
  const { can } = useCurrentUser()
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [pendingRemove, setPendingRemove] = useState<IngredientAlias | null>(null)

  const options = [{ value: '', label: 'Not mapped' }, ...ingredientChoices(ingredients)]

  const optionsFor = (row: IngredientAlias) =>
    keepingCurrent(options, row.ingredientId, row.ingredientName)
  const unmapped = aliases.filter((a) => !a.ingredientId).length

  const mapping = useMutation({
    mutationFn: ({ row, ingredientId }: { row: IngredientAlias; ingredientId: string }) =>
      documentsService.mapAlias(row.id, ingredientId || null),
    onSuccess: async (_, { row, ingredientId }) => {
      await invalidate('ingredient-aliases')
      toast(
        'success',
        ingredientId
          ? `"${row.rawName}" now reads as ${ingredients.find((x) => x.id === ingredientId)?.name}`
          : `"${row.rawName}" is no longer mapped`
      )
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not save the mapping')),
  })
  const savingId = mapping.isPending ? mapping.variables.row.id : null

  const map = (row: IngredientAlias, ingredientId: string) => mapping.mutate({ row, ingredientId })

  const adding = useMutation({
    mutationFn: () =>
      documentsService.createAlias(form.rawName.trim(), form.ingredientId || undefined),
    onSuccess: async () => {
      await invalidate('ingredient-aliases')
      toast('success', 'Name added')
      setOpen(false)
      setForm(EMPTY)
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not add the name')),
  })

  function submit() {
    if (!form.rawName.trim()) {
      toast('danger', 'A name is required')
      return
    }
    adding.mutate()
  }

  const removal = useMutation({
    mutationFn: (row: IngredientAlias) => documentsService.removeAlias(row.id),
    onSuccess: async () => {
      await invalidate('ingredient-aliases')
      toast('success', 'Name removed')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not remove the name')),
    onSettled: () => setPendingRemove(null),
  })

  return (
    <>
      <PageHeader
        title="Ingredient Mapping"
        subtitle="Names as they are written on documents, against the ingredients they mean. A name an uploaded document reaches no ingredient by is parked here until someone maps it; from then on every document that uses it is understood. A name that arrived on an invoice from a known vendor is parked in that vendor's catalogue under Vendor Products instead, because only that vendor uses it. Lines already recorded keep the name they arrived under."
        actions={
          can('manager') ? (
            <Button variant="primary" onClick={() => setOpen(true)}>
              + Add Name
            </Button>
          ) : undefined
        }
      />

      {isLoading && <p className="text-sm text-text-muted">Loading…</p>}

      {!isLoading && aliases.length === 0 && (
        <EmptyState
          title="No alternative names recorded"
          hint="A vendor writing an ingredient by another name adds itself here the first time a document carries it. Add one ahead of time when you already know the wording."
          action={
            can('manager') ? <Button onClick={() => setOpen(true)}>+ Add Name</Button> : undefined
          }
        />
      )}

      {aliases.length > 0 && (
        <>
          {unmapped > 0 && (
            <p className="mb-4 text-sm text-text-muted">
              {unmapped} {unmapped === 1 ? 'name reaches' : 'names reach'} no ingredient yet.
            </p>
          )}
          <Table>
            <THead>
              <TR>
                <TH>Name on documents</TH>
                <TH>Unmatched lines</TH>
                <TH>Reads as</TH>
                {can('manager') && <TH>Actions</TH>}
              </TR>
            </THead>
            <TBody>
              {aliases.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <span className="font-medium">{a.rawName}</span>
                    {!a.ingredientId && (
                      <Badge tone="warning" className="ml-2">
                        Unmapped
                      </Badge>
                    )}
                  </TD>
                  <TD>{a.lines || '—'}</TD>
                  <TD>
                    {can('manager') ? (
                      <SelectField
                        label="Reads as"
                        hideLabel
                        value={a.ingredientId ?? ''}
                        disabled={savingId === a.id}
                        onChange={(e) => map(a, e.target.value)}
                        options={optionsFor(a)}
                        searchable
                      />
                    ) : (
                      (a.ingredientName ?? '—')
                    )}
                  </TD>
                  {can('manager') && (
                    <TD>
                      <Button variant="ghost" size="sm" onClick={() => setPendingRemove(a)}>
                        Remove
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add Name">
        <div className="grid gap-4">
          <TextField
            label="Name on documents"
            help="Exactly as the vendor writes it"
            placeholder="Butter, Unsalted 36ct"
            value={form.rawName}
            onChange={(e) => setForm({ ...form, rawName: e.target.value })}
          />
          <SelectField
            label="Reads as"
            help="Leave empty to record the name now and map it later"
            value={form.ingredientId}
            onChange={(e) => setForm({ ...form, ingredientId: e.target.value })}
            options={options}
            searchable
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={adding.isPending}>
              {adding.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingRemove !== null}
        title="Remove this name?"
        confirmLabel="Remove"
        onClose={() => setPendingRemove(null)}
        onConfirm={() => pendingRemove && removal.mutate(pendingRemove)}
        busy={removal.isPending}
      >
        A document that uses it again will park it here once more, unmapped.
      </ConfirmDialog>
    </>
  )
}

export default function Page() {
  return (
    <RequireRole minRole="manager">
      <MappingPage />
    </RequireRole>
  )
}
