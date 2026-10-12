'use client'

import { RequireRole } from '@/components/layout/RequireRole'
import { Suspense, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { Badge, Button, Card, useToast } from '@/components/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { billingService, type BillingSubscription } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { cn } from '@/lib/utils/cn'
import { formatDate } from '@/lib/utils/format'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

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

const statusTone = {
  trial: 'info',
  active: 'success',
  past_due: 'warning',
  canceled: 'danger',
} as const

const statusLabel = {
  trial: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
} as const

function StatusCard({ sub, trialDays }: { sub: BillingSubscription; trialDays: number }) {
  const toast = useToast()
  const portal = useMutation({
    mutationFn: billingService.portal,
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (e) => toast('danger', serverMessage(e, 'Could not open the billing portal')),
  })

  const detail =
    sub.status === 'trial'
      ? sub.trialEndsAt
        ? `${trialDays} day${trialDays === 1 ? '' : 's'} left · ends ${formatDate(sub.trialEndsAt)}`
        : 'No end date recorded'
      : sub.status === 'active'
        ? sub.currentPeriodEnd
          ? `${sub.provider === 'stripe' ? 'Next payment' : 'Period ends'} ${formatDate(sub.currentPeriodEnd)}`
          : 'Paid'
        : sub.status === 'past_due'
          ? sub.currentPeriodEnd
            ? `Paid period ended ${formatDate(sub.currentPeriodEnd)}`
            : 'The last payment failed'
          : 'Choose a plan below to continue'

  return (
    <Card
      className={cn(
        'mx-auto mt-6 max-w-3xl',
        sub.restricted && 'border-danger-600',
        sub.warning && 'border-warning-700'
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-lg font-semibold">
            {sub.planName ? `${sub.planName} plan` : 'No plan'}
            <Badge dot tone={statusTone[sub.status]}>
              {statusLabel[sub.status]}
            </Badge>
          </p>
          <p className="mt-1 text-sm text-text-muted">
            {detail}
            {sub.perLocation && ` · ${sub.seats} location${sub.seats === 1 ? '' : 's'} billed`}
          </p>
        </div>
        {sub.provider === 'stripe' && sub.hasSubscription && (
          <Button variant="secondary" onClick={() => portal.mutate()} disabled={portal.isPending}>
            Manage billing
          </Button>
        )}
      </div>
      {sub.reason && (
        <p
          className={cn(
            'mt-4 rounded-lg px-3 py-2 text-sm',
            sub.restricted
              ? 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-100'
              : 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-100'
          )}
        >
          {sub.reason}
        </p>
      )}
      {sub.provider === 'stub' && (
        <p className="mt-4 text-[13px] text-text-muted">
          No payment provider is connected yet: choosing a plan below records it directly, without a
          checkout. Card payments and the billing portal switch on with the provider keys.
        </p>
      )}
    </Card>
  )
}

function BillingPage() {
  const invalidate = useInvalidate()
  const toast = useToast()
  const params = useSearchParams()

  const { data: billingPlans = [] } = useQuery(queries.billingPlans())
  const { data: trialDays = 0 } = useQuery(queries.billingTrial())
  const { data: sub } = useQuery(queries.billingSubscription())

  const checkoutResult = params.get('checkout')
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (!checkoutResult || handled.current === checkoutResult) return
    handled.current = checkoutResult
    if (checkoutResult === 'success') {
      toast(
        'success',
        'Checkout complete; the plan shows here once the payment provider confirms it'
      )
      void invalidate('billing')
    } else if (checkoutResult === 'canceled') {
      toast('info', 'Checkout was canceled; the plan is unchanged')
    }
    window.history.replaceState(null, '', '/subscription')
  }, [checkoutResult, invalidate, toast])

  const checkout = useMutation({
    mutationFn: (planId: string) => billingService.checkout(planId),
    onSuccess: ({ url, provider, changed }) => {
      if (provider === 'stub' || changed) {
        toast(
          'success',
          changed
            ? 'The plan is changed on the current subscription; the difference is prorated on the next invoice'
            : 'The plan is recorded; no payment provider is connected yet'
        )
        void invalidate('billing')
        return
      }
      window.location.assign(url)
    },
    onError: (e) => toast('danger', serverMessage(e, 'Could not start the checkout')),
  })

  const currentIndex = billingPlans.findIndex((p) => p.current)

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-center text-2xl font-bold tracking-tight md:text-[27px] md:leading-9">
        Choose Your Plan
      </h1>
      <p className="mt-4 text-center text-text-muted">
        Select the perfect plan for your restaurant business
      </p>

      {sub && <StatusCard sub={sub} trialDays={trialDays} />}

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
              <span className="text-3xl font-bold">${p.monthlyPrice}</span>
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
              {p.id === 'free' ? (
                <Button variant="secondary" disabled className="w-full">
                  {p.current ? 'Current Plan' : 'Trial'}
                </Button>
              ) : (
                <Button
                  variant={p.current ? 'secondary' : 'primary'}
                  disabled={p.current || checkout.isPending}
                  className="w-full"
                  onClick={() => checkout.mutate(p.id)}
                >
                  {p.current
                    ? 'Current Plan'
                    : sub?.provider === 'stripe' && sub.hasSubscription
                      ? `Switch to ${p.name}`
                      : currentIndex === -1 || i > currentIndex
                        ? `Upgrade to ${p.name}`
                        : `Downgrade to ${p.name}`}
                </Button>
              )}
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
      <Suspense fallback={null}>
        <BillingPage />
      </Suspense>
    </RequireRole>
  )
}
