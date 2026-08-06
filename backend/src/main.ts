import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino'
import { AppModule } from './app.module'
import { configureApp } from './app-setup'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  const logger = app.get(Logger)
  app.useLogger(logger)
  app.useGlobalInterceptors(new LoggerErrorInterceptor())

  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  })
  configureApp(app)

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Nexus API')
    .setDescription(
      'Nexus Restaurant Management Platform — multi-tenant REST API covering ' +
        'authentication, restaurant operations and recipe costing.',
    )
    .setVersion('0.1.0')
    .addCookieAuth('access_token')
    .build()
  const document = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup('api/docs', app, document)

  const port = Number(process.env.PORT ?? 8000)
  await app.listen(port)
  logger.log(`Nexus API on http://localhost:${port} — Swagger: /api/docs`)
}

void bootstrap()
