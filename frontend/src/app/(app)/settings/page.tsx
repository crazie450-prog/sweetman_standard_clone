'use client'

import { RequireRole } from '@/components/layout/RequireRole'
import { useState } from 'react'
import Link from 'next/link'
import { Badge, Button, Card, PageHeader, SelectField, TextField, useToast } from '@/components/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { organizationService, type OrganizationProfile } from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { formatDate } from '@/lib/utils/format'
import { useCurrentUser } from '@/lib/api/useCurrentUser'
import { useInvalidate } from '@/lib/api/useInvalidate'
import { queries } from '@/lib/api/queries'

function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Manage your organization's profile and preferences" />
      <OrganizationTab />
    </>
  )
}

/* ============================== Organization ============================== */

function SettingsSection({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <section className="grid grid-cols-1 gap-x-8 gap-y-3 lg:grid-cols-[15rem_minmax(0,40rem)]">
      <div className="lg:sticky lg:top-[4.5rem] lg:self-start">
        <h3 className="section-title text-[15px] font-semibold">{title}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-text-muted">{hint}</p>
      </div>
      <Card>{children}</Card>
    </section>
  )
}

const LockIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)

const EMPTY_ORG: OrganizationProfile = {
  id: '',
  name: '',
  ownerName: '',
  ownerEmail: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  zipCode: '',
  country: 'US',
  timezone: 'America/New_York',
  currency: 'USD',
  dateFormat: 'MM/DD/YYYY',
  foodCostTargetPct: 30,
  subscriptionStatus: 'trial',
  trialEndsAt: null,
}

function OrganizationTab() {
  const { data: org } = useQuery(queries.organization())

  return <OrganizationForm key={org?.id ?? 'loading'} org={org ?? EMPTY_ORG} />
}

