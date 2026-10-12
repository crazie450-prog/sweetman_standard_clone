'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  Badge,
  Button,
  KpiCard,
  Modal,
  PageHeader,
  SelectField,
  StatusBadge,
  Table,
  TableEmpty,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
  PAGE_SIZE,
  Pager,
  usePageOffset,
} from '@/components/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminService } from '@/lib/api/services'
import type { ExtractionPayload } from '@/lib/api/types'
import { ExtractionEditor } from '@/components/documents/ExtractionEditor'
import { serverMessage } from '@/lib/api/error'
import { formatDateTime } from '@/lib/utils/format'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

function JobDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  const toast = useToast()
  const { data: job, isLoading } = useQuery(queries.adminJob(id))
  const [draft, setDraft] = useState<ExtractionPayload | null>(null)
  const [syncedFor, setSyncedFor] = useState<string | null>(null)

  const version = job ? `${job.id}:${job.versions}` : null
  if (job && version !== syncedFor) {
    setSyncedFor(version)
    setDraft(job.payload)
  }

  const editable = job?.status === 'requires_review'

  const save = useMutation({
    mutationFn: (payload: ExtractionPayload) => adminService.saveExtraction(id, payload),
    onSuccess: (next) => {
      qc.setQueryData(queries.adminJob(id).queryKey, next)
      void invalidate('admin-queue')
      toast('success', 'Corrections saved for the tenant to review')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not save the corrections')),
  })

  const map = useMutation({
    mutationFn: (vars: { rawName: string; ingredientId: string }) =>
      adminService.mapName(id, vars.rawName, vars.ingredientId),
    onSuccess: (next) => {
      qc.setQueryData(queries.adminJob(id).queryKey, next)
      toast('success', 'Name mapped for this tenant')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not map the name')),
  })

  const retry = useMutation({
    mutationFn: () => adminService.retryJob(id),
    onSuccess: () => {
      toast('info', 'Re-queued for processing')
      void invalidate('admin-queue')
      onClose()
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not re-queue the document')),
  })

  if (isLoading || !job) return <p className="text-sm text-text-muted">Loading job…</p>

  return (
    <>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-text-muted">Tenant</dt>
          <dd className="font-medium">
            <Link
              href={`/admin/organizations/${job.organizationId}`}
              className="text-primary-700 hover:underline dark:text-primary-300"
            >
              {job.organization}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">Location</dt>
          <dd className="font-medium">{job.location}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Type</dt>
          <dd className="font-medium">{job.type}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Uploaded to last update</dt>
          <dd className="font-medium">{job.duration}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-text-muted">Processing attempts</dt>
          <dd className="font-medium">
            {job.attempts
              ? `${job.attempts.attemptsMade} of ${job.attempts.attemptsAllowed}` +
                (job.attempts.finishedOn
                  ? ` · finished ${formatDateTime(job.attempts.finishedOn)}`
                  : '') +
                (job.attempts.failedReason && job.attempts.failedReason !== job.error
                  ? ` · last error: ${job.attempts.failedReason}`
                  : '')
              : 'The queue holds no record of this job any more'}
          </dd>
        </div>
        {job.error && (
          <div className="sm:col-span-2">
            <dt className="text-text-muted">Error details</dt>
            <dd className="mt-1 rounded-lg bg-danger-100 p-3 text-danger-700 dark:bg-danger-900/40 dark:text-danger-100">
              {job.error}
            </dd>
          </div>
        )}
      </dl>

      <section className="mt-5">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          Extracted data
          {job.versions > 1 && <Badge tone="info">corrected · {job.versions} versions</Badge>}
        </h3>
        {!draft ? (
          <p className="rounded-lg border border-border bg-bg p-3 text-sm text-text-muted">
            Nothing was extracted from this file.
          </p>
        ) : editable ? (
          <ExtractionEditor payload={draft} onChange={setDraft} />
        ) : (
          <>
            <p className="mb-2 text-[13px] text-text-muted">
              This document has been dealt with by the tenant, so its values are the record of what
              it moved and are no longer editable.
            </p>
            <pre className="overflow-x-auto rounded-lg border border-border bg-bg p-3 font-mono text-xs">
              {JSON.stringify(draft, null, 2)}
            </pre>
          </>
        )}
      </section>

      {job.unresolved.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">Names that reach no ingredient</h3>
          <Table>
            <THead>
              <TR>
                <TH>Name on the document</TH>
                <TH>Unmatched lines</TH>
                <TH>Reads as</TH>
              </TR>
            </THead>
            <TBody>
              {job.unresolved.map((u) => (
                <TR key={u.rawName}>
                  <TD className="font-medium">{u.rawName}</TD>
                  <TD>{u.lines || '—'}</TD>
                  <TD>
                    <SelectField
                      label="Reads as"
                      hideLabel
                      value=""
                      disabled={map.isPending}
                      onChange={(e) =>
                        e.target.value &&
                        map.mutate({ rawName: u.rawName, ingredientId: e.target.value })
                      }
                      options={[
                        { value: '', label: 'Not mapped' },
                        ...job.ingredients.map((i) => ({ value: i.id, label: i.name })),
                      ]}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      )}

      <div className="mt-6 flex justify-end gap-2">
        {job.status === 'failed' && (
          <Button variant="secondary" onClick={() => retry.mutate()} disabled={retry.isPending}>
            Retry Job
          </Button>
        )}
        {editable && draft && (
          <Button variant="primary" onClick={() => save.mutate(draft)} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save corrections'}
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
      </div>
    </>
  )
}

export default function AdminQueuePage() {
  const invalidate = useInvalidate()
  const [offset, setOffset] = usePageOffset()
  const { data: summary } = useQuery({
    ...queries.adminQueueSummary(),
    refetchInterval: (query) => ((query.state.data?.processing ?? 0) > 0 ? 1500 : 5000),
  })
  const { data: page, isLoading } = useQuery({
    ...queries.adminQueue({ offset, limit: PAGE_SIZE }),
    refetchInterval: (query) =>
      (summary?.processing ?? 0) > 0 ||
      (query.state.data?.data ?? []).some((j) => j.status === 'queued' || j.status === 'processing')
        ? 1500
        : false,
  })
  const adminQueue = page?.data ?? []
  const { data: queueState } = useQuery({
    ...queries.adminQueueState(),
    refetchInterval: 5000,
  })
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const toast = useToast()
  const job = adminQueue.find((j) => j.id === detailsId)

  const retry = useMutation({
    mutationFn: (id: string) => adminService.retryJob(id),
    onSuccess: () => {
      toast('info', 'Re-queued for processing')
      void invalidate('admin-queue')
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not re-queue the document')),
  })

  const failed = summary?.failed ?? 0
  const processing = summary?.processing ?? 0
  const requiresReview = summary?.requiresReview ?? 0

  return (
    <>
      <PageHeader title="Processing Queue" subtitle="Document-processing jobs across all tenants" />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="In queue" value={processing} tone="info" icon={<span>⏳</span>} />
        <KpiCard label="Failed" value={failed} tone="danger" icon={<span>✕</span>} />
        <KpiCard
          label="Requires review"
          value={requiresReview}
          tone={requiresReview > 0 ? 'warning' : 'slate'}
          icon={<span>👁</span>}
        />
        <KpiCard
          label="Delayed"
          value={queueState?.delayed ?? 0}
          hint={
            queueState && !queueState.reachable
              ? 'The queue did not answer'
              : `${queueState?.active ?? 0} running, ${queueState?.waiting ?? 0} waiting`
          }
          tone={queueState && !queueState.reachable ? 'danger' : 'slate'}
          icon={<span>⏸</span>}
        />
        <KpiCard
          label="Total jobs"
          value={summary?.total ?? 0}
          tone="primary"
          icon={<span>⏱</span>}
        />
      </div>

      {queueState && !queueState.reachable && (
        <p className="mb-6 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-800 dark:border-danger-900/40 dark:bg-danger-900/20 dark:text-danger-100">
          The background queue is not answering. Uploaded documents will sit unprocessed until it is
          reachable again.
        </p>
      )}

      <Table>
        <THead>
          <TR>
            <TH>Job</TH>
            <TH>Tenant / location</TH>
            <TH>Type</TH>
            <TH>To last update</TH>
            <TH>Status</TH>
            <TH className="text-right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {isLoading && <TableEmpty colSpan={6}>Loading queue…</TableEmpty>}
          {!isLoading && adminQueue.length === 0 && (
            <TableEmpty colSpan={6}>No processing jobs yet.</TableEmpty>
          )}
          {!isLoading &&
            adminQueue.map((j) => (
              <TR key={j.id}>
                <TD>
                  <p className="max-w-52 truncate font-medium">{j.file}</p>
                  <p className="text-xs text-text-muted">{j.id}</p>
                </TD>
                <TD>
                  <p>{j.organization}</p>
                  <p className="text-xs text-text-muted">{j.location}</p>
                </TD>
                <TD>
                  <Badge>{j.type}</Badge>
                </TD>
                <TD>{j.duration}</TD>
                <TD>
                  <StatusBadge status={j.status} />
                </TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-1">
                    {j.status === 'failed' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => retry.mutate(j.id)}
                        disabled={retry.isPending}
                      >
                        Retry
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setDetailsId(j.id)}>
                      Details
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
        </TBody>
      </Table>
      <Pager page={page?.pagination} onOffset={setOffset} label="Job pages" />

      <Modal
        open={!!detailsId}
        onClose={() => setDetailsId(null)}
        title={`Job ${job?.id ?? ''}: ${job?.file ?? ''}`}
        size="xl"
      >
        {detailsId && <JobDetails id={detailsId} onClose={() => setDetailsId(null)} />}
      </Modal>
    </>
  )
}
