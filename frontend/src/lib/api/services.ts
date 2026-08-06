import { api } from './client'
import type {
  ActivityEvent,
  AdminOrganization,
  BillingPlan,
  Category,
  CategoryKind,
  CostByCategoryRow,
  CurrentUser,
  DashboardKpis,
  DashboardTrends,
  DocumentJob,
  Ingredient,
  IngredientPriceHistory,
  InventoryTransaction,
  Invitation,
  InvitationDelivery,
  InvitationPreview,
  Location,
  LocationDetail,
  MenuItem,
  OrderGuideAnalysis,
  OrganizationProfile,
  PrepSuggestion,
  PriceTrendRow,
  ProductionBatch,
  QueueJob,
  Recipe,
  RecipeDetail,
  RecipeRow,
  RevenueTrendRow,
  SaleRow,
  SalesDailyRow,
  SalesSummaryRow,
  SessionUser,
  SpendRow,
  TeamMember,
  UsageRow,
  Vendor,
  WasteBreakdownRow,
  WasteEntry,
  WasteIngredient,
  WasteReason,
} from './types'

export type * from './types'

/* ===== Recipes ===== */

export type RecipeIngredientInput = {
  ingredientId: string
  quantity: number
  unit: string
  prepNote?: string
}

export type RecipeInput = {
  name: string
  description?: string
  portions?: number
  categoryId?: string
  locationId?: string
  targetFoodCostPct?: number
  ingredients?: RecipeIngredientInput[]
}

export const recipesService = {
  list: (): Promise<RecipeRow[]> => api.get<RecipeRow[]>('/api/recipes'),
  get: (id: string): Promise<Recipe> => api.get<Recipe>(`/api/recipes/${id}`),
  create: (payload: RecipeInput): Promise<Recipe> => api.post<Recipe>('/api/recipes', payload),
  update: (id: string, payload: Partial<RecipeInput>): Promise<Recipe> =>
    api.patch<Recipe>(`/api/recipes/${id}`, payload),
  remove: (id: string): Promise<unknown> => api.delete(`/api/recipes/${id}`),
  addComponent: (
    id: string,
    payload: { componentId: string; quantity: number; unit: string; prepNote?: string }
  ): Promise<unknown> => api.post(`/api/recipes/${id}/components`, payload),
  removeComponent: (id: string, componentId: string): Promise<unknown> =>
    api.delete(`/api/recipes/${id}/components/${componentId}`),
}

export const recipeDetailService = {
  get: (id: string): Promise<RecipeDetail> => api.get<RecipeDetail>(`/api/recipes/${id}/detail`),
}

/* ===== Ingredients ===== */

export type IngredientInput = {
  name: string
  unit: string
  costPerUnit: number
  onHand?: number
  reorderLevel?: number
  categoryId?: string
  vendorId?: string
  sku?: string
}

export const ingredientsService = {
  list: (): Promise<Ingredient[]> => api.get<Ingredient[]>('/api/ingredients'),
  create: (payload: IngredientInput): Promise<Ingredient> =>
    api.post<Ingredient>('/api/ingredients', payload),
  update: (id: string, payload: Partial<IngredientInput>): Promise<Ingredient> =>
    api.patch<Ingredient>(`/api/ingredients/${id}`, payload),
  remove: (id: string): Promise<unknown> => api.delete(`/api/ingredients/${id}`),
}

/* ===== Vendors ===== */

export type VendorInput = {
  name: string
  contact?: string
  phone?: string
  status?: 'active' | 'inactive'
  notes?: string
}

export const vendorsService = {
  list: (): Promise<Vendor[]> => api.get<Vendor[]>('/api/vendors'),
  create: (payload: VendorInput): Promise<Vendor> => api.post<Vendor>('/api/vendors', payload),
  update: (id: string, payload: Partial<VendorInput>): Promise<Vendor> =>
    api.patch<Vendor>(`/api/vendors/${id}`, payload),
  remove: (id: string): Promise<unknown> => api.delete(`/api/vendors/${id}`),
}

