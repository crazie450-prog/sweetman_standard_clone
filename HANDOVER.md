# Technical handover

This document is for the engineers who take the product on. It says how it is put together,
which behaviours are deliberate (so they are not reported as defects) and what is still
open. How to run it is in [`README.md`](README.md); how to deploy it in
[`DEPLOYMENT.md`](DEPLOYMENT.md); every variable in [`ENVIRONMENT.md`](ENVIRONMENT.md).

## The data model

Data belongs to an **organization** (the tenant) and, below it, to a **restaurant location**:

```
Organization ─┬─ Location ─┬─ stock per ingredient, per-location price and vendor,
              │            │  sales, waste, production, documents, purchase drafts
              │            └─ users assigned to it
              ├─ ingredients, vendors, vendor products, categories, unit conversions
              ├─ recipes and menu items (organization-wide or bound to one location)
              ├─ menus (assigned to one or more locations)
              ├─ invoices, price history, invitations, sessions
              └─ subscription status, plan, billing events
```

Isolation between organizations is enforced three times, and each layer is tested:

1. **Middleware.** The session cookie is read and the tenant is put into request-scoped
   storage; the `X-Location-Id` header names the active location, and a guard checks that it
   belongs to the tenant and to the user's assignments before anything is read or written.
2. **Prisma client extension.** Every query on a tenant-owned model is narrowed by
   organization, every write is stamped with it, and lists are narrowed by the active location.
   With no active location a member assigned to locations reads the sum over those locations
   only: stock, price ranges and the per-location view of an ingredient, like every report.
   Models that carry no organization of their own (invoice lines, recipe lines, sale items) are
   always reached through their parent. A unit test reads the schema and fails when a model is
   not classified.
3. **Row-level security in PostgreSQL.** Every table has a policy; a connection that carries no
   organization sees no rows. The application connects as the table owner, so this layer is for
   connections *around* the application: analytics, scripts, a manual client.

A record belonging to another organization answers **404**, never 403: the API does not
confirm that someone else's record exists.

## Roles

One ladder: `viewer < staff < manager < admin < owner`. A route marked for a role admits that
role and everything above it.

| Role | Proposal name | What it may do |
|---|---|---|
| `owner` | Restaurant Executive / Franchise Owner | Everything, including the subscription and deactivating the organization's members. |
| `admin` | (not named) | Organization settings and locations; the team up to managers. |
| `manager` | Restaurant Manager | Menus, mapping screens, unit conversions, vendor catalogues, renaming and deleting categories, purchase-draft approval, deleting what staff may create; the team of chefs and team members at the locations they work at. |
| `staff` | Executive Chef / Chef | Day-to-day writes: documents, waste, recipes, ingredients, purchase drafts; a new category where one is chosen. |
| `viewer` | Team Member | Read-only. |

**The team is run from above.** Inviting, changing a role or locations, deactivating, bringing
back and issuing a password reset all reach only members below the caller's own role, and an
invitation offers only such a role. A member assigned to locations reaches only people whose
locations all lie among their own, and invites only to those locations; a member with no
assignment reaches every location.

A **platform administrator** is an account with `isPlatformAdmin` set. It opens `/admin/*`
(organizations, users, the processing queue) and may act inside any organization from there;
everyone else gets 404 on those routes. Outside the panel it is an ordinary member of its own
organization, holding exactly the role it has there and nothing more. Creating one is described in [`DEPLOYMENT.md`](DEPLOYMENT.md).

Sessions live in their own table, one per device: signing out ends that session; a password
change, a reset or a deactivation ends all of them. A refresh token is replaced on every use; the
one it replaced is still honoured for thirty seconds with a new access token only, so two tabs
refreshing at once both stay signed in, and presented later it ends the session as a stolen token
would. Five failed sign-ins lock an account for
fifteen minutes. The public sign-in routes (sign-in, registration, password reset, accepting an
invitation) are also limited per address and answer 429 past the limit; `AUTH_RATE_LIMIT` and
`TRUST_PROXY` in `ENVIRONMENT.md` say how.

## Where things are

**API: [`backend/src`](backend/src/)**

