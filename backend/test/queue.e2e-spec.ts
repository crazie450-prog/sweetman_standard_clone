import { INestApplication, Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app-setup'
import { DocumentsQueue, DocumentsWorker } from '../src/modules/documents/documents.queue'

describe('The document queue looks after itself (e2e)', () => {
  let app: INestApplication
  const sweeps: (() => void)[] = []

  beforeAll(async () => {
    const real = global.setInterval
    const spy = jest.spyOn(global, 'setInterval').mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      if (ms === 60_000) sweeps.push(fn)
      return real(fn, ms)
    }) as typeof setInterval)
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication({ rawBody: true })
    configureApp(app)
    await app.init()
    spy.mockRestore()
  })

  afterAll(async () => {
    await app.close()
  })

  test('a job nobody queued has no record to show', async () => {
    expect(await app.get(DocumentsQueue).jobInfo('never-queued')).toBeNull()
  })

  test('the sweep that returns cut-off confirms to review says so when it cannot run', async () => {
    expect(sweeps).toHaveLength(1)
    const worker = app.get(DocumentsWorker)
    const release = jest
      .spyOn(worker, 'releaseStaleConfirms')
      .mockRejectedValue(new Error('database went away'))
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      sweeps[0]()
      await new Promise((resolve) => setImmediate(resolve))
      expect(release).toHaveBeenCalledTimes(1)
      expect(logged).toHaveBeenCalledWith(
        'stale confirms could not be released: database went away',
      )
    } finally {
      release.mockRestore()
      logged.mockRestore()
    }
  })
})
