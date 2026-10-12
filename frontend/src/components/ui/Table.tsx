import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '@/lib/utils/cn'

const pinnedLastColumn =
  'sm:[&_th:last-child]:sticky sm:[&_th:last-child]:right-0 sm:[&_th:last-child]:bg-surface-subtle ' +
  'sm:[&_td:last-child]:sticky sm:[&_td:last-child]:right-0 sm:[&_td:last-child]:bg-surface ' +
  'sm:[&_tr:hover_td:last-child]:bg-surface-subtle ' +
  'sm:[&_th:last-child]:border-l sm:[&_td:last-child]:border-l sm:[&_th:last-child]:border-border ' +
  'sm:[&_td:last-child]:border-border'

const compactCells = '[&_td]:px-3 [&_th]:px-3'

export function Table({
  pinActions = false,
  compact = false,
  className,
  ...rest
}: HTMLAttributes<HTMLTableElement> & { pinActions?: boolean; compact?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
      <table
        className={cn(
          'w-full text-left text-sm',
          pinActions && pinnedLastColumn,
          compact && compactCells,
          className
        )}
        {...rest}
      />
    </div>
  )
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('sticky top-0 z-10 bg-surface-subtle', className)} {...rest} />
}

export function TBody({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-border', className)} {...rest} />
}

export function TR({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'group transition-[background-color,box-shadow] hover:bg-surface-subtle hover:shadow-[inset_2px_0_0_var(--color-primary-500)]',
        className
      )}
      {...rest}
    />
  )
}

export function TH({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-border px-4 py-3 text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap text-text-muted uppercase',
        className
      )}
      {...rest}
    />
  )
}

export function TD({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3.5 align-middle', className)} {...rest} />
}

export function TDNum({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <TD className={cn('text-right', className)} {...rest} />
}

export function RowActions({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-wrap gap-1 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
        className
      )}
      {...rest}
    />
  )
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-14 text-center">
        <div className="sticky left-4 w-[calc(100vw-5rem)] sm:static sm:w-auto">
          <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
              aria-hidden
            >
              <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM9 12h6" />
            </svg>
          </span>
          <span className="mx-auto block max-w-sm text-sm text-text-muted">{children}</span>
        </div>
      </td>
    </tr>
  )
}
