import 'dotenv/config'
import Bugsnag from '@bugsnag/js'
import Stripe from 'stripe'
import type { AppConfig } from '../src/config/env.validation'
import { configWith } from './config'
import {
  appEnv,
  billingChoice,
  errorReporterChoice,
  extractorChoice,
  mailChoice,
  storageChoice,
} from '../src/config/integrations'
import {
  ClaudeExtractor,
  GeminiExtractor,
  PairExtractor,
  type DocumentExtractor,
} from '../src/modules/documents/extraction'
import { StorageService } from '../src/storage/storage.service'
import { MailerService } from '../src/mailer/mailer.service'

type Outcome = {
  service: string
  provider: string
  result: 'ok' | 'failed' | 'skipped'
  detail: string
}

const SAMPLE_INVOICE = [
  'Dairy Direct',
  'Invoice DD-CHECK-1, 2026-09-16',
  'Unsalted Butter    4 kg    9.50 per kg    38.00',
  'Heavy Cream 33%    6 l     3.60 per l     21.60',
].join('\n')

const args = new Set(process.argv.slice(2))
const only = [...args]
  .find((a) => a.startsWith('--only='))
  ?.slice('--only='.length)
  .split(',')
const wanted = (service: string) => !only || only.includes(service)
const mailTo = [...args].find((a) => a.startsWith('--mail-to='))?.slice('--mail-to='.length)

async function documents(): Promise<Outcome> {
  const provider = extractorChoice(config)
  if (provider === 'stub')
    return {
      service: 'documents',
      provider,
      result: 'skipped',
      detail: 'stand-in, nothing to reach',
    }
  const extractor: DocumentExtractor =
    provider === 'claude'
      ? new ClaudeExtractor({
          apiKey: config.getOrThrow('ANTHROPIC_API_KEY', { infer: true }),
          model: config.getOrThrow('ANTHROPIC_MODEL', { infer: true }),
          effort: config.getOrThrow('ANTHROPIC_EFFORT', { infer: true }),
        })
      : provider === 'pair'
        ? new PairExtractor({
            apiKey: config.getOrThrow('GEMINI_API_KEY', { infer: true }),
            draftModel: config.getOrThrow('GEMINI_DRAFT_MODEL', { infer: true }),
            reviewModel: config.getOrThrow('GEMINI_REVIEW_MODEL', { infer: true }),
          })
        : new GeminiExtractor({
            apiKey: config.getOrThrow('GEMINI_API_KEY', { infer: true }),
            model: config.getOrThrow('GEMINI_MODEL', { infer: true }),
          })
  const results = await extractor.extract({
    type: 'invoice',
    fileName: 'check.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(SAMPLE_INVOICE),
  })
  const first = results[0]?.payload as { vendorName?: string; items?: unknown[] } | undefined
  const lines = first?.items?.length ?? 0
  return {
    service: 'documents',
    provider,
    result: lines === 2 ? 'ok' : 'failed',
    detail: `one request; read vendor "${first?.vendorName ?? '-'}" and ${lines} of 2 lines`,
  }
}

async function storage(): Promise<Outcome> {
  const provider = storageChoice(config)
  const store = new StorageService(config)
  const key = `checks/provider-check-${Date.now()}.txt`
  const body = Buffer.from('provider check')
  await store.put(key, body, 'text/plain')
  const back = await store.get(key)
  await store.remove(key)
  return {
    service: 'storage',
    provider,
    result: back.equals(body) ? 'ok' : 'failed',
    detail: 'wrote, read back and removed one small object',
  }
}

