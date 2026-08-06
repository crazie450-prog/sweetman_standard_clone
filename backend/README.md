# Nexus Restaurant Manager — Backend

NestJS API for the **Nexus** multi-tenant restaurant management platform (Sprint 2).
Every screen the frontend ships reads through this API, and both sides change in
one commit. The full endpoint reference is generated from the code and served at
`/api/docs` (Swagger) once the server is running.

## Running

```bash
docker compose up -d          # from the repo root: postgres :5432 (+ redis, idle until Sprint 3)
npm install
npx prisma migrate dev        # apply schema
npx prisma db seed            # two demo organizations
npm run dev                   # :8000 · Swagger at /api/docs
```

`.env` is derived from `.env.example`; generate real JWT secrets with
`openssl rand -base64 48`. No AI/Stripe/AWS keys live here yet (Sprints 3–4).

### Demo logins (password `Nexus_dev1`)

| Email | Role | Why it exists |
|---|---|---|
| `owner@goldenfork.com` | owner | full access |
| `maria@goldenfork.com` | manager | role boundaries |
| `ken@goldenfork.com` | staff | what staff may *not* do |
| `owner@bellacucina.com` | owner | second tenant — proves isolation |

Both organizations deliberately share names ("Prime Meats Co.", "Marinara Sauce"),
so a leak between them is visible rather than plausible.

## Checks

```bash
npx tsc --noEmit && npm run lint && npm run build
npx jest --setupFiles dotenv/config          # tenant isolation + costing core
npx jest --config test/jest-e2e.json         # auth, contract, location scope, RLS (needs db + seed)
```

The same three commands run on every push and pull request
([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)), against a throwaway Postgres.

## How it is put together

- **Tenancy — three layers, not one.** A middleware reads the session cookie and puts
  the tenant into `AsyncLocalStorage`; a Prisma client extension scopes every query and
  stamps every write with `organizationId`; Postgres row-level security is the last line
  if application code ever forgets. A foreign id answers `404`, never `403` — the API
  does not confirm that someone else's record exists.
  RLS is not a claim: `test/rls.e2e-spec.ts` connects as `nexus_app` — a role that does
  **not** own the tables, so the policies actually apply to it — and shows that without
  `app.current_org` nothing is visible, with it only one organization is, and a write
  aimed at another tenant is rejected by the database itself. That role is what any
  connection *around* the application gets: analytics, a migration script, a manual
  `psql`. The application keeps its own scope from layers 1–2.
- **Location is the second axis, and it is enforced.** `X-Location-Id` arrives from the
  client, so it is input, not fact: a global guard checks the location belongs to the
  tenant and to the user's assignments before anything reads or writes. Lists narrow to
  the active location; the catalog (recipes, menu items) also shows organization-wide
  rows, which are the ones with no location. Stock is kept twice — per location and
  consolidated — so the switcher in the header changes the numbers instead of decorating
  them.
- **Auth.** JWT in HttpOnly cookies (access 15 min, refresh 7 days on `/api/auth`),
  refresh rotation with reuse detection, argon2 hashes, lockout after repeated failures,
  and identical answers for unknown email vs. wrong password.
- **Roles.** One ladder — `viewer < staff < manager < admin < owner`; `@Roles('manager')`
  means "this and above". Platform-admin routes are invisible (`404`) to everyone else.
- **Costing (`src/costing`).** Recipe cost = ingredients + nested recipe contributions,
  computed bottom-up over the whole graph in one pass. Cycles are rejected on three
  levels (database check, graph walk before insert, depth limit 5). Changing an
  ingredient price cascades to every recipe and menu item that depends on it.
- **Module shape.** Each domain module is a single file — DTOs, service, controller,
  module together — because they change together. Decimal values become plain numbers
  at the API edge so the frontend never parses strings.

- **Infrastructure seams.** Mail, document storage and crash reporting each have one
  service with two drivers, chosen by environment rather than by a flag in code:
  `S3_BUCKET` switches `StorageService` from a local directory to S3, `BUGSNAG_API_KEY`
  switches `ErrorReporterService` from silence to BugSnag. Nothing to rewrite when the
  credentials appear — see `.env.example`.

## Not here yet

AI document processing and queues (Sprint 3), Stripe billing (Sprint 4).
Endpoints for those return empty collections or static data on purpose, and say
so in their Swagger description. Redis is up in `docker compose` but unused
until the queues arrive.
