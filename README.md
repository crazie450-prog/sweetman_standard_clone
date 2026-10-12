# Nexus Restaurant Manager

Nexus is a multi-tenant SaaS platform for restaurant groups: one organization, one or more
restaurant locations, and the vendors, ingredients, inventory, recipes, menus, sales and waste of
each. Its purpose is to reduce manual data entry — invoices, recipes, menus and sales files are
uploaded, read by a background worker, put in front of a person for review, and only then
applied to prices, stock and sales — and to keep food cost visible: every recipe and menu item
carries a cost, a margin and a food-cost percentage, and a report reconciles the standard cost
of what was sold against what was actually consumed and wasted.

## What is in the repository

| Path | What it is |
|---|---|
| [`backend/`](backend/) | NestJS REST API — PostgreSQL through Prisma, Redis through BullMQ, JWT in HttpOnly cookies, Swagger at `/api/docs`. See [`backend/README.md`](backend/README.md). |
| [`frontend/`](frontend/) | Next.js application. It reads and writes through the API only; without the API the screens are empty. See [`frontend/README.md`](frontend/README.md). |
| [`docker-compose.yml`](docker-compose.yml) | Local infrastructure: PostgreSQL and Redis. |
| [`docker-compose.deploy.yml`](docker-compose.deploy.yml) | The whole product from images, the way a deployment runs it. |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | A clean install from the lockfile, `prisma generate`, type check, lint and both builds. |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Images, order of operations, migrations, health checks, staging and production, first-deploy setup. |
| [`ENVIRONMENT.md`](ENVIRONMENT.md) | Every environment variable: what it does, whether it is required, and how to check it took effect. |
| [`PROVIDERS.md`](PROVIDERS.md) | Each outside service at its three levels — stand-in, test key, live key — and the one check that proves a key works. |
| [`deploy/aws/`](deploy/aws/README.md) | ECS task definitions, IAM policies and the order of commands for an AWS environment. |
| [`HANDOVER.md`](HANDOVER.md) | How the product is put together, the roles, the behaviours that are deliberate, and what is still open. |

## Running it locally

Requirements: Node 22 or newer, Docker with Compose.

```bash
docker compose up -d                 # PostgreSQL on :5432, Redis on :6379

cd backend
npm install
cp .env.example .env                 # fill in the two JWT secrets: openssl rand -base64 48
npx prisma generate                  # Prisma does not generate the client on install
npx prisma migrate dev               # applies the migrations
npx prisma db seed                   # two demo organizations, see the logins below
npm run dev                          # API on :8000, Swagger at http://localhost:8000/api/docs

cd ../frontend
npm install
cp .env.example .env.local           # NEXT_PUBLIC_API_URL points at the API
npm run dev                          # UI on http://localhost:3000
```

`GET /health` answers `200 { status: "ok" }` while the database is reachable and `503` when it is
not. Redis is not part of that answer: with an unreachable Redis the API starts and uploaded
documents sit in the queue — the check for Redis is to upload a document and see it reach
*Requires review*.

### Demo logins

Every seeded account uses the password `Nexus_dev1`.

| Email | Role | What it is for |
|---|---|---|
| `owner@goldenfork.com` | owner | Full access to the Golden Fork organization and its three locations. |
| `maria@goldenfork.com` | manager | Assigned to one location; shows what a manager may and may not do. |
| `ken@goldenfork.com` | staff | Assigned to two locations; shows the staff boundary. |
| `owner@bellacucina.com` | owner | A second organization that shares names with the first, so a leak between tenants would be visible. |
| `platform@nexus.app` | platform administrator | The only account that opens `/admin/*`. |

## Running it from images

```bash
docker compose -f docker-compose.yml -f docker-compose.deploy.yml up -d --build
cd backend && npx prisma db seed     # optional demo data; seeding runs from the host
```

API on :8000, UI on :3000, both from images. The API container applies its own migrations
before it starts serving. Details, including what to set for a real deployment, are in
[`DEPLOYMENT.md`](DEPLOYMENT.md).

## Checks

```bash
# backend
cd backend
npx tsc --noEmit && npm run lint && npm run format:check && npm run build
npx jest --setupFiles dotenv/config            # unit: tenant coverage, isolation, costing,
                                               # unit conversion, billing, mail, storage keys
npx jest --config test/jest-e2e.json           # e2e: auth, contract, location scope, RLS,
                                               # documents, billing (needs the database and the seed)

# frontend
cd frontend
npx tsc --noEmit && npm run lint && npm run format:check && npm run build
npm run start &                                # the browser suite runs against a production build,
npm run test:e2e                               # not the dev server, and needs the API running;
                                               # it covers a desktop and a phone (--project=mobile)

# against a deployed environment (the isolation and billing blocks need the local seed and skip)
E2E_BASE_URL=https://<web host> npx playwright test -g "Authentication|Screens carry data"
```

The suites share one seeded database and mutate its rows, so they run with one worker and in a
fixed order. The browser suite deliberately leaves what a confirm writes — a confirmed invoice
cannot be deleted — so reseed (`npx prisma db seed`) before an API e2e run that follows a
browser run, and before reading numbers off a screen by eye.

CI does not run the suites; it proves what a developer's machine cannot — that a fresh checkout
installs from the lockfile and builds. Run the suites before pushing.
