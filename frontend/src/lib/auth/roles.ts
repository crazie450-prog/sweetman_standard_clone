export const ROLE_RANK: Record<string, number> = {
  viewer: 0,
  staff: 1,
  manager: 2,
  admin: 3,
  owner: 4,
}

export type Role = keyof typeof ROLE_RANK

export const allowed = (role: string | undefined, minRole?: Role) =>
  !minRole || (ROLE_RANK[role ?? ''] ?? -1) >= ROLE_RANK[minRole]
