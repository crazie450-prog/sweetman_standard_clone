export type Page<T> = {
  data: T[]
  pagination: { limit: number; offset: number; total: number }
}

export type PageParams = { limit?: number; offset?: number }
