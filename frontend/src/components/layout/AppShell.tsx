'use client'

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils/cn'
import { adoptCurrency, adoptedCurrency } from '@/lib/utils/format'
import { Button, IconButton } from '@/components/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authService } from '@/lib/api/services'
import { getActiveLocationId, setActiveLocationId } from '@/lib/api/active-location'
import { allowed, type Role } from '@/lib/auth/roles'
import { queries } from '@/lib/api/queries'

async function logout(queryClient: ReturnType<typeof useQueryClient>) {
  await authService.logout().catch(() => undefined)
  queryClient.clear()
  try {
    setActiveLocationId('')
  } catch {}
  window.location.replace('/login')
}

function toggleTheme() {
  const dark = document.documentElement.classList.toggle('dark')
  try {
    localStorage.setItem('nexus.theme', dark ? 'dark' : 'light')
  } catch {}
}

const NavIcon = ({ d, circle }: { d: string; circle?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-4 shrink-0"
    aria-hidden
  >
    {circle && <circle cx="12" cy="12" r="3" />}
    <path d={d} />
  </svg>
)

const GEAR_PATH =
  'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z'

const ICON: Record<string, ReactNode> = {
  '/dashboard': <NavIcon d="M3 10.5 12 3l9 7.5M5 9.5V20h5v-5h4v5h5V9.5" />,
  '/production': <NavIcon d="M13 2 4 13h6l-1 9 9-11h-6l1-9" />,
  '/sales': (
    <NavIcon d="M12 3v18M16 7.5C16 6 14.2 5 12 5s-4 1-4 2.5 1.5 2.3 4 2.5 4 1 4 2.5-1.8 2.5-4 2.5-4-1-4-2.5" />
  ),
  '/waste': (
    <NavIcon d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13h8l1-13M10 11v6M14 11v6" />
  ),
  '/documents': <NavIcon d="M6 3h8l4 4v14H6zM14 3v4h4" />,
  '/recipes': <NavIcon d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2v14" />,
  '/components': <NavIcon d="M12 3 3 8l9 5 9-5-9-5M3 12l9 5 9-5M3 16l9 5 9-5" />,
  '/menus': <NavIcon d="M5 4h14v16l-7-3-7 3V4Z" />,
  '/menu': <NavIcon d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  '/menu/mapping': <NavIcon d="M4 7h6M4 12h6M4 17h6M13 12h7M17 9l3 3-3 3" />,
  '/inventory': <NavIcon d="M12 3 4 7v10l8 4 8-4V7l-8-4M4 7l8 4 8-4M12 11v10" />,
  '/purchasing': (
    <NavIcon d="M3 4h2l2.4 12h11.2L21 8H7M9 20a1 1 0 1 0 0 .01M17 20a1 1 0 1 0 0 .01" />
  ),
  '/ingredients': <NavIcon d="M4 6h16M4 12h16M4 18h10M18.5 16.5a2 2 0 1 1-.01 0M20 20l-1.2-1.2" />,
  '/ingredients/mapping': <NavIcon d="M4 7h6M4 12h6M4 17h6M13 12h7M17 9l3 3-3 3" />,
  '/vendors': (
    <NavIcon d="M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3" />
  ),
  '/vendors/products': (
    <NavIcon d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9M7.5 5.2l9 4.5" />
  ),
  '/analytics/food-cost': <NavIcon d="M4 20V10M10 20V4M16 20v-7M20 20H3.5" />,
  '/reports': <NavIcon d="M6 3h8l4 4v14H6zM14 3v4h4M9 17v-3M12 17v-5M15 17v-2" />,
  '/settings': <NavIcon circle d={GEAR_PATH} />,
  '/team': (
    <NavIcon d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 20c0-3 2.7-5 6-5s6 2 6 5M16 10a3 3 0 1 0-1-5.8M15 15c3 .2 6 2 6 5" />
  ),
  '/settings/properties': (
    <NavIcon d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M8 8h2M8 12h2M8 16h2M15 9h4a1 1 0 0 1 1 1v11M3 21h18" />
  ),
  '/settings/units': <NavIcon d="M3 7h13M13 4l3 3-3 3M21 17H8M11 14l-3 3 3 3" />,
  '/settings/categories': <NavIcon d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  '/subscription': <NavIcon d="M3 6h18v12H3zM3 10h18M6 15h4" />,
}

const BADGE_HREF = '/documents'

const subscribeToNothing = () => () => {}

const NAV_ALL: { group: string; items: { href: string; label: string; minRole?: Role }[] }[] = [
  {
    group: 'Dashboard',
    items: [{ href: '/dashboard', label: 'Dashboard' }],
  },
  {
    group: 'Operations',
    items: [
      { href: '/production', label: 'Production' },
      { href: '/sales', label: 'Sales' },
      { href: '/waste', label: 'Waste Entry', minRole: 'staff' },
      { href: '/documents', label: 'Documents', minRole: 'staff' },
    ],
  },
  {
    group: 'Recipe Management',
    items: [
      { href: '/recipes', label: 'Recipes' },
      { href: '/components', label: 'Components' },
      { href: '/menus', label: 'Menus' },
      { href: '/menu', label: 'Menu Items' },
      { href: '/menu/mapping', label: 'Sales Mapping', minRole: 'manager' },
    ],
  },
  {
    group: 'Inventory',
    items: [
      { href: '/inventory', label: 'Inventory' },
      { href: '/purchasing', label: 'Purchasing', minRole: 'staff' },
      { href: '/ingredients', label: 'Ingredients' },
      { href: '/ingredients/mapping', label: 'Ingredient Mapping', minRole: 'manager' },
      { href: '/vendors', label: 'Vendors' },
      { href: '/vendors/products', label: 'Vendor Products' },
    ],
  },
  {
    group: 'Analytics & Reports',
    items: [
      { href: '/analytics/food-cost', label: 'Food Cost Analysis' },
      { href: '/reports', label: 'Reports' },
    ],
  },
  {
    group: 'Settings',
    items: [
      { href: '/profile', label: 'My Profile' },
      { href: '/settings', label: 'Settings', minRole: 'admin' },
      { href: '/team', label: 'Team', minRole: 'manager' },
      { href: '/settings/properties', label: 'Property Management', minRole: 'manager' },
      { href: '/settings/units', label: 'Unit Conversions', minRole: 'manager' },
      { href: '/settings/categories', label: 'Categories', minRole: 'manager' },
      { href: '/subscription', label: 'Subscription & Billing', minRole: 'owner' },
    ],
  },
]

function useVisibleNav(role: string | undefined) {
  return NAV_ALL.map((g) => ({
    ...g,
    items: g.items.filter((i) => allowed(role, i.minRole)),
  })).filter((g) => g.items.length > 0)
}

const GroupIcon = ({ d, circle }: { d: string; circle?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-5"
    aria-hidden
  >
    <path d={d} />
    {circle && <circle cx="12" cy="12" r="3" />}
  </svg>
)

const GROUP_ICON: Record<string, ReactNode> = {
  Dashboard: <GroupIcon d="M3 10.5 12 3l9 7.5M5 9.5V20h5v-5h4v5h5V9.5" />,
  Operations: <GroupIcon d="M13 2 4 13h6l-1 9 9-11h-6l1-9" />,
  'Recipe Management': (
    <GroupIcon d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2v14" />
  ),
  Inventory: <GroupIcon d="M12 3 4 7v10l8 4 8-4V7l-8-4M4 7l8 4 8-4M12 11v10" />,
  'Analytics & Reports': <GroupIcon d="M4 20V10M10 20V4M16 20v-7M20 20H3.5" />,
  Settings: <GroupIcon circle d={GEAR_PATH} />,
}

function isActive(pathname: string, href: string, all: string[]) {
  if (pathname === href) return true
  if (!pathname.startsWith(href + '/')) return false
  return !all.some(
    (h) => h !== href && h.length > href.length && (pathname === h || pathname.startsWith(h + '/'))
  )
}

function RailSidebar() {
  const { data: kpis } = useQuery(queries.dashboardKpis())
  const { data: currentUser } = useQuery(queries.orgCurrent())
  const queryClient = useQueryClient()
  const pathname = usePathname()
  const router = useRouter()
  const NAV = useVisibleNav(currentUser?.roleKey)
  const allHrefs = NAV.flatMap((g) => g.items.map((i) => i.href))

  const activeGroup =
    NAV.find((g) => g.items.some((i) => isActive(pathname, i.href, allHrefs)))?.group ??
    NAV[0].group

  const [browseGroup, setBrowseGroup] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [lastPath, setLastPath] = useState(pathname)
  if (pathname !== lastPath) {
    setLastPath(pathname)
    setBrowseGroup(null)
  }

  const shownGroup = browseGroup ?? activeGroup
  const shownItems = NAV.find((g) => g.group === shownGroup)?.items ?? []

  return (
    <div className="flex h-full">
      <div className="flex min-h-0 w-16 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-surface-subtle py-3">
        <span className="mb-4 flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-sm font-bold text-white shadow-sm">
          N
        </span>
        {NAV.map(({ group, items }) => {
          const isCurrent = group === activeGroup
          const isShown = group === shownGroup
          return (
            <button
              key={group}
              type="button"
              title={group}
              aria-label={group}
              aria-current={isCurrent ? 'true' : undefined}
              onClick={() => {
                setBrowseGroup(group)
                if (items.length === 1) {
                  router.push(items[0].href)
                } else if (collapsed) {
                  setCollapsed(false)
                }
              }}
              className={cn(
                'relative flex size-11 items-center justify-center rounded-xl transition duration-150 hover:-translate-y-0.5 active:scale-95',
                isShown ? 'bg-surface shadow-sm ring-1 ring-border' : 'hover:bg-surface/70',
                isCurrent
                  ? 'text-primary-700 dark:text-primary-300'
                  : 'text-text-muted hover:text-text'
              )}
            >
              {GROUP_ICON[group]}
              {isCurrent && !isShown && (
                <span
                  className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary-600"
                  aria-hidden
                />
              )}
            </button>
          )
        })}

        <div className="mt-auto">
          <button
            type="button"
            onClick={toggleTheme}
            title="Dark Mode"
            aria-label="Toggle dark mode"
            className="flex size-11 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-surface/70 hover:text-text"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
              aria-hidden
            >
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          </button>
        </div>
      </div>

      <div
        className={cn(
          'shrink-0 overflow-hidden bg-surface transition-[width] duration-200 ease-out',
          collapsed ? 'w-0' : 'w-56'
        )}
      >
        <div className="flex h-full w-56 flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between pr-2 pl-4">
            <span className="truncate text-[11px] font-semibold tracking-[0.08em] text-text-muted uppercase">
              {shownGroup}
            </span>
            <button
              type="button"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              onClick={() => setCollapsed(true)}
              className="flex size-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-subtle hover:text-text"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden>
                <path
                  fillRule="evenodd"
                  d="M12.78 4.22a.75.75 0 010 1.06L8.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L6.44 10.53a.75.75 0 010-1.06l5.28-5.25a.75.75 0 011.06 0z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
          <nav
            className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4"
            aria-label={shownGroup}
          >
            {shownItems.map(({ href, label }) => {
              const badge = href === BADGE_HREF ? kpis?.pendingDocuments : undefined
              const active = isActive(pathname, href, allHrefs)
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                    active
                      ? 'bg-primary-50 font-medium text-primary-900 ring-1 ring-primary-100 dark:bg-primary-900/25 dark:text-primary-100 dark:ring-primary-900/40'
                      : 'text-text-muted hover:bg-surface-subtle hover:text-text'
                  )}
                >
                  {active && (
                    <span
                      className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary-600"
                      aria-hidden
                    />
                  )}
                  <span
                    className={
                      active ? 'text-primary-700 dark:text-primary-300' : 'text-text-muted'
                    }
                  >
                    {ICON[href]}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {badge !== undefined && badge > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary-100 py-0.5 pr-1.5 pl-1 text-[11px] font-semibold text-primary-800 tabular-nums dark:bg-primary-900/40 dark:text-primary-200">
                      <span className="relative flex size-1.5 shrink-0" aria-hidden>
                        <span className="status-ping absolute inset-0 rounded-full bg-current" />
                        <span className="relative size-1.5 rounded-full bg-current" />
                      </span>
                      {badge}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>
          <div className="shrink-0 border-t border-border p-3">
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => logout(queryClient)}
            >
              Logout
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SidebarContent({
  onNavigate,
  onCollapse,
}: {
  onNavigate?: () => void
  onCollapse?: () => void
}) {
  const { data: currentUser } = useQuery(queries.orgCurrent())
  const queryClient = useQueryClient()
  const pathname = usePathname()
  const NAV = useVisibleNav(currentUser?.roleKey)
  const allHrefs = NAV.flatMap((g) => g.items.map((i) => i.href))
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggleGroup = (group: string) => setCollapsed((c) => ({ ...c, [group]: !c[group] }))

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 text-sm font-bold text-white">
          N
        </span>
        <span className="font-semibold tracking-wide">NEXUS</span>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse sidebar"
            className="ml-auto hidden rounded-lg p-1.5 text-text-muted hover:bg-bg hover:text-text lg:block"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden>
              <path
                fillRule="evenodd"
                d="M12.78 4.22a.75.75 0 010 1.06L8.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L6.44 10.53a.75.75 0 010-1.06l5.28-5.25a.75.75 0 011.06 0z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>

      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
        {NAV.map(({ group, items }) => {
          const isCollapsed = !!collapsed[group]
          return (
            <div key={group}>
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center justify-between rounded-lg px-2 pb-1 text-[11px] font-semibold tracking-wider text-text-muted uppercase hover:text-text"
              >
                <span>{group}</span>
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden
                  className={cn(
                    'size-3.5 shrink-0 transition-transform',
                    isCollapsed ? '-rotate-90' : 'rotate-0'
                  )}
                >
                  <path
                    fillRule="evenodd"
                    d="M5.22 7.47a.75.75 0 011.06 0L10 11.19l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 8.53a.75.75 0 010-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              {!isCollapsed && (
                <ul className="space-y-0.5">
                  {items.map(({ href, label }) => {
                    const active = isActive(pathname, href, allHrefs)
                    return (
                      <li key={href}>
                        <Link
                          href={href}
                          onClick={onNavigate}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                            active
                              ? 'bg-primary-50 font-medium text-primary-900 ring-1 ring-primary-100 dark:bg-primary-900/25 dark:text-primary-100 dark:ring-primary-900/40'
                              : 'text-text-muted hover:bg-surface/70 hover:text-text'
                          )}
                        >
                          <span
                            className={
                              active ? 'text-primary-700 dark:text-primary-300' : 'text-text-muted'
                            }
                          >
                            {ICON[href]}
                          </span>
                          {label}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </nav>

      <div className="shrink-0 space-y-3 border-t border-border p-3">
        <button
          type="button"
          onClick={toggleTheme}
          className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm text-text hover:bg-bg"
        >
          <span>Dark Mode</span>
          <span aria-hidden>☾</span>
        </button>
        <div className="flex items-center gap-2 px-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-800">
            {(currentUser?.name ?? '')
              .split(' ')
              .map((s) => s[0])
              .join('')}
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-medium">{currentUser?.name ?? '—'}</p>
            <p className="truncate text-xs text-text-muted">{currentUser?.role ?? ''}</p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          onClick={() => logout(queryClient)}
        >
          Logout
        </Button>
      </div>
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { data: currentUser } = useQuery(queries.orgCurrent())
  const { data: locations = [] } = useQuery(queries.locations())
  const { data: subscription } = useQuery({
    ...queries.billingSubscription(),
    staleTime: 60000,
  })
  const { data: organization } = useQuery(queries.organization())
  adoptCurrency(organization?.currency)
  const [locationId, setLocationId] = useState(() => getActiveLocationId())
  const queryClient = useQueryClient()

  const mayReviewAllLocations = allowed(currentUser?.roleKey, 'admin')
  const known = locationId && locations.some((l) => l.id === locationId) ? locationId : ''
  const selectedLocation =
    !currentUser || mayReviewAllLocations ? known : known || (locations[0]?.id ?? '')

  const changeLocation = (id: string) => {
    setLocationId(id)
    setActiveLocationId(id)
    void queryClient.invalidateQueries()
  }

  useEffect(() => {
    if (locations.length === 0 || !currentUser) return
    const stored = getActiveLocationId()
    if (stored && locations.some((l) => l.id === stored)) return
    if (selectedLocation === stored) return
    setActiveLocationId(selectedLocation)
    void queryClient.invalidateQueries()
  }, [selectedLocation, locations, currentUser, queryClient])

  const today = useSyncExternalStore(
    subscribeToNothing,
    () =>
      new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    () => ''
  )

  return (
    <div className="flex min-h-dvh overflow-clip bg-surface lg:m-3 lg:min-h-[calc(100dvh-1.5rem)] lg:rounded-2xl lg:shadow-lg lg:ring-1 lg:ring-border">
      <aside className="hidden shrink-0 self-start border-r border-border lg:sticky lg:top-3 lg:block lg:h-[calc(100dvh-1.5rem)]">
        <RailSidebar />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface">
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface px-4 sm:gap-3 sm:px-6">
          <span className="dawn-strip absolute inset-x-0 top-0" aria-hidden />
          <IconButton
            aria-label="Open menu"
            className="lg:hidden"
            onClick={() => setDrawerOpen(true)}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-5" aria-hidden>
              <path
                fillRule="evenodd"
                d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zM2 10a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 10zm0 5.25a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z"
                clipRule="evenodd"
              />
            </svg>
          </IconButton>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <span className="hidden items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-text-muted xl:flex">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                className="sun-spin size-4 text-warning-600"
                aria-hidden
              >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
              <span>{today}</span>
            </span>

            <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />

            <div className="relative">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-primary-700 dark:text-primary-300"
                aria-hidden
              >
                <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <select
                aria-label="Location"
                value={selectedLocation}
                onChange={(e) => changeLocation(e.target.value)}
                className="h-9 max-w-[45vw] cursor-pointer appearance-none truncate rounded-lg border border-border bg-surface pl-8 pr-8 text-sm font-medium text-text shadow-xs transition-colors hover:border-border-strong focus:outline-2 focus:outline-offset-1 focus:outline-primary-600 sm:max-w-56"
              >
                {mayReviewAllLocations && <option value="">All locations</option>}
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-text-muted"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M5.22 7.47a.75.75 0 011.06 0L10 11.19l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 8.53a.75.75 0 010-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </div>

            <div
              className="flex items-center gap-2.5"
              title={currentUser ? `${currentUser.name} · ${currentUser.role}` : ''}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-[13px] font-semibold text-white ring-2 ring-primary-100 dark:ring-primary-900/50">
                {(currentUser?.name ?? '')
                  .split(' ')
                  .map((s) => s[0])
                  .join('')}
              </div>
              <div className="hidden min-w-0 leading-tight xl:block">
                <p className="max-w-32 truncate text-[13px] font-semibold">
                  {currentUser?.name ?? '—'}
                </p>
                <p className="max-w-32 truncate text-[11px] text-text-muted">
                  {currentUser?.role ?? ''}
                </p>
              </div>
            </div>
          </div>
        </header>

        {subscription?.reason && (
          <div
            role="status"
            className={cn(
              'border-b px-4 py-2 text-sm sm:px-6',
              subscription.restricted
                ? 'border-danger-200 bg-danger-50 text-danger-800 dark:border-danger-900/40 dark:bg-danger-900/20 dark:text-danger-100'
                : 'border-warning-200 bg-warning-50 text-warning-800 dark:border-warning-900/40 dark:bg-warning-900/20 dark:text-warning-100'
            )}
          >
            {subscription.reason}{' '}
            {allowed(currentUser?.roleKey, 'owner') && (
              <Link href="/subscription" className="font-semibold underline">
                Open Subscription
              </Link>
            )}
          </div>
        )}
        <main
          key={adoptedCurrency()}
          className="sunlit min-w-0 flex-1 bg-surface-subtle p-4 sm:p-6"
        >
          {children}
        </main>
      </div>
    </div>
  )
}
