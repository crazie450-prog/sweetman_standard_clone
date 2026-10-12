import type { TenantScopedClient } from '../../prisma/prisma.service'

export type Serial = Omit<
  TenantScopedClient,
  '$transaction' | '$connect' | '$disconnect' | '$on' | '$use' | '$extends'
>

export const lockKey = (...parts: string[]) => parts.map((p) => p.trim().toLowerCase()).join(':')

export const LOCK_WAIT_MS = 3000

export const MENU_WRITE_MS = 15_000

export function serialized<T>(
  client: TenantScopedClient,
  key: string | string[],
  fn: (tx: Serial) => Promise<T>,
  options?: { timeout?: number; lockWait?: number },
): Promise<T> {
  const keys = [...new Set([key].flat())].sort()
  const lockWait = Math.trunc(options?.lockWait ?? LOCK_WAIT_MS)
  return client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${lockWait}ms'`)
      for (const held of keys) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${held}))`
      return fn(tx)
    },
    options?.timeout === undefined ? undefined : { timeout: options.timeout },
  )
}