/* ===== Categories ===== */

export const categoriesService = {
  list: (kind?: CategoryKind): Promise<Category[]> =>
    api.get<Category[]>(`/api/categories${kind ? `?kind=${kind}` : ''}`),
  create: (payload: { name: string; kind?: CategoryKind }): Promise<Category> =>
    api.post<Category>('/api/categories', payload),
  remove: (id: string): Promise<unknown> => api.delete(`/api/categories/${id}`),
}

/* ===== Documents ===== */

export const documentsService = {
  list: (): Promise<DocumentJob[]> => api.get<DocumentJob[]>('/api/documents'),
}

/* ===== Locations ===== */

export type LocationInput = { name: string; address?: string; phone?: string }

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

/* ===== Menu ===== */

export type MenuItemInput = {
  name: string
  price: number
  categoryId?: string
  locationId?: string
  isActive?: boolean
  recipes?: { recipeId: string; portions?: number }[]
}

export const menuService = {
  list: (): Promise<MenuItem[]> => api.get<MenuItem[]>('/api/menu-items'),
  create: (payload: MenuItemInput): Promise<unknown> => api.post('/api/menu-items', payload),
  update: (id: string, payload: Partial<MenuItemInput>): Promise<unknown> =>
    api.patch(`/api/menu-items/${id}`, payload),
  remove: (id: string): Promise<unknown> => api.delete(`/api/menu-items/${id}`),
}

/* ===== Inventory ===== */

export const inventoryService = {
  list: (): Promise<Ingredient[]> => api.get<Ingredient[]>('/api/inventory'),
  transactions: (): Promise<InventoryTransaction[]> =>
    api.get<InventoryTransaction[]>('/api/inventory/transactions'),
  usage: (): Promise<UsageRow[]> => api.get<UsageRow[]>('/api/reports/usage'),
  priceTrends: (): Promise<PriceTrendRow[]> => api.get<PriceTrendRow[]>('/api/reports/price-trends'),
  priceHistory: (ingredientId: string): Promise<IngredientPriceHistory> =>
    api.get<IngredientPriceHistory>(`/api/ingredients/${ingredientId}/price-history`),
  createTransaction: (payload: {
    ingredientId: string
    type: 'RECEIVE' | 'USE' | 'ADJUST' | 'COUNT'
    quantity: number
    cost?: number
    notes?: string
  }): Promise<InventoryTransaction> =>
    api.post<InventoryTransaction>('/api/inventory/transactions', payload),
}

/* ===== Sales ===== */

export const salesService = {
  daily: (): Promise<SalesDailyRow[]> => api.get<SalesDailyRow[]>('/api/sales/daily'),
  individual: (): Promise<SaleRow[]> => api.get<SaleRow[]>('/api/sales'),
  menuItemNames: (): Promise<string[]> => api.get<string[]>('/api/sales/menu-items'),
  rows: (): Promise<SalesSummaryRow[]> => api.get<SalesSummaryRow[]>('/api/sales/summary'),
  create: (payload: {
    date?: string
    items: { menuItemId: string; quantity: number }[]
  }): Promise<unknown> => api.post('/api/sales', payload),
}

/* ===== Production ===== */

export const productionService = {
  batches: (): Promise<ProductionBatch[]> => api.get<ProductionBatch[]>('/api/production'),
  prepSuggestions: (): Promise<PrepSuggestion[]> => api.get<PrepSuggestion[]>('/api/prep-list'),
  create: (payload: {
    recipeId: string
    quantity: number
    unit: string
    madeBy?: string
    date?: string
  }): Promise<unknown> => api.post('/api/production', payload),
}

/* ===== Waste ===== */

