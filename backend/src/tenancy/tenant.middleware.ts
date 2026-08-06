import { Injectable, NestMiddleware } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { NextFunction, Request, Response } from 'express'
import { tenantStorage, TenantContext } from './tenant-context'
import type { Role } from '../generated/prisma/client'

export interface AccessTokenPayload {
  sub: string // userId
  org: string // organizationId
  role: Role
  pa?: boolean // isPlatformAdmin
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly jwt: JwtService) {}

  use(req: Request, _res: Response, next: NextFunction) {
    const token = (req.cookies as Record<string, string> | undefined)?.access_token
    if (token) {
      try {
        const payload = this.jwt.verify<AccessTokenPayload>(token, {
          secret: process.env.JWT_ACCESS_SECRET,
        })
        const locationHeader = req.headers['x-location-id']
        const ctx: TenantContext = {
          organizationId: payload.org,
          locationId: typeof locationHeader === 'string' && locationHeader ? locationHeader : null,
          userId: payload.sub,
          role: payload.role,
          isPlatformAdmin: payload.pa === true,
        }
        ;(req as Request & { tenant?: TenantContext }).tenant = ctx
        tenantStorage.enterWith(ctx)
      } catch {
        // Invalid or expired token leaves the request unauthenticated;
        // the auth guard is what rejects it, not this middleware.
      }
    }
    next()
  }
}
