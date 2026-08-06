'use client'

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '@/lib/utils/cn'

interface FieldWrapperProps {
  label: string
  hideLabel?: boolean
  error?: string
  help?: string
  required?: boolean
  className?: string
}

function FieldWrapper({
  label,
  hideLabel,
  error,
  help,
  required,
  className,
  id,
  children,
}: FieldWrapperProps & { id: string; children: ReactNode }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label
        htmlFor={id}
        className={cn('block text-[13px] font-semibold text-text', hideLabel && 'sr-only')}
      >
        {label}
        {required && <span className="text-danger dark:text-danger-100"> *</span>}
      </label>
      {children}
      {error ? (
        <p className="flex items-start gap-1 text-[13px] text-danger-700" role="alert">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="mt-0.5 size-3.5 shrink-0"
            aria-hidden
          >
            <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4M12 16h.01" />
          </svg>
          {error}
        </p>
      ) : (
        help && (
          <p className="flex items-start gap-1 text-[13px] text-text-muted">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="mt-0.5 size-3.5 shrink-0"
              aria-hidden
            >
              <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" />
            </svg>
            {help}
          </p>
        )
      )}
    </div>
  )
}

export const inputClasses = (error?: string, radius = 'rounded-lg') =>
  cn(
    'block h-10 w-full border bg-surface-subtle px-3 text-sm text-text placeholder:text-text-muted/70',
    '[&[type=date]]:flex [&[type=date]]:appearance-none [&[type=date]]:items-center',
    '[&::-webkit-date-and-time-value]:m-0 [&::-webkit-date-and-time-value]:text-left',
    radius,
    'transition-colors focus:bg-surface focus:outline-2 focus:outline-offset-1 focus:outline-primary-600',
    'disabled:cursor-not-allowed disabled:opacity-60',
    error ? 'border-danger' : 'border-border hover:border-border-strong focus:border-border'
  )

const adornment =
  'pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-muted [&>svg]:size-4'

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>, FieldWrapperProps {
  leading?: ReactNode
  trailing?: ReactNode
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hideLabel, error, help, required, className, leading, trailing, id: idProp, ...rest },
  ref
) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <FieldWrapper {...{ label, hideLabel, error, help, required, className, id }}>
      <div className="relative">
        {leading && <span className={cn(adornment, 'left-3')}>{leading}</span>}
        <input
          ref={ref}
          id={id}
          required={required}
          aria-invalid={!!error || undefined}
          className={cn(inputClasses(error), leading ? 'pl-9' : '', trailing ? 'pr-9' : '')}
          {...rest}
        />
        {trailing && <span className={cn(adornment, 'right-3')}>{trailing}</span>}
      </div>
    </FieldWrapper>
  )
})

export interface SelectFieldProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>, FieldWrapperProps {
  options: { value: string; label: string }[]
  placeholder?: string
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hideLabel, error, help, required, className, options, placeholder, id: idProp, ...rest },
  ref
) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <FieldWrapper {...{ label, hideLabel, error, help, required, className, id }}>
      <div className="relative">
        <select
          ref={ref}
          id={id}
          required={required}
          aria-invalid={!!error || undefined}
          className={cn(inputClasses(error), 'cursor-pointer appearance-none truncate pr-9')}
          {...rest}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-muted"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M5.22 7.47a.75.75 0 011.06 0L10 11.19l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 8.53a.75.75 0 010-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    </FieldWrapper>
  )
})

export interface TextAreaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>, FieldWrapperProps {}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField(
    { label, hideLabel, error, help, required, className, id: idProp, rows = 3, ...rest },
    ref
  ) {
    const autoId = useId()
    const id = idProp ?? autoId
    return (
      <FieldWrapper {...{ label, hideLabel, error, help, required, className, id }}>
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          required={required}
          aria-invalid={!!error || undefined}
          className={cn(inputClasses(error), 'h-auto py-2')}
          {...rest}
        />
      </FieldWrapper>
    )
  }
)

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, id: idProp, ...rest },
  ref
) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <label htmlFor={id} className={cn('flex cursor-pointer items-center gap-2 text-sm', className)}>
      <span className="relative flex size-[18px] shrink-0 items-center justify-center">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          className={cn(
            'peer size-[18px] cursor-pointer appearance-none rounded-[5px] border border-border-strong bg-surface transition-colors',
            'hover:border-primary-500 checked:border-primary-600 checked:bg-primary-600',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600',
            'disabled:cursor-not-allowed disabled:opacity-60'
          )}
          {...rest}
        />
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute size-3 opacity-0 transition-opacity peer-checked:opacity-100"
          aria-hidden
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      {label}
    </label>
  )
})

export const SearchInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label?: string }
>(function SearchInput({ label = 'Search', className, ...rest }, ref) {
  const id = useId()
  return (
    <div className={cn('relative', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <svg
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.45 4.4l3.07 3.08a.75.75 0 11-1.06 1.06l-3.08-3.07A7 7 0 012 9z"
          clipRule="evenodd"
        />
      </svg>
      <input
        ref={ref}
        id={id}
        type="search"
        placeholder={rest.placeholder ?? 'Search…'}
        className={cn(inputClasses(undefined, 'rounded-full'), 'pl-9')}
        {...rest}
      />
    </div>
  )
})
