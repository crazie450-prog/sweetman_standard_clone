import { applyDecorators, UseGuards } from '@nestjs/common'
import { Throttle, ThrottlerGuard, type ThrottlerModuleOptions } from '@nestjs/throttler'
import { appEnv, setting, type Source } from '../config/integrations'

const MINUTE = 60_000

export function rateLimited(env: Source): boolean {
  const stated = setting(env, 'AUTH_RATE_LIMIT').toLowerCase()
  if (stated === 'on') return true
  if (stated === 'off') return false
  return appEnv(env) !== 'development'
}

export function rateLimitOptions(config: Source): ThrottlerModuleOptions {
  return {
    throttlers: [{ name: 'default', ttl: MINUTE, limit: 20 }],
    errorMessage: 'Too many attempts from this address; wait a minute and try again',
    skipIf: () => !rateLimited(config),
  }
}

export function AttemptsPerMinute(limit: number) {
  return applyDecorators(UseGuards(ThrottlerGuard), Throttle({ default: { limit, ttl: MINUTE } }))
}
