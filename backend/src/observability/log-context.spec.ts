import type { IncomingMessage } from 'node:http'
import pino from 'pino'
import { LOG_REDACT, logBase, logProps } from './log-context'

describe('log context', () => {
  it('names the service and the environment on every line, for a log group to filter by', () => {
    expect(logBase({})).toEqual({ service: 'nexus-api', environment: 'development' })
    expect(logBase({ NODE_ENV: 'production', APP_ENV: 'staging', APP_VERSION: '1.4.0' })).toEqual({
      service: 'nexus-api',
      environment: 'staging',
      version: '1.4.0',
    })
  })

  it('carries who made a request and where, and nothing from a request nobody signed', () => {
    const signed = {
      tenant: {
        organizationId: 'org-1',
        userId: 'user-1',
        locationId: 'loc-1',
        role: 'owner',
        isPlatformAdmin: false,
      },
    } as unknown as IncomingMessage
    expect(logProps(signed)).toEqual({
      organizationId: 'org-1',
      userId: 'user-1',
      locationId: 'loc-1',
    })
    const everywhere = {
      tenant: {
        organizationId: 'org-1',
        userId: 'user-1',
        locationId: null,
        role: 'owner',
        isPlatformAdmin: false,
      },
    } as unknown as IncomingMessage
    expect(logProps(everywhere)).toEqual({ organizationId: 'org-1', userId: 'user-1' })
    expect(logProps({} as IncomingMessage)).toEqual({})
  })

  it('writes no session token, cookie or signature into a log line', () => {
    const lines: string[] = []
    const logger = pino({ redact: LOG_REDACT }, { write: (line: string) => lines.push(line) })
    logger.info({
      req: {
        headers: {
          cookie: 'access_token=secret-access',
          authorization: 'Bearer secret-bearer',
          'stripe-signature': 't=1,v1=secret-signature',
        },
      },
      res: {
        headers: {
          'set-cookie': ['access_token=secret-set; HttpOnly', 'refresh_token=secret-refresh'],
        },
      },
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toMatch(/secret-/)
    expect(lines[0]).toContain('[Redacted]')
  })
})
