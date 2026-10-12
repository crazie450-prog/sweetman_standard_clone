const TENANCY_COLUMNS = new Set(['organizationId', 'locationId', 'id'])

export type PrismaFailureMeta = {
  target?: unknown
  driverAdapterError?: { cause?: { code?: unknown; constraint?: { fields?: unknown } } }
}

export function conflictingColumns(meta: PrismaFailureMeta | undefined): string[] {
  const fromQueryEngine = meta?.target
  const fromDriverAdapter = meta?.driverAdapterError?.cause?.constraint?.fields
  const raw = fromQueryEngine ?? fromDriverAdapter
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  return list
    .filter((f): f is string => typeof f === 'string')
    .map((f) => f.replace(/"/g, ''))
    .filter((f) => !TENANCY_COLUMNS.has(f))
}

export function duplicateColumns(exception: unknown): string[] | null {
  const e = exception as { code?: string; meta?: PrismaFailureMeta }
  return e?.code === 'P2002' ? conflictingColumns(e.meta) : null
}
