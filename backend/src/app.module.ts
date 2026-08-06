import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { LoggerModule } from 'nestjs-pino'
import { validateEnv } from './config/env.validation'
import { PrismaModule } from './prisma/prisma.module'
import { HealthModule } from './health/health.module'
import { MailerModule } from './mailer/mailer.module'
import { AuthModule } from './auth/auth.module'
import { InvitationsModule } from './invitations/invitations.module'
import { TenantMiddleware } from './tenancy/tenant.middleware'
import { JwtAuthGuard } from './common/guards/jwt-auth.guard'
import { RolesGuard } from './common/guards/roles.guard'
import { LocationGuard } from './common/guards/location.guard'
import { VendorsModule } from './modules/vendors/vendors.module'
import { CategoriesModule } from './modules/categories/categories.module'
import { IngredientsModule } from './modules/ingredients/ingredients.module'
import { InventoryModule } from './modules/inventory/inventory.module'
import { InvoicesModule } from './modules/invoices/invoices.module'
import { LocationsModule } from './modules/locations/locations.module'
import { TeamModule } from './modules/team/team.module'
import { RecipesModule } from './modules/recipes/recipes.module'
import { MenuModule } from './modules/menu/menu.module'
import { WasteModule } from './modules/waste/waste.module'
import { ProductionModule } from './modules/production/production.module'
import { SalesModule } from './modules/sales/sales.module'
import { DashboardModule } from './modules/dashboard/dashboard.module'
import { OrganizationsModule } from './modules/organizations/organizations.module'
import { AdminModule } from './modules/admin/admin.module'
import { DocumentsModule } from './modules/documents/documents.module'
import { StorageModule } from './storage/storage.service'
import { ObservabilityModule } from './observability/error-reporter.service'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        genReqId: (req) => (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
      },
    }),
    PrismaModule,
    MailerModule,
    StorageModule,
    ObservabilityModule,
    HealthModule,
    AuthModule,
    InvitationsModule,
    VendorsModule,
    CategoriesModule,
    IngredientsModule,
    InventoryModule,
    InvoicesModule,
    LocationsModule,
    TeamModule,
    RecipesModule,
    MenuModule,
    WasteModule,
    ProductionModule,
    SalesModule,
    DashboardModule,
    OrganizationsModule,
    AdminModule,
    DocumentsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: LocationGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*')
  }
}
