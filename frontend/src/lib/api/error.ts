import { ApiError, errorOf } from './client'

export function serverMessage(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (e instanceof ApiError) {
    const error = errorOf(e.body)
    const details = (error?.details ?? []).map((d) => d.message).filter((m) => m.trim())
    if (details.length > 0) return details.join('. ')
    if (error?.message.trim()) return error.message
    if (e.status === 403) return 'Your role does not allow this action.'
  }
  return fallback
}
