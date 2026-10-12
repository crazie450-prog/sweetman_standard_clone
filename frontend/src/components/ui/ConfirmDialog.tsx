'use client'

import type { ReactNode } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  confirmLabel = 'Delete',
  tone = 'danger',
  busy = false,
  children,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  busy?: boolean
  children: ReactNode
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-text-muted">{children}</div>
    </Modal>
  )
}
