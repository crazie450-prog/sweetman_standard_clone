'use client'

import { useState } from 'react'
import {
  Badge,
  Button,
  KpiCard,
  Modal,
  PageHeader,
  StatusBadge,
  Table,
  TableEmpty,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui'
import { useQuery } from '@tanstack/react-query'
import { adminService } from '@/lib/api/services'

export default function AdminQueuePage() {
  const { data: adminQueue = [], isLoading } = useQuery({
    queryKey: ['admin-queue'],
    queryFn: adminService.queue,
  })
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const toast = useToast()
  const job = adminQueue.find((j) => j.id === detailsId)

  const failed = adminQueue.filter((j) => j.status === 'failed').length
  const processing = adminQueue.filter(
    (j) => j.status === 'processing' || j.status === 'queued'
  ).length
  const requiresReview = adminQueue.filter((j) => j.status === 'requires_review').length

  return (
    <>
      <PageHeader title="Processing Queue" subtitle="Document-processing jobs across all tenants" />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="In queue" value={processing} tone="info" icon={<span>⏳</span>} />
        <KpiCard label="Failed" value={failed} tone="danger" icon={<span>✕</span>} />
        <KpiCard
          label="Requires review"
          value={requiresReview}
          tone={requiresReview > 0 ? 'warning' : 'slate'}
          icon={<span>👁</span>}
        />
        <KpiCard
          label="Total jobs"
          value={adminQueue.length}
          tone="primary"
          icon={<span>⏱</span>}
        />
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Job</TH>
            <TH>Tenant / location</TH>
            <TH>Type</TH>
            <TH>Duration</TH>
            <TH>Status</TH>
            <TH className="text-right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {isLoading && <TableEmpty colSpan={6}>Loading queue…</TableEmpty>}
          {!isLoading && adminQueue.length === 0 && (
            <TableEmpty colSpan={6}>
              No processing jobs. The queue fills up once document processing is running.
            </TableEmpty>
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
                        onClick={() => toast('info', 'Reprocessing is not available yet')}
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

      <Modal
        open={!!detailsId}
        onClose={() => setDetailsId(null)}
        title={`Job ${job?.id ?? ''} — ${job?.file ?? ''}`}
        size="lg"
        footer={
          <>
            {job?.status === 'failed' && (
              <Button
                variant="secondary"
                onClick={() => {
                  setDetailsId(null)
                  toast('info', 'Reprocessing is not available yet')
                }}
              >
                Retry Job
              </Button>
            )}
            <Button onClick={() => setDetailsId(null)}>Close</Button>
          </>
        }
      >
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-text-muted">Tenant</dt>
            <dd className="font-medium">{job?.organization}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Location</dt>
            <dd className="font-medium">{job?.location}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Type</dt>
            <dd className="font-medium">{job?.type}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Duration</dt>
            <dd className="font-medium">{job?.duration}</dd>
          </div>
          {job?.error && (
            <div className="sm:col-span-2">
              <dt className="text-text-muted">Error details</dt>
              <dd className="mt-1 rounded-lg bg-danger-100 p-3 text-danger-700 dark:bg-danger-900/40 dark:text-danger-100">
                {job.error}
              </dd>
            </div>
          )}
          <div className="sm:col-span-2">
            <dt className="text-text-muted">Extracted-data preview</dt>
            <dd className="mt-1 rounded-lg border border-border bg-bg p-3 font-mono text-xs text-text-muted">
              {job?.status === 'failed'
                ? '— no data extracted —'
                : '{ "vendor": "…", "items": [ … ] }'}
            </dd>
          </div>
        </dl>
      </Modal>
    </>
  )
}
