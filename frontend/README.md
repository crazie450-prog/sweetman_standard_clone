# Nexus Restaurant Manager — Frontend

Frontend for the **Nexus** multi-tenant restaurant management platform.
Built in **Sprint 1** as the full UI on mock data; since **Sprint 2** it talks to
the NestJS API in [`../backend`](../backend) — real login, real tenant data, real
recipe costing. Mock mode is still one flag away and needs no backend at all.

## Stack

- **Next.js 16** (App Router, Turbopack) · **React 19** · **TypeScript**
- **Tailwind CSS 4** (`@theme` tokens, `@custom-variant dark`)
- **@tanstack/react-query** (server-state layer, ready for the real API)

## Getting started

The UI reads and writes through the NestJS API only, so start the backend first
(see its README).

```bash
npm install
cp .env.example .env.local   # point NEXT_PUBLIC_API_URL at the backend
npm run dev                  # http://localhost:3000
```

Sign in with a seeded account (e.g. `owner@goldenfork.com` / `Nexus_dev1`).
The session lives in HttpOnly cookies — the browser holds it, JavaScript never
sees a token. The location switcher in the topbar travels with every request as
an `X-Location-Id` header, so switching it re-fetches the whole screen.

### Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server (Turbopack) on :3000 |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |

### Docker

```bash
docker build -t nexus-frontend .
docker run -d --name nexus-frontend -p 3000:3000 nexus-frontend
# → http://localhost:3000
```

`NEXT_PUBLIC_API_URL` is inlined at build time, so pass it as a build argument.

## Environment

All variables are documented in [`.env.example`](./.env.example). One is used:

| Variable | Default | Purpose |
|----------|---------|---------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | NestJS backend base URL |

> **Security:** these are `NEXT_PUBLIC_*` — they ship to the browser. Never put
> secrets (Anthropic/Gemini/Stripe/AWS keys) here; those belong to the backend.
> `.env.local` is git-ignored; only `.env.example` (placeholders) is committed.

## Project structure

```
src/
  app/            App Router routes (~30 pages)
    (auth)/       login, signup, reset-password
    (app)/        authenticated shell: dashboard, recipes, menu, inventory,
                  vendors, sales, waste, reports, analytics, settings, …
    admin/        platform-admin area (organizations, document queue)
    design/       dev-only component gallery (not a product screen)
  components/
    ui/           reusable primitives — Button, Card/KpiCard, Table, Field,
                  Filters, Modal, Toast, Badge, UploadZone, Stepper, EmptyState,
                  PageHeader, Spinner
    layout/       AppShell (sidebar + responsive mobile drawer + topbar)
  lib/
    api/          integration layer for NestJS (see below)
    utils/        cn(), formatters
```

Domain types live in `lib/api/types.ts` and describe what the API actually
returns; `services.ts` re-exports them, so a screen imports both from one place.

## Backend-integration layer (`src/lib/api`)

Every screen reads and writes through this layer; no component talks to `fetch`
directly.

- **`client.ts`** — one shared HTTP client. Auth via **HttpOnly cookie**
  (`credentials: 'include'`), automatic `401 → silent refresh → redirect to
  login`, the active location travelling as an `X-Location-Id` header, and a
  typed `ApiError`.
- **`services.ts`** — typed domain services (recipes, ingredients, vendors,
  inventory, sales, waste, production, menu, team, documents, locations). Each
  is a single call to the API; there is no second data source.
- **`types.ts`** — the response shapes, written from what the API returns.
- **`QueryProvider.tsx`** — React Query provider.

## Responsive

Layouts target desktop / tablet / mobile browsers (verified with zero horizontal
overflow at 1440 / 768 / 390 px). `AppShell` swaps the desktop sidebar for a
burger + slide-out drawer below `lg`.

## Scope notes

- **Dark mode** is supported across screens.
- **Mock mode** keeps the whole UI browsable without a backend; actions that
  would write announce themselves as `(mock)` toasts.
- **Deferred to later sprints:** AI document processing and Stripe billing
  screens read from endpoints that are still intentionally empty, a guided
  onboarding wizard, and a touch-optimized Mobile Count screen.
