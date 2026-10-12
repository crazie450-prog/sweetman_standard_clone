import { ConfigService } from '@nestjs/config'
import type { AppConfig } from './env.validation'

export type Source = Record<string, unknown> | AppConfig | ConfigService

/* ===== Which provider each service runs on ===== */

export type AppEnv = 'development' | 'staging' | 'production'
export type ExtractorChoice = 'stub' | 'gemini' | 'claude' | 'pair'
export type StorageChoice = 'local' | 's3'
export type MailChoice = 'none' | 'resend'
export type BillingChoice = 'stub' | 'stripe'
export type ErrorReporterChoice = 'none' | 'bugsnag'

export function setting(env: Source, key: string): string {
  const value = env instanceof ConfigService ? (env as ConfigService).get<unknown>(key) : env[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function appEnv(env: Source): AppEnv {
  const stated = setting(env, 'APP_ENV')
  if (stated === 'development' || stated === 'staging' || stated === 'production') return stated
  return setting(env, 'NODE_ENV') === 'production' ? 'production' : 'development'
}

export function extractorChoice(env: Source): ExtractorChoice {
  const stated = setting(env, 'DOCUMENT_EXTRACTOR')
  if (stated === 'ai' || stated === 'gemini') return 'gemini'
  if (stated === 'claude') return 'claude'
  if (stated === 'pair') return 'pair'
  return 'stub'
}

export function storageChoice(env: Source): StorageChoice {
  const stated = setting(env, 'STORAGE_PROVIDER')
  if (stated === 's3' || stated === 'local') return stated
  return setting(env, 'S3_BUCKET') ? 's3' : 'local'
}

export function mailChoice(env: Source): MailChoice {
  return setting(env, 'MAIL_PROVIDER') === 'resend' ? 'resend' : 'none'
}

export function billingChoice(env: Source): BillingChoice {
  return setting(env, 'BILLING_PROVIDER') === 'stripe' ? 'stripe' : 'stub'
}

export function errorReporterChoice(env: Source): ErrorReporterChoice {
  const stated = setting(env, 'ERROR_REPORTER')
  if (stated === 'bugsnag' || stated === 'none') return stated
  return setting(env, 'BUGSNAG_API_KEY') ? 'bugsnag' : 'none'
}

/* ===== What an administrator is shown ===== */

export interface Integration {
  service: 'documents' | 'storage' | 'mail' | 'billing' | 'errors'
  provider: string
  live: boolean
  note: string
}

export function integrations(env: Source): Integration[] {
  const extractor = extractorChoice(env)
  const storage = storageChoice(env)
  const mail = mailChoice(env)
  const billing = billingChoice(env)
  const errors = errorReporterChoice(env)
  const stripeKey = setting(env, 'STRIPE_SECRET_KEY')
  return [
    {
      service: 'documents',
      provider: extractor,
      live: extractor !== 'stub',
      note:
        extractor === 'stub'
          ? 'Spreadsheets are read; PDFs and images get a sample reading, Word files fail'
          : extractor === 'pair'
            ? 'Documents are read by Gemini in two steps: a draft, then a check by a second model'
            : `Documents are read by ${extractor === 'claude' ? 'Claude' : 'Gemini'}`,
    },
    {
      service: 'storage',
      provider: storage,
      live: storage === 's3',
      note:
        storage === 's3'
          ? setting(env, 'S3_ENDPOINT')
            ? 'An S3-compatible store at a custom endpoint'
            : 'Amazon S3'
          : 'Files are kept on the API server disk',
    },
    {
      service: 'mail',
      provider: mail,
      live: mail === 'resend',
      note:
        mail === 'resend'
          ? 'Invitations and password resets are sent by email'
          : 'Nothing is sent; invitation and reset links are shown to the administrator',
    },
    {
      service: 'billing',
      provider: billing,
      live: billing === 'stripe',
      note:
        billing === 'stripe'
          ? stripeKey.startsWith('sk_live_') || stripeKey.startsWith('rk_live_')
            ? 'Stripe, live mode: cards are charged'
            : 'Stripe, test mode: no card is charged'
          : 'Choosing a plan records it at once; nothing is charged',
    },
    {
      service: 'errors',
      provider: errors,
      live: errors === 'bugsnag',
      note:
        errors === 'bugsnag'
          ? `Errors are reported to BugSnag as ${appEnv(env)}`
          : 'Errors are written to the log only',
    },
  ]
}
