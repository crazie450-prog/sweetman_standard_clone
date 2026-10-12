export type Vendor = {
  id: string
  name: string
  contact: string
  phone: string
  status: string
  notes: string
  products: number
  ingredients: number
  lastInvoice: string | null
  spend30: number
}

export type InvoiceLine = {
  id: string
  ingredientId: string | null
  ingredient: string
  description: string
  quantity: number
  unit: string
  unitPrice: number
  lineTotal: number
}

export type Invoice = {
  id: string
  number: string
  vendorId: string | null
  vendor: string
  locationId: string | null
  invoiceDate: string
  dueDate: string | null
  status: 'draft' | 'confirmed'
  subtotal: number
  tax: number
  total: number
  documentKey: string | null
  notes: string
  items: InvoiceLine[]
}

export type VendorSpendPoint = {
  period: string
  total: number
}

export type VendorProduct = {
  id: string
  name: string
  sku: string
  isActive: boolean
  vendorId: string
  vendorName: string
  ingredientId: string | null
  ingredientName: string | null
  ingredientUnit: string | null
  lastPrice: number | null
  lastReceived: string | null
}

export type VendorProductInput = {
  name: string
  vendorId: string
  sku?: string
  ingredientId?: string | null
  isActive?: boolean
}

export type VendorInput = {
  name: string
  contact?: string | null
  phone?: string | null
  status?: 'active' | 'inactive'
  notes?: string | null
}
