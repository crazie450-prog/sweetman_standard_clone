import { MailerService, maskedAddress } from './mailer.service'
import { configWith } from '../../test/config'

const INVITE = {
  organization: 'Golden Fork',
  role: 'staff' as const,
  invitedBy: null,
  expiresAt: new Date('2026-10-07T12:00:00Z'),
}

describe('MailerService', () => {
  let mailer: MailerService
  let warnings: string[]
  let logs: string[]

  function build(overrides: Record<string, string | undefined>) {
    mailer = new MailerService(
      configWith({ FRONTEND_ORIGIN: 'https://nexus.example', ...overrides }),
    )
    warnings = []
    logs = []
    const log = mailer['log'] as { warn: unknown; log: unknown; error: unknown }
    log.warn = (message: string) => warnings.push(message)
    log.log = (message: string) => logs.push(message)
    log.error = (message: string) => warnings.push(message)
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('without a provider', () => {
    beforeEach(() => {
      build({ MAIL_PROVIDER: undefined, RESEND_API_KEY: undefined })
    })

    test('nothing is sent and the caller is told so', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
      expect(await mailer.sendPasswordReset('chef@example.com', 'reset-token')).toBe(false)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    test('the reset link never reaches the log', async () => {
      await mailer.sendPasswordReset('chef@example.com', 'reset-token')
      await mailer.sendInvitation('chef@example.com', INVITE, 'invite-token')
      for (const line of [...warnings, ...logs]) {
        expect(line).not.toContain('reset-token')
        expect(line).not.toContain('invite-token')
        expect(line).not.toContain('https://nexus.example')
      }
    })
  })

  describe('with Resend configured', () => {
    beforeEach(() => {
      build({
        MAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 'test-key',
        MAIL_FROM: 'Nexus <no-reply@nexus.example>',
      })
    })

    test('the message is handed to the provider, and the link stays out of the log', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }))

      expect(await mailer.sendPasswordReset('chef@example.com', 'reset-token')).toBe(true)

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.resend.com/emails')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key')

      const body = JSON.parse(init.body as string) as {
        from: string
        to: string[]
        subject: string
        text: string
      }
      expect(body.to).toEqual(['chef@example.com'])
      expect(body.from).toBe('Nexus <no-reply@nexus.example>')
      expect(body.text).toContain('https://nexus.example/reset-password?token=reset-token')

      for (const line of [...warnings, ...logs]) {
        expect(line).not.toContain('reset-token')
      }
    })

    test('an invitation says who invited whom, to what, as what and until when', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }))

      await mailer.sendInvitation(
        'chef@example.com',
        {
          organization: 'Golden Fork',
          role: 'staff',
          invitedBy: 'Alex Morgan',
          expiresAt: new Date('2026-10-07T12:00:00Z'),
        },
        'invite-token',
      )

      const body = JSON.parse(
        (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as {
        subject: string
        text: string
      }
      expect(body.subject).toContain('Golden Fork')
      expect(body.text).toContain('Alex Morgan')
      expect(body.text).toContain('Golden Fork')
      expect(body.text).toContain('Executive Chef')
      expect(body.text).toContain('7 October 2026')
      expect(body.text).toContain('https://nexus.example/signup?invite=invite-token')
    })

    test('a reset says how long the link lasts and what happens if nobody asked', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }))

      await mailer.sendPasswordReset('chef@example.com', 'reset-token')

      const { text } = JSON.parse(
        (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as { text: string }
      expect(text).toContain('one hour')
      expect(text).toContain('every device')
      expect(text).toMatch(/did not ask/)
    })

    test('the log does not carry the whole address', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
      await mailer.sendPasswordReset('chef@example.com', 'reset-token')
      jest.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 422 }))
      await mailer.sendPasswordReset('chef@example.com', 'reset-token')
      const lines = [...warnings, ...logs]
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) {
        expect(line).not.toContain('chef@example.com')
        expect(line).toContain('@example.com')
      }
    })

    test('a refusal from the provider is reported, not thrown', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 422 }))
      expect(await mailer.sendInvitation('chef@example.com', INVITE, 'invite-token')).toBe(false)
      expect(warnings.join(' ')).toContain('422')
    })

    test('a provider that does not answer is given up on, not waited for', async () => {
      jest
        .spyOn(AbortSignal, 'timeout')
        .mockReturnValue(
          AbortSignal.abort(new DOMException('The operation timed out', 'TimeoutError')),
        )
      jest.spyOn(global, 'fetch').mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal
            if (!signal) return
            if (signal.aborted) reject(signal.reason)
            signal.addEventListener('abort', () => reject(signal.reason))
          }),
      )
      expect(await mailer.sendPasswordReset('chef@example.com', 'reset-token')).toBe(false)
      expect(warnings.join(' ')).toContain('timed out')
    }, 2_000)

    test('an unreachable provider is reported, not thrown', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))
      expect(await mailer.sendPasswordReset('chef@example.com', 'reset-token')).toBe(false)
      expect(warnings.join(' ')).toContain('ENOTFOUND')
    })
  })

  test('a message without a stated sender goes out from the default address', async () => {
    build({ MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'test-key', MAIL_FROM: undefined })
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    expect(await mailer.sendPasswordReset('chef@example.com', 'reset-token')).toBe(true)
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.from).toBe('Nexus <onboarding@resend.dev>')
  })

  test('an address with nothing before the at sign is hidden whole', () => {
    expect(maskedAddress('@example.com')).toBe('***')
    expect(maskedAddress('no-at-sign')).toBe('***')
    expect(maskedAddress('chef@example.com')).toBe('c***@example.com')
  })
})