| Directory | What is there |
|---|---|
| `auth/`, `invitations/` | Sign-in, refresh with rotation and reuse detection, password reset, invitations. |
| `tenancy/` | The middleware, the Prisma extension and the classification lists (`tenant.extension.ts`), the reference check every write with foreign ids goes through (`references.ts`). |
| `common/` | Guards (JWT, roles, location, platform admin), the global exception filter that turns database failures into 400/404/409, DTO validation helpers with the column ceilings. |
| `rules/` | The rules a write must keep wherever it comes from (an API call, a confirmed document, a change to what it depends on): an archived location takes nothing new, a name is claimed once where it is used, a nested recipe is measured in what it yields, stock is drawn through one function. `rules.spec.ts` lists every method that writes what a rule guards and fails when a new one does not call it. |
| `modules/*` | One folder per domain module, each with its module, controller, service and `dto/`: ingredients, inventory, recipes, menu, menus, vendors, invoices, sales, waste, production, documents, purchasing, team, locations, organizations, units, categories, dashboard, admin. |
| `costing/` | Recipe costing over the whole graph, unit conversion, food-cost variance, purchase recommendations. Pure functions with unit tests. |
| `billing/` | The billing provider contract, the stand-in, the Stripe driver, the restriction rule and the guard. |
| `storage/`, `mailer/`, `observability/` | Local-or-S3 storage, none-or-Resend mail, silent-or-BugSnag crash reporting. |
| `prisma/` (under `backend/`) | `schema.prisma`, the migrations, the seed. |
| `test/` (under `backend/`) | The API e2e suites and the extraction benchmark. |

**Web: [`frontend/src`](frontend/src/)**

| Directory | What is there |
|---|---|
| `app/(auth)` | Sign-in, sign-up, password reset. |
| `app/(app)` | Every product screen behind the shell. |
| `app/admin` | The platform administrator's panel. |
| `components/ui`, `components/layout` | Primitives and the shell (sidebar, location switcher, banners). |
| `lib/api` | The one HTTP client, the typed services and the response shapes written from what the API returns (`services/` and `types/`, one file per domain), and `queries.ts`, every query the screens make. |
| `e2e/` (under `frontend/`) | The browser suite. |

Swagger at `/api/docs` lists every operation. Response bodies are described in
`frontend/src/lib/api/types/` rather than in Swagger; when a response shape changes, the
domain's file changes with it.

Lists that keep growing are read a page at a time: documents, invoices, inventory
movements, waste entries, production batches, sold items, a price history, draft orders,
and the administrator's organizations, accounts and queue. Each takes `limit` (1 to 200,
50 by default) and `offset`, and answers `{ data, pagination: { limit, offset, total } }`;
their filters (type, status, period, vendor) apply on the server before the page is cut.
Totals a screen shows across a whole period come from a summary beside the list
(`/inventory/transactions/summary`, `/production/summary`, `/documents/summary`,
`/admin/queue/summary`), never from adding up one page. Reference lists (ingredients,
recipes, vendors, units and the like) and reports stay whole.

## The document pipeline

Upload → stored file → queue → worker → extraction → **review** → **confirm**.

- Accepted: PDF, JPG, PNG, WEBP, AVIF, XLSX, DOC, DOCX, CSV, JSON, up to 15 MB, at an active location. A file
  holding several documents is split into one review item each.
- The worker makes up to three attempts with an increasing delay; a document that cannot be read lands
  in *failed* with the reason, and only a failed document can be retried.
- Spreadsheets are parsed locally in every configuration; PDFs, images and Word files go to the
  model when `DOCUMENT_EXTRACTOR` is `gemini` (or `ai`), `pair` or `claude`, otherwise the stand-in answers
  a PDF or an image with sample values and fails a Word file with a sentence saying no model
  is configured. `APP_ENV=production` refuses to start on the stand-in.
- **Nothing is applied automatically.** The extracted values are shown for review, validated
  again when the person confirms, and applied in one transaction. A confirm is the only place a
  document moves prices, stock or sales; a second confirm answers 409.
- An invoice line is resolved in the sending vendor's catalogue (by printed code, then by the
  vendor's product name), then by the organization's ingredient names and recorded alternative
  names. A line that reaches nothing is parked on *Ingredient Mapping* (or in the vendor's
  catalogue) and the document is marked *partially processed*. Sales lines are resolved the same
  way against the menu and parked on *Sales Mapping*.
- Mapping a name teaches the next document; it does **not** replay lines already received.

## Costing

Recipe cost is ingredients plus nested recipe contributions, computed bottom-up over the whole
graph; a circular relationship is refused. Lines are costed in the unit the ingredient is
priced in. Conversions inside one dimension are built in; crossing dimensions (an egg priced by
the kilogram) needs a rule under *Settings → Unit Conversions*; and a line whose unit reaches
the priced unit by neither is refused. A nested recipe goes into its parent by the portion,
or by weight or volume once the nested recipe states what one batch makes (its yield); a
unit that reaches neither is refused rather than silently counted as portions.

**Recipe and menu costing runs on the organization's shared ingredient price.** Each location
may carry its own price, vendor, reorder level and vendor code, and those are what purchasing,
inventory value, waste value and price history read; the recipe screens say which price they
cost on. Per-location recipe costing is a separate piece of work nobody has asked for.
Food-cost variance weighs both its sides, theoretical and actual, at that same shared price.

