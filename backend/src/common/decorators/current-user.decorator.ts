import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { TenantContext } from '../../tenancy/tenant-context'

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const req = ctx.switchToHttp().getRequest<{ tenant?: TenantContext }>()
    if (!req.tenant)
      throw new Error('CurrentUser used without TenantMiddleware: the route is unprotected')
    return req.tenant
  },
)
