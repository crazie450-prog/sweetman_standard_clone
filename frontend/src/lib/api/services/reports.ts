import { api } from '../client'
import type {
  ActivityEvent,
  DashboardKpis,
  DashboardTrends,
  FoodCostVariance,
  RevenueTrendRow,
  SpendRow,
  WasteBreakdownRow,
} from '../types'

export const analyticsService = {
  wasteBreakdown: (from?: string, to?: string): Promise<WasteBreakdownRow[]> => {
    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    const suffix = q.toString() ? `?${q.toString()}` : ''
    return api.get<WasteBreakdownRow[]>(`/api/analytics/waste-breakdown${suffix}`)
  },
  spendByCategory: (): Promise<SpendRow[]> => api.get<SpendRow[]>('/api/analytics/spend'),
  revenueTrend: (): Promise<RevenueTrendRow[]> =>
    api.get<RevenueTrendRow[]>('/api/analytics/revenue-trend'),
  foodCostVariance: (from?: string, to?: string): Promise<FoodCostVariance> => {
    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    const suffix = q.toString() ? `?${q.toString()}` : ''
    return api.get<FoodCostVariance>(`/api/analytics/food-cost-variance${suffix}`)
  },
}

export const dashboardService = {
  kpis: (): Promise<DashboardKpis> => api.get<DashboardKpis>('/api/dashboard/kpis'),
  trends: (): Promise<DashboardTrends> => api.get<DashboardTrends>('/api/dashboard/trends'),
  activity: (): Promise<ActivityEvent[]> => api.get<ActivityEvent[]>('/api/dashboard/activity'),
}
