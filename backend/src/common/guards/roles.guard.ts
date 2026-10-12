import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY, roleAtLeast } from '../decorators/roles.decorator'
import type { Role } from '../../generated/prisma/client'
import type { TenantContext } from '../../tenancy/tenant-context'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (!required) return true

    const req = ctx.switchToHttp().getRequest<{ tenant?: TenantContext }>()
    const tenant = req.tenant
    if (!tenant) return true

    if (!roleAtLeast(tenant.role, required)) {
      throw new ForbiddenException({
        code: 'ROLE_TOO_LOW',
        message: `Requires ${required} role or higher`,
      })
    }
    return true
  }
}
