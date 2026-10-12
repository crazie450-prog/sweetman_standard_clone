export type Ingredient = {
  id: string
  name: string
  unit: string
  costPerUnit: number
  onHand: number
  sharedCostPerUnit: number
  reorderLevel: number
  vendor: string
  category: string
  vendorId: string | null
  categoryId: string | null
  sku: string
  vendorSku: string
  locations: number
  vendors: number
  costLow: number | null
  costHigh: number | null
  status: string
  isActive: boolean
  lowAt: string[]
  value: number
}

export type IngredientLocationRow = {
  locationId: string
  location: string
  vendor: string
  vendorId: string | null
  vendorSku: string
  costPerUnit: number
  reorderLevel: number
  onHand: number
  ownSettings: boolean
}

export type IngredientLocations = {
  shared: {
    id: string
    name: string
    unit: string
    category: string
    categoryId: string | null
    sku: string
    costPerUnit: number
    reorderLevel: number
    vendor: string
    vendorId: string | null
  }
  locations: IngredientLocationRow[]
  totals: {
    locations: number
    vendors: number
    onHand: number
    costLow: number | null
    costHigh: number | null
  }
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
  pagination: { limit: number; offset: number; total: number }
  data: {
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

export type CategoryKind = 'ingredient' | 'recipe' | 'menu'

export type Category = {
  id: string
  name: string
  kind: CategoryKind
  used: number
}

export type UnitDescriptor = {
  value: string
  label: string
  dimension: string
  perBase: number
}

export type UnitConversion = {
  id: string
  ingredientId: string | null
  ingredient: string
  recipeId: string | null
  recipe: string
  fromUnit: string
  toUnit: string
  factor: number
}

export type UnitConversionInput = {
  ingredientId?: string
  recipeId?: string
  fromUnit: string
  toUnit: string
  factor: number
}

export type IngredientInput = {
  name: string
  unit: string
  costPerUnit: number
  onHand?: number
  reorderLevel?: number
  categoryId?: string | null
  vendorId?: string | null
  sku?: string
  vendorSku?: string
  isActive?: boolean
}

export type TransactionKind = 'received' | 'used' | 'wasted' | 'counted'

export type TransactionsSummary = {
  received: number
  used: number
  wasted: number
  counted: number
  net: number
  movements: number
}
