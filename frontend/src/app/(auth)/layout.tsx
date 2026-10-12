import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh">
      <aside className="hero-dawn relative hidden w-[44%] max-w-2xl shrink-0 flex-col justify-between overflow-hidden border-r border-border p-10 lg:flex">
        <span className="dawn-strip absolute inset-x-0 top-0" aria-hidden />
        <span
          className="blob -top-10 -left-8 size-56 bg-primary-200/40 dark:bg-primary-900/25"
          aria-hidden
        />
        <span
          className="blob top-1/3 -right-12 size-64 bg-info-100/50 dark:bg-info-900/20"
          aria-hidden
        />
        <span
          className="blob bottom-8 left-1/4 size-44 bg-danger-50 dark:bg-rose-900/15"
          aria-hidden
        />

        <div className="relative flex items-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-lg font-bold text-white shadow-sm">
            N
          </span>
          <span className="text-lg font-semibold tracking-wide">NEXUS</span>
        </div>

        <div className="relative">
          <h2 className="max-w-md text-3xl font-bold tracking-tight text-balance">
            Fresh mornings for your kitchen.
          </h2>
          <p className="mt-3 max-w-md text-[15px] text-text-muted">
            Recipes, inventory, invoices, and food costs: one calm workspace for your whole
            restaurant group.
          </p>

          <div className="mt-10 max-w-sm" aria-hidden>
            <div className="w-64 -rotate-2 rounded-xl bg-surface p-4 shadow-lg ring-1 ring-border">
              <p className="text-[13px] font-medium text-text-muted">Today&apos;s Revenue</p>
              <div className="mt-1.5 flex items-end justify-between gap-3">
                <p className="text-2xl font-bold tracking-tight tabular-nums">$3,505.00</p>
                <svg viewBox="0 0 96 32" className="h-8 w-24 shrink-0" fill="none" aria-hidden>
                  <path
                    d="M2 26 18 20 34 23 50 12 66 16 82 6 94 9"
                    stroke="var(--color-primary-500)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="94" cy="9" r="3" fill="var(--color-primary-500)" />
                </svg>
              </div>
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-[11px] font-semibold text-success-700 dark:bg-success-900/40 dark:text-success-600">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-3"
                  aria-hidden
                >
                  <path d="m6 14 6-6 6 6" />
                </svg>
                +12% vs yesterday
              </span>
            </div>

            <div className="relative -mt-3 ml-16 w-64 rotate-[1.5deg] rounded-xl bg-surface p-4 shadow-lg ring-1 ring-border">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Beef Wellington</p>
                <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-text-muted ring-1 ring-border">
                  Mains
                </span>
              </div>
              <p className="mt-2 text-[13px] text-text-muted">
                Food cost{' '}
                <span className="font-semibold text-warning-700 dark:text-warning-100">34%</span> ·
                $12.40 / portion
              </p>
              <div className="relative mt-2 h-1.5 rounded-full bg-surface-subtle ring-1 ring-border/60 ring-inset">
                <span className="block h-full w-[57%] rounded-full bg-warning-600" />
                <span className="absolute top-1/2 left-[60%] h-2.5 w-px -translate-y-1/2 bg-border-strong" />
              </div>
            </div>

            <div className="-mt-2 ml-7 inline-flex rotate-[-1deg] items-center gap-2 rounded-full bg-surface py-2 pr-3.5 pl-2 text-[13px] font-medium shadow-md ring-1 ring-border">
              <span className="flex size-5 items-center justify-center rounded-full bg-success text-white">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-3"
                  aria-hidden
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              Duxelles updated · 3 recipes recosted
            </div>
          </div>
        </div>

        <p className="relative text-[13px] text-text-muted">Nexus Restaurant Manager v0.1.0</p>
      </aside>

      <div className="flex min-w-0 flex-1 items-center justify-center p-4">{children}</div>
    </main>
  )
}
