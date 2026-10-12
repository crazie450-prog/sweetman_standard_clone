'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'
import { IconButton } from './Button'

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  return (
    <dialog
      ref={ref}
      onClose={(e) => {
        if (e.target === ref.current) onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={cn(
        'modal-in m-auto max-h-[85%] w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-surface p-0 text-text shadow-xl',
        'open:flex open:flex-col',
        'backdrop:bg-black/40 backdrop:backdrop-blur-[2px]',
        sizes[size]
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        <IconButton aria-label="Close" onClick={onClose} className="-mr-2 size-8">
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-5" aria-hidden>
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </IconButton>
      </div>
      <div className="min-h-0 flex-auto overflow-y-auto px-5 py-4">{children}</div>
      {footer && (
        <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-surface-subtle px-5 py-3.5">
          {footer}
        </div>
      )}
    </dialog>
  )
}
