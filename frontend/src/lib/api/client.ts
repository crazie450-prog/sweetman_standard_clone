import { getActiveLocationId } from './active-location'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown
  ) {
    super(message)
  }
}

async function refreshSession(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, { credentials: 'include' })
    return res.ok
  } catch {
    return false
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  retried = false
): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const locationId = getActiveLocationId()
  if (locationId) headers['X-Location-Id'] = locationId

  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const isAuthCall = path.startsWith('/api/auth/')

  if (res.status === 401 && !retried && !isAuthCall && (await refreshSession())) {
    return request<T>(method, path, body, true)
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => undefined)
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
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
