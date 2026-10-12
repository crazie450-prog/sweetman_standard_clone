describe('Configuration at start-up (e2e)', () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
  })

  const start = () =>
    jest.isolateModulesAsync(async () => {
      const { Test } = await import('@nestjs/testing')
      const { AppModule } = await import('../src/app.module')
      const { configureApp } = await import('../src/app-setup')
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
      const app = moduleRef.createNestApplication()
      configureApp(app)
      await app.init()
      await app.close()
    })

  it('refuses to start without a database address, naming the variable', async () => {
    process.env.DATABASE_URL = ''
    await expect(start()).rejects.toThrow(/DATABASE_URL/)
  })

  it('refuses to start on a signing secret too short to be one', async () => {
    process.env.JWT_ACCESS_SECRET = 'short'
    await expect(start()).rejects.toThrow(/JWT_ACCESS_SECRET is too short/)
  })

  it('refuses to start on a real provider whose key is missing', async () => {
    process.env.BILLING_PROVIDER = 'stripe'
    process.env.STRIPE_SECRET_KEY = ''
    process.env.STRIPE_WEBHOOK_SECRET = ''
    await expect(start()).rejects.toThrow(
      /STRIPE_SECRET_KEY is required when BILLING_PROVIDER is stripe/,
    )
  })

  it('starts on the configuration this suite runs with', async () => {
    await expect(start()).resolves.toBeUndefined()
  })
})
