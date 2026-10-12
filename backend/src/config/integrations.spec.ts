import {
  appEnv,
  errorReporterChoice,
  extractorChoice,
  integrations,
  storageChoice,
} from './integrations'

describe('integrations', () => {
  it('names the environment from APP_ENV, or from NODE_ENV when it is not stated', () => {
    expect(appEnv({})).toBe('development')
    expect(appEnv({ NODE_ENV: 'production' })).toBe('production')
    expect(appEnv({ NODE_ENV: 'production', APP_ENV: 'staging' })).toBe('staging')
    expect(appEnv({ NODE_ENV: 'test', APP_ENV: 'nonsense' })).toBe('development')
  })

  it('keeps the older switches meaning what they meant', () => {
    expect(extractorChoice({ DOCUMENT_EXTRACTOR: 'ai' })).toBe('gemini')
    expect(extractorChoice({})).toBe('stub')
    expect(extractorChoice({ DOCUMENT_EXTRACTOR: 'pair' })).toBe('pair')
    expect(
      integrations({ DOCUMENT_EXTRACTOR: 'pair' }).find((i) => i.service === 'documents')?.note,
    ).toBe('Documents are read by Gemini in two steps: a draft, then a check by a second model')
    expect(storageChoice({ S3_BUCKET: 'nexus' })).toBe('s3')
    expect(storageChoice({ S3_BUCKET: 'nexus', STORAGE_PROVIDER: 'local' })).toBe('local')
    expect(errorReporterChoice({ BUGSNAG_API_KEY: 'k' })).toBe('bugsnag')
    expect(errorReporterChoice({ BUGSNAG_API_KEY: 'k', ERROR_REPORTER: 'none' })).toBe('none')
  })

  it('reports every service as a stand-in when nothing is configured', () => {
    const list = integrations({})
    expect(list.map((i) => i.service)).toEqual([
      'documents',
      'storage',
      'mail',
      'billing',
      'errors',
    ])
    expect(list.every((i) => !i.live)).toBe(true)
  })

  it('says which Stripe mode charges cards, and never repeats a key', () => {
    const secret = 'sk_test_do_not_print'
    const test = integrations({ BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: secret })
    expect(test.find((i) => i.service === 'billing')).toMatchObject({
      provider: 'stripe',
      live: true,
      note: 'Stripe, test mode: no card is charged',
    })
    expect(JSON.stringify(test)).not.toContain(secret)
    const live = integrations({ BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_live_x' })
    expect(live.find((i) => i.service === 'billing')?.note).toMatch(/live mode/)
  })

  it('names an S3-compatible endpoint apart from Amazon S3 and the reporter stage', () => {
    const minio = integrations({ S3_BUCKET: 'b', S3_ENDPOINT: 'http://localhost:9000' })
    expect(minio.find((i) => i.service === 'storage')?.note).toMatch(/custom endpoint/)
    const errors = integrations({ BUGSNAG_API_KEY: 'k', APP_ENV: 'staging' })
    expect(errors.find((i) => i.service === 'errors')?.note).toBe(
      'Errors are reported to BugSnag as staging',
    )
  })
})
