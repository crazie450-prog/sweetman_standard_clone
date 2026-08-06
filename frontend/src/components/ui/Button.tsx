'use client'

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'
import { Spinner } from './Spinner'

export type ButtonVariant =
  'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning' | 'info'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'btn-sheen bg-primary-600 text-white hover:bg-primary-700 disabled:hover:bg-primary-600',
  secondary:
    'border border-border-strong bg-surface text-text shadow-xs hover:border-ink-600 hover:bg-surface-subtle disabled:hover:bg-surface',
  ghost: 'text-text-muted hover:bg-surface-subtle hover:text-text',
  danger: 'bg-danger text-white shadow-sm hover:bg-danger-700 disabled:hover:bg-danger',
  success: 'bg-success text-white shadow-sm hover:bg-success-800 disabled:hover:bg-success',
  warning: 'bg-warning text-white shadow-sm hover:bg-warning-800 disabled:hover:bg-warning',
  info: 'bg-info text-white shadow-sm hover:bg-info-700 disabled:hover:bg-info',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-sm',
  md: 'h-10 px-4 text-sm',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition duration-150 active:scale-[0.97]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...rest}
    >
      {loading ? <Spinner size="sm" className="text-current" /> : icon}
      {children}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string
  variant?: ButtonVariant
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', className, children, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex size-10 items-center justify-center rounded-lg transition duration-150 active:scale-95',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variantClasses[variant],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
})
