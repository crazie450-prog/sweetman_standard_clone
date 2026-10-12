import { Children, Fragment, cloneElement, isValidElement, type ReactElement } from 'react'
import type { ReviewIssue } from '@/lib/api/types'

export type Where = { part?: number | null; line?: number; field?: string }

export function issuesAt(issues: ReviewIssue[], where: Where) {
  return issues.filter(
    (i) =>
      (where.part === undefined || (i.part ?? null) === where.part) &&
      i.line === where.line &&
      (where.field === undefined || i.field === where.field)
  )
}

export function markOf(issues: ReviewIssue[]) {
  if (issues.some((i) => i.severity === 'error'))
    return 'border-danger-600 bg-danger-50 dark:bg-danger-900/20'
  if (issues.length > 0) return 'border-warning-600 bg-warning-50 dark:bg-warning-900/20'
  return ''
}

export function IssueNotes({ issues }: { issues: ReviewIssue[] }) {
  if (issues.length === 0) return null
  return (
    <ul className="mt-1 space-y-0.5">
      {issues.map((i) => (
        <li
          key={`${i.code}:${i.field ?? ''}:${i.message}`}
          data-severity={i.severity}
          className={`text-[12px] ${
            i.severity === 'error'
              ? 'text-danger-700 dark:text-danger-100'
              : 'text-warning-700 dark:text-warning-100'
          }`}
        >
          {i.message}
        </li>
      ))}
    </ul>
  )
}

export function ReviewSummary({ issues, checking }: { issues: ReviewIssue[]; checking: boolean }) {
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const general = issues.filter(
    (i) =>
      i.line === undefined &&
      !['name', 'number', 'yield', 'date', 'invoiceDate', 'vendorName'].includes(i.field ?? '')
  )
  if (issues.length === 0)
    return checking ? null : (
      <p className="text-[13px] text-success-700 dark:text-success-100">
        Nothing stops this document from being confirmed.
      </p>
    )
  return (
    <section
      aria-label="What to fix before confirming"
      className={`space-y-1 rounded-lg border px-3 py-2 text-sm ${
        errors.length > 0
          ? 'border-danger-600 bg-danger-50 text-danger-800 dark:bg-danger-900/20 dark:text-danger-100'
          : 'border-warning-600 bg-warning-50 text-warning-800 dark:bg-warning-900/20 dark:text-warning-100'
      }`}
    >
      <p className="font-semibold">
        {errors.length > 0
          ? `${errors.length} ${errors.length === 1 ? 'thing' : 'things'} to fix before this can be confirmed`
          : `${warnings.length} ${warnings.length === 1 ? 'thing' : 'things'} to check before confirming`}
        {errors.length > 0 && warnings.length > 0 && `, ${warnings.length} to check`}
      </p>
      <p className="text-[13px]">
        Fields marked in red stop the confirm; fields marked in yellow are worth a second look.
      </p>
      <IssueNotes issues={general} />
    </section>
  )
}

export function LineWithNotes({
  issues,
  span,
  children,
}: {
  issues: ReviewIssue[]
  span: number
  children: ReactElement
}) {
  const noted = issues.length > 0
  const row = Children.only(children)
  return (
    <Fragment>
      {noted && isValidElement(row)
        ? cloneElement(row as ReactElement<{ className?: string }>, { className: '!border-b-0' })
        : row}
      {noted && (
        <tr data-notes>
          <td colSpan={span} className="px-4 pb-3 pt-0">
            <IssueNotes issues={issues} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}
