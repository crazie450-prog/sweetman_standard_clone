# Nexus Restaurant Manager: Frontend

Frontend for the **Nexus** multi-tenant restaurant management platform. It talks to the
NestJS API in [`../backend`](../backend) (real login, real tenant data, real recipe costing)
and has no data source of its own: without the API the screens are empty.

## Stack

- **Next.js 16** (App Router, Turbopack) · **React 19** · **TypeScript**
- **Tailwind CSS 4** (`@theme` tokens, `@custom-variant dark`)
- **@tanstack/react-query** (server-state layer)
- **Playwright** (browser suite in `e2e/`)

## Getting started

Start the backend first (see its README), then:

```bash
npm install
cp .env.example .env.local   # point NEXT_PUBLIC_API_URL at the backend
npm run dev                  # http://localhost:3000
```

Sign in with a seeded account (e.g. `owner@goldenfork.com` / `Nexus_dev1`).
The session lives in HttpOnly cookies: the browser holds it, JavaScript never
sees a token. The location switcher in the topbar travels with every request as
an `X-Location-Id` header, so switching it re-fetches the whole screen.

### Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server (Turbopack) on :3000 |
| `npm run build` | Production build |
| `npm run start` | Serve the production build locally (the image runs the standalone server instead) |
| `npm run lint` | ESLint |
| `npm run format` · `npm run format:check` | Prettier: rewrite or only check the layout |
| `npm run test:e2e` | Browser suite, against `npm run start`, not the dev server, with the API and the seed in place. Two projects: `chromium` (desktop) and `mobile` (a phone with touch, `e2e/mobile.spec.ts` only); `--project=mobile` runs the phone alone |

`E2E_BASE_URL=https://<web host> npx playwright test -g "Authentication|Screens carry data"`
runs the smoke part of the suite against a deployed environment; the isolation and billing
blocks need the local seed and skip there.

### Docker

The image is built by [`Dockerfile`](Dockerfile) from Next's standalone output
(`output: "standalone"` in `next.config.ts`): the runtime layer holds the traced server and the
static assets only, runs as the `node` user, and starts with `node server.js`. Every
`NEXT_PUBLIC_*` value is inlined at build time, so it is passed as a build argument. The deployment shape, including the compose file
that builds both images, is in [`../DEPLOYMENT.md`](../DEPLOYMENT.md).

## Environment

All variables are documented in [`.env.example`](./.env.example); all three are read at build
time:

| Variable | Default | Purpose |
|----------|---------|---------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | NestJS backend base URL |
| `NEXT_PUBLIC_BUGSNAG_API_KEY` | empty | BugSnag browser key; empty keeps reporting off and loads nothing |
| `NEXT_PUBLIC_APP_ENV` | `development` | release stage; only `staging` and `production` report errors |

> **Security:** these are `NEXT_PUBLIC_*`, so they ship to the browser. Never put
> secrets (Gemini/Stripe/AWS keys) here; those belong to the backend.
> `.env.local` is git-ignored; only `.env.example` (placeholders) is committed.

## Project structure

```
src/
  app/            App Router routes
    (auth)/       login, signup, reset-password
    (app)/        authenticated shell: dashboard, documents, ingredients (+ mapping),
                  inventory, purchasing, vendors (+ products), recipes,
                  components, menus, menu items (+ sales mapping), production,
                  sales, waste, food-cost analysis, reports, team, settings (+ properties,
                  categories, units), subscription, profile
    admin/        platform-administrator area: organizations, users, processing queue
    design/       component gallery, opened by the platform administrator only
  components/
    ui/           reusable primitives: Button, Card/KpiCard, Table, Field,
                  Filters, Modal, Toast, Badge, UploadZone, Stepper, EmptyState,
                  PageHeader, Spinner
    layout/       AppShell (sidebar + responsive mobile drawer + topbar + banners),
                  RequireRole
    documents/    the extraction editor shared by the review dialog and the admin panel
    admin/        row actions shared by the admin screens
  lib/
    api/          integration layer for NestJS (see below)
    utils/        cn(), formatters
e2e/              Playwright suite: smoke, then one file per screen area
```

Domain types live in `lib/api/types/` and describe what the API actually
returns; `lib/api/services` re-exports them, so a screen imports both from one place.

## Backend-integration layer (`src/lib/api`)

Every screen reads and writes through this layer; no component talks to `fetch`
directly.

- **`client.ts`**: one shared HTTP client. Auth via **HttpOnly cookie**
  (`credentials: 'include'`), automatic `401 → silent refresh → redirect to
  login`, the active location travelling as an `X-Location-Id` header, and a
  typed `ApiError` whose server sentence the screens show as-is.
- **`services/`**: typed services, one file per domain (recipes, catalogue, vendors,
  operations, documents, reports, account, admin). Each method is a single call to the API;
  there is no second data source.
- **`types/`**: the request and response shapes, written from what the API returns, in the
  same eight domains.
- **`queries.ts`**: every query the screens make, declared once with its key, and the type of
  a key's root; `useInvalidate.ts` names what each change refreshes and accepts only those
  roots.
- **`QueryProvider.tsx`**: React Query provider.

## Responsive

Layouts target desktop / tablet / mobile browsers (verified with zero horizontal
overflow at 1440 / 768 / 390 px). `AppShell` swaps the desktop sidebar for a
burger + slide-out drawer below `lg`. Dark mode is supported across screens.
