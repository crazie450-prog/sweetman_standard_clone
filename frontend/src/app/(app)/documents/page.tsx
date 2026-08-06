'use client'

import { RequireRole } from '@/components/layout/RequireRole'

import { useState } from 'react'
import {
  Badge,
  Button,
  Modal,
  PageHeader,
  Progress,
  StatusBadge,
  Table,
  TableEmpty,
  TBody,
  TD,
  TH,
  THead,
  TR,
  UploadZone,
  useToast,
} from '@/components/ui'
import { useQuery } from '@tanstack/react-query'
import { documentsService } from '@/lib/api/services'
import { formatDate } from '@/lib/utils/format'

const EXT_STYLE: Record<string, string> = {
  pdf: 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-100',
  xlsx: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-100',
  xls: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-100',
  docx: 'bg-info-100 text-info-700 dark:bg-info-900/40 dark:text-info-100',
  csv: 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200',
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

function DocumentsPage() {
  const [reviewId, setReviewId] = useState<string | null>(null)
  const toast = useToast()
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: documentsService.list,
  })
  const doc = documents.find((d) => d.id === reviewId)

  return (
    <>
      <PageHeader title="Documents" subtitle="Invoices, recipes, menus and sales files" />

      <div className="mb-6">
        <UploadZone
          formats={['PDF', 'JPG', 'PNG', 'XLSX', 'DOCX', 'CSV']}
          onFiles={(f) =>
            toast(
              'info',
              `${f.length} file(s) received — automated processing is not available yet`
            )
          }
        />
      </div>

      <Table>
        <THead>
          <TR>
            <TH>File</TH>
            <TH>Type</TH>
            <TH>Vendor</TH>
            <TH>Uploaded</TH>
            <TH>Status</TH>
            <TH className="text-right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {isLoading && <TableEmpty colSpan={6}>Loading documents…</TableEmpty>}
          {!isLoading && documents.length === 0 && (
            <TableEmpty colSpan={6}>No documents uploaded yet.</TableEmpty>
          )}
          {!isLoading &&
            documents.map((d) => (
              <TR key={d.id}>
                <TD className="max-w-64">
                  <FileCell name={d.file} />
                </TD>
                <TD>
                  <Badge>{d.type}</Badge>
                </TD>
                <TD className="text-text-muted">{d.vendor ?? '—'}</TD>
                <TD className="text-text-muted">{formatDate(d.uploadedAt)}</TD>
                <TD>
                  <StatusBadge status={d.status} />
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
                  {d.status === 'failed' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => toast('info', 'Reprocessing is not available yet')}
                    >
                      Retry
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
        </TBody>
      </Table>

      <Modal
        open={!!reviewId}
        onClose={() => setReviewId(null)}
        title={`Review extracted data — ${doc?.file ?? ''}`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReviewId(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setReviewId(null)
                toast('info', 'Confirming extracted values is not available yet')
              }}
            >
              Confirm & Apply
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-muted">
          Extraction arrives with document processing. Once a file has been read, its vendor, items,
          quantities and prices appear here for review, and nothing is written until you confirm
          them.
        </p>
      </Modal>
    </>
  )
}

export default function Page() {
  return (
    <RequireRole minRole="staff">
      <DocumentsPage />
    </RequireRole>
  )
}
