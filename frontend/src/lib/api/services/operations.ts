import { api } from '../client'
import { periodQuery, searchOf } from './period'
import type {
  ProductionBatch,
  PurchaseDraft,
  PurchaseDraftSummary,
  PurchaseRecommendations,
  SaleRow,
  SalesDailyRow,
  WasteEntry,
  WasteIngredient,
  WasteReason,
  Page,
  PageParams,
  ProductionSummary,
  SaleLinesParams,
} from '../types'

export const salesService = {
  daily: (from?: string, to?: string): Promise<SalesDailyRow[]> =>
    api.get<SalesDailyRow[]>(`/api/sales/daily${periodQuery({ from, to })}`),
  individual: (params: SaleLinesParams = {}): Promise<Page<SaleRow>> =>
    api.get<Page<SaleRow>>(`/api/sales${searchOf(params)}`),
  create: (payload: {
    date?: string
    items: { menuItemId: string; quantity: number }[]
  }): Promise<unknown> => api.post('/api/sales', payload),
}

export const productionService = {
  batches: (
    params: PageParams & { from?: string; to?: string } = {}
  ): Promise<Page<ProductionBatch>> =>
    api.get<Page<ProductionBatch>>(`/api/production${searchOf(params)}`),
  summary: (period?: { from?: string; to?: string }): Promise<ProductionSummary> =>
    api.get<ProductionSummary>(`/api/production/summary${periodQuery(period)}`),
  create: (payload: {
    recipeId: string
    quantity: number
    unit: string
    madeBy?: string
    date?: string
  }): Promise<unknown> => api.post('/api/production', payload),
}

export const wasteService = {
  ingredients: (): Promise<WasteIngredient[]> =>
    api.get<WasteIngredient[]>('/api/waste/ingredients'),
  reasons: (): Promise<WasteReason[]> => api.get<WasteReason[]>('/api/waste/reasons'),
  entries: (params: PageParams & { from?: string; to?: string } = {}): Promise<Page<WasteEntry>> =>
    api.get<Page<WasteEntry>>(`/api/waste${searchOf(params)}`),
  create: (payload: {
    ingredientId: string
    quantity: number
    unit?: string
    reason: string
    date?: string
    notes?: string
  }): Promise<WasteEntry> => api.post<WasteEntry>('/api/waste', payload),
}

export const purchasingService = {
  recommendations: (
    params: { days?: number; horizon?: number } = {}
  ): Promise<PurchaseRecommendations> => {
    const q = new URLSearchParams()
    if (params.days) q.set('days', String(params.days))
    if (params.horizon) q.set('horizon', String(params.horizon))
    const query = q.toString()
    return api.get<PurchaseRecommendations>(
      `/api/purchasing/recommendations${query ? `?${query}` : ''}`
    )
  },
  drafts: (
    params: PageParams & { status?: 'draft' | 'approved' } = {}
  ): Promise<Page<PurchaseDraftSummary>> =>
    api.get<Page<PurchaseDraftSummary>>(`/api/purchasing/drafts${searchOf(params)}`),
  draft: (id: string): Promise<PurchaseDraft> =>
    api.get<PurchaseDraft>(`/api/purchasing/drafts/${id}`),
  createDrafts: (payload: {
    days?: number
    horizon?: number
    note?: string
    lines: { ingredientId: string; quantity: number }[]
  }): Promise<PurchaseDraft[]> => api.post<PurchaseDraft[]>('/api/purchasing/drafts', payload),
  updateDraft: (
    id: string,
    payload: { lines?: { ingredientId: string; quantity: number }[]; note?: string }
  ): Promise<PurchaseDraft> => api.patch<PurchaseDraft>(`/api/purchasing/drafts/${id}`, payload),
  approveDraft: (id: string): Promise<PurchaseDraft> =>
    api.post<PurchaseDraft>(`/api/purchasing/drafts/${id}/approve`),
  deleteDraft: (id: string): Promise<unknown> => api.delete(`/api/purchasing/drafts/${id}`),
}
