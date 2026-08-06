'use client'

import { RequireRole } from '@/components/layout/RequireRole'
import { useState } from 'react'
import Link from 'next/link'
import {
  Badge,
  Button,
  Card,
  PageHeader,
  SegmentedControl,
  SelectField,
  TextField,
  useToast,
  Progress,
} from '@/components/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  locationsService,
  billingService,
  organizationService,
  teamService,
  ROLE_LABELS,
  type OrganizationProfile,
} from '@/lib/api/services'
import { serverMessage } from '@/lib/api/error'
import { formatDate } from '@/lib/utils/format'
import { useCurrentUser } from '@/lib/api/useCurrentUser'

const TABS = ['Organization', 'Team', 'Properties', 'Unit Conversions'] as const
type Tab = (typeof TABS)[number]

function SettingsPage() {
  const [tab, setTab] = useState<Tab>('Organization')

  return (
    <>
      <PageHeader title="Settings" subtitle="Manage system configuration and preferences" />

      <div
        role="tablist"
        aria-label="Settings sections"
        className="mb-6 flex flex-wrap gap-1 border-b border-border"
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t
                ? 'border-primary-600 text-primary-700 dark:text-primary-400'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Organization' && <OrganizationTab />}
      {tab === 'Team' && <TeamTab />}
      {tab === 'Properties' && <PropertiesTab />}
      {tab === 'Unit Conversions' && <UnitConversionsTab />}
    </>
  )
}

