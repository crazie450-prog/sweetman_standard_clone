'use client'

import { RequireRole } from '@/components/layout/RequireRole'

import { use, useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Modal,
  PAGE_SIZE,
  PageHeader,
  Pager,
  Progress,
  SelectField,
  StatusBadge,
  Table,
  TableEmpty,
  TBody,
  TD,
  TH,
  THead,
  TR,
  UploadZone,
  usePageOffset,
  useToast,
} from '@/components/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DOCUMENT_FORMATS, documentsService } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { useActiveLocationId } from '@/lib/api/useActiveLocation'
import type { ConfirmResult, DocumentJob, DocumentType, ExtractionPayload } from '@/lib/api/types'
import { ExtractionEditor } from '@/components/documents/ExtractionEditor'
import {
  confirmSentence,
  sendEach,
  uploadPlace,
  uploadSentence,
} from '@/components/documents/DocumentUpload'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { MissingConversions } from '@/components/documents/MissingConversions'
import { PriceJumps } from '@/components/documents/PriceJumps'
import { ReviewSummary } from '@/components/documents/issues'
import { FileUnits } from '@/components/documents/FileUnits'
import { formatDate } from '@/lib/utils/format'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'
import { ingredientChoices } from '@/lib/utils/options'

const TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'sales', label: 'Sales' },
  { value: 'recipe', label: 'Recipe' },
  { value: 'menu', label: 'Menu' },
]

const EXT_STYLE: Record<string, string> = {
  pdf: 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-100',
  xlsx: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-100',
  xls: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-100',
  docx: 'bg-info-100 text-info-700 dark:bg-info-900/40 dark:text-info-100',
  csv: 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200',
  json: 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200',
  jpg: 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-100',
  png: 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-100',
}

