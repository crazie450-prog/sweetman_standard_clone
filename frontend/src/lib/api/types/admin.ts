import type { DocumentStatus } from '@/components/ui'
import type { ExtractionPayload } from './documents'

export type AdminOrganization = {
  id: string
  name: string
  ownerEmail: string
  locations: number
  users: number
  status: string
  planId: string | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  hasCustomer: boolean
  isActive: boolean
  created: string
}

export type AdminUser = {
  id: string
  name: string
  email: string
  role: string
  isActive: boolean
  isPlatformAdmin: boolean
  lockedUntil: string | null
  lastSignIn: string | null
  created: string
}

export type AdminUserRow = AdminUser & {
  organization: { id: string; name: string; isActive: boolean }
}

export type AdminOrganizationDetail = {
  id: string
  name: string
  slug: string
  ownerName: string
  ownerEmail: string
  country: string
  timezone: string
  currency: string
  isActive: boolean
  created: string
  subscription: {
    status: string
    planId: string | null
    trialEndsAt: string | null
    currentPeriodEnd: string | null
    seats: number | null
    stripeCustomerId: string | null
    foodCostTargetPct: number
  }
  locations: {
    id: string
    name: string
    address: string
    isActive: boolean
    isDefault: boolean
    assignedUsers: number
  }[]
  users: AdminUser[]
  documents: Record<string, number>
}

export type AdminJobAttempts = {
  attemptsMade: number
  attemptsAllowed: number
  failedReason: string | null
  processedOn: string | null
  finishedOn: string | null
}

export type QueueJob = {
  id: string
  file: string
  organization: string
  organizationId: string
  location: string
  type: string
  duration: string
  status: DocumentStatus
  error?: string | null
}

export type IntegrationService = 'documents' | 'storage' | 'mail' | 'billing' | 'errors'

export type Integrations = {
  environment: 'development' | 'staging' | 'production'
  services: { service: IntegrationService; provider: string; live: boolean; note: string }[]
}

export type QueueState = {
  reachable: boolean
  waiting: number
  active: number
  delayed: number
  failed: number
}

export type AdminQueueDetail = QueueJob & {
  attempts: AdminJobAttempts | null
  versions: number
  payload: ExtractionPayload | null
  unresolved: { rawName: string; lines: number }[]
  ingredients: { id: string; name: string }[]
}

export type QueueSummary = {
  total: number
  processing: number
  requiresReview: number
  failed: number
}
