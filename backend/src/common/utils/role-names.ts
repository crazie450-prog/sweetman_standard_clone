import type { Role } from '../../generated/prisma/client'

export const ROLE_NAMES: Record<Role, string> = {
  owner: 'Restaurant Executive',
  admin: 'Administrator',
  manager: 'Restaurant Manager',
  staff: 'Executive Chef',
  viewer: 'Team Member',
}
