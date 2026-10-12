import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino'
import { AppModule } from './app.module'
import { configureApp } from './app-setup'
import type { AppConfig } from './config/env.validation'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true })
  const logger = app.get(Logger)
  const config = app.get<AppConfig>(ConfigService)
  app.useLogger(logger)
  app.useGlobalInterceptors(new LoggerErrorInterceptor())

  app.enableCors({
    origin: config.getOrThrow('FRONTEND_ORIGIN', { infer: true }),
    credentials: true,
  })
  configureApp(app)
  app.enableShutdownHooks()

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Nexus API')
    .setDescription(
      'Nexus Restaurant Management Platform: a multi-tenant REST API covering ' +
        'authentication, restaurant operations and recipe costing.',
    )
    .setVersion('0.1.0')
    .addCookieAuth('access_token')
    .build()
  const document = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup('api/docs', app, document)

  const port = config.getOrThrow('PORT', { infer: true })
  await app.listen(port)
  logger.log(`Nexus API on http://localhost:${port}, Swagger at /api/docs`)
}

void bootstrap()
