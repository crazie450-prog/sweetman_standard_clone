import { cn } from '@/lib/utils/cn'

const sizes = { sm: 'size-4', md: 'size-6', lg: 'size-8' } as const

export function Spinner({
  size = 'md',
  className,
}: {
  size?: keyof typeof sizes
  className?: string
}) {
  return (
    <svg
      className={cn('animate-spin text-primary-700 dark:text-primary-400', sizes[size], className)}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}
