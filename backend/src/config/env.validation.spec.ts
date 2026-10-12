import { validateEnv } from './env.validation'

const base = {
  DATABASE_URL: 'postgresql://nexus:nexus@localhost:5432/nexus',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
}

describe('validateEnv', () => {
  it('starts on the stub billing provider without any Stripe key', () => {
    expect(validateEnv(base).BILLING_PROVIDER).toBe('stub')
  })

  it('refuses to start on Stripe without the secret key or the webhook secret', () => {
    expect(() => validateEnv({ ...base, BILLING_PROVIDER: 'stripe' })).toThrow(
      /STRIPE_SECRET_KEY is required[\s\S]*STRIPE_WEBHOOK_SECRET is required/,
    )
    expect(() =>
      validateEnv({ ...base, BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x' }),
    ).toThrow(/STRIPE_WEBHOOK_SECRET is required/)
    expect(
      validateEnv({
        ...base,
        BILLING_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_WEBHOOK_SECRET: 'whsec_x',
      }).BILLING_PROVIDER,
    ).toBe('stripe')
  })
  it('holds the billing switches to the values the code understands', () => {
    expect(() => validateEnv({ ...base, BILLING_PROVIDER: 'paypal' })).toThrow(/BILLING_PROVIDER/)
    expect(() => validateEnv({ ...base, BILLING_PER_LOCATION: 'yes' })).toThrow(
      /BILLING_PER_LOCATION/,
    )
    expect(() => validateEnv({ ...base, BILLING_GRACE_DAYS: '91' })).toThrow(/BILLING_GRACE_DAYS/)
    expect(() => validateEnv({ ...base, BILLING_GRACE_DAYS: '-1' })).toThrow(/BILLING_GRACE_DAYS/)
    const env = validateEnv({ ...base, BILLING_GRACE_DAYS: '0', BILLING_PER_LOCATION: 'true' })
    expect(env.BILLING_GRACE_DAYS).toBe(0)
    expect(env.BILLING_PER_LOCATION).toBe('true')
  })

  it('refuses to start on a real provider that has no key, whichever service it is', () => {
    expect(() => validateEnv({ ...base, DOCUMENT_EXTRACTOR: 'ai' })).toThrow(
      /GEMINI_API_KEY is required when DOCUMENT_EXTRACTOR is ai/,
    )
    expect(() =>
      validateEnv({ ...base, DOCUMENT_EXTRACTOR: 'gemini', GEMINI_API_KEY: '  ' }),
    ).toThrow(/GEMINI_API_KEY is required/)
    expect(() => validateEnv({ ...base, DOCUMENT_EXTRACTOR: 'claude' })).toThrow(
      /ANTHROPIC_API_KEY is required/,
    )
    expect(() => validateEnv({ ...base, MAIL_PROVIDER: 'resend' })).toThrow(
      /RESEND_API_KEY is required/,
    )
    expect(() => validateEnv({ ...base, STORAGE_PROVIDER: 's3' })).toThrow(/S3_BUCKET is required/)
    expect(() => validateEnv({ ...base, ERROR_REPORTER: 'bugsnag' })).toThrow(
      /BUGSNAG_API_KEY is required/,
    )
    expect(() => validateEnv({ ...base, DOCUMENT_EXTRACTOR: 'openai' })).toThrow(
      /DOCUMENT_EXTRACTOR/,
    )
  })

  it('starts on every stand-in with no key at all, and on each real provider once its key is there', () => {
    expect(validateEnv(base)).toMatchObject({ DOCUMENT_EXTRACTOR: 'stub', MAIL_PROVIDER: 'none' })
    expect(
      validateEnv({ ...base, DOCUMENT_EXTRACTOR: 'claude', ANTHROPIC_API_KEY: 'k' }),
    ).toMatchObject({ ANTHROPIC_MODEL: 'claude-opus-5-5', ANTHROPIC_EFFORT: 'low' })
    expect(validateEnv({ ...base, DOCUMENT_EXTRACTOR: 'pair', GEMINI_API_KEY: 'k' })).toMatchObject(
      {
        GEMINI_DRAFT_MODEL: 'gemini-3.5-flash-lite',
        GEMINI_REVIEW_MODEL: 'gemini-3.8-flash',
      },
    )
    expect(() => validateEnv({ ...base, DOCUMENT_EXTRACTOR: 'pair' })).toThrow(
      /GEMINI_API_KEY is required/,
    )
    expect(() =>
      validateEnv({
        ...base,
        DOCUMENT_EXTRACTOR: 'claude',
        ANTHROPIC_API_KEY: 'k',
        ANTHROPIC_EFFORT: 'max!',
      }),
    ).toThrow(/ANTHROPIC_EFFORT/)
    expect(
      validateEnv({ ...base, DOCUMENT_EXTRACTOR: 'ai', GEMINI_API_KEY: 'k' }).DOCUMENT_EXTRACTOR,
    ).toBe('ai')
    expect(
      validateEnv({ ...base, MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' }).MAIL_PROVIDER,
    ).toBe('resend')
    expect(
      validateEnv({
        ...base,
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'nexus',
        S3_ENDPOINT: 'http://localhost:9000',
        S3_FORCE_PATH_STYLE: 'true',
      }).S3_FORCE_PATH_STYLE,
    ).toBe('true')
    expect(() => validateEnv({ ...base, S3_ENDPOINT: 'minio' })).toThrow(/S3_ENDPOINT/)
    expect(validateEnv({ ...base, BUGSNAG_API_KEY: 'k' }).ERROR_REPORTER).toBeUndefined()
  })

  it('refuses a live Stripe key anywhere but production', () => {
    const live = {
      ...base,
      BILLING_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_live_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
    }
    expect(() => validateEnv(live)).toThrow(
      /live Stripe key is refused outside production \(APP_ENV is development\)/,
    )
    expect(() => validateEnv({ ...live, NODE_ENV: 'production', APP_ENV: 'staging' })).toThrow(
      /APP_ENV is staging/,
    )
    expect(() =>
      validateEnv({ ...live, STRIPE_SECRET_KEY: 'rk_live_x', APP_ENV: 'staging' }),
    ).toThrow(/live Stripe key/)
    expect(
      validateEnv({
        ...live,
        APP_ENV: 'production',
        DOCUMENT_EXTRACTOR: 'gemini',
        GEMINI_API_KEY: 'g',
      }).BILLING_PROVIDER,
    ).toBe('stripe')
    expect(validateEnv({ ...live, NODE_ENV: 'production' }).BILLING_PROVIDER).toBe('stripe')
    expect(
      validateEnv({ ...live, STRIPE_SECRET_KEY: 'sk_test_x', APP_ENV: 'staging' }).APP_ENV,
    ).toBe('staging')
    expect(() => validateEnv({ ...base, APP_ENV: 'qa' })).toThrow(/APP_ENV/)
  })

  it('refuses to start production on a stand-in that would invent readings or grant plans unpaid', () => {
    const production = { ...base, APP_ENV: 'production' }
    expect(() => validateEnv(production)).toThrow(/DOCUMENT_EXTRACTOR.*stand-in/)
    expect(() =>
      validateEnv({ ...production, DOCUMENT_EXTRACTOR: 'gemini', GEMINI_API_KEY: 'g' }),
    ).toThrow(/BILLING_PROVIDER.*stand-in/)
    expect(
      validateEnv({
        ...production,
        DOCUMENT_EXTRACTOR: 'claude',
        ANTHROPIC_API_KEY: 'a',
        BILLING_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_live_x',
        STRIPE_WEBHOOK_SECRET: 'whsec_x',
      }).APP_ENV,
    ).toBe('production')
    expect(validateEnv({ ...base, NODE_ENV: 'production', APP_ENV: 'staging' }).APP_ENV).toBe(
      'staging',
    )
    expect(validateEnv({ ...base, NODE_ENV: 'production' }).NODE_ENV).toBe('production')
  })
})