export const wasteService = {
  ingredients: (): Promise<WasteIngredient[]> =>
    api.get<WasteIngredient[]>('/api/waste/ingredients'),
  reasons: (): Promise<WasteReason[]> => api.get<WasteReason[]>('/api/waste/reasons'),
  entries: (): Promise<WasteEntry[]> => api.get<WasteEntry[]>('/api/waste'),
  records: (): Promise<WasteEntry[]> => api.get<WasteEntry[]>('/api/waste/records'),
  create: (payload: {
    ingredientId: string
    quantity: number
    reason: string
    notes?: string
  }): Promise<WasteEntry> => api.post<WasteEntry>('/api/waste', payload),
}

/* ===== Analytics ===== */

export const analyticsService = {
  costByCategory: (): Promise<CostByCategoryRow[]> =>
    api.get<CostByCategoryRow[]>('/api/analytics/cost-by-category'),
  wasteBreakdown: (): Promise<WasteBreakdownRow[]> =>
    api.get<WasteBreakdownRow[]>('/api/analytics/waste-breakdown'),
  spendByCategory: (): Promise<SpendRow[]> => api.get<SpendRow[]>('/api/analytics/spend'),
  revenueTrend: (): Promise<RevenueTrendRow[]> =>
    api.get<RevenueTrendRow[]>('/api/analytics/revenue-trend'),
}

/* ===== Dashboard ===== */

export const dashboardService = {
  kpis: (): Promise<DashboardKpis> => api.get<DashboardKpis>('/api/dashboard/kpis'),
  trends: (): Promise<DashboardTrends> => api.get<DashboardTrends>('/api/dashboard/trends'),
  activity: (): Promise<ActivityEvent[]> => api.get<ActivityEvent[]>('/api/dashboard/activity'),
}

/* ===== Team ===== */

export const INVITABLE_ROLES = ['viewer', 'staff', 'manager', 'admin'] as const
export type InvitableRole = (typeof INVITABLE_ROLES)[number]

export const teamService = {
  list: (): Promise<TeamMember[]> => api.get<TeamMember[]>('/api/users'),
  update: (id: string, payload: { role?: InvitableRole; locationIds?: string[] }): Promise<unknown> =>
    api.patch(`/api/users/${id}`, payload),
  deactivate: (id: string): Promise<unknown> => api.delete(`/api/users/${id}`),
}

/* ===== Invitations ===== */

export const invitationsService = {
  list: (): Promise<Invitation[]> => api.get<Invitation[]>('/api/invitations'),
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

/* ===== Authentication ===== */

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
  updateProfile: (payload: { fullName?: string; email?: string }): Promise<unknown> =>
    api.patch('/api/auth/me', payload),
  changePassword: (currentPassword: string, newPassword: string): Promise<unknown> =>
    api.post('/api/auth/change-password', { currentPassword, newPassword }),
}

/* ===== Organization ===== */

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
    }
  },
  profile: (): Promise<OrganizationProfile> =>
    api.get<OrganizationProfile>('/api/organizations/current'),
  updateProfile: (payload: Partial<OrganizationProfile>): Promise<OrganizationProfile> =>
    api.patch<OrganizationProfile>('/api/organizations/current', payload),
}

/* ===== Billing ===== */

export const billingService = {
  plans: (): Promise<BillingPlan[]> => api.get<BillingPlan[]>('/api/billing/plans'),
  trialDaysRemaining: (): Promise<number> => api.get<number>('/api/billing/trial'),
}

/* ===== Platform administration ===== */

export const adminService = {
  organizations: (): Promise<AdminOrganization[]> =>
    api.get<AdminOrganization[]>('/api/admin/organizations'),
  queue: (): Promise<QueueJob[]> => api.get<QueueJob[]>('/api/admin/queue'),
}

export const orderGuideService = {
  analysis: (): Promise<OrderGuideAnalysis> =>
    api.get<OrderGuideAnalysis>('/api/imports/order-guides/analysis'),
}
