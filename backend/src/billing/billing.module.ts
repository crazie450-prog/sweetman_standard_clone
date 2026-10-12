import { Logger, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AppConfig } from '../config/env.validation'
import { BILLING_PROVIDER, type BillingProvider } from './billing.provider'
import { StubBillingProvider } from './stub.provider'
import { StripeBillingProvider } from './stripe.provider'
import { BillingController } from './billing.controller'
import { BillingService } from './billing.service'

@Module({
  providers: [
    BillingService,
    {
      provide: BILLING_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: AppConfig): BillingProvider => {
        if (config.get('BILLING_PROVIDER', { infer: true }) === 'stripe') {
          const prices = {
            starter: config.get('STRIPE_PRICE_STARTER', { infer: true }),
            professional: config.get('STRIPE_PRICE_PROFESSIONAL', { infer: true }),
            enterprise: config.get('STRIPE_PRICE_ENTERPRISE', { infer: true }),
          }
          for (const [plan, price] of Object.entries(prices)) {
            if (!price) {
              new Logger('Billing').warn(
                `No Stripe price is configured for the ${plan} plan; choosing it will be refused`,
              )
            }
          }
          return new StripeBillingProvider({
            secretKey: config.getOrThrow('STRIPE_SECRET_KEY', { infer: true }),
            webhookSecret: config.getOrThrow('STRIPE_WEBHOOK_SECRET', { infer: true }),
            prices,
          })
        }
        return new StubBillingProvider(config.get('BILLING_WEBHOOK_SECRET', { infer: true }))
      },
    },
  ],
  controllers: [BillingController],
  exports: [BillingService],
})
export class BillingModule {}
