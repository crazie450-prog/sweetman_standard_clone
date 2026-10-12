import type { ConfigService } from '@nestjs/config'
import { z } from 'zod'
import {
  appEnv,
  billingChoice,
  errorReporterChoice,
  extractorChoice,
  mailChoice,
  storageChoice,
} from './integrations'

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['development', 'staging', 'production']).optional(),
    AUTH_RATE_LIMIT: z.enum(['on', 'off']).optional(),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),
    PORT: z.coerce.number().int().positive().default(8000),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET is too short (min 32)'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET is too short (min 32)'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('7d'),

    FRONTEND_ORIGIN: z.string().url().default('http://localhost:3000'),

    STORAGE_PROVIDER: z.enum(['local', 's3']).optional(),
    S3_BUCKET: z.string().optional(),
    S3_ENDPOINT: z.string().url().optional(),
    S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),
    AWS_REGION: z.string().optional(),
    STORAGE_LOCAL_DIR: z.string().optional(),

    MAIL_PROVIDER: z.enum(['none', 'resend']).default('none'),
    RESEND_API_KEY: z.string().optional(),
    MAIL_FROM: z.string().optional(),

    DOCUMENT_EXTRACTOR: z.enum(['stub', 'ai', 'gemini', 'claude', 'pair']).default('stub'),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-flash-lite-latest'),
    GEMINI_DRAFT_MODEL: z.string().default('gemini-3.5-flash-lite'),
    GEMINI_REVIEW_MODEL: z.string().default('gemini-3.8-flash'),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
    ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),

    BILLING_PROVIDER: z.enum(['stub', 'stripe']).default('stub'),
    BILLING_WEBHOOK_SECRET: z.string().optional(),
    BILLING_PER_LOCATION: z.enum(['true', 'false']).default('false'),
    BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(90).default(7),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_STARTER: z.string().optional(),
    STRIPE_PRICE_PROFESSIONAL: z.string().optional(),
    STRIPE_PRICE_ENTERPRISE: z.string().optional(),

    ERROR_REPORTER: z.enum(['none', 'bugsnag']).optional(),
    BUGSNAG_API_KEY: z.string().optional(),
    APP_VERSION: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const requires = (key: keyof typeof env, when: string) => {
      const value = env[key]
      if (typeof value === 'string' && value.trim()) return
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when ${when}` })
    }

    if (env.BILLING_PROVIDER === 'stripe') {
      requires('STRIPE_SECRET_KEY', 'BILLING_PROVIDER is stripe')
      requires('STRIPE_WEBHOOK_SECRET', 'BILLING_PROVIDER is stripe')
    }
    const extractor = extractorChoice(env)
    if (extractor === 'gemini' || extractor === 'pair')
      requires('GEMINI_API_KEY', `DOCUMENT_EXTRACTOR is ${env.DOCUMENT_EXTRACTOR}`)
    if (extractor === 'claude') requires('ANTHROPIC_API_KEY', 'DOCUMENT_EXTRACTOR is claude')
    if (mailChoice(env) === 'resend') requires('RESEND_API_KEY', 'MAIL_PROVIDER is resend')
    if (storageChoice(env) === 's3') requires('S3_BUCKET', 'STORAGE_PROVIDER is s3')
    if (errorReporterChoice(env) === 'bugsnag')
      requires('BUGSNAG_API_KEY', 'ERROR_REPORTER is bugsnag')

    if (env.APP_ENV === 'production') {
      if (extractor === 'stub') {
        ctx.addIssue({
          code: 'custom',
          path: ['DOCUMENT_EXTRACTOR'],
          message:
            'DOCUMENT_EXTRACTOR is the stand-in, which reads no document and shows a sample instead; production needs gemini, pair or claude',
        })
      }
      if (billingChoice(env) === 'stub') {
        ctx.addIssue({
          code: 'custom',
          path: ['BILLING_PROVIDER'],
          message:
            'BILLING_PROVIDER is the stand-in, which grants any plan without payment; production needs stripe',
        })
      }
    }

    if (appEnv(env) !== 'production') {
      const stripeKey = env.STRIPE_SECRET_KEY?.trim() ?? ''
      if (stripeKey.startsWith('sk_live_') || stripeKey.startsWith('rk_live_')) {
        ctx.addIssue({
          code: 'custom',
          path: ['STRIPE_SECRET_KEY'],
          message: `a live Stripe key is refused outside production (APP_ENV is ${appEnv(env)}); use a test key`,
        })
      }
    }
  })

export type Env = z.infer<typeof envSchema>

export type AppConfig = ConfigService<Env, true>

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment (.env):\n${issues}`)
  }
  return parsed.data
}
