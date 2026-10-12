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

export type FoodCostVariance = {
  from: string
  to: string
  theoreticalCost: number
  actualCost: number
  variance: number
  variancePct: number | null
  wasteCost: number
  byCategory: { category: string; theoretical: number; actual: number; variance: number }[]
  byDish: {
    menuItemId: string
    name: string
    quantity: number
    standardCost: number
    actualCost: number
    wasteCost: number
    variance: number
  }[]
}
