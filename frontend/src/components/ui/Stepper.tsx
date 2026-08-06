import { cn } from '@/lib/utils/cn'

const CheckIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-3.5"
    aria-hidden
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm">
      {steps.map((step, i) => {
        const done = i < current
        const active = i === current
        return (
          <li
            key={step}
            className="flex items-center gap-2"
            aria-current={active ? 'step' : undefined}
          >
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  'h-0.5 w-8 rounded-full transition-colors duration-300 sm:w-12',
                  done ? 'bg-info' : 'bg-border'
                )}
              />
            )}
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full text-xs font-semibold transition-all duration-200',
                  done && 'bg-info text-white',
                  active && 'bg-info text-white ring-4 ring-info-100 dark:ring-info-900/40',
                  !done && !active && 'border border-border bg-bg text-text-muted'
                )}
              >
                {done ? <CheckIcon /> : i + 1}
              </span>
              <span
                className={cn(
                  'hidden sm:inline transition-colors',
                  active ? 'font-medium text-text' : 'text-text-muted'
                )}
              >
                {step}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
