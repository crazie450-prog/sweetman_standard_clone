import {
  BadRequestException,
  ValidationPipe,
  type ValidationError,
  type ArgumentMetadata,
  type INestApplication,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import cookieParser from 'cookie-parser'
import { Logger } from 'nestjs-pino'
import {
  GlobalExceptionFilter,
  ValidationFailed,
  type ErrorDetail,
} from './common/filters/http-exception.filter'
import { ErrorReporterService } from './observability/error-reporter.service'
import type { AppConfig } from './config/env.validation'

function detailsOf(errors: ValidationError[], parent?: string): ErrorDetail[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property
    const own = Object.values(e.constraints ?? {}).map((message) => ({
      field,
      message: parent ? `${parent}.${message}` : message,
    }))
    return [...own, ...detailsOf(e.children ?? [], field)]
  })
}

class ObjectBodyValidationPipe extends ValidationPipe {
  async transform(value: unknown, metadata: ArgumentMetadata) {
    const whole = metadata.type === 'body' && !metadata.data && this.toValidate(metadata)
    if (whole && (value === null || typeof value !== 'object' || Array.isArray(value))) {
      throw new BadRequestException({
        code: 'REQUEST_BODY_NOT_OBJECT',
        message: 'The request body must be an object',
      })
    }
    return super.transform(value, metadata)
  }
}

export function configureApp(app: INestApplication): void {
  const config = app.get<AppConfig>(ConfigService)
  const production = config.get('NODE_ENV', { infer: true }) === 'production'
  const http = app.getHttpAdapter().getInstance() as {
    set?: (key: string, value: unknown) => void
    disable?: (key: string) => void
  }
  http.set?.('trust proxy', config.getOrThrow('TRUST_PROXY', { infer: true }))
  http.disable?.('x-powered-by')
  app.use(
    (
      _req: unknown,
      res: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('X-Frame-Options', 'DENY')
      res.setHeader('Referrer-Policy', 'no-referrer')
      if (production) {
        res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
      }
      next()
    },
  )
  app.use(cookieParser())

  app.useGlobalPipes(
    new ObjectBodyValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) => new ValidationFailed(detailsOf(errors)),
    }),
  )

  app.useGlobalFilters(new GlobalExceptionFilter(app.get(Logger), app.get(ErrorReporterService)))
}
