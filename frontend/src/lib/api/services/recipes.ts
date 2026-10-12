import { api } from '../client'
import type {
  Menu,
  MenuDetail,
  MenuInput,
  MenuItem,
  MenuItemInput,
  Recipe,
  RecipeDetail,
  RecipeInput,
  RecipeRow,
} from '../types'

export const recipesService = {
  list: (): Promise<RecipeRow[]> => api.get<RecipeRow[]>('/api/recipes'),
  create: (payload: RecipeInput): Promise<Recipe> => api.post<Recipe>('/api/recipes', payload),
  update: (id: string, payload: Partial<RecipeInput>): Promise<Recipe> =>
    api.patch<Recipe>(`/api/recipes/${id}`, payload),
  remove: (id: string): Promise<unknown> => api.delete(`/api/recipes/${id}`),
  addComponent: (
    id: string,
    payload: { componentId: string; quantity: number; unit: string; prepNote?: string }
  ): Promise<unknown> => api.post(`/api/recipes/${id}/components`, payload),
  updateComponent: (
    id: string,
    componentId: string,
    payload: { quantity?: number; unit?: string }
  ): Promise<unknown> => api.patch(`/api/recipes/${id}/components/${componentId}`, payload),
  removeComponent: (id: string, componentId: string): Promise<unknown> =>
    api.delete(`/api/recipes/${id}/components/${componentId}`),
}

export const recipeDetailService = {
  get: (id: string): Promise<RecipeDetail> => api.get<RecipeDetail>(`/api/recipes/${id}/detail`),
}

export const menuService = {
  list: (): Promise<MenuItem[]> => api.get<MenuItem[]>('/api/menu-items'),
  create: (payload: MenuItemInput): Promise<unknown> => api.post('/api/menu-items', payload),
  update: (id: string, payload: Partial<MenuItemInput>): Promise<unknown> =>
    api.patch(`/api/menu-items/${id}`, payload),
  remove: (id: string): Promise<unknown> => api.delete(`/api/menu-items/${id}`),
}

export const menusService = {
  list: (): Promise<Menu[]> => api.get<Menu[]>('/api/menus'),
  get: (id: string): Promise<MenuDetail> => api.get<MenuDetail>(`/api/menus/${id}`),
  availableItems: (id: string): Promise<MenuItem[]> =>
    api.get<MenuItem[]>(`/api/menus/${id}/available-items`),
  create: (payload: MenuInput): Promise<MenuDetail> => api.post<MenuDetail>('/api/menus', payload),
  update: (id: string, payload: Partial<MenuInput>): Promise<MenuDetail> =>
    api.patch<MenuDetail>(`/api/menus/${id}`, payload),
  remove: (id: string): Promise<unknown> => api.delete(`/api/menus/${id}`),
}