function FileCell({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${EXT_STYLE[ext] ?? 'bg-surface-subtle text-text-muted'}`}
        aria-hidden
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-4"
        >
          <path d="M7 3h7l4 4v14H7zM14 3v4h4" />
        </svg>
      </span>
      <span className="truncate font-medium">{name}</span>
    </div>
  )
}

const isDocumentType = (value: unknown): value is DocumentType =>
  TYPE_OPTIONS.some((o) => o.value === value)

function DocumentsPage({ only }: { only: DocumentType | null }) {
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ExtractionPayload | null>(null)
  const [syncedFor, setSyncedFor] = useState<string | null>(null)
  const [type, setType] = useState<DocumentType>(only ?? 'invoice')
  const [shown, setShown] = useState<DocumentType | ''>(only ?? '')
  const [pendingDelete, setPendingDelete] = useState<DocumentJob | null>(null)
  const [createMissing, setCreateMissing] = useState(false)
  const [notConfirmed, setNotConfirmed] = useState<(ConfirmResult & { file: string })[]>([])
  const locationId = useActiveLocationId()
  const { worksEverywhere } = useCurrentUser()
  const place = uploadPlace(type, locationId, worksEverywhere)
  const toast = useToast()
  const qc = useQueryClient()
  const invalidate = useInvalidate()

  const [offset, setOffset] = usePageOffset(shown)
  const { data: summary } = useQuery({
    ...queries.documentsSummary(shown || undefined),
    refetchInterval: (query) => ((query.state.data?.reading ?? 0) > 0 ? 1500 : false),
  })
  const reading = summary?.reading ?? 0
  const { data: page, isLoading } = useQuery({
    ...queries.documents({ type: shown || undefined, offset, limit: PAGE_SIZE }),
    refetchInterval: (query) =>
      reading > 0 ||
      (query.state.data?.data ?? []).some((d) => d.status === 'queued' || d.status === 'processing')
        ? 1500
        : false,
  })
  const rows = page?.data ?? []

  const { data: review, dataUpdatedAt: reviewRead } = useQuery({
    ...queries.document(reviewId ?? ''),
    enabled: !!reviewId,
  })

  const [checked, setChecked] = useState<{ id: string; payload: ExtractionPayload } | null>(null)
  useEffect(() => {
    const wait = setTimeout(
      () => setChecked(reviewId && draft ? { id: reviewId, payload: draft } : null),
      400
    )
    return () => clearTimeout(wait)
  }, [reviewId, draft])
  const current = checked && checked.id === reviewId ? checked : null
  const {
    data: checkResult,
    isFetching: checking,
    isError: checkFailed,
  } = useQuery({
    queryKey: [
      'document-check',
      current?.id,
      reviewRead,
      createMissing,
      JSON.stringify(current?.payload),
    ],
    queryFn: () =>
      documentsService.check(
        (current as { id: string }).id,
        (current as { payload: ExtractionPayload }).payload,
        createMissing
      ),
    enabled: !!current,
    placeholderData: (previous, query) =>
      query?.queryKey[1] === current?.id ? previous : undefined,
  })
  const issues = current ? (checkResult?.issues ?? []) : []
  const unchecked = !!reviewId && !checkFailed && !checkResult
  const blocking = issues.filter((i) => i.severity === 'error')
  const blockingAll = blocking.filter((i) => i.code !== 'RECIPE_COMPONENTS_UNCONFIRMED')

  const { data: ingredients = [] } = useQuery({
    ...queries.ingredients(),
    enabled: !!reviewId,
  })

  const mapName = useMutation({
    mutationFn: (vars: { rawName: string; ingredientId: string }) =>
      documentsService.mapName(reviewId as string, vars.rawName, vars.ingredientId),
    onSuccess: (next) => {
      qc.setQueryData(queries.document(reviewId ?? '').queryKey, next)
      toast('success', 'Name mapped to the catalogue')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not map the name')),
  })

  if (review && review.id !== syncedFor) {
    setSyncedFor(review.id)
    setDraft(review.extraction ?? null)
  }

  const closeReview = () => {
    setReviewId(null)
    setDraft(null)
    setSyncedFor(null)
    setCreateMissing(false)
  }

  const upload = useMutation({
    mutationFn: (files: File[]) => sendEach(files, type),
    onSuccess: (outcome) => {
      const said = uploadSentence(outcome)
      toast(said.tone, said.text)
      void invalidate('documents')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Upload failed')),
  })

  const alsoWaiting =
    review && review.id === reviewId
      ? review.siblings.filter((d) => d.status === 'requires_review')
      : []
  const fileOf = (id: string) =>
    (review?.id === id ? review.file : undefined) ??
    alsoWaiting.find((d) => d.id === id)?.file ??
    rows.find((d) => d.id === id)?.file ??
    id

  const confirm = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ExtractionPayload }) =>
      documentsService.confirm(id, payload, createMissing),
    onSuccess: (result) => {
      const said = confirmSentence(result)
      toast(said.tone, said.text)
      closeReview()
      void invalidate('confirmed')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not apply the extracted values')),
  })

  const confirmAll = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: ExtractionPayload }) =>
      (
        await documentsService.confirmMany([id, ...alsoWaiting.map((d) => d.id)], createMissing, {
          id,
          payload,
        })
      ).results,
    onSuccess: (results) => {
      const failed = results.filter((r) => r.error).map((r) => ({ ...r, file: fileOf(r.id) }))
      toast(
        failed.length ? 'info' : 'success',
        `${results.length - failed.length} of ${results.length} confirmed`
      )
      setNotConfirmed(failed)
      closeReview()
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not apply the extracted values')),
    onSettled: () => {
      void invalidate('confirmed')
    },
  })

  const retry = useMutation({
    mutationFn: (id: string) => documentsService.retry(id),
    onSuccess: () => {
      toast('info', 'Re-queued for processing')
      void invalidate('documents')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not re-queue the document')),
  })

  const remove = useMutation({
    mutationFn: (id: string) => documentsService.remove(id),
    onSuccess: () => {
      toast('success', 'Document deleted')
      setPendingDelete(null)
      void invalidate('documents')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not delete the document')),
  })

  return (
    <>
      <PageHeader title="Documents" subtitle="Invoices, recipes, menus and sales files" />

      <div className="mb-6 grid gap-3 sm:grid-cols-[200px_1fr]">
        <SelectField
          label="Document type"
          options={TYPE_OPTIONS}
          value={type}
          onChange={(e) => setType(e.target.value as DocumentType)}
        />
        <UploadZone
          formats={DOCUMENT_FORMATS}
          onFiles={(f) => f.length > 0 && upload.mutate(f)}
          disabled={!place.open}
          disabledHint={place.hint}
        />
      </div>

      <div className="mb-3 flex justify-end">
        <SelectField
          label="Show"
          placeholder="All types"
          options={TYPE_OPTIONS}
          value={shown}
          onChange={(e) => setShown(isDocumentType(e.target.value) ? e.target.value : '')}
          className="w-44"
        />
      </div>

      <Table pinActions>
        <THead>
          <TR>
            <TH>File</TH>
            <TH>Type</TH>
            <TH>Uploaded</TH>
            <TH>Status</TH>
            <TH className="text-right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {isLoading && <TableEmpty colSpan={5}>Loading documents…</TableEmpty>}
          {!isLoading && rows.length === 0 && (
            <TableEmpty colSpan={5}>
              {shown ? 'No documents of this type.' : 'No documents uploaded yet.'}
            </TableEmpty>
          )}
          {!isLoading &&
            rows.map((d) => (
              <TR key={d.id}>
                <TD className="max-w-64">
                  <FileCell name={d.file} />
                  {d.part && (
                    <p className="text-xs text-text-muted">
                      part {d.part.index} of {d.part.of}
                    </p>
                  )}
                </TD>
                <TD>
                  <Badge>{d.type}</Badge>
                </TD>
                <TD className="whitespace-nowrap text-text-muted">{formatDate(d.uploadedAt)}</TD>
                <TD>
                  <StatusBadge status={d.status} />
                  {d.status === 'failed' && d.error && (
                    <p
                      data-testid="document-error"
                      title={d.error}
                      className="mt-1 line-clamp-2 max-w-64 text-xs text-danger-700 dark:text-danger-100"
                    >
                      {d.error}
                    </p>
                  )}
                  {d.status === 'processing' && (
                    <Progress
                      indeterminate
                      tone="info"
                      size="sm"
                      label={`Processing ${d.file}`}
                      className="mt-1.5 w-24"
                    />
                  )}
                </TD>
                <TD className="text-right">
                  {d.status === 'requires_review' && (
                    <Button size="sm" onClick={() => setReviewId(d.id)}>
                      Review
                    </Button>
                  )}
                  {d.status === 'failed' && !d.part && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => retry.mutate(d.id)}
                      disabled={retry.isPending}
                    >
                      Retry
                    </Button>
                  )}
                  {d.status !== 'confirmed' && d.status !== 'partially_processed' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-1.5"
                      onClick={() => setPendingDelete(d)}
                    >
                      Delete
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
        </TBody>
      </Table>
      <Pager page={page?.pagination} onOffset={setOffset} label="Document pages" />

      <Modal
        open={!!reviewId}
        onClose={closeReview}
        title={`Review extracted data: ${review?.file ?? ''}`}
        size="xl"
        footer={
          <>
            <Button variant="secondary" onClick={closeReview}>
              Cancel
            </Button>
            {alsoWaiting.length > 0 && (
              <Button
                variant="secondary"
                onClick={() =>
                  reviewId && draft && confirmAll.mutate({ id: reviewId, payload: draft })
                }
                disabled={
                  !draft ||
                  confirmAll.isPending ||
                  confirm.isPending ||
                  unchecked ||
                  blockingAll.length > 0
                }
              >
                Confirm all {alsoWaiting.length + 1} from this file
              </Button>
            )}
            <Button
              onClick={() => reviewId && draft && confirm.mutate({ id: reviewId, payload: draft })}
              disabled={
                !draft ||
                confirm.isPending ||
                confirmAll.isPending ||
                unchecked ||
                blocking.length > 0
              }
            >
              Confirm &amp; Apply
            </Button>
          </>
        }
      >
        {!reviewId ? null : draft ? (
          <div className="space-y-3">
            <p className="text-sm text-text-muted">
              Check the extracted values and correct them if needed. Nothing is written until you
              confirm. On confirm, an invoice updates ingredient prices and receives stock, a sales
              file records the sale, and a recipe or menu file becomes a recipe or a dish.
            </p>
            <ReviewSummary issues={issues} checking={checking || !current} />
            <ExtractionEditor payload={draft} onChange={setDraft} issues={issues} />
            {review && (
              <PriceJumps jumps={review.priceJumps ?? []} read={review.extraction} draft={draft} />
            )}
            {review && review.unresolved.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Names that reach no ingredient</h3>
                <p className="text-[13px] text-text-muted">
                  {draft.kind === 'recipe'
                    ? 'A recipe cannot be saved until every name means an ingredient, or its cost would be too low. Map each name, or add the ones the catalogue lacks.'
                    : 'A line whose name means nothing here is recorded on the invoice but moves no stock. On an invoice, the name is remembered for the vendor that wrote it.'}
                </p>
                <Table>
                  <THead>
                    <TR>
                      <TH>Name on the document</TH>
                      <TH>Reads as</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {review.unresolved.map((u) => (
                      <TR key={u.rawName}>
                        <TD className="font-medium">{u.rawName}</TD>
                        <TD>
                          <SelectField
                            label="Reads as"
                            hideLabel
                            searchable
                            value=""
                            disabled={mapName.isPending}
                            onChange={(e) =>
                              e.target.value &&
                              mapName.mutate({ rawName: u.rawName, ingredientId: e.target.value })
                            }
                            options={[
                              { value: '', label: 'Not mapped' },
                              ...ingredientChoices(ingredients),
                            ]}
                          />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </section>
            )}
            {review && draft.kind === 'recipe' && (
              <FileUnits documentId={review.id} stamp={reviewRead} />
            )}
            {review && draft.kind === 'invoice' && (
              <MissingConversions documentId={review.id} missing={review.unconverted ?? []} />
            )}
            {draft.kind === 'recipe' &&
              ((review?.unresolved.length ?? 0) > 0 || alsoWaiting.length > 0) && (
                <Checkbox
                  label="Add the names that reach no ingredient to the catalogue, without a price yet"
                  checked={createMissing}
                  onChange={(e) => setCreateMissing(e.target.checked)}
                />
              )}
            {draft.kind === 'invoice' && (review?.unresolved.length ?? 0) > 0 && (
              <Checkbox
                label="Add the names that reach no ingredient to the catalogue and receive them, at the price on this invoice"
                checked={createMissing}
                onChange={(e) => setCreateMissing(e.target.checked)}
              />
            )}
            {alsoWaiting.length > 0 && (
              <p className="text-[13px] text-text-muted">
                This file holds {alsoWaiting.length + 1} documents waiting for review. Confirm all
                applies this one as edited here and the others as they were extracted; the ones that
                cannot be confirmed stay here with the reason.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-text-muted">Loading extracted values…</p>
        )}
      </Modal>

      <Modal
        open={notConfirmed.length > 0}
        onClose={() => setNotConfirmed([])}
        title={`${notConfirmed.length} not confirmed`}
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setNotConfirmed([])}>
            Close
          </Button>
        }
      >
        <p className="mb-3 text-sm text-text-muted">
          These stay waiting for review. Open each one to correct it, or map its names first.
        </p>
        <Table>
          <THead>
            <TR>
              <TH>Document</TH>
              <TH>Why</TH>
            </TR>
          </THead>
          <TBody>
            {notConfirmed.map((r, i) => (
              <TR key={`${r.id}-${i}`}>
                <TD className="font-medium">{r.file}</TD>
                <TD className="text-text-muted">{r.error}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
        title={`Delete ${pendingDelete?.file ?? 'document'}?`}
        busy={remove.isPending}
      >
        The file and everything extracted from it are removed. Nothing it has already applied is
        undone. This cannot be undone.
      </ConfirmDialog>
    </>
  )
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { type } = use(searchParams)
  return (
    <RequireRole minRole="staff">
      <DocumentsPage only={isDocumentType(type) ? type : null} />
    </RequireRole>
  )
}
