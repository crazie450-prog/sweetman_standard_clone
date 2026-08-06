import type { DocumentStatus } from '@/components/ui'

/* ===== Recipes ===== */

export type Recipe = {
  id: string
  name: string
  category: string
  cost: number
  targetFoodCostPct: number | null
  foodCostPct: number | null
  portions: number
  nested: number
  updatedAt: string
}

export type RecipeRow = Recipe & {
  status: string
  usedIn: number
}

export type RecipeDetail = {
  id: string
  name: string
  category: string
  categoryId: string | null
  locationId: string | null
  description: string
  portions: number
  targetFoodCostPct: number | null
  foodCostPct: number | null
  cost: number
  ingredients: {
    ingredientId: string
    name: string
    qty: number
    unit: string
    prepNote: string
    cost: number
  }[]
  components: {
    componentId: string
    name: string
    qty: number
    unit: string
    cost: number
    link: string
  }[]
}

/* ===== Ingredients and inventory ===== */

export type Ingredient = {
  id: string
  name: string
  unit: string
  costPerUnit: number
  onHand: number
  reorderLevel: number
  vendor: string
  category: string
  vendorId: string | null
  categoryId: string | null
  sku: string
  status: string
}

export type InventoryTransaction = {
  id: string
  date: string
  type: string
  ingredient: string
  category: string
  quantity: number
  unit: string
  cost: number
  notes: string
}

export type UsageRow = {
  id: string
  period: string
  ingredient: string
  category: string
  used: number
  unit: string
  cost: number
}

export type PriceTrendRow = {
  id: string
  ingredient: string
  vendor: string
  previous: number
  current: number
  change: number
}

export type IngredientPriceHistory = {
  ingredient: { id: string; name: string; unit: string }
  records: {
    id: string
    costPerUnit: number
    source: string
    recordedAt: string
    vendor: string
    vendorId: string | null
    location: string
    locationId: string | null
  }[]
}

/* ===== Vendors ===== */

export type Vendor = {
  id: string
  name: string
  contact: string
  phone: string
  status: string
  notes: string
  products: number
  lastInvoice: string | null
}

/* ===== Categories ===== */

export type CategoryKind = 'ingredient' | 'recipe' | 'menu'

export type Category = {
  id: string
  name: string
  kind: CategoryKind
}

/* ===== Locations ===== */

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
}

/* ===== Menu ===== */

export type MenuItem = {
  id: string
  name: string
  category: string
  categoryId: string | null
  locationId: string | null
  location: string
  recipes: { id: string; name: string; portions: number }[]
  price: number
  cost: number
  active: boolean
}

/* ===== Sales ===== */

export type SalesDailyRow = {
  date: string
  sales: number
  revenue: number
  cost: number
  profit: number
}

export type SaleRow = {
  id: string
  item: string
  qty: number
  price: number
  date: string
}

export type SalesSummaryRow = {
  id: string
  item: string
  qty: number
  gross: number
  period: string
}

/* ===== Production ===== */

export type ProductionBatch = {
  id: string
  recipe: string
  qty: string
  madeBy: string
  date: string
  cost: number
}

export type PrepSuggestion = {
  item: string
  onHand: string
  suggested: string
  reason: string
}

/* ===== Waste ===== */

export type WasteIngredient = {
  id: string
  name: string
  unit: string
  unitCost: number
}

export type WasteReason = {
  value: string
  label: string
}

export type WasteEntry = {
  id: string
  ingredient: string
  qty: number
  unit: string
  reason: string
  date: string
  value: number
}

/* ===== Analytics ===== */

export type CostByCategoryRow = {
  category: string
  cost: number
  pct: number
}

export type WasteBreakdownRow = {
  reason: string
  cost: number
}

export type SpendRow = {
  category: string
  amount: number
}

export type RevenueTrendRow = {
  date: string
  revenue: number
  cost: number
}

/* ===== Dashboard ===== */

export type DashboardKpis = {
  recipes: number
  foodCostPct: number
  foodCostTarget: number
  wasteMonth: number
  marginPct: number
  lowStockCount: number
  pendingDocuments: number
  todayRevenue: number
  todayProfit: number
  recentRecipe: string | null
}

export type DashboardTrends = {
  revenue: number[]
  profit: number[]
  foodCost: number[]
}

export type ActivityEvent = {
  id: string
  type: 'waste' | 'production' | 'recipe' | 'team'
  text: string
  at: string
}

/* ===== Team and invitations ===== */

export type TeamMember = {
  id: string
  name: string
  email: string
  role: string
  status: string
  locations: { id: string; name: string }[]
}

export type Invitation = {
  id: string
  email: string
  role: string
  status: string
  expiresAt: string
  createdAt: string
  invitedBy: { fullName: string } | null
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

/* ===== Session and organization ===== */

export type SessionUser = {
  id: string
  email: string
  fullName: string
  role: string
  organizationId: string
  organizationName: string
  isPlatformAdmin: boolean
  locations: { id: string; name: string }[]
}

export type CurrentUser = {
  name: string
  email: string
  role: string
  roleKey: string
  isPlatformAdmin: boolean
  organization: string
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
  subscriptionStatus: string
  trialEndsAt: string | null
}

/* ===== Billing ===== */

export type BillingPlan = {
  id: string
  name: string
  description: string
  monthlyPrice: number
  features: string[]
  current: boolean
}

/* ===== Platform administration ===== */

export type AdminOrganization = {
  id: string
  name: string
  locations: number
  users: number
  status: string
  trialEndsAt: string | null
  created: string
}

/* ===== Document processing: the queue fills in Sprint 3 ===== */

export type DocumentJob = {
  id: string
  file: string
  type: 'Invoice' | 'Recipe' | 'Menu' | 'Sales'
  vendor?: string
  uploadedAt: string
  status: DocumentStatus
}

export type QueueJob = {
  id: string
  file: string
  organization: string
  location: string
  type: string
  duration: string
  status: DocumentStatus
  error?: string
}

export type OrderGuideAnalysis = {
  sheets: { name: string; rows: number }[]
  detectedVendors: { detected: string; sheet: string }[]
  existingVendors: { value: string; label: string }[]
  products: { name: string; unit: string; price: string }[]
}
