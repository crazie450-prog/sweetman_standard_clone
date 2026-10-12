'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { RequireRole } from '@/components/layout/RequireRole'
import { Button, Card, ConfirmDialog, PageHeader, TextField, useToast } from '@/components/ui'
import { categoriesService, type Category, type CategoryKind } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

const SECTIONS: { kind: CategoryKind; title: string; one: string; many: string }[] = [
  { kind: 'ingredient', title: 'Ingredients', one: 'ingredient', many: 'ingredients' },
  { kind: 'recipe', title: 'Recipes', one: 'recipe', many: 'recipes' },
  { kind: 'menu', title: 'Menu items', one: 'dish', many: 'dishes' },
]

function Section({
  kind,
  title,
  one,
  many,
  onRemove,
}: {
  kind: CategoryKind
  title: string
  one: string
  many: string
  onRemove: (c: Category) => void
}) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const { data: categories = [], isLoading } = useQuery(queries.categories(kind))
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<Category | null>(null)
  const [newName, setNewName] = useState('')

  const renameCategory = useMutation({
    mutationFn: ({ category, to }: { category: Category; to: string }) =>
      categoriesService.rename(category.id, to),
    onSuccess: async (saved, { category }) => {
      await invalidate('categories')
      toast('success', `${category.name} renamed to ${saved.name}`)
      setRenaming(null)
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not rename the category')),
  })

  function rename() {
    if (!renaming) return
    if (!newName.trim()) {
      toast('danger', 'Type a name for the category')
      return
    }
    renameCategory.mutate({ category: renaming, to: newName.trim() })
  }

  const adding = useMutation({
    mutationFn: (named: string) => categoriesService.create({ name: named, kind }),
    onSuccess: async (created) => {
      await invalidate('categories')
      toast('success', `${created.name} added`)
      setName('')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not add the category')),
  })

  function add() {
    if (!name.trim()) {
      toast('danger', 'Type a name for the category')
      return
    }
    adding.mutate(name.trim())
  }

  return (
    <Card role="region" aria-label={title}>
      <h2 className="section-title font-semibold">{title}</h2>
      <div className="mt-3 flex items-end gap-2">
        <TextField
          label={`New ${title.toLowerCase()} category`}
          hideLabel
          placeholder="New category name"
          className="flex-1"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <Button onClick={add} disabled={adding.isPending}>
          Add
        </Button>
      </div>
      <div className="mt-4">
        {isLoading ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : categories.length === 0 ? (
          <p className="text-sm text-text-muted">No categories yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2.5">
                {renaming?.id === c.id ? (
                  <>
                    <TextField
                      label={`New name for ${c.name}`}
                      hideLabel
                      className="flex-1"
                      value={newName}
                      maxLength={60}
                      autoFocus
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') rename()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                    />
                    <Button size="sm" onClick={rename} disabled={renameCategory.isPending}>
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium" title={c.name}>
                        {c.name}
                      </p>
                      <p className="text-xs text-text-muted">
                        {c.used} {c.used === 1 ? one : many}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Rename ${c.name}`}
                      onClick={() => {
                        setRenaming(c)
                        setNewName(c.name)
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${c.name}`}
                      onClick={() => onRemove(c)}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function CategoriesPage() {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [pending, setPending] = useState<Category | null>(null)

  const removal = useMutation({
    mutationFn: (category: Category) => categoriesService.remove(category.id),
    onSuccess: async (_, category) => {
      await invalidate('categories')
      toast('success', `${category.name} deleted`)
      setPending(null)
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not delete the category')),
  })

  return (
    <>
      <PageHeader
        title="Categories"
        subtitle="The categories ingredients, recipes and dishes are filed under. A category is also added where it is chosen, in the recipe and dish forms. Renaming one renames it everywhere it is used; deleting one leaves what it filed in place, uncategorized."
      />
      <div className="grid gap-4 xl:grid-cols-3">
        {SECTIONS.map((s) => (
          <Section key={s.kind} {...s} onRemove={setPending} />
        ))}
      </div>
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => pending && removal.mutate(pending)}
        title={`Delete ${pending?.name ?? ''}?`}
        busy={removal.isPending}
      >
        {pending && pending.used > 0
          ? `${pending.used} ${pending.used === 1 ? 'record stays' : 'records stay'} where ${pending.used === 1 ? 'it is' : 'they are'}, without a category.`
          : 'Nothing is filed under it.'}
      </ConfirmDialog>
    </>
  )
}

export default function Page() {
  return (
    <RequireRole minRole="manager">
      <CategoriesPage />
    </RequireRole>
  )
}
