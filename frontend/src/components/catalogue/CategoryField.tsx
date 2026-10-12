'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button, SelectField, TextField, useToast } from '@/components/ui'
import { categoriesService, type CategoryKind } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

const NEW = '__new__'

export function CategoryField({
  kind,
  value,
  onChange,
  className,
}: {
  kind: CategoryKind
  value: string
  onChange: (id: string) => void
  className?: string
}) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const { can } = useCurrentUser()
  const { data: categories = [] } = useQuery(queries.categories(kind))
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const options = categories.map((c) => ({ value: c.id, label: c.name }))
  if (can('staff')) options.push({ value: NEW, label: '+ New category' })

  const close = () => {
    setAdding(false)
    setName('')
  }

  const creation = useMutation({
    mutationFn: (named: string) => categoriesService.create({ name: named, kind }),
    onSuccess: async (created) => {
      await invalidate('categories')
      onChange(created.id)
      close()
    },
    onError: (e) => toast('danger', serverMessage(e)),
  })

  function create() {
    if (!name.trim()) return
    creation.mutate(name.trim())
  }

  return (
    <div className={className}>
      <SelectField
        label="Category"
        placeholder="Uncategorized"
        value={adding ? NEW : value}
        onChange={(e) => {
          if (e.target.value === NEW) {
            setAdding(true)
            return
          }
          close()
          onChange(e.target.value)
        }}
        options={options}
      />
      {adding && (
        <div className="mt-2 space-y-2">
          <TextField
            label="New category name"
            hideLabel
            placeholder="New category name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void create()
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" onClick={create} disabled={creation.isPending || !name.trim()}>
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