**Days are the organization's.** A day a person states (a waste, a sale, a batch, an invoice date,
a reporting period) is a calendar day in the timezone set under *Settings*, stored at local
midday; currency and date format there change only how figures are shown.

## Deliberate behaviours

These are decisions, not omissions. Each one has a reason and most have a test.

- **Sales and production do not move stock.** Only a confirmed invoice, a waste entry, a
  physical count or a movement recorded on the inventory screen (receive, use, adjust) does. Deducting on sale would double-count
  once consumption is recorded, and the food-cost report is built on recorded use and waste.
- **A confirmed document and the invoice it wrote cannot be deleted or rewritten.** They are
  the record of what moved; deleting them would let the same paper be received twice. An
  invoice typed by hand, which moved nothing, stays deletable.
- **The same invoice number from the same vendor is refused a second time, at any location.**
- **A credit line (negative quantity) is recorded as written and moves nothing.** Returns are
  not deducted from stock.
- **A line that cost nothing moves stock and leaves the price alone.** A free sample is not a
  price.
- **Stock cannot go below zero**, and the guard is part of the write itself. An existing
  negative figure from before the guard is repaired by a physical count, not automatically.
- **Archived is not offered where new work is written.** An archived ingredient leaves the
  pickers but stays in inventory while it has stock, in the waste form, in reports and in
  document recognition. Deletion is refused for anything still referred to, naming archiving as
  the way out.
- **A location is archived, never deleted.**
- **An approved purchase draft is a decision, not an order.** It is sent nowhere and moves no
  stock; deliveries still arrive through a confirmed invoice. Vendor ordering APIs are out of
  scope. A draft is an order to one vendor: an ingredient the location buys elsewhere is refused
  on it, and each ingredient appears on a draft once.
- **A purchase recommendation counts usage as the higher of sales-implied and recorded use,
  plus waste**, never their sum, or a kitchen that records what it sells is counted twice. Each
  row names what it rests on: sales, recorded use, waste only, the deliveries received, or nothing
  but the reorder level. Deliveries stand in only where nothing was sold, used or wasted, because
  a delivery is what consumption comes out of; counting both would order twice.
- **An inactive subscription can read but not write.** A canceled subscription, an ended trial
  or a failed payment past its grace period makes every change answer 402 with a sentence naming
  the Subscription page; reading, sign-in, the organization profile and billing itself stay open
  so an account can always pay its way back in.
- **Plans are priced monthly.** One Stripe price exists per plan, so the Subscription page
  offers no yearly period.
- **Choosing another plan changes the subscription on file; it does not open a second one.**
  With Stripe and a subscription in place the plan is switched with proration; a subscription the
  provider has reported as canceled is no longer on file, so the next choice opens a new checkout.
  An event about a different subscription of the same customer, or one older than an event already
  applied, is recorded and changes nothing, with one exception: a completed checkout still records
  which plan and subscription were bought, because Stripe does not deliver events in order and the
  first invoice may arrive before the checkout that started it. A failed payment with no paid
  period on record starts the grace period from the failure.
- **A location is saved even when the billing provider cannot be reached** to update the number
  of billed locations; the count is corrected by the next change.
- **A deactivated organization cannot sign in**, and deactivating it ends every member's
  session. The platform panel refuses to deactivate its own organization, an owner alone, or
  another platform administrator.
- **The public *forgot password* form never returns a link**: it would hand any account to
  whoever knows the address. With no mail provider, an administrator issues the reset from the
  Team screen and receives the link to pass on.
- **There is no invoices screen.** A vendor's invoices (number, date, status, lines, total)
  are read from the vendor's row.
- **A menu groups dishes; it does not reprice them.** Its analytics sum exactly what it includes.
- **The cost cascade follows the shared price, not every confirm.** Editing an ingredient's
  price with *All locations* active changes the shared price and recalculates every dependent
  recipe and menu item in every location, whoever asks and from wherever. A price set for one
  location, and a confirmed invoice, move that location's price only; the shared price follows
  them only in a single-location organization, where that location is every location, because
  moving it otherwise would reprice every location without an override.
- **A few schema fields are kept but read by no route**: `RecipeSection`, `Instruction`,
  `Recipe.prepTimeMinutes`, `Recipe.cookTimeMinutes`, `Recipe.notes` and `MenuItem.cost` (a dish's
  cost is computed from its recipes). They are left in place rather than dropped by a migration,
  and can be removed together when nobody needs them.
- **The dashboard's document badge updates on page load**, not live.
- Out of scope by the proposal: POS integrations, native apps, offline mode, historical data
  migration, payroll, white-labeling, BI dashboards, complex forecasting.

## Providers and what switches them on

