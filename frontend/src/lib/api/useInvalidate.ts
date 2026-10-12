'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { QueryRoot } from './queries'

const STOCK: QueryRoot[] = [
  'inventory',
  'ingredients',
  'ingredient-locations',
  'waste-ingredients',
  'inventory-transactions',
  'inventory-usage',
  'purchase-recommendations',
  'dashboard-kpis',
]
const COSTS: QueryRoot[] = ['recipes', 'recipe-detail', 'menu-items', 'menus']
const SALES: QueryRoot[] = [
  'sales-daily',
  'sales-individual',
  'revenue-trend',
  'dashboard-kpis',
  'dashboard-trends',
  'dashboard-activity',
  'spend-by-category',
  'food-cost-variance',
  'purchase-recommendations',
]

const AFFECTS = {
  ingredients: [...STOCK, ...COSTS, 'price-history', 'price-trends', 'vendors'],
  stock: STOCK,
  waste: [...STOCK, 'waste-entries', 'waste-breakdown', 'food-cost-variance'],
  recipes: COSTS,
  dishes: COSTS,
  menus: ['menus', 'menu-items'],
  units: ['unit-conversions', ...COSTS],
  categories: ['categories', 'ingredients', 'recipes', 'menu-items'],
  documents: ['documents', 'dashboard-kpis'],
  confirmed: [
    'documents',
    ...STOCK,
    ...COSTS,
    ...SALES,
    'price-history',
    'price-trends',
    'vendors',
    'vendor-spend',
    'vendor-products',
    'invoices',
    'categories',
    'ingredient-aliases',
    'menu-item-aliases',
  ],
  sales: SALES,
  production: ['production'],
  reports: ['waste-breakdown', 'sales-daily', 'food-cost-variance'],
  vendors: ['vendors', 'vendor-products', 'vendor-spend', 'invoices', 'ingredients'],
  'vendor-products': ['vendor-products', 'vendors'],
  'ingredient-aliases': ['ingredient-aliases'],
  'menu-item-aliases': ['menu-item-aliases'],
  purchasing: ['purchase-drafts', 'purchase-draft'],
  locations: ['locations', 'locations-all', 'org-current'],
  team: ['team'],
  organization: ['organization', 'org-current', 'dashboard-kpis'],
  profile: ['org-current'],
  billing: ['billing-plans', 'billing-subscription', 'org-current'],
  'admin-queue': ['admin-queue', 'admin-job', 'admin-queue-state'],
  'admin-organizations': ['admin-organizations', 'admin-organization'],
  'admin-users': ['admin-users', 'admin-organization'],
} satisfies Record<string, QueryRoot[]>

export type Change = keyof typeof AFFECTS

export function useInvalidate() {
  const queryClient = useQueryClient()
  return useCallback(
    async (...changes: Change[]) => {
      const roots = new Set(changes.flatMap((change) => AFFECTS[change]))
      await Promise.all(
        [...roots].map((root) => queryClient.invalidateQueries({ queryKey: [root] }))
      )
    },
    [queryClient]
  )
}
