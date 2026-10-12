import { api } from '../client'
import type { DocumentStatus } from '@/components/ui'
import type {
  ConfirmResult,
  ConfirmSummary,
  DocumentDetail,
  DocumentJob,
  DocumentsSummary,
  DocumentType,
  ExtractionPayload,
  FileUnitsInput,
  FileUnitsRow,
  IngredientAlias,
  MenuItemAlias,
  Page,
  PageParams,
  ReviewIssue,
} from '../types'
import { searchOf } from './period'

export const DOCUMENT_FORMATS = [
  'PDF',
  'JPG',
  'PNG',
  'WEBP',
  'AVIF',
  'XLSX',
  'DOC',
  'DOCX',
  'CSV',
  'JSON',
]

export const documentsService = {
  list: (
    params: PageParams & { type?: DocumentType; status?: DocumentStatus } = {}
  ): Promise<Page<DocumentJob>> => api.get<Page<DocumentJob>>(`/api/documents${searchOf(params)}`),
  summary: (type?: DocumentType): Promise<DocumentsSummary> =>
    api.get<DocumentsSummary>(`/api/documents/summary${searchOf({ type })}`),
  detail: (id: string): Promise<DocumentDetail> => api.get<DocumentDetail>(`/api/documents/${id}`),
  upload: (file: File, type: DocumentType): Promise<{ id: string; status: string }> => {
    const form = new FormData()
    form.append('file', file)
    form.append('type', type)
    return api.postForm('/api/documents', form)
  },
  confirm: (
    id: string,
    payload?: ExtractionPayload,
    createMissing = false
  ): Promise<ConfirmSummary> =>
    api.post(`/api/documents/${id}/confirm`, { ...(payload ? { payload } : {}), createMissing }),
  check: (
    id: string,
    payload: ExtractionPayload,
    createMissing = false
  ): Promise<{ issues: ReviewIssue[] }> =>
    api.post(`/api/documents/${id}/check`, { payload, createMissing }),
  fileUnits: (id: string): Promise<{ ingredients: FileUnitsRow[] }> =>
    api.get(`/api/documents/${id}/file-units`),
  saveFileUnits: (id: string, body: FileUnitsInput): Promise<{ added: number; recorded: number }> =>
    api.post(`/api/documents/${id}/file-units`, body),
  confirmMany: (
    ids: string[],
    createMissing = false,
    edited?: { id: string; payload: ExtractionPayload }
  ): Promise<{ results: ConfirmResult[] }> =>
    api.post('/api/documents/confirm-many', { ids, createMissing, ...(edited ? { edited } : {}) }),
  retry: (id: string): Promise<{ id: string; status: string }> =>
    api.post(`/api/documents/${id}/retry`),
  mapName: (id: string, rawName: string, ingredientId: string): Promise<DocumentDetail> =>
    api.post<DocumentDetail>(`/api/documents/${id}/map`, { rawName, ingredientId }),
  remove: (id: string): Promise<{ id: string; deleted: boolean }> =>
    api.delete(`/api/documents/${id}`),
  aliases: (): Promise<IngredientAlias[]> =>
    api.get<IngredientAlias[]>('/api/documents/ingredient-aliases'),
  createAlias: (rawName: string, ingredientId?: string): Promise<IngredientAlias> =>
    api.post<IngredientAlias>('/api/documents/ingredient-aliases', { rawName, ingredientId }),
  mapAlias: (id: string, ingredientId: string | null): Promise<unknown> =>
    api.post(`/api/documents/ingredient-aliases/${id}`, { ingredientId }),
  removeAlias: (id: string): Promise<unknown> =>
    api.delete(`/api/documents/ingredient-aliases/${id}`),
  menuAliases: (): Promise<MenuItemAlias[]> =>
    api.get<MenuItemAlias[]>('/api/documents/menu-item-aliases'),
  createMenuAlias: (rawName: string, menuItemId?: string): Promise<MenuItemAlias> =>
    api.post<MenuItemAlias>('/api/documents/menu-item-aliases', { rawName, menuItemId }),
  mapMenuAlias: (id: string, menuItemId: string | null): Promise<unknown> =>
    api.post(`/api/documents/menu-item-aliases/${id}`, { menuItemId }),
  removeMenuAlias: (id: string): Promise<unknown> =>
    api.delete(`/api/documents/menu-item-aliases/${id}`),
}
