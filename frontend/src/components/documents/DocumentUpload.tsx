'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button, Modal, UploadZone, useToast } from '@/components/ui'
import { DOCUMENT_FORMATS, documentsService, type DocumentType } from '@/lib/api/services'
import type { ConfirmSummary } from '@/lib/api/types'
import { serverMessage } from '@/lib/api/error'
import { useActiveLocationId } from '@/lib/api/useActiveLocation'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

const WHAT: Record<DocumentType, { one: string; many: string; reads: string }> = {
  invoice: {
    one: 'invoice',
    many: 'invoices',
    reads: 'Each file is read for its vendor, number, date and lines.',
  },
  recipe: {
    one: 'recipe',
    many: 'recipes',
    reads:
      'Each file is read for its recipes: name, portions, ingredients and quantities. A workbook may hold one recipe per sheet.',
  },
  menu: {
    one: 'menu',
    many: 'menus',
    reads: 'Each file is read as a whole menu: its name and every dish with price and section.',
  },
  sales: {
    one: 'sales report',
    many: 'sales reports',
    reads: 'Each file is read for the dishes sold, how many and at what price.',
  },
}

export function uploadPlace(
  type: DocumentType,
  locationId: string,
  worksEverywhere: boolean
): { open: boolean; hint: string } {
  const everywhere = type === 'recipe' || type === 'menu'
  return {
    open: !!locationId || (everywhere && worksEverywhere),
    hint: everywhere
      ? 'Choose a location in the header: with every location active, only someone who works at all of them adds recipes and menus for the whole organization'
      : 'Choose a location in the header: an invoice or a sales report belongs to the location that received it',
  }
}

export type UploadOutcome = { sent: number; refused: { file: string; reason: string }[] }

export async function sendEach(files: File[], type: DocumentType): Promise<UploadOutcome> {
  const settled = await Promise.allSettled(files.map((f) => documentsService.upload(f, type)))
  const refused = settled.flatMap((r, i) =>
    r.status === 'rejected'
      ? [{ file: files[i].name, reason: serverMessage(r.reason, 'refused') }]
      : []
  )
  return { sent: files.length - refused.length, refused }
}

export function uploadSentence({ sent, refused }: UploadOutcome): {
  tone: 'success' | 'warning' | 'danger'
  text: string
} {
  const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`
  const why = refused.map((r) => `${r.file}: ${r.reason}`).join('; ')
  if (refused.length === 0) {
    return {
      tone: 'success',
      text: `${files(sent)} sent for reading; review them in Documents before anything is saved`,
    }
  }
  if (sent === 0) return { tone: 'danger', text: `Nothing was uploaded. ${why}` }
  return {
    tone: 'warning',
    text: `${files(sent)} sent for reading, ${files(refused.length)} refused. ${why}`,
  }
}

export function confirmSentence(result: ConfirmSummary): {
  tone: 'success' | 'warning'
  text: string
} {
  const lines = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`
  const told: string[] = []
  if (result.unmapped) told.push(`${lines(result.unmapped)} matched nothing in the catalogue`)
  if (result.unconverted)
    told.push(`${lines(result.unconverted)} in a unit that could not be converted`)
  if (result.credits) told.push(`${lines(result.credits)} of credit recorded without moving stock`)
  if (result.vendorUnmatched) told.push('the vendor is not on the vendor list')
  const added = result.added
    ? `, ${result.added} new ${result.added === 1 ? 'ingredient' : 'ingredients'} added`
    : ''
  const applied =
    (result.applied === undefined
      ? 'Extracted values applied'
      : `${lines(result.applied)} applied`) + added
  if (told.length === 0 && result.status !== 'partially_processed') {
    return { tone: 'success', text: applied }
  }
  return {
    tone: 'warning',
    text: `${applied}; ${told.join('; ') || 'some lines were not applied'}`,
  }
}

export function DocumentUploadButton({
  type,
  label,
  variant = 'secondary',
}: {
  type: DocumentType
  label: string
  variant?: 'primary' | 'secondary'
}) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const { can, worksEverywhere } = useCurrentUser()
  const locationId = useActiveLocationId()
  const place = uploadPlace(type, locationId, worksEverywhere)
  const [open, setOpen] = useState(false)
  const what = WHAT[type]

  const upload = useMutation({
    mutationFn: (files: File[]) => sendEach(files, type),
    onSuccess: (outcome) => {
      const said = uploadSentence(outcome)
      toast(said.tone, said.text)
      void invalidate('documents')
      if (outcome.refused.length === 0) setOpen(false)
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not upload the files')),
  })

  if (!can('staff')) return null

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        footer={
          <>
            <Link href={`/documents?type=${type}`}>
              <Button variant="secondary">Open Documents</Button>
            </Link>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
          </>
        }
      >
        {open && (
          <div className="space-y-3">
            <p className="text-sm text-text-muted">
              {what.reads} Every value read is shown for review, and nothing reaches your{' '}
              {what.many} until you confirm it.
            </p>
            <UploadZone
              formats={DOCUMENT_FORMATS}
              hint={`Drag and drop ${what.one} files here`}
              onFiles={(f) => f.length > 0 && upload.mutate(f)}
              disabled={!place.open || upload.isPending}
              disabledHint={place.hint}
            />
          </div>
        )}
      </Modal>
    </>
  )
}

export function PendingReview({ type }: { type: DocumentType }) {
  const { can } = useCurrentUser()
  const { data: summary } = useQuery({
    ...queries.documentsSummary(type),
    enabled: can('staff'),
    refetchInterval: (query) => ((query.state.data?.reading ?? 0) > 0 ? 1500 : false),
  })
  const reading = summary?.reading ?? 0
  const waiting = summary?.requires_review ?? 0
  if (reading === 0 && waiting === 0) return null
  const what = WHAT[type]
  const files = (n: number) => `${n} ${what.one} ${n === 1 ? 'file' : 'files'}`
  const parts = [
    reading > 0 ? `${files(reading)} ${reading === 1 ? 'is' : 'are'} being read` : null,
    waiting > 0
      ? `${waiting} ${waiting === 1 ? what.one : what.many} ${waiting === 1 ? 'is' : 'are'} waiting for review`
      : null,
  ].filter(Boolean)
  return (
    <p
      role="status"
      className="mb-4 rounded-lg border border-info-100 bg-info-50 px-3 py-2 text-sm text-info-800 dark:border-info-900/40 dark:bg-info-900/20 dark:text-info-100"
    >
      {parts.join('; ')}.{' '}
      <Link href={`/documents?type=${type}`} className="font-semibold underline">
        Review in Documents
      </Link>
    </p>
  )
}
