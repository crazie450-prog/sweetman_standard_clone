'use client'

import { RequireRole } from '@/components/layout/RequireRole'
import { useState } from 'react'
import { Badge, Button, Card, useToast } from '@/components/ui'
import { useQuery } from '@tanstack/react-query'
import { billingService, type BillingPlan } from '@/lib/api/services'
import { cn } from '@/lib/utils/cn'

type BillingPeriod = 'monthly' | 'yearly'

function CheckIcon() {
  return (
    <svg
      className="mt-0.5 size-4 shrink-0 text-success-700"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  )
}

function BillingPage() {
  const { data: billingPlans = [] } = useQuery({
    queryKey: ['billing-plans'],
    queryFn: billingService.plans,
  })
  const { data: TRIAL_DAYS_REMAINING = 0 } = useQuery({
    queryKey: ['billing-trial'],
    queryFn: billingService.trialDaysRemaining,
  })
  const toast = useToast()
  const [period, setPeriod] = useState<BillingPeriod>('monthly')

  const currentIndex = billingPlans.findIndex((p) => p.current)

  const displayPrice = (p: BillingPlan) =>
    period === 'yearly' ? Math.round(p.monthlyPrice * 0.83) : p.monthlyPrice

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-center text-2xl font-bold tracking-tight md:text-[27px] md:leading-9">
        Choose Your Plan
      </h1>
      <p className="mt-4 text-center text-text-muted">
        Select the perfect plan for your restaurant business
      </p>

      {TRIAL_DAYS_REMAINING > 0 && (
        <div className="mt-5 flex justify-center">
          <div className="rounded-lg border border-warning-700/30 bg-warning-100 px-4 py-2 text-sm text-warning-700 dark:bg-warning-900/40 dark:text-warning-100">
            <span className="font-semibold">Trial Active:</span> {TRIAL_DAYS_REMAINING} day
            {TRIAL_DAYS_REMAINING === 1 ? '' : 's'} remaining
          </div>
        </div>
      )}

      <div className="mt-8 flex justify-center">
        <div
          className="inline-flex rounded-lg bg-bg p-1 shadow-inner"
          role="tablist"
          aria-label="Billing period"
        >
          <button
            type="button"
            role="tab"
            aria-selected={period === 'monthly'}
            className={cn(
              'rounded-md px-5 py-2 text-sm font-medium transition-colors',
              period === 'monthly'
                ? 'bg-surface text-primary-700 shadow-sm dark:text-primary-300'
                : 'text-text-muted hover:text-text'
            )}
            onClick={() => setPeriod('monthly')}
          >
            Monthly
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={period === 'yearly'}
            className={cn(
              'flex items-center gap-2 rounded-md px-5 py-2 text-sm font-medium transition-colors',
              period === 'yearly'
                ? 'bg-surface text-primary-700 shadow-sm dark:text-primary-300'
                : 'text-text-muted hover:text-text'
            )}
            onClick={() => setPeriod('yearly')}
          >
            Yearly
            <Badge tone="success">Save 17%</Badge>
          </button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {billingPlans.map((p, i) => (
          <Card
            key={p.id}
            className={cn('relative flex flex-col', p.current && 'border-primary-600')}
          >
            {p.current && (
              <Badge
                tone="primary"
                className="absolute -top-px -right-px rounded-tl-none rounded-br-none"
              >
                Current Plan
              </Badge>
            )}
            <h2 className="text-lg font-semibold">{p.name}</h2>
            <p className="mt-2 text-sm text-text-muted">{p.description}</p>
            <p className="mt-4">
              <span className="text-3xl font-bold">${displayPrice(p)}</span>
              <span className="text-sm font-semibold text-text-muted">/mo</span>
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <CheckIcon />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-6">
              <Button
                variant={p.current ? 'secondary' : 'primary'}
                disabled={p.current}
                className="w-full"
                onClick={() => toast('info', 'Changing the plan is not available yet')}
              >
                {p.current
                  ? 'Current Plan'
                  : i > currentIndex
                    ? `Upgrade to ${p.name}`
                    : `Downgrade to ${p.name}`}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default function Page() {
  return (
    <RequireRole minRole="owner">
      <BillingPage />
    </RequireRole>
  )
}
