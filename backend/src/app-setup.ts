import { ValidationPipe, type INestApplication } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import { Logger } from 'nestjs-pino'
import { GlobalExceptionFilter } from './common/filters/http-exception.filter'
import { ErrorReporterService } from './observability/error-reporter.service'

export function configureApp(app: INestApplication): void {
  app.use(cookieParser())

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )

  app.useGlobalFilters(new GlobalExceptionFilter(app.get(Logger), app.get(ErrorReporterService)))
}
