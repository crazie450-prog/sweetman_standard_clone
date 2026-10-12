export type Location = {
  id: string
  name: string
}

export type LocationDetail = {
  id: string
  name: string
  address: string | null
  phone: string | null
  isActive: boolean
  isDefault: boolean
  people: number
}

export type TeamMember = {
  id: string
  name: string
  email: string
  role: string
  status: 'active' | 'inactive' | 'invited' | 'expired'
  locations: { id: string; name: string }[]
}

export type InvitationPreview = {
  email: string
  role: string
  organizationName: string
  expiresAt: string
}

export type InvitationDelivery = {
  emailDelivered: boolean
  acceptUrl: string | null
}

export type PasswordResetDelivery = {
  emailDelivered: boolean
  resetUrl: string | null
}

export type SessionUser = {
  id: string
  email: string
  fullName: string
  role: string
  organizationId: string
  organizationName: string
  isPlatformAdmin: boolean
  locations: { id: string; name: string }[]
  assigned: boolean
}

export type CurrentUser = {
  name: string
  email: string
  role: string
  roleKey: string
  isPlatformAdmin: boolean
  organization: string
  locations: { id: string; name: string }[]
  assigned: boolean
}

export type OrganizationProfile = {
  id: string
  name: string
  ownerName: string
  ownerEmail: string
  phone: string
  address: string
  city: string
  state: string
  zipCode: string
  country: string
  timezone: string
  currency: string
  dateFormat: string
  foodCostTargetPct: number
  subscriptionStatus: string
  trialEndsAt: string | null
}

export type BillingPlan = {
  id: string
  name: string
  description: string
  monthlyPrice: number
  features: string[]
  current: boolean
}

export type BillingSubscription = {
  status: 'trial' | 'active' | 'past_due' | 'canceled'
  planId: string | null
  planName: string | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  seats: number
  perLocation: boolean
  provider: 'stub' | 'stripe'
  hasCustomer: boolean
  hasSubscription: boolean
  restricted: boolean
  warning: boolean
  reason: string | null
  graceDays: number
}

export type LocationInput = { name: string; address?: string | null; phone?: string | null }
