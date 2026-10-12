# Nexus Restaurant Manager: Backend

NestJS API for the **Nexus** multi-tenant restaurant management platform. Every screen the
frontend ships reads through this API, and both sides change in one commit. The full endpoint
reference is generated from the code and served at `/api/docs` (Swagger) once the server is
running. How to deploy it is in [`../DEPLOYMENT.md`](../DEPLOYMENT.md), every variable in
[`../ENVIRONMENT.md`](../ENVIRONMENT.md), and how the whole product is put together in
[`../HANDOVER.md`](../HANDOVER.md).

## Running

```bash
docker compose up -d          # from the repo root: postgres :5432, redis :6379
npm install
cp .env.example .env          # fill in the two JWT secrets
npx prisma generate           # Prisma no longer generates the client on install
npx prisma migrate dev        # apply schema
npx prisma db seed            # two demo organizations
npm run dev                   # :8000 · Swagger at /api/docs
```

`.env` is derived from `.env.example`; generate real JWT secrets with
`openssl rand -base64 48`. Every external service (document extraction, mail, billing,
storage, crash reporting) has a stand-in that needs no key, so the API runs in full with
nothing but the database and Redis. The stand-ins are for development and staging: with
`APP_ENV=production` the API refuses to start on the extraction or billing stand-in.

### Demo logins (password `Nexus_dev1`)

| Email | Role | Why it exists |
|---|---|---|
| `owner@goldenfork.com` | owner | full access |
| `maria@goldenfork.com` | manager | role boundaries; assigned to one location |
| `ken@goldenfork.com` | staff | what staff may *not* do; assigned to two locations |
| `owner@bellacucina.com` | owner | second tenant, proves isolation |
| `platform@nexus.app` | platform administrator | the only account that opens `/admin/*` |

Both organizations deliberately share names ("Prime Meats Co.", "Marinara Sauce"),
so a leak between them is visible rather than plausible.

## Checks

```bash
npx tsc --noEmit && npm run lint && npm run format:check && npm run build
npx jest --setupFiles dotenv/config          # unit: tenant coverage and isolation, costing,
                                             # unit conversion, variance, recommendations,
                                             # billing, mail, storage keys, calendar, health
npx jest --config test/jest-e2e.json         # e2e: auth, contract, location scope, RLS,
                                             # documents, billing (needs db + seed)
npm run benchmark:extraction                 # scores extraction against the fixtures in test/
```

The e2e suites share one seeded database and mutate the same rows, so `test/jest-e2e.json`
pins one worker. The RLS suite connects as the `nexus_app` role a migration creates; if it
is missing, run `npx prisma migrate deploy` first. CI
([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs the install, `prisma generate`,
type check, lint and build from a clean checkout; the suites are run here, before a push.

## How it is put together

- **Tenancy: three layers, not one.** A middleware reads the session cookie and puts
  the tenant into `AsyncLocalStorage`; a Prisma client extension scopes every query and
  stamps every write with `organizationId`; Postgres row-level security is the last line
  if application code ever forgets. A foreign id answers `404`, never `403`: the API
  does not confirm that someone else's record exists.
  RLS is not a claim: `test/rls.e2e-spec.ts` connects as `nexus_app`, a role that does
  **not** own the tables, so the policies actually apply to it, and shows that without
  `app.current_org` nothing is visible, with it only one organization is, and a write
  aimed at another tenant is rejected by the database itself. That role is what any
  connection *around* the application gets: analytics, a migration script, a manual
  `psql`. The application keeps its own scope from layers 1 and 2.
  The classification lists in `src/tenancy/tenant.extension.ts` are explicit, and
  `tenant-coverage.spec.ts` reads the schema and fails until every model is on one of them.
- **Location is the second axis, and it is enforced.** `X-Location-Id` arrives from the
  client, so it is input, not fact: a global guard checks the location belongs to the
  tenant, is not archived, and is among the user's assignments before anything reads or writes. Lists narrow to
  the active location; the catalog (recipes, menu items) also shows organization-wide
  rows, which are the ones with no location. Stock is kept twice, per location and
  consolidated, so the switcher in the header changes the numbers instead of decorating
  them. Cost, vendor, reorder level and vendor code are held per location as well, with
  the organization's own record as the default a location without an override inherits.
- **Auth.** JWT in HttpOnly cookies (access 15 min, refresh 7 days on `/api/auth`),
  refresh rotation with reuse detection, argon2 hashes, lockout after repeated failures,
  and the same answer, in about the same time, for an unknown email and a wrong password.
  The public sign-in routes are rate limited per address (`AUTH_RATE_LIMIT`, on everywhere
  except `APP_ENV=development`; `TRUST_PROXY` says how many proxies stand in front). Sessions are one row per
  device: signing out ends one, a password change or a deactivation ends all.
- **Roles.** One ladder, `viewer < staff < manager < admin < owner`; `@Roles('manager')`
  means "this and above". Platform-admin routes are invisible (`404`) to everyone else, and a
  platform administrator is scoped like any tenant outside the panel's own methods.
- **Costing (`src/costing`).** Recipe cost = ingredients + nested recipe contributions,
  computed bottom-up over the whole graph in one pass, in the unit the ingredient is priced
  in. Cycles are rejected on three levels (database check, graph walk before insert, depth
  limit 5). Recipes are costed on the organization's shared ingredient price: changing it
  (with *All locations* active) recalculates every recipe and menu item that depends on it, in
  every location, whoever asks. A price set for one location belongs to that location and does
  not move recipe cost. The same directory holds food-cost variance and the purchase recommendation.
- **Documents (`src/modules/documents`).** Upload → storage → BullMQ queue on Redis → worker →
  extraction → review → confirm. The extractor sits behind `DOCUMENT_EXTRACTOR`: a
  deterministic stand-in, a local spreadsheet parser that runs in every mode, Gemini and Claude.
  Confirm is the only place a document moves prices, stock or sales, it is idempotent, and it
  lands in one transaction.
- **Billing (`src/billing`).** A provider behind `BILLING_PROVIDER` (a stand-in whose
  checkout always succeeds, or Stripe) and a guard that refuses writes with `402` when the
  subscription is inactive while reads, sign-in and billing itself stay open.
- **Module shape.** Each domain module is a single file (DTOs, service, controller, module
  together) because they change together. Decimal values become plain numbers at the API
  edge so the frontend never parses strings. Every numeric DTO field carries the ceiling of
  the column it lands in (`src/common/validation/numeric.ts`), so an oversized value answers
  400 naming the field, not 500.
- **Days.** A day a person states (a waste, a sale, a batch, a reporting period) is a calendar
  day in the organization's timezone (*Settings*), stored at local midday, so a report reads the
  same day the kitchen wrote (`src/common/utils/calendar.ts`).
- **Infrastructure seams.** Mail, document storage, crash reporting, extraction and billing
  each have one service with two drivers, chosen by environment rather than by a flag in
  code: `STORAGE_PROVIDER` switches `StorageService` from a local directory to S3 (or MinIO
  through `S3_ENDPOINT`), `ERROR_REPORTER` switches `ErrorReporterService` from silence to
  BugSnag, `MAIL_PROVIDER` from returning links to sending them. `src/config/integrations.ts`
  is the one place each choice is read; `env.validation.ts` refuses a real provider without its
  key. Nothing to rewrite when the credentials appear; see `.env.example`.