async function mail(): Promise<Outcome> {
  const provider = mailChoice(config)
  if (provider === 'none')
    return { service: 'mail', provider, result: 'skipped', detail: 'stand-in, nothing is sent' }
  if (!mailTo)
    return {
      service: 'mail',
      provider,
      result: 'skipped',
      detail: 'pass --mail-to=<your own address> to send one message',
    }
  const sent = await new MailerService(config).send(
    mailTo,
    'Nexus provider check',
    `Sent from the ${appEnv(config)} environment.`,
  )
  return {
    service: 'mail',
    provider,
    result: sent ? 'ok' : 'failed',
    detail: `one message to ${mailTo}`,
  }
}

async function billing(): Promise<Outcome> {
  const provider = billingChoice(config)
  if (provider === 'stub')
    return {
      service: 'billing',
      provider,
      result: 'skipped',
      detail: 'stand-in, nothing is charged',
    }
  const stripe = new Stripe(config.getOrThrow('STRIPE_SECRET_KEY', { infer: true }))
  const found: string[] = []
  let livemode = false
  const prices = {
    STARTER: config.get('STRIPE_PRICE_STARTER', { infer: true }),
    PROFESSIONAL: config.get('STRIPE_PRICE_PROFESSIONAL', { infer: true }),
    ENTERPRISE: config.get('STRIPE_PRICE_ENTERPRISE', { infer: true }),
  }
  for (const [plan, id] of Object.entries(prices)) {
    if (!id) {
      found.push(`${plan.toLowerCase()}: no price`)
      continue
    }
    const price = await stripe.prices.retrieve(id)
    livemode = livemode || price.livemode
    found.push(
      `${plan.toLowerCase()}: ${(price.unit_amount ?? 0) / 100} ${price.currency} per ${price.recurring?.interval ?? 'once'}`,
    )
  }
  return {
    service: 'billing',
    provider,
    result: found.some((f) => f.includes('no price')) ? 'failed' : 'ok',
    detail: `read-only, ${livemode ? 'LIVE mode' : 'test mode'}; ${found.join('; ')}`,
  }
}

async function errors(): Promise<Outcome> {
  const provider = errorReporterChoice(config)
  if (provider === 'none')
    return {
      service: 'errors',
      provider,
      result: 'skipped',
      detail: 'stand-in, errors stay in the log',
    }
  if (!args.has('--notify'))
    return {
      service: 'errors',
      provider,
      result: 'skipped',
      detail: 'pass --notify to send one test error',
    }
  const stage = appEnv(config)
  Bugsnag.start({
    apiKey: config.getOrThrow('BUGSNAG_API_KEY', { infer: true }),
    releaseStage: stage,
    enabledReleaseStages: ['production', 'staging'],
    logger: null,
  })
  if (stage === 'development') {
    return {
      service: 'errors',
      provider,
      result: 'skipped',
      detail: 'APP_ENV is development, which never reports',
    }
  }
  const delivered = await new Promise<boolean>((resolve) =>
    Bugsnag.notify(new Error('Nexus provider check'), undefined, (err) => resolve(!err)),
  )
  return {
    service: 'errors',
    provider,
    result: delivered ? 'ok' : 'failed',
    detail: `one test error under stage ${stage}`,
  }
}

let config: AppConfig

async function main() {
  config = configWith()
  console.log(`\nProvider check — environment: ${appEnv(config)}\n`)
  const checks: [string, () => Promise<Outcome>][] = [
    ['documents', documents],
    ['storage', storage],
    ['mail', mail],
    ['billing', billing],
    ['errors', errors],
  ]
  let failed = 0
  for (const [service, check] of checks) {
    if (!wanted(service)) continue
    let outcome: Outcome
    try {
      outcome = await check()
    } catch (error) {
      outcome = {
        service,
        provider: '?',
        result: 'failed',
        detail: (error as Error).message.slice(0, 200),
      }
    }
    if (outcome.result === 'failed') failed++
    console.log(
      `  ${outcome.result.padEnd(7)} ${outcome.service.padEnd(10)} ${outcome.provider.padEnd(8)} ${outcome.detail}`,
    )
  }
  console.log('')
  process.exit(failed ? 1 : 0)
}

void main()
