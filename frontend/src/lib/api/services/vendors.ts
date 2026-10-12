import { api } from '../client'
import type {
  Invoice,
  Page,
  PageParams,
  Vendor,
  VendorInput,
  VendorProduct,
  VendorProductInput,
  VendorSpendPoint,
} from '../types'
import { searchOf } from './period'

export const vendorsService = {
  list: (): Promise<Vendor[]> => api.get<Vendor[]>('/api/vendors'),
  create: (payload: VendorInput): Promise<Vendor> => api.post<Vendor>('/api/vendors', payload),
  update: (id: string, payload: Partial<VendorInput>): Promise<Vendor> =>
    api.patch<Vendor>(`/api/vendors/${id}`, payload),
  remove: (id: string): Promise<unknown> => api.delete(`/api/vendors/${id}`),
  spend: (): Promise<VendorSpendPoint[]> => api.get<VendorSpendPoint[]>('/api/vendors/spend'),
}

export const invoicesService = {
  list: (params: PageParams & { vendorId?: string } = {}): Promise<Page<Invoice>> =>
    api.get<Page<Invoice>>(`/api/invoices${searchOf(params)}`),
}

export const vendorProductsService = {
  list: (vendorId?: string): Promise<VendorProduct[]> =>
    api.get<VendorProduct[]>(`/api/vendor-products${vendorId ? `?vendorId=${vendorId}` : ''}`),
  create: (payload: VendorProductInput): Promise<VendorProduct> =>
    api.post<VendorProduct>('/api/vendor-products', payload),
  update: (id: string, payload: Partial<VendorProductInput>): Promise<VendorProduct> =>
    api.patch<VendorProduct>(`/api/vendor-products/${id}`, payload),
  remove: (id: string): Promise<unknown> => api.delete(`/api/vendor-products/${id}`),
}