function TabHeading({
  title,
  hint,
  actions,
}: {
  title: string
  hint: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-text-muted">{hint}</p>
      </div>
      {actions}
    </div>
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
  subscriptionStatus: 'trial',
  trialEndsAt: null,
}

const TRIAL_DAYS_TOTAL = 30

function OrganizationTab() {
  const { data: org } = useQuery({
    queryKey: ['organization'],
    queryFn: organizationService.profile,
  })

  return <OrganizationForm key={org?.id ?? 'loading'} org={org ?? EMPTY_ORG} />
}

function OrganizationForm({ org }: { org: OrganizationProfile }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { can } = useCurrentUser()
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<OrganizationProfile>(org)

  const { data: daysLeft = 0 } = useQuery({
    queryKey: ['trial-days'],
    queryFn: billingService.trialDaysRemaining,
  })
  const { data: plans = [] } = useQuery({
    queryKey: ['billing-plans'],
    queryFn: billingService.plans,
  })
  const currentPlan = plans.find((p) => p.current)?.name

  const set = <K extends keyof OrganizationProfile>(key: K, value: OrganizationProfile[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setDirty(true)
  }

  const trialDaysUsed = Math.min(TRIAL_DAYS_TOTAL, Math.max(0, TRIAL_DAYS_TOTAL - daysLeft))
  const onTrial = form.subscriptionStatus === 'trial' && !!form.trialEndsAt

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await organizationService.updateProfile({
        name: form.name,
        ownerName: form.ownerName,
        phone: form.phone,
        address: form.address,
        city: form.city,
        state: form.state,
        zipCode: form.zipCode,
        country: form.country,
        timezone: form.timezone,
        currency: form.currency,
        dateFormat: form.dateFormat,
      })
      await queryClient.invalidateQueries({ queryKey: ['organization'] })
      await queryClient.invalidateQueries({ queryKey: ['org-current'] })
      setDirty(false)
      toast('success', 'Organization settings saved')
    } catch (err) {
      toast('danger', serverMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={save}
      onReset={() => {
        setForm(org)
        setDirty(false)
      }}
    >
      <TabHeading
        title="Organization Settings"
        hint="Manage your organization details, usage, and account settings"
      />

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
              onChange={(e) => set('ownerName', e.target.value)}
            />
            <TextField
              label="Owner Email"
              type="email"
              value={form.ownerEmail}
              disabled
              trailing={LockIcon}
              help="Contact support to change owner email"
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
          hint="Saved with the organization. Reports and screens still render in US English and USD."
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
                  { value: 'America/New_York', label: 'Eastern Time (ET)' },
                  { value: 'America/Chicago', label: 'Central Time (CT)' },
                  { value: 'America/Denver', label: 'Mountain Time (MT)' },
                  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
                ]}
              />
            </div>
            <div>
              <span className="mb-1.5 block text-[13px] font-semibold">Date Format</span>
              <SegmentedControl
                label="Date Format"
                value={form.dateFormat}
                onChange={(v) => set('dateFormat', v)}
                options={[
                  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
                  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
                  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
                ]}
              />
            </div>
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
                    : 'Subscription billing arrives with Stripe'}
                </p>
              </div>
            </div>
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
          </div>
          {onTrial && (
            <div className="mt-4">
              <Progress value={(trialDaysUsed / TRIAL_DAYS_TOTAL) * 100} />
              <p className="mt-1.5 text-[13px] text-text-muted">
                {trialDaysUsed} of {TRIAL_DAYS_TOTAL} trial days used
              </p>
            </div>
          )}
        </SettingsSection>
      </div>

      {dirty && can('admin') && (
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
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </form>
  )
}

/* ================================== Team ================================== */

function TeamTab() {
  const { data: teamMembers = [] } = useQuery({
    queryKey: ['team'],
    queryFn: teamService.list,
  })
  const active = teamMembers.filter((m) => m.status === 'active')

  return (
    <>
      <TabHeading
        title="Team Management"
        hint="Manage team members, roles, and invitations"
        actions={
          <Link
            href="/team"
            className="inline-flex h-10 items-center rounded-lg bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700"
          >
            Invite Team Member
          </Link>
        }
      />

      <h3 className="mb-3 text-lg font-semibold">Active Team Members ({active.length})</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {active.map((m) => (
          <Card key={m.id}>
            <p className="text-lg font-semibold">{m.name}</p>
            <p className="mt-1 text-sm text-text-muted">{m.email}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone="primary">{ROLE_LABELS[m.role] ?? m.role}</Badge>
              <span className="text-xs text-text-muted">
                {m.locations.length === 0
                  ? 'All locations'
                  : m.locations.map((l) => l.name).join(', ')}
              </span>
            </div>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-sm text-text-muted">
        Full member list, role editing, and invitations live on the{' '}
        <Link href="/team" className="font-medium text-primary-700 underline dark:text-primary-400">
          Team page
        </Link>
        .
      </p>
    </>
  )
}

/* =============================== Properties =============================== */

function PropertiesTab() {
  const { data: locations = [] } = useQuery({
    queryKey: ['locations-all'],
    queryFn: locationsService.listAll,
  })
  return (
    <>
      <TabHeading
        title="Properties"
        hint="Manage your restaurant locations and properties"
        actions={
          <Link
            href="/settings/properties"
            className="inline-flex h-10 items-center rounded-lg bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700"
          >
            Add Property
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {locations.map((l) => (
          <Card key={l.id}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-lg font-semibold">{l.name}</p>
              {l.isDefault && <Badge tone="primary">Default</Badge>}
            </div>
            <p className="mt-1 text-sm text-text-muted">{l.address || 'Restaurant location'}</p>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-sm text-text-muted">
        Editing and archiving locations lives on the{' '}
        <Link
          href="/settings/properties"
          className="font-medium text-primary-700 underline dark:text-primary-400"
        >
          Property Management page
        </Link>
        .
      </p>
    </>
  )
}

/* ============================ Unit Conversions ============================ */

const systemConversions = [
  { from: '1 kg', to: '1000 g' },
  { from: '1 lb', to: '453.59 g' },
  { from: '1 oz', to: '28.35 g' },
  { from: '1 gal', to: '3.785 L' },
  { from: '1 qt', to: '0.946 L' },
  { from: '1 cup', to: '236.59 ml' },
  { from: '1 tbsp', to: '14.79 ml' },
  { from: '1 tsp', to: '4.93 ml' },
]

function ConversionSection({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string
  count: number
  defaultOpen?: boolean
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? true)

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-lg font-semibold">
          {title}
          <Badge>{count}</Badge>
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
          className={`size-5 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </Card>
  )
}

function UnitConversionsTab() {
  const toast = useToast()

  return (
    <>
      <TabHeading
        title="Unit Conversions"
        hint="Manage global and ingredient-specific unit conversions"
        actions={
          <Button onClick={() => toast('info', 'Unit conversions are not available yet')}>
            Add Conversion
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4">
        <ConversionSection
          title="System Conversions (Built-in)"
          count={systemConversions.length}
          defaultOpen={false}
        >
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 xl:grid-cols-4">
            {systemConversions.map((c) => (
              <li key={c.from} className="text-text-muted">
                {c.from} = {c.to}
              </li>
            ))}
          </ul>
        </ConversionSection>

        <ConversionSection title="Custom Global Conversions" count={0}>
          <p className="text-sm text-text-muted">
            Custom conversions that apply to all ingredients
          </p>
          <p className="mt-3 text-sm italic text-text-muted">
            No custom global conversions. Click &quot;Add Conversion&quot; to create one.
          </p>
        </ConversionSection>

        <ConversionSection title="Ingredient-Specific Conversions" count={0}>
          <p className="text-sm text-text-muted">
            These conversions apply only to specific ingredients (e.g., &quot;to taste&quot; for
            salt vs chives)
          </p>
          <div className="mt-3 rounded-lg border border-info-700/30 bg-info-100 p-4 text-sm text-info-700 dark:bg-info-900/40 dark:text-info-100">
            <p className="font-medium">No ingredient-specific conversions yet</p>
            <p className="mt-1">
              They will cover measurements that only make sense per ingredient, such as &quot;to
              taste&quot;.
            </p>
          </div>
        </ConversionSection>
      </div>
    </>
  )
}

export default function Page() {
  return (
    <RequireRole minRole="admin">
      <SettingsPage />
    </RequireRole>
  )
}
