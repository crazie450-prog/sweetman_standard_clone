import { getActiveLocationId, setActiveLocationId } from './active-location'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export type ErrorDetail = { field: string; message: string }

export type ErrorEnvelope = {
  error: { code: string; message: string; details?: ErrorDetail[] }
}

export function errorOf(body: unknown): ErrorEnvelope['error'] | undefined {
  const error = (body as Partial<ErrorEnvelope> | undefined)?.error
  return error && typeof error.code === 'string' ? error : undefined
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown
  ) {
    super(message)
  }

  get code(): string | undefined {
    return errorOf(this.body)?.code
  }
}

const OUT_OF_REACH = new Set(['LOCATION_NOT_REACHED', 'LOCATION_UNKNOWN'])

let refreshing: Promise<boolean> | null = null

function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${API_URL}/api/auth/refresh`, { credentials: 'include' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  retried = false
): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const headers: Record<string, string> = {}
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  const locationId = getActiveLocationId()
  if (locationId) headers['X-Location-Id'] = locationId

  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  })

  const isAuthCall = path.startsWith('/api/auth/')

  if (res.status === 401 && !retried && !isAuthCall && (await refreshSession())) {
    return request<T>(method, path, body, true)
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => undefined)
    const code = errorOf(errBody)?.code
    if (res.status === 403 && locationId && code && OUT_OF_REACH.has(code)) {
      if (getActiveLocationId() === locationId) setActiveLocationId('')
      return request<T>(method, path, body, retried)
    }
    if (res.status === 401 && !isAuthCall && typeof window !== 'undefined') {
      window.location.href = '/login'
    }
    throw new ApiError(res.status, `${method} ${path} → ${res.status}`, errBody)
  }

  if (res.status === 204) return undefined as T
  const data = await res.json()
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  postForm: <T>(path: string, form: FormData) => request<T>('POST', path, form),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
