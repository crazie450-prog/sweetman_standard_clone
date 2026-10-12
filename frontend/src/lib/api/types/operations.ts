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

export type ProductionBatch = {
  id: string
  recipe: string
  qty: string
  madeBy: string
  date: string
  cost: number
}

export type PurchaseRecommendation = {
  ingredientId: string
  name: string
  category: string
  unit: string
  onHand: number
  reorderLevel: number
  salesQty: number
  useQty: number
  wasteQty: number
  receivedQty: number
  basis: 'sales' | 'usage' | 'waste' | 'receipts' | 'none'
  dailyRate: number
  coverDays: number | null
  suggested: number
  vendorId: string | null
  vendorName: string | null
  unitPrice: number
  estimatedCost: number
}

export type PurchaseRecommendations = {
  days: number
  horizon: number
  from: string
  to: string
  examined: number
  rows: PurchaseRecommendation[]
}

export type PurchaseDraftLine = {
  id: string
  ingredientId: string
  name: string
  unit: string
  quantity: number
  unitPrice: number | null
  lineTotal: number | null
  suggested: number
  onHand: number
}

export type PurchaseDraftSummary = {
  id: string
  status: 'draft' | 'approved'
  vendorId: string | null
  vendorName: string | null
  note: string
  days: number
  horizon: number
  lines: number
  total: number
  created: string
  approvedAt: string | null
}

export type PurchaseDraft = Omit<PurchaseDraftSummary, 'lines'> & { lines: PurchaseDraftLine[] }

export type WasteIngredient = {
  id: string
  name: string
  unit: string
  isActive: boolean
  unitCost: number
  onHand: number
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

export type ProductionSummary = {
  batches: number
  cost: number
  average: number
  recipes: number
}

export type SaleLinesParams = {
  limit?: number
  offset?: number
  from?: string
  to?: string
  sort?: 'date' | 'total'
  dir?: 'asc' | 'desc'
  minTotal?: number
  maxTotal?: number
}
