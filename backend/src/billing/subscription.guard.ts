import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator'
import { PrismaService } from '../prisma/prisma.service'
import type { TenantContext } from '../tenancy/tenant-context'
import { restriction } from './restriction'
import type { AppConfig } from '../config/env.validation'

const OPEN_PREFIXES = ['/api/billing', '/api/auth', '/api/organizations/current', '/api/admin']

export function graceDays(config: AppConfig): number {
  return config.getOrThrow('BILLING_GRACE_DAYS', { infer: true })
}

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (isPublic) return true

    const req = ctx.switchToHttp().getRequest<Request & { tenant?: TenantContext }>()
    const tenant = req.tenant
    if (!tenant || tenant.isPlatformAdmin) return true
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true
    if (OPEN_PREFIXES.some((prefix) => req.path.startsWith(prefix))) return true

    const org = await this.prisma.client.organization.findUnique({
      where: { id: tenant.organizationId },
      select: { subscriptionStatus: true, trialEndsAt: true, currentPeriodEnd: true },
    })
    if (!org) return true

    const verdict = restriction(org, new Date(), graceDays(this.config))
    if (verdict.restricted) {
      throw new HttpException(
        { code: 'SUBSCRIPTION_INACTIVE', message: verdict.reason as string },
        HttpStatus.PAYMENT_REQUIRED,
      )
    }
    return true
  }
}
