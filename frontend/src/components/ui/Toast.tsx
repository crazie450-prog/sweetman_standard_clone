'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils/cn'

type ToastTone = 'success' | 'warning' | 'danger' | 'info'

interface ToastItem {
  id: number
  tone: ToastTone
  message: string
  count: number
}

const TIMEOUT = 4500

const ToastContext = createContext<(tone: ToastTone, message: string) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

const plateClasses: Record<ToastTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
}

const ToneIcon = ({ tone }: { tone: ToastTone }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-4"
    aria-hidden
  >
    {tone === 'success' && <path d="M20 6 9 17l-5-5" />}
    {tone === 'warning' && (
      <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
    )}
    {tone === 'danger' && <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4M12 16h.01" />}
    {tone === 'info' && <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" />}
  </svg>
)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counter = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const toastsRef = useRef<ToastItem[]>([])
  useEffect(() => {
    toastsRef.current = toasts
  }, [toasts])

  const remove = useCallback((id: number) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const existing = toastsRef.current.find((x) => x.tone === tone && x.message === message)
      if (existing) {
        clearTimeout(timers.current.get(existing.id))
        timers.current.set(
          existing.id,
          setTimeout(() => remove(existing.id), TIMEOUT)
        )
        setToasts((t) => t.map((x) => (x.id === existing.id ? { ...x, count: x.count + 1 } : x)))
        return
      }
      const id = ++counter.current
      timers.current.set(
        id,
        setTimeout(() => remove(id), TIMEOUT)
      )
      setToasts((t) => [...t, { id, tone, message, count: 1 }])
    },
    [remove]
  )

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((timer) => clearTimeout(timer))
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2.5"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="toast-in pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl bg-surface py-3 pr-2 pl-3.5 shadow-lg ring-1 ring-border"
          >
            <span
              className={cn(
                'mt-px flex size-7 shrink-0 items-center justify-center rounded-full text-white',
                plateClasses[t.tone]
              )}
            >
              <ToneIcon tone={t.tone} />
            </span>
            <p className="min-w-0 flex-1 self-center text-sm font-medium text-text">
              {t.message}
              {t.count > 1 && (
                <span className="ml-2 rounded-full bg-surface-subtle px-1.5 py-0.5 text-[11px] font-semibold text-text-muted tabular-nums ring-1 ring-border">
                  ×{t.count}
                </span>
              )}
            </p>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => remove(t.id)}
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-subtle hover:text-text"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="size-3.5"
                aria-hidden
              >
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
            <span
              key={t.count}
              aria-hidden
              className={cn('toast-life absolute inset-x-0 bottom-0 h-0.5', plateClasses[t.tone])}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
