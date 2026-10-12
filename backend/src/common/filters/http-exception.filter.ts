import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import type { Request, Response } from 'express'
import { Logger } from 'nestjs-pino'
import type { ErrorReporterService } from '../../observability/error-reporter.service'
import type { TenantContext } from '../../tenancy/tenant-context'
import { conflictingColumns, type PrismaFailureMeta } from '../utils/duplicate'

const BUSY_CODES = new Set(['55P03', '40P01', '40001'])

export type ErrorDetail = { field: string; message: string }

export type Failure = { status: number; code: string; message: string; details?: ErrorDetail[] }

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  423: 'LOCKED',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
  503: 'SERVICE_UNAVAILABLE',
}

const statusCode = (status: number) => STATUS_CODES[status] ?? `HTTP_${status}`

const busy: Failure = {
  status: HttpStatus.CONFLICT,
  code: 'RECORDS_BUSY',
  message: 'Someone else is changing the same records right now; try again in a moment',
}

function prismaFailure(exception: unknown): Failure | null {
  const e = exception as { code?: string; meta?: PrismaFailureMeta }
  if (typeof e?.code !== 'string') return null

  const driverCode = e.meta?.driverAdapterError?.cause?.code
  if (
    e.code === 'P2034' ||
    e.code === 'P2028' ||
    (typeof driverCode === 'string' && BUSY_CODES.has(driverCode))
  ) {
    return busy
  }
  if (e.code === 'P2002') {
    const fields = conflictingColumns(e.meta)
    return {
      status: HttpStatus.CONFLICT,
      code: 'DUPLICATE_RECORD',
      message: fields.length
        ? `Another record already uses this ${fields.join(' and ')}`
        : 'This record already exists',
    }
  }
  if (e.code === 'P2003') {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'RECORD_IN_USE',
      message: 'This record is still in use elsewhere and cannot be removed',
    }
  }
  if (e.code === 'P2025') {
    return { status: HttpStatus.NOT_FOUND, code: 'RECORD_NOT_FOUND', message: 'Record not found' }
  }
  return null
}

function databaseRefusal(exception: unknown): Failure | null {
  const e = exception as { name?: unknown; message?: unknown } | null
  if (typeof e?.message !== 'string') return null
  const refused = { status: HttpStatus.BAD_REQUEST, code: 'VALUE_REQUIRED' }
  if (e.name === 'PrismaClientValidationError') {
    const nulled =
      /Argument `(\w+)`(?: must not be null|: Invalid value provided\. Expected \w+, provided Null)/.exec(
        e.message,
      )?.[1]
    if (nulled) return { ...refused, message: `${nulled} must not be null` }
    if (/Argument `\w+` is missing/.test(e.message)) {
      return { ...refused, message: 'A required value is missing or null' }
    }
  }
  if (/invalid byte sequence for encoding/.test(e.message)) {
    return {
      ...refused,
      code: 'TEXT_UNSUPPORTED_CHARACTER',
      message: 'Text contains a character that cannot be stored',
    }
  }
  if (/numeric field overflow/.test(e.message)) {
    return {
      ...refused,
      code: 'VALUE_TOO_LARGE',
      message: 'A figure this would record is larger than the record can hold',
    }
  }
  return null
}

function requestFailure(exception: unknown): Failure | null {
  const e = exception as { type?: unknown; status?: unknown }
  if (typeof e?.type !== 'string' || typeof e.status !== 'number') return null
  if (e.status !== HttpStatus.PAYLOAD_TOO_LARGE) return null
  return {
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    code: 'PAYLOAD_TOO_LARGE',
    message: 'The request body is larger than this endpoint accepts',
  }
}

export class ValidationFailed extends HttpException {
  constructor(readonly details: ErrorDetail[]) {
    super({ code: 'VALIDATION_ERROR', message: 'Validation failed' }, HttpStatus.BAD_REQUEST)
  }
}

function httpFailure(exception: unknown): Failure | null {
  if (!(exception instanceof HttpException)) return null
  const status = exception.getStatus()
  const body = exception.getResponse()
  const details = exception instanceof ValidationFailed ? exception.details : undefined
  if (typeof body === 'string') return { status, code: statusCode(status), message: body }
  const b = (body ?? {}) as { code?: unknown; message?: unknown }
  const code = typeof b.code === 'string' ? b.code : statusCode(status)
  if (Array.isArray(b.message)) {
    const messages = b.message.filter((m): m is string => typeof m === 'string')
    return {
      status,
      code: typeof b.code === 'string' ? b.code : 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: messages.map((message) => ({ field: message.split(' ')[0], message })),
    }
  }
  const message = typeof b.message === 'string' ? b.message : exception.message
  return { status, code, message, ...(details ? { details } : {}) }
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

    const failure =
      httpFailure(exception) ??
      requestFailure(exception) ??
      databaseRefusal(exception) ??
      prismaFailure(exception) ??
      this.unexpected(exception, req)

    res.status(failure.status).json({
      error: {
        code: failure.code,
        message: failure.message,
        ...(failure.details?.length ? { details: failure.details } : {}),
      },
    })
  }

  private unexpected(exception: unknown, req: Request): Failure {
    this.logger.error({ err: exception, path: req.url, method: req.method }, 'Unhandled exception')
    this.reporter?.notify(exception, {
      path: req.url,
      method: req.method,
      organizationId: (req as Request & { tenant?: TenantContext }).tenant?.organizationId,
    })
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong on our side; try again in a moment',
    }
  }
}
