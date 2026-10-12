import { api } from '../client'
import type { DocumentStatus } from '@/components/ui'
import type {
  AdminOrganization,
  AdminOrganizationDetail,
  AdminQueueDetail,
  AdminUserRow,
  ExtractionPayload,
  Integrations,
  Page,
  PageParams,
  QueueJob,
  QueueState,
  QueueSummary,
} from '../types'
import { searchOf } from './period'

export const adminService = {
  organizations: (
    params: PageParams & { status?: string; q?: string } = {}
  ): Promise<Page<AdminOrganization>> =>
    api.get<Page<AdminOrganization>>(`/api/admin/organizations${searchOf(params)}`),
  organization: (id: string): Promise<AdminOrganizationDetail> =>
    api.get<AdminOrganizationDetail>(`/api/admin/organizations/${id}`),
  updateOrganization: (id: string, dto: { isActive: boolean }): Promise<AdminOrganizationDetail> =>
    api.patch<AdminOrganizationDetail>(`/api/admin/organizations/${id}`, dto),
  users: (params: PageParams & { q: string }): Promise<Page<AdminUserRow>> =>
    api.get<Page<AdminUserRow>>(`/api/admin/users${searchOf(params)}`),
  updateUser: (id: string, dto: { isActive?: boolean; unlock?: boolean }): Promise<AdminUserRow> =>
    api.patch<AdminUserRow>(`/api/admin/users/${id}`, dto),
  resetUserPassword: (id: string): Promise<{ emailDelivered: boolean; resetUrl: string | null }> =>
    api.post<{ emailDelivered: boolean; resetUrl: string | null }>(
      `/api/admin/users/${id}/password-reset`
    ),
  integrations: (): Promise<Integrations> => api.get<Integrations>('/api/admin/integrations'),
  queue: (params: PageParams & { status?: DocumentStatus } = {}): Promise<Page<QueueJob>> =>
    api.get<Page<QueueJob>>(`/api/admin/queue${searchOf(params)}`),
  queueSummary: (): Promise<QueueSummary> => api.get<QueueSummary>('/api/admin/queue/summary'),
  queueState: (): Promise<QueueState> => api.get<QueueState>('/api/admin/queue/state'),
  job: (id: string): Promise<AdminQueueDetail> =>
    api.get<AdminQueueDetail>(`/api/admin/queue/${id}`),
  retryJob: (id: string): Promise<unknown> => api.post(`/api/admin/queue/${id}/retry`),
  saveExtraction: (id: string, payload: ExtractionPayload): Promise<AdminQueueDetail> =>
    api.patch<AdminQueueDetail>(`/api/admin/queue/${id}/extraction`, { payload }),
  mapName: (id: string, rawName: string, ingredientId: string): Promise<AdminQueueDetail> =>
    api.post<AdminQueueDetail>(`/api/admin/queue/${id}/map`, { rawName, ingredientId }),
}
