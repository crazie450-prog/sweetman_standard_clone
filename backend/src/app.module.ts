import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { LoggerModule } from 'nestjs-pino'
import { validateEnv, type AppConfig } from './config/env.validation'
import { LOG_REDACT, logBase, logProps } from './observability/log-context'
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
import { VendorProductsModule } from './modules/vendors/vendor-products.module'
import { CategoriesModule } from './modules/categories/categories.module'
import { IngredientsModule } from './modules/ingredients/ingredients.module'
import { InventoryModule } from './modules/inventory/inventory.module'
import { InvoicesModule } from './modules/invoices/invoices.module'
import { UnitsModule } from './modules/units/units.module'
import { LocationsModule } from './modules/locations/locations.module'
import { TeamModule } from './modules/team/team.module'
import { RecipesModule } from './modules/recipes/recipes.module'
import { MenuModule } from './modules/menu/menu.module'
import { MenusModule } from './modules/menu/menus.module'
import { WasteModule } from './modules/waste/waste.module'
import { ProductionModule } from './modules/production/production.module'
import { PurchasingModule } from './modules/purchasing/purchasing.module'
import { BillingModule } from './billing/billing.module'
import { SubscriptionGuard } from './billing/subscription.guard'
import { SalesModule } from './modules/sales/sales.module'
import { DashboardModule } from './modules/dashboard/dashboard.module'
import { OrganizationsModule } from './modules/organizations/organizations.module'
import { AdminModule } from './modules/admin/admin.module'
import { DocumentsModule } from './modules/documents/documents.module'
import { StorageModule } from './storage/storage.module'
import { ObservabilityModule } from './observability/observability.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      skipProcessEnv: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          transport:
            config.get('NODE_ENV', { infer: true }) !== 'production'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          redact: LOG_REDACT,
          genReqId: (req) => (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
          base: logBase(config),
          customProps: logProps,
        },
      }),
    }),
    PrismaModule,
    MailerModule,
    StorageModule,
    ObservabilityModule,
    HealthModule,
    AuthModule,
    InvitationsModule,
    VendorsModule,
    VendorProductsModule,
    CategoriesModule,
    IngredientsModule,
    InventoryModule,
    InvoicesModule,
    UnitsModule,
    LocationsModule,
    TeamModule,
    RecipesModule,
    MenuModule,
    MenusModule,
    WasteModule,
    ProductionModule,
    PurchasingModule,
    SalesModule,
    DashboardModule,
    OrganizationsModule,
    BillingModule,
    AdminModule,
    DocumentsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: LocationGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*')
  }
}
