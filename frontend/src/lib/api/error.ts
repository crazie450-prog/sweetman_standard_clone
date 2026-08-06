import { ApiError } from './client'

export function serverMessage(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (e instanceof ApiError) {
    const body = e.body as { message?: string | string[] } | undefined
    const msg = body?.message
    if (Array.isArray(msg) && msg.length > 0) return msg.join('. ')
    if (typeof msg === 'string' && msg.trim()) return msg
    if (e.status === 403) return 'Your role does not allow this action.'
  }
  return fallback
}
