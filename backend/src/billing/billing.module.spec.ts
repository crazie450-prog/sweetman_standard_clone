import { Logger, type FactoryProvider } from '@nestjs/common'
import { configWith } from '../../test/config'
import { BillingModule } from './billing.module'
import { BILLING_PROVIDER } from './billing.provider'
import { StripeBillingProvider } from './stripe.provider'
import { StubBillingProvider } from './stub.provider'

const factory = (
  (Reflect.getMetadata('providers', BillingModule) as unknown[]).find(
    (p) => (p as FactoryProvider).provide === BILLING_PROVIDER,
  ) as FactoryProvider
).useFactory

const stripe = {
  BILLING_PROVIDER: 'stripe',
  STRIPE_SECRET_KEY: 'sk_test_probe',
  STRIPE_WEBHOOK_SECRET: 'whsec_probe',
}

describe('The billing provider the module hands out', () => {
  test('is the stand-in unless Stripe is chosen', () => {
    expect(factory(configWith({ BILLING_PROVIDER: undefined }))).toBeInstanceOf(StubBillingProvider)
  })

  test('is Stripe when chosen, and every plan with a price says nothing', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const provider = factory(
        configWith({
          ...stripe,
          STRIPE_PRICE_STARTER: 'price_s',
          STRIPE_PRICE_PROFESSIONAL: 'price_p',
          STRIPE_PRICE_ENTERPRISE: 'price_e',
        }),
      )
      expect(provider).toBeInstanceOf(StripeBillingProvider)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  test('warns at start for each plan that has no Stripe price', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      factory(
        configWith({
          ...stripe,
          STRIPE_PRICE_STARTER: 'price_s',
          STRIPE_PRICE_PROFESSIONAL: undefined,
          STRIPE_PRICE_ENTERPRISE: undefined,
        }),
      )
      expect(warn.mock.calls.map(([m]) => m)).toEqual([
        'No Stripe price is configured for the professional plan; choosing it will be refused',
        'No Stripe price is configured for the enterprise plan; choosing it will be refused',
      ])
    } finally {
      warn.mockRestore()
    }
  })
})
