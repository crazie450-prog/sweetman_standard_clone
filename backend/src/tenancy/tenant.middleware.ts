import { Inject, Injectable, NestMiddleware } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { NextFunction, Request, Response } from 'express'
import { tenantStorage, TenantContext } from './tenant-context'
import type { Role } from '../generated/prisma/client'
import type { AppConfig } from '../config/env.validation'

export interface AccessTokenPayload {
  sub: string // userId
  org: string // organizationId
  role: Role
  pa?: boolean // isPlatformAdmin
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ConfigService) private readonly config: AppConfig,
  ) {}

  use(req: Request, _res: Response, next: NextFunction) {
    const payload = this.verified(req)
    if (payload) {
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
    }
    next()
  }

  private verified(req: Request): AccessTokenPayload | null {
    const token = (req.cookies as Record<string, string> | undefined)?.access_token
    if (!token) return null
    try {
      return this.jwt.verify<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET', { infer: true }),
      })
    } catch {
      return null
    }
  }
}
