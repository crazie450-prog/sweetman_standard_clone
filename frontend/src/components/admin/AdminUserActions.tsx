'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, ConfirmDialog, Modal, TextField, useToast } from '@/components/ui'
import { adminService } from '@/lib/api/services'
import type { AdminUser } from '@/lib/api/types'
import { serverMessage } from '@/lib/api/error'
import { useInvalidate } from '@/lib/api/useInvalidate'

export function userStatus(u: AdminUser): {
  label: string
  tone: 'success' | 'danger' | 'warning'
} {
  if (!u.isActive) return { label: 'Deactivated', tone: 'danger' }
  if (u.lockedUntil) return { label: 'Locked', tone: 'warning' }
  return { label: 'Active', tone: 'success' }
}

export function AdminUserActions({ user, onChanged }: { user: AdminUser; onChanged?: () => void }) {
  const invalidate = useInvalidate()
  const toast = useToast()
  const [pendingDeactivate, setPendingDeactivate] = useState(false)
  const [resetLink, setResetLink] = useState<string | null>(null)

  const refresh = () => {
    void invalidate('admin-users')
    onChanged?.()
  }

  const update = useMutation({
    mutationFn: (dto: { isActive?: boolean; unlock?: boolean }) =>
      adminService.updateUser(user.id, dto),
    onSuccess: (_, dto) => {
      refresh()
      setPendingDeactivate(false)
      toast(
        'success',
        dto.unlock
          ? `${user.email} is unlocked`
          : dto.isActive
            ? `${user.email} can sign in again`
            : `${user.email} is deactivated and signed out everywhere`
      )
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not update the account')),
  })

  const reset = useMutation({
    mutationFn: () => adminService.resetUserPassword(user.id),
    onSuccess: (delivery) => {
      if (delivery.emailDelivered) toast('success', `Reset link sent to ${user.email}`)
      else if (delivery.resetUrl) setResetLink(delivery.resetUrl)
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not issue a reset')),
  })

  const managed = !user.isPlatformAdmin
  if (!managed) return <span className="text-xs text-text-muted">Platform administrator</span>

  return (
    <>
      <div className="flex flex-wrap justify-end gap-1">
        {user.lockedUntil && user.isActive && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => update.mutate({ unlock: true })}
            disabled={update.isPending}
          >
            Unlock
          </Button>
        )}
        {user.isActive && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => reset.mutate()}
            disabled={reset.isPending}
          >
            Reset password
          </Button>
        )}
        {user.isActive ? (
          user.role !== 'owner' && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => setPendingDeactivate(true)}
              disabled={update.isPending}
            >
              Deactivate
            </Button>
          )
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => update.mutate({ isActive: true })}
            disabled={update.isPending}
          >
            Reactivate
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={pendingDeactivate}
        onClose={() => setPendingDeactivate(false)}
        onConfirm={() => update.mutate({ isActive: false })}
        title={`Deactivate ${user.name}?`}
        confirmLabel="Deactivate"
        busy={update.isPending}
      >
        They are signed out on every device and cannot sign in until the account is reactivated
        here. Nothing they recorded is removed.
      </ConfirmDialog>

      <Modal
        open={resetLink !== null}
        onClose={() => setResetLink(null)}
        title="Share the reset link"
        footer={
          <Button variant="secondary" onClick={() => setResetLink(null)}>
            Close
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="text-sm">
            A reset for <span className="font-medium">{user.email}</span> is ready, but no mail
            provider is connected, so nothing was sent. Pass this link on yourself; it expires in an
            hour, and using it signs the account out everywhere.
          </p>
          <TextField
            label="Reset link"
            readOnly
            value={resetLink ?? ''}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      </Modal>
    </>
  )
}
