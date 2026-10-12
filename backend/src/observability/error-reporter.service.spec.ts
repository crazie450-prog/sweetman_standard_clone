import Bugsnag from '@bugsnag/js'
import { configWith } from '../../test/config'
import { ErrorReporterService } from './error-reporter.service'

jest.mock('@bugsnag/js', () => ({
  __esModule: true,
  default: { start: jest.fn(), notify: jest.fn() },
}))

const bugsnag = Bugsnag as unknown as { start: jest.Mock; notify: jest.Mock }

describe('ErrorReporterService', () => {
  beforeEach(() => {
    bugsnag.start.mockClear()
    bugsnag.notify.mockClear()
  })

  test('stays silent without a key', () => {
    const reporter = new ErrorReporterService(
      configWith({ ERROR_REPORTER: undefined, BUGSNAG_API_KEY: undefined }),
    )
    reporter.notify(new Error('nobody hears this'))
    expect(bugsnag.start).not.toHaveBeenCalled()
    expect(bugsnag.notify).not.toHaveBeenCalled()
  })

  test('stays silent when told to, even with a key', () => {
    const reporter = new ErrorReporterService(
      configWith({ ERROR_REPORTER: 'none', BUGSNAG_API_KEY: 'key-for-tests' }),
    )
    reporter.notify(new Error('nobody hears this'))
    expect(bugsnag.start).not.toHaveBeenCalled()
    expect(bugsnag.notify).not.toHaveBeenCalled()
  })

  test('starts with the stage and version it runs as', () => {
    new ErrorReporterService(
      configWith({
        ERROR_REPORTER: 'bugsnag',
        BUGSNAG_API_KEY: 'key-for-tests',
        APP_ENV: 'staging',
        APP_VERSION: '1.2.3',
      }),
    )
    expect(bugsnag.start).toHaveBeenCalledWith({
      apiKey: 'key-for-tests',
      releaseStage: 'staging',
      enabledReleaseStages: ['production', 'staging'],
      appVersion: '1.2.3',
    })
  })

  test('sends an error with the request it came from', () => {
    const reporter = new ErrorReporterService(
      configWith({ ERROR_REPORTER: 'bugsnag', BUGSNAG_API_KEY: 'key-for-tests' }),
    )
    const error = new Error('broken')
    const meta = { path: '/api/vendors', method: 'GET', organizationId: 'org-1' }
    reporter.notify(error, meta)
    expect(bugsnag.notify).toHaveBeenCalledWith(error, expect.any(Function))
    const event = { addMetadata: jest.fn() }
    ;(bugsnag.notify.mock.calls[0][1] as (e: typeof event) => void)(event)
    expect(event.addMetadata).toHaveBeenCalledWith('request', meta)
  })

  test('turns a thrown value that is not an error into one, and adds nothing it was not given', () => {
    const reporter = new ErrorReporterService(
      configWith({ ERROR_REPORTER: 'bugsnag', BUGSNAG_API_KEY: 'key-for-tests' }),
    )
    reporter.notify('a plain string')
    const [sent, callback] = bugsnag.notify.mock.calls[0] as [Error, (e: object) => void]
    expect(sent).toBeInstanceOf(Error)
    expect(sent.message).toBe('a plain string')
    const event = { addMetadata: jest.fn() }
    callback(event)
    expect(event.addMetadata).not.toHaveBeenCalled()
  })
})
