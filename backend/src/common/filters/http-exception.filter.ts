import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import type { Request, Response } from 'express'
import { Logger } from 'nestjs-pino'
import type { ErrorReporterService } from '../../observability/error-reporter.service'
import type { TenantContext } from '../../tenancy/tenant-context'

const TENANCY_COLUMNS = new Set(['organizationId', 'locationId', 'id'])

type PrismaFailureMeta = {
  target?: unknown
  driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } }
}

function conflictingColumns(meta: PrismaFailureMeta | undefined): string[] {
  const fromQueryEngine = meta?.target
  const fromDriverAdapter = meta?.driverAdapterError?.cause?.constraint?.fields
  const raw = fromQueryEngine ?? fromDriverAdapter
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  return list
    .filter((f): f is string => typeof f === 'string')
    .map((f) => f.replace(/"/g, ''))
    .filter((f) => !TENANCY_COLUMNS.has(f))
}

function prismaFailure(
  exception: unknown,
): { status: number; message: string; error: string } | null {
  const e = exception as { code?: string; meta?: PrismaFailureMeta }
  if (typeof e?.code !== 'string') return null

  if (e.code === 'P2002') {
    const fields = conflictingColumns(e.meta)
    return {
      status: HttpStatus.CONFLICT,
      error: 'Conflict',
      message: fields.length
        ? `Another record already uses this ${fields.join(' and ')}`
        : 'This record already exists',
    }
  }
  if (e.code === 'P2003') {
    return {
      status: HttpStatus.BAD_REQUEST,
      error: 'Bad Request',
      message: 'This record is still in use elsewhere and cannot be removed',
    }
  }
  if (e.code === 'P2025') {
    return { status: HttpStatus.NOT_FOUND, error: 'Not Found', message: 'Record not found' }
  }
  return null
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: Logger,
    private readonly reporter?: ErrorReporterService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()
    const req = ctx.getRequest<Request>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let message: string | string[] = 'Internal server error'
    let error = 'Internal Server Error'

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const body = exception.getResponse()
      if (typeof body === 'string') {
        message = body
        error = exception.name
      } else if (typeof body === 'object' && body !== null) {
        const b = body as { message?: string | string[]; error?: string }
        message = b.message ?? exception.message
        error = b.error ?? exception.name
      }
    } else if (prismaFailure(exception)) {
      const failure = prismaFailure(exception)!
      status = failure.status
      message = failure.message
      error = failure.error
    } else {
      this.logger.error(
        { err: exception, path: req.url, method: req.method },
        'Unhandled exception',
      )
      this.reporter?.notify(exception, {
        path: req.url,
        method: req.method,
        organizationId: (req as Request & { tenant?: TenantContext }).tenant?.organizationId,
      })
    }

    res.status(status).json({ statusCode: status, message, error })
  }
}
