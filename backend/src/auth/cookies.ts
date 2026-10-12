import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Response } from 'express'
import type { AppConfig } from '../config/env.validation'

export const ACCESS_COOKIE = 'access_token'
export const REFRESH_COOKIE = 'refresh_token'

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

export function lifetimeMs(value: string | undefined, fallback: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/.exec((value ?? fallback).trim())
  if (!match) return lifetimeMs(fallback, fallback)
  return Number(match[1]) * UNIT_MS[match[2] ?? 's']
}

@Injectable()
export class AuthCookies {
  constructor(@Inject(ConfigService) private readonly config: AppConfig) {}

  private base() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
    }
  }

  set(res: Response, accessToken: string, refreshToken: string | null): void {
    res.cookie(ACCESS_COOKIE, accessToken, {
      ...this.base(),
      path: '/',
      maxAge: lifetimeMs(this.config.get('JWT_ACCESS_TTL', { infer: true }), '15m'),
    })
    if (refreshToken === null) return
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...this.base(),
      path: '/api/auth',
      maxAge: lifetimeMs(this.config.get('JWT_REFRESH_TTL', { infer: true }), '7d'),
    })
  }

  clear(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, { ...this.base(), path: '/' })
    res.clearCookie(REFRESH_COOKIE, { ...this.base(), path: '/api/auth' })
  }
}