| Concern | Stand-in (default) | Real service | Switched by |
|---|---|---|---|
| Document extraction | deterministic; spreadsheets parsed locally, PDFs and images answered with sample values | Gemini, a Gemini pair, or Claude | `DOCUMENT_EXTRACTOR=gemini` or `pair` + `GEMINI_API_KEY`, or `DOCUMENT_EXTRACTOR=claude` + `ANTHROPIC_API_KEY` |
| Mail | nothing sent; links returned to the administrator | Resend | `MAIL_PROVIDER=resend` + `RESEND_API_KEY` + `MAIL_FROM` |
| Billing | a plan is recorded directly; webhook signed with a shared secret | Stripe Checkout, Customer Portal, signed webhooks | `BILLING_PROVIDER=stripe` + `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + three `STRIPE_PRICE_*` |
| Document storage | a local directory | S3, or an S3-compatible store such as MinIO | `STORAGE_PROVIDER=s3` + `S3_BUCKET` (+ `AWS_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`) |
| Crash reporting | JSON logs on stdout | BugSnag, in the API and in the browser | `ERROR_REPORTER=bugsnag` + `BUGSNAG_API_KEY`; `NEXT_PUBLIC_BUGSNAG_API_KEY` for the browser |

A real provider chosen without its key stops the API at start, a live Stripe key is refused
unless `APP_ENV` is `production`, production refuses the extraction and billing stand-ins, and *Platform Admin → Services* shows what each service runs on.
Log lines are JSON on stdout carrying the service, the environment, the request id and, for a
signed-in request, the organization, user and location; cookies, the authorization header, the
session cookies a response sets and the Stripe signature are redacted.

## Open items

- **Stripe has not been exercised live.** The driver is written against the SDK and its event
  mapping is proved by signing test events, but no real Checkout Session or Customer Portal
  has been clicked through. When keys arrive: set the variables, run
  `stripe listen --latest --forward-to <api>/api/billing/webhook`, complete one checkout, and watch
  the subscription turn *Active*. The webhook endpoint registered in the dashboard should carry the
  API version the `stripe` package pins (see `PROVIDERS.md`). A paid invoice sets the period end
  from the latest line-item period on the invoice, which is the subscription's service period; an
  invoice with no such line leaves the recorded period untouched.
- **Neither extraction model has been run against real documents with a key of the client's
  own.** Both drivers are exercised against recorded answers, which proves the request each sends
  and how its answer is read, not what the model extracts.
- **The extraction accuracy benchmark** (`npm run benchmark:extraction` in `backend/`) runs
  against the fixtures in `backend/test/`; scoring it on real documents needs a sample agreed
  with the client and a key of the client's own. Figures produced on the stand-in describe the
  stand-in, not the model.
- **Keys and secrets.** Any key inherited from an earlier system should be revoked and
  reissued; every secret listed at the end of `ENVIRONMENT.md` should be generated per
  environment.

## Testing

| Suite | Where | Needs | Covers |
|---|---|---|---|
| Unit | `backend`: `npx jest --setupFiles dotenv/config` | nothing | tenant classification and isolation, costing, unit conversion, variance, recommendations, billing restriction and event mapping, mail, storage keys, calendar, health |
| API e2e | `backend`: `npx jest --config test/jest-e2e.json` | database + seed | auth, the read contract of every list, location scope, RLS as a non-owner role, the document pipeline, billing on the stand-in |
| Browser | `frontend`: `npm run test:e2e` | API + production build of the web app + seed | every navigation item under every role, each screen's data, writes within each role's boundary, document review, mapping, purchasing, billing banner and 402 |

The suites share one seeded database and run with one worker, in order. The browser suite
leaves confirmed invoices and one production batch behind on purpose (they cannot be deleted),
so reseed before an API e2e run that follows it. A browser failure that is a *timeout* on an
unrelated screen is usually machine load; a failure on an *assertion* deserves a live request
against the API before it is called a flake. Two clean runs in a row is the bar.

## Operations

- **Migrations** run on container start; never edit an applied one (its checksum is recorded),
  add a new one. See the rollback note in `DEPLOYMENT.md`.
- **Seed** (`npx prisma db seed`) is for development and demonstration only; it wipes and
  recreates the two demo organizations. It does not run inside the runtime image.
- **A new model** must be classified in `backend/src/tenancy/tenant.extension.ts` and carry a
  row-level-security policy in its migration; the unit suite fails until it is classified.
- **Secrets rotation**: rotating the JWT secrets signs everyone out and nothing else; rotating
  the Stripe webhook secret needs the new endpoint secret from the Stripe dashboard.
- **Accounts on a fresh environment**: the owner registers through the API, invites the team
  from the *Team* screen, and a platform administrator is flagged in the database; the steps are in
  `DEPLOYMENT.md`. Passwords are never written into documents.