function OrganizationForm({ org }: { org: OrganizationProfile }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const { can, worksEverywhere } = useCurrentUser()
  const [dirty, setDirty] = useState(false)
  const [form, setForm] = useState<OrganizationProfile>(org)
  const [target, setTarget] = useState(String(org.foodCostTargetPct))
  const [targetError, setTargetError] = useState<string | undefined>(undefined)

  const { data: daysLeft = 0 } = useQuery(queries.billingTrial())
  const { data: subscription } = useQuery(queries.billingSubscription())
  const currentPlan = subscription?.planName

  const set = <K extends keyof OrganizationProfile>(key: K, value: OrganizationProfile[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setDirty(true)
  }

  const onTrial = form.subscriptionStatus === 'trial' && !!form.trialEndsAt

  const saving = useMutation({
    mutationFn: (foodCostTargetPct: number) =>
      organizationService.updateProfile({
        name: form.name,
        phone: form.phone,
        address: form.address,
        city: form.city,
        state: form.state,
        zipCode: form.zipCode,
        country: form.country,
        timezone: form.timezone,
        currency: form.currency,
        foodCostTargetPct,
      }),
    onSuccess: async () => {
      await invalidate('organization')
      setDirty(false)
      toast('success', 'Organization settings saved')
    },
    onError: (err) => toast('danger', serverMessage(err)),
  })

  function save(e: React.FormEvent) {
    e.preventDefault()
    const targetPct = Number(target.trim().replace(',', '.'))
    if (target.trim() === '' || !Number.isFinite(targetPct) || targetPct < 1 || targetPct > 100) {
      setTargetError('Enter a share between 1 and 100')
      return
    }
    setTargetError(undefined)
    saving.mutate(targetPct)
  }

  return (
    <form
      onSubmit={save}
      onReset={() => {
        setForm(org)
        setTarget(String(org.foodCostTargetPct))
        setTargetError(undefined)
        setDirty(false)
      }}
    >
      <div className="grid grid-cols-1 gap-6">
        <SettingsSection title="General" hint="How your organization appears across Nexus.">
          <div className="grid grid-cols-1 gap-4">
            <TextField
              label="Organization Name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
            <TextField
              label="Owner Name"
              value={form.ownerName}
              disabled
              trailing={LockIcon}
              help="The owner's own account; the owner changes it on My Profile"
            />
            <TextField
              label="Owner Email"
              type="email"
              value={form.ownerEmail}
              disabled
              trailing={LockIcon}
              help="The owner signs in with it and changes it on My Profile"
            />
          </div>
        </SettingsSection>

        <SettingsSection
          title="Organization Information"
          hint="Business address and contact details used on documents and invoices."
        >
          <div className="grid grid-cols-1 gap-4">
            <TextField
              label="Address"
              placeholder="Street address"
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
              <TextField
                label="City"
                placeholder="City"
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
              />
              <TextField
                label="State/Province"
                placeholder="State"
                value={form.state}
                onChange={(e) => set('state', e.target.value)}
              />
              <TextField
                label="ZIP Code"
                placeholder="ZIP"
                value={form.zipCode}
                onChange={(e) => set('zipCode', e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField
                label="Country"
                value={form.country}
                onChange={(e) => set('country', e.target.value)}
                options={[
                  { value: 'US', label: 'United States' },
                  { value: 'CA', label: 'Canada' },
                  { value: 'GB', label: 'United Kingdom' },
                ]}
              />
              <TextField
                label="Phone"
                type="tel"
                placeholder="(555) 123-4567"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Preferences"
          hint="Amounts are shown in this currency, and days, weeks and months in reports and on the dashboard are counted in this timezone. Dates are shown in US English."
        >
          <div className="grid grid-cols-1 gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField
                label="Currency"
                value={form.currency}
                onChange={(e) => set('currency', e.target.value)}
                options={[
                  { value: 'USD', label: '$ USD - US Dollar' },
                  { value: 'EUR', label: '€ EUR - Euro' },
                  { value: 'GBP', label: '£ GBP - British Pound' },
                ]}
              />
              <SelectField
                label="Timezone"
                value={form.timezone}
                onChange={(e) => set('timezone', e.target.value)}
                options={[
                  ...TIMEZONES,
                  ...(TIMEZONES.some((z) => z.value === form.timezone)
                    ? []
                    : [{ value: form.timezone, label: form.timezone }]),
                ]}
              />
            </div>
            <TextField
              label="Target food cost %"
              inputMode="decimal"
              help="Recipes and menu items above this share of their selling price are flagged"
              error={targetError}
              value={target}
              onChange={(e) => {
                setTarget(e.target.value)
                setTargetError(undefined)
                setDirty(true)
              }}
            />
          </div>
        </SettingsSection>

        <SettingsSection
          title="Usage & Subscription"
          hint="Your current plan and trial status. Billing details live on the Subscription page."
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary-100 to-primary-50 text-primary-800 dark:from-primary-900/50 dark:to-primary-900/20 dark:text-primary-200">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-5"
                  aria-hidden
                >
                  <path d="M13 2 4 13h6l-1 9 9-11h-6l1-9" />
                </svg>
              </span>
              <div>
                <p className="flex items-center gap-2 font-semibold">
                  {currentPlan ? `${currentPlan} Plan` : 'Plan'}
                  {onTrial && (
                    <Badge dot tone="info">
                      Trial
                    </Badge>
                  )}
                </p>
                <p className="text-[13px] text-text-muted">
                  {onTrial
                    ? `${daysLeft} days left · ends ${formatDate(form.trialEndsAt!)}`
                    : subscription?.status === 'active'
                      ? subscription.currentPeriodEnd
                        ? `Active · ${subscription.provider === 'stripe' ? 'next payment' : 'period ends'} ${formatDate(subscription.currentPeriodEnd)}`
                        : 'Active'
                      : subscription?.status === 'past_due'
                        ? 'The last payment failed'
                        : subscription?.status === 'canceled'
                          ? 'Canceled · choose a plan to continue'
                          : ''}
                </p>
              </div>
            </div>
            {!can('owner') && (
              <p className="text-[13px] text-text-muted">The owner manages the subscription.</p>
            )}
            {can('owner') && (
              <Link
                href="/subscription"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3.5 text-sm font-semibold text-text shadow-xs transition-colors hover:border-ink-600 hover:bg-surface-subtle"
              >
                Manage Subscription
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-3.5"
                  aria-hidden
                >
                  <path d="M7 17 17 7M9 7h8v8" />
                </svg>
              </Link>
            )}
          </div>
        </SettingsSection>
      </div>

      {dirty && can('admin') && worksEverywhere && (
        <div className="sticky bottom-4 z-20 mt-6 lg:max-w-[57.5rem]">
          <div className="toast-in flex items-center justify-between gap-3 rounded-xl border border-border bg-surface/90 py-3 pr-3 pl-4 shadow-lg backdrop-blur-sm">
            <p className="flex items-center gap-2 text-sm font-medium">
              <span className="size-2 rounded-full bg-warning-600" aria-hidden />
              Unsaved changes
            </p>
            <div className="flex gap-2">
              <Button type="reset" variant="secondary" size="sm">
                Discard
              </Button>
              <Button type="submit" size="sm" disabled={saving.isPending}>
                {saving.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </form>
  )
}

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Phoenix', label: 'Arizona (MST)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
  { value: 'UTC', label: 'UTC' },
]

export default function Page() {
  return (
    <RequireRole minRole="admin">
      <SettingsPage />
    </RequireRole>
  )
}
