import { api } from '../client'
import { periodQuery, searchOf } from './period'
import type {
  Category,
  CategoryKind,
  Ingredient,
  IngredientInput,
  IngredientLocations,
  IngredientPriceHistory,
  InventoryTransaction,
  Page,
  PageParams,
  PriceTrendRow,
  TransactionKind,
  TransactionsSummary,
  UnitConversion,
  UnitConversionInput,
  UnitDescriptor,
  UsageRow,
} from '../types'

export const ingredientsService = {
  list: (includeArchived = false): Promise<Ingredient[]> =>
    api.get<Ingredient[]>(`/api/ingredients${includeArchived ? '?includeArchived=true' : ''}`),
  atLocations: (id: string): Promise<IngredientLocations> =>
    api.get<IngredientLocations>(`/api/ingredients/${id}/locations`),
  create: (payload: IngredientInput): Promise<Ingredient> =>
    api.post<Ingredient>('/api/ingredients', payload),
  update: (
    id: string,
    payload: Partial<IngredientInput>
  ): Promise<Ingredient & { relabelled?: string[] }> =>
    api.patch<Ingredient>(`/api/ingredients/${id}`, payload),
  remove: (id: string): Promise<unknown> => api.delete(`/api/ingredients/${id}`),
}

export const unitsService = {
  list: (): Promise<UnitDescriptor[]> => api.get<UnitDescriptor[]>('/api/units'),
}

export const unitConversionsService = {
  list: (): Promise<UnitConversion[]> => api.get<UnitConversion[]>('/api/unit-conversions'),
  create: (payload: UnitConversionInput): Promise<{ id: string }> =>
    api.post<{ id: string }>('/api/unit-conversions', payload),
  update: (
    id: string,
    payload: Omit<Partial<UnitConversionInput>, 'ingredientId'> & { ingredientId?: string | null }
  ): Promise<UnitConversion> => api.patch<UnitConversion>(`/api/unit-conversions/${id}`, payload),
  remove: (id: string): Promise<unknown> => api.delete(`/api/unit-conversions/${id}`),
}

export const categoriesService = {
  list: (kind?: CategoryKind): Promise<Category[]> =>
    api.get<Category[]>(`/api/categories${kind ? `?kind=${kind}` : ''}`),
  create: (payload: { name: string; kind?: CategoryKind }): Promise<Category> =>
    api.post<Category>('/api/categories', payload),
  rename: (id: string, name: string): Promise<Category> =>
    api.patch<Category>(`/api/categories/${id}`, { name }),
  remove: (id: string): Promise<unknown> => api.delete(`/api/categories/${id}`),
}

export const inventoryService = {
  list: (): Promise<Ingredient[]> => api.get<Ingredient[]>('/api/inventory'),
  transactions: (
    params: PageParams & { from?: string; to?: string; type?: TransactionKind } = {}
  ): Promise<Page<InventoryTransaction>> =>
    api.get<Page<InventoryTransaction>>(`/api/inventory/transactions${searchOf(params)}`),
  transactionsSummary: (period?: { from?: string; to?: string }): Promise<TransactionsSummary> =>
    api.get<TransactionsSummary>(`/api/inventory/transactions/summary${periodQuery(period)}`),
  usage: (period?: { from?: string; to?: string }): Promise<UsageRow[]> =>
    api.get<UsageRow[]>(`/api/reports/usage${periodQuery(period)}`),
  priceTrends: (): Promise<PriceTrendRow[]> =>
    api.get<PriceTrendRow[]>('/api/reports/price-trends'),
  priceHistory: (ingredientId: string, params: PageParams = {}): Promise<IngredientPriceHistory> =>
    api.get<IngredientPriceHistory>(
      `/api/ingredients/${ingredientId}/price-history${searchOf(params)}`
    ),
  createTransaction: (payload: {
    ingredientId: string
    type: 'RECEIVE' | 'USE' | 'ADJUST' | 'COUNT'
    quantity: number
    cost?: number
    notes?: string
  }): Promise<InventoryTransaction> =>
    api.post<InventoryTransaction>('/api/inventory/transactions', payload),
}
