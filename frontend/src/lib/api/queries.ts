import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import type { DocumentStatus } from '@/components/ui'
import {
  adminService,
  analyticsService,
  billingService,
  categoriesService,
  dashboardService,
  documentsService,
  ingredientsService,
  inventoryService,
  invitationsService,
  invoicesService,
  locationsService,
  menuService,
  menusService,
  organizationService,
  productionService,
  purchasingService,
  recipeDetailService,
  recipesService,
  salesService,
  teamService,
  unitConversionsService,
  unitsService,
  vendorProductsService,
  vendorsService,
  wasteService,
} from './services'
import type {
  CategoryKind,
  DocumentType,
  PageParams,
  SaleLinesParams,
  TransactionKind,
} from './types'

type Period = { from?: string; to?: string }

export const queries = {
  /* ===== Account and organization ===== */
  orgCurrent: () =>
    queryOptions({ queryKey: ['org-current'] as const, queryFn: organizationService.current }),
  organization: () =>
    queryOptions({ queryKey: ['organization'] as const, queryFn: organizationService.profile }),
  locations: () =>
    queryOptions({ queryKey: ['locations'] as const, queryFn: locationsService.list }),
  locationsAll: () =>
    queryOptions({ queryKey: ['locations-all'] as const, queryFn: locationsService.listAll }),
  team: () => queryOptions({ queryKey: ['team'] as const, queryFn: teamService.list }),
  invitation: (token: string) =>
    queryOptions({
      queryKey: ['invitation', token] as const,
      queryFn: () => invitationsService.preview(token),
    }),

  /* ===== Billing ===== */
  billingPlans: () =>
    queryOptions({ queryKey: ['billing-plans'] as const, queryFn: billingService.plans }),
  billingTrial: () =>
    queryOptions({
      queryKey: ['billing-trial'] as const,
      queryFn: billingService.trialDaysRemaining,
    }),
  billingSubscription: () =>
    queryOptions({
      queryKey: ['billing-subscription'] as const,
      queryFn: billingService.subscription,
    }),

  /* ===== Dashboard and analytics ===== */
  dashboardKpis: () =>
    queryOptions({ queryKey: ['dashboard-kpis'] as const, queryFn: dashboardService.kpis }),
  dashboardTrends: () =>
    queryOptions({ queryKey: ['dashboard-trends'] as const, queryFn: dashboardService.trends }),
  dashboardActivity: () =>
    queryOptions({
      queryKey: ['dashboard-activity'] as const,
      queryFn: dashboardService.activity,
    }),
  revenueTrend: () =>
    queryOptions({ queryKey: ['revenue-trend'] as const, queryFn: analyticsService.revenueTrend }),
  spendByCategory: () =>
    queryOptions({
      queryKey: ['spend-by-category'] as const,
      queryFn: analyticsService.spendByCategory,
    }),
  foodCostVariance: (from?: string, to?: string) =>
    queryOptions({
      queryKey: ['food-cost-variance', from, to] as const,
      queryFn: () => analyticsService.foodCostVariance(from, to),
    }),
  wasteBreakdown: (from?: string, to?: string) =>
    queryOptions({
      queryKey: ['waste-breakdown', from, to] as const,
      queryFn: () => analyticsService.wasteBreakdown(from, to),
    }),

  /* ===== Catalogue ===== */
  ingredients: () =>
    queryOptions({ queryKey: ['ingredients'] as const, queryFn: () => ingredientsService.list() }),
  ingredientsWithArchived: () =>
    queryOptions({
      queryKey: ['ingredients', 'with-archived'] as const,
      queryFn: () => ingredientsService.list(true),
    }),
  ingredientLocations: (id: string) =>
    queryOptions({
      queryKey: ['ingredient-locations', id] as const,
      queryFn: () => ingredientsService.atLocations(id),
    }),
  priceHistory: (ingredientId: string, page: PageParams = {}) =>
    queryOptions({
      queryKey: ['price-history', ingredientId, page.offset, page.limit] as const,
      queryFn: () => inventoryService.priceHistory(ingredientId, page),
      placeholderData: keepPreviousData,
    }),
  priceTrends: () =>
    queryOptions({ queryKey: ['price-trends'] as const, queryFn: inventoryService.priceTrends }),
  categories: (kind: CategoryKind) =>
    queryOptions({
      queryKey: ['categories', kind] as const,
      queryFn: () => categoriesService.list(kind),
    }),
  units: () =>
    queryOptions({ queryKey: ['units'] as const, queryFn: unitsService.list, staleTime: Infinity }),
  unitConversions: () =>
    queryOptions({
      queryKey: ['unit-conversions'] as const,
      queryFn: unitConversionsService.list,
    }),
  ingredientAliases: () =>
    queryOptions({
      queryKey: ['ingredient-aliases'] as const,
      queryFn: documentsService.aliases,
    }),
  menuItemAliases: () =>
    queryOptions({
      queryKey: ['menu-item-aliases'] as const,
      queryFn: documentsService.menuAliases,
    }),

  /* ===== Vendors ===== */
  vendors: () => queryOptions({ queryKey: ['vendors'] as const, queryFn: vendorsService.list }),
  vendorSpend: () =>
    queryOptions({ queryKey: ['vendor-spend'] as const, queryFn: vendorsService.spend }),
  vendorProducts: () =>
    queryOptions({
      queryKey: ['vendor-products'] as const,
      queryFn: () => vendorProductsService.list(),
    }),
  invoices: (vendorId: string, page: PageParams = {}) =>
    queryOptions({
      queryKey: ['invoices', vendorId, page.offset, page.limit] as const,
      queryFn: () => invoicesService.list({ vendorId, ...page }),
      placeholderData: keepPreviousData,
    }),

  /* ===== Inventory ===== */
  inventory: () =>
    queryOptions({ queryKey: ['inventory'] as const, queryFn: inventoryService.list }),
  inventoryTransactions: (params: Period & PageParams & { type?: TransactionKind }) =>
    queryOptions({
      queryKey: [
        'inventory-transactions',
        'page',
        params.from,
        params.to,
        params.type,
        params.offset,
        params.limit,
      ] as const,
      queryFn: () => inventoryService.transactions(params),
      placeholderData: keepPreviousData,
    }),
  inventoryTransactionsSummary: (period: Period) =>
    queryOptions({
      queryKey: ['inventory-transactions', 'summary', period.from, period.to] as const,
      queryFn: () => inventoryService.transactionsSummary(period),
    }),
  inventoryUsage: (period: Period) =>
    queryOptions({
      queryKey: ['inventory-usage', period.from, period.to] as const,
      queryFn: () => inventoryService.usage(period),
    }),
  wasteIngredients: () =>
    queryOptions({ queryKey: ['waste-ingredients'] as const, queryFn: wasteService.ingredients }),
  wasteReasons: () =>
    queryOptions({ queryKey: ['waste-reasons'] as const, queryFn: wasteService.reasons }),
  wasteEntries: (page: PageParams = {}) =>
    queryOptions({
      queryKey: ['waste-entries', page.offset, page.limit] as const,
      queryFn: () => wasteService.entries(page),
      placeholderData: keepPreviousData,
    }),
  production: (params: Period & PageParams = {}) =>
    queryOptions({
      queryKey: [
        'production',
        'page',
        params.from,
        params.to,
        params.offset,
        params.limit,
      ] as const,
      queryFn: () => productionService.batches(params),
      placeholderData: keepPreviousData,
    }),
  productionSummary: (period: Period = {}) =>
    queryOptions({
      queryKey: ['production', 'summary', period.from, period.to] as const,
      queryFn: () => productionService.summary(period),
    }),

  /* ===== Recipes and menu ===== */
  recipes: () => queryOptions({ queryKey: ['recipes'] as const, queryFn: recipesService.list }),
  recipeDetail: (id: string) =>
    queryOptions({
      queryKey: ['recipe-detail', id] as const,
      queryFn: () => recipeDetailService.get(id),
    }),
  menuItems: () => queryOptions({ queryKey: ['menu-items'] as const, queryFn: menuService.list }),
  menus: () => queryOptions({ queryKey: ['menus'] as const, queryFn: menusService.list }),
  menu: (id: string) =>
    queryOptions({ queryKey: ['menus', id] as const, queryFn: () => menusService.get(id) }),
  menuAvailableItems: (id: string) =>
    queryOptions({
      queryKey: ['menus', id, 'available-items'] as const,
      queryFn: () => menusService.availableItems(id),
    }),

  /* ===== Sales ===== */
  salesDaily: (from?: string, to?: string) =>
    queryOptions({
      queryKey: ['sales-daily', from, to] as const,
      queryFn: () => salesService.daily(from, to),
    }),
  salesIndividual: (params: SaleLinesParams) =>
    queryOptions({
      queryKey: [
        'sales-individual',
        params.from,
        params.to,
        params.sort,
        params.dir,
        params.minTotal,
        params.maxTotal,
        params.offset,
        params.limit,
      ] as const,
      queryFn: () => salesService.individual(params),
      placeholderData: keepPreviousData,
    }),

  /* ===== Documents ===== */
  documents: (params: PageParams & { type?: DocumentType; status?: DocumentStatus } = {}) =>
    queryOptions({
      queryKey: [
        'documents',
        'page',
        params.type,
        params.status,
        params.offset,
        params.limit,
      ] as const,
      queryFn: () => documentsService.list(params),
      placeholderData: keepPreviousData,
    }),
  documentsSummary: (type?: DocumentType) =>
    queryOptions({
      queryKey: ['documents', 'summary', type] as const,
      queryFn: () => documentsService.summary(type),
    }),
  document: (id: string) =>
    queryOptions({
      queryKey: ['document', id] as const,
      queryFn: () => documentsService.detail(id),
    }),

  /* ===== Purchasing ===== */
  purchaseRecommendations: (params: { days: number; horizon: number }) =>
    queryOptions({
      queryKey: ['purchase-recommendations', params.days, params.horizon] as const,
      queryFn: () => purchasingService.recommendations(params),
    }),
  purchaseDrafts: (page: PageParams = {}) =>
    queryOptions({
      queryKey: ['purchase-drafts', page.offset, page.limit] as const,
      queryFn: () => purchasingService.drafts(page),
      placeholderData: keepPreviousData,
    }),
  purchaseDraft: (id: string) =>
    queryOptions({
      queryKey: ['purchase-draft', id] as const,
      queryFn: () => purchasingService.draft(id),
    }),

  /* ===== Platform administration ===== */
  adminOrganizations: (filter: PageParams & { status?: string; q?: string }) =>
    queryOptions({
      queryKey: [
        'admin-organizations',
        filter.status,
        filter.q,
        filter.offset,
        filter.limit,
      ] as const,
      queryFn: () => adminService.organizations(filter),
      placeholderData: keepPreviousData,
    }),
  adminOrganization: (id: string) =>
    queryOptions({
      queryKey: ['admin-organization', id] as const,
      queryFn: () => adminService.organization(id),
    }),
  adminUsers: (q: string, page: PageParams = {}) =>
    queryOptions({
      queryKey: ['admin-users', q, page.offset, page.limit] as const,
      queryFn: () => adminService.users({ q, ...page }),
      placeholderData: keepPreviousData,
    }),
  adminQueue: (params: PageParams & { status?: DocumentStatus } = {}) =>
    queryOptions({
      queryKey: ['admin-queue', 'page', params.status, params.offset, params.limit] as const,
      queryFn: () => adminService.queue(params),
      placeholderData: keepPreviousData,
    }),
  adminQueueSummary: () =>
    queryOptions({
      queryKey: ['admin-queue', 'summary'] as const,
      queryFn: adminService.queueSummary,
    }),
  adminQueueState: () =>
    queryOptions({ queryKey: ['admin-queue-state'] as const, queryFn: adminService.queueState }),
  adminJob: (id: string) =>
    queryOptions({ queryKey: ['admin-job', id] as const, queryFn: () => adminService.job(id) }),
  adminIntegrations: () =>
    queryOptions({
      queryKey: ['admin-integrations'] as const,
      queryFn: adminService.integrations,
    }),
}

export type QueryRoot = ReturnType<(typeof queries)[keyof typeof queries]>['queryKey'][0]
