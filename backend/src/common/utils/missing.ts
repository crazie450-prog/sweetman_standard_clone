import { NotFoundException } from '@nestjs/common'

export function notFoundCode(message: string): string {
  const what = message.replace(/ not found$/i, '').trim()
  return `${what.replace(/\W+/g, '_').toUpperCase()}_NOT_FOUND`
}

export function notFoundOr(error: unknown, message: string): unknown {
  return (error as { code?: string } | null)?.code === 'P2025'
    ? new NotFoundException({ code: notFoundCode(message), message })
    : error
}
