import type { Response } from 'express'

const isProd = () => process.env.NODE_ENV === 'production'

export const ACCESS_COOKIE = 'access_token'
export const REFRESH_COOKIE = 'refresh_token'

const base = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProd(),
})

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...base(),
    path: '/',
    maxAge: 15 * 60 * 1000,
  })
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base(),
    path: '/api/auth',
    maxAge: 7 * 24 * 3600 * 1000,
  })
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(), path: '/' })
  res.clearCookie(REFRESH_COOKIE, { ...base(), path: '/api/auth' })
}
