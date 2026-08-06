import { SetMetadata } from '@nestjs/common'
import type { Role } from '../../generated/prisma/client'

export const ROLES_KEY = 'requiredRole'

export const ROLE_ORDER: Role[] = ['viewer', 'staff', 'manager', 'admin', 'owner']

export function roleAtLeast(actual: Role, required: Role): boolean {
  return ROLE_ORDER.indexOf(actual) >= ROLE_ORDER.indexOf(required)
}

export const Roles = (role: Role) => SetMetadata(ROLES_KEY, role)
