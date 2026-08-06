import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common'
import type { TenantContext } from '../../tenancy/tenant-context'

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ tenant?: TenantContext }>()
    if (!req.tenant?.isPlatformAdmin) throw new NotFoundException()
    return true
  }
}
