import { api } from '../client'
import type {
  BillingPlan,
  BillingSubscription,
  CurrentUser,
  InvitationDelivery,
  InvitationPreview,
  Location,
  LocationDetail,
  LocationInput,
  OrganizationProfile,
  PasswordResetDelivery,
  SessionUser,
  TeamMember,
} from '../types'

export const locationsService = {
  list: (): Promise<Location[]> => api.get<Location[]>('/api/properties'),
  listAll: (): Promise<LocationDetail[]> => api.get<LocationDetail[]>('/api/locations'),
  create: (payload: LocationInput): Promise<Location> =>
    api.post<Location>('/api/locations', payload),
  update: (
    id: string,
    payload: Partial<LocationInput> & { isActive?: boolean }
  ): Promise<Location> => api.patch<Location>(`/api/locations/${id}`, payload),
  remove: (id: string): Promise<unknown> => api.delete(`/api/locations/${id}`),
  restore: (id: string): Promise<unknown> => api.patch(`/api/locations/${id}`, { isActive: true }),
}

export const INVITABLE_ROLES = ['viewer', 'staff', 'manager', 'admin'] as const

export type InvitableRole = (typeof INVITABLE_ROLES)[number]

export const teamService = {
  list: (): Promise<TeamMember[]> => api.get<TeamMember[]>('/api/users'),
  update: (
    id: string,
    payload: { role?: InvitableRole; locationIds?: string[] }
  ): Promise<unknown> => api.patch(`/api/users/${id}`, payload),
  deactivate: (id: string): Promise<unknown> => api.delete(`/api/users/${id}`),
  reactivate: (id: string): Promise<TeamMember> =>
    api.post<TeamMember>(`/api/users/${id}/reactivate`, {}),
  resetPassword: (id: string): Promise<PasswordResetDelivery> =>
    api.post<PasswordResetDelivery>(`/api/users/${id}/password-reset`, {}),
}

export const invitationsService = {
  preview: (token: string): Promise<InvitationPreview> =>
    api.get<InvitationPreview>(`/api/invitations/${token}`),
  accept: (token: string, payload: { fullName: string; password: string }): Promise<unknown> =>
    api.post(`/api/invitations/${token}/accept`, payload),
  create: (payload: {
    email: string
    role: InvitableRole
    locationIds?: string[]
  }): Promise<InvitationDelivery> => api.post<InvitationDelivery>('/api/invitations', payload),
  revoke: (id: string): Promise<unknown> => api.delete(`/api/invitations/${id}`),
  resend: (id: string): Promise<InvitationDelivery> =>
    api.post<InvitationDelivery>(`/api/invitations/${id}/resend`),
}

export const authService = {
  login: (email: string, password: string): Promise<unknown> =>
    api.post('/api/auth/login', { email, password }),
  logout: (): Promise<unknown> => api.post('/api/auth/logout'),
  register: (payload: {
    organizationName: string
    fullName: string
    email: string
    password: string
  }): Promise<unknown> => api.post('/api/auth/register', payload),
  forgotPassword: (email: string): Promise<unknown> =>
    api.post('/api/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string): Promise<unknown> =>
    api.post('/api/auth/reset-password', { token, password }),
  updateProfile: (payload: {
    fullName?: string
    email?: string
    currentPassword?: string
  }): Promise<unknown> => api.patch('/api/auth/me', payload),
  changePassword: (currentPassword: string, newPassword: string): Promise<unknown> =>
    api.post('/api/auth/change-password', { currentPassword, newPassword }),
}

export const ROLE_LABELS: Record<string, string> = {
  owner: 'Restaurant Executive',
  admin: 'Administrator',
  manager: 'Restaurant Manager',
  staff: 'Executive Chef',
  viewer: 'Team Member',
}

export const organizationService = {
  current: async (): Promise<CurrentUser> => {
    const me = await api.get<SessionUser>('/api/auth/me')
    return {
      name: me.fullName || me.email,
      email: me.email,
      role: ROLE_LABELS[me.role] ?? me.role,
      roleKey: me.role,
      isPlatformAdmin: me.isPlatformAdmin,
      organization: me.organizationName,
      locations: me.locations,
      assigned: me.assigned,
    }
  },
  profile: (): Promise<OrganizationProfile> =>
    api.get<OrganizationProfile>('/api/organizations/current'),
  updateProfile: (payload: Partial<OrganizationProfile>): Promise<OrganizationProfile> =>
    api.patch<OrganizationProfile>('/api/organizations/current', payload),
}

export const billingService = {
  plans: (): Promise<BillingPlan[]> => api.get<BillingPlan[]>('/api/billing/plans'),
  trialDaysRemaining: (): Promise<number> => api.get<number>('/api/billing/trial'),
  subscription: (): Promise<BillingSubscription> =>
    api.get<BillingSubscription>('/api/billing/subscription'),
  checkout: (
    planId: string
  ): Promise<{ url: string; provider: 'stub' | 'stripe'; changed: boolean }> =>
    api.post<{ url: string; provider: 'stub' | 'stripe'; changed: boolean }>(
      '/api/billing/checkout',
      { planId }
    ),
  portal: (): Promise<{ url: string }> => api.post<{ url: string }>('/api/billing/portal'),
}
