import type { DocumentStatus } from '@/components/ui'

export type DocumentType = 'invoice' | 'recipe' | 'menu' | 'sales'

export type DocumentJob = {
  id: string
  file: string
  type: DocumentType
  vendor?: string | null
  uploadedAt: string
  status: DocumentStatus
  error?: string | null
  part?: { index: number; of: number; group: string } | null
}

export type ConfirmResult = { id: string; status?: DocumentStatus; error?: string }

export type ConfirmSummary = {
  id: string
  status: DocumentStatus
  applied?: number
  unmapped?: number
  unconverted?: number
  credits?: number
  added?: number
  vendorUnmatched?: number
}

export type SubRecipe = {
  name: string
  portions?: number
  yieldQty?: number
  yieldUnit?: string
  items: { rawName: string; quantity: number; unit: string; quantityText?: string }[]
}

export type ExtractionPayload =
  | {
      kind: 'invoice'
      vendorName?: string
      number?: string
      invoiceDate?: string
      items: {
        rawName: string
        sku?: string
        quantity: number
        unit: string
        unitPrice: number
        lineTotal?: number
      }[]
    }
  | {
      kind: 'sales'
      date?: string
      items: { menuItemName: string; quantity: number; unitPrice: number }[]
    }
  | ({ kind: 'recipe'; subRecipes?: SubRecipe[] } & SubRecipe)
  | { kind: 'menu'; name: string; items: { name: string; price: number; section?: string }[] }

export type DocumentDetail = {
  id: string
  file: string
  type: DocumentType
  status: DocumentStatus
  error: string | null
  uploadedAt: string
  extraction: ExtractionPayload | null
  unresolved: { rawName: string; lines: number }[]
  unconverted: MissingConversion[]
  priceJumps: PriceJump[]
  siblings: { id: string; file: string; status: DocumentStatus }[]
}

export type DocumentsSummary = Record<DocumentStatus, number> & { total: number; reading: number }

export type IngredientAlias = {
  id: string
  rawName: string
  ingredientId: string | null
  ingredientName: string | null
  lines: number
}

export type MenuItemAlias = {
  id: string
  rawName: string
  menuItemId: string | null
  menuItemName: string | null
  locationId: string | null
  locationName: string | null
}

export type FileUnitsRow = {
  key: string
  name: string
  ingredientId: string | null
  unit: string
  unitDimension: string | null
  choices: string[]
  units: { unit: string; dimension: string | null; lines: number; reaches: boolean }[]
}

export type FileUnitsInput = {
  ingredients: { name: string; unit: string }[]
  conversions: { ingredientId?: string; name?: string; fromUnit: string; factor: number }[]
}

export type ReviewIssue = {
  severity: 'error' | 'warning'
  code: string
  message: string
  part?: number | null
  line?: number
  field?: string
}

export type PriceJump = {
  line?: number
  rawName: string
  ingredient: string
  stated: number
  now: number
  unit: string
}

export type MissingConversion = {
  rawName: string
  ingredientId: string
  ingredient: string
  from: string
  to: string
}
