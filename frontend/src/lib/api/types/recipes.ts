export type Recipe = {
  id: string
  name: string
  category: string
  cost: number
  targetFoodCostPct: number | null
  foodCostPct: number | null
  portions: number
  nested: number
  unpriced: number
  location: { id: string; name: string } | null
  updatedAt: string
}

export type RecipeRow = Recipe & {
  description: string
  status: string
  usedIn: number
  yieldAmount: number | null
  yieldUnit: string | null
}

export type RecipeDetail = {
  id: string
  name: string
  category: string
  categoryId: string | null
  locationId: string | null
  location: { id: string; name: string } | null
  description: string
  portions: number
  targetFoodCostPct: number | null
  foodCostPct: number | null
  cost: number
  yieldAmount: number | null
  yieldUnit: string | null
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
    yieldAmount: number | null
    yieldUnit: string | null
    cost: number
    link: string
  }[]
  usedBy: {
    recipes: { id: string; name: string }[]
    dishes: { id: string; name: string }[]
  }
  containedBy: string[]
}

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
  menus: { id: string; name: string }[]
}

export type MenuAnalytics = {
  items: number
  price: number
  cost: number
  margin: number
  marginPct: number | null
  foodCostPct: number | null
  target: number
  overTarget: number
}

export type Menu = {
  id: string
  name: string
  description: string
  isActive: boolean
  locations: { id: string; name: string }[]
  analytics: MenuAnalytics
}

export type MenuDetail = Menu & {
  items: MenuItem[]
}

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
  categoryId?: string | null
  locationId?: string | null
  targetFoodCostPct?: number | null
  yieldAmount?: number | null
  yieldUnit?: string | null
  ingredients?: RecipeIngredientInput[]
}

export type MenuItemInput = {
  name: string
  price: number
  categoryId?: string | null
  locationId?: string | null
  isActive?: boolean
  recipes?: { recipeId: string; portions?: number }[]
  menuIds?: string[]
}

export type MenuInput = {
  name: string
  description?: string
  isActive?: boolean
  locationIds?: string[]
  menuItemIds?: string[]
}
