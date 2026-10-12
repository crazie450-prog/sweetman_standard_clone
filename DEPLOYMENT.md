# Deployment

The product is two containers — the API and the web application — beside a PostgreSQL
database and a Redis instance. Both containers are built from the Dockerfiles in this
repository and configured entirely through environment variables ([`ENVIRONMENT.md`](ENVIRONMENT.md)).
Nothing in the images depends on the hosting platform: the same two images run under
Docker Compose on one machine, under Coolify, or under a container service such as ECS.

## The two images

**API — [`backend/Dockerfile`](backend/Dockerfile).** A multi-stage build: dependencies,
then `prisma generate` and `nest build`, then a runtime layer with production dependencies
only. The runtime image carries the Prisma CLI, the schema, the migrations and
`prisma.config.ts`, because the container applies its own migrations before it serves:

```
CMD prisma migrate deploy && exec node dist/main.js
```

`migrate deploy` takes an advisory lock, so several replicas starting at once wait for each
other rather than collide, and it is a no-op when the schema is already current. The image
declares a `HEALTHCHECK` against `GET /health`, the same route a load balancer should poll.

**Web — [`frontend/Dockerfile`](frontend/Dockerfile).** Next.js is built inside the image, and
`NEXT_PUBLIC_API_URL` is inlined into the browser bundle at build time. It is therefore a
**build argument, not a runtime variable**, and it must be the URL a *browser* reaches — a public
host name, never a service name on an internal network. Changing the API URL means rebuilding
the web image.

## Services around them

| Service | Version used | Notes |
|---|---|---|
| PostgreSQL | 17 | One database per environment. The application connects as the table owner; a read-only or analytics role gets row-level security applied to it. |
| Redis | 7 | The document-processing queue. Nothing else uses it. |

`GET /health` answers `200 { "status": "ok", "database": "up" }` while the database is
reachable and `503 { "status": "degraded", "database": "down" }` when it is not, so an
orchestrator does not route traffic to an API without its database. **Redis is not part of
that answer**: `REDIS_URL` is validated as a URL and nothing more, and with an unreachable
Redis the API starts and reports `ok` while uploaded documents wait in the queue forever. The
check for Redis is to upload a document and watch it reach *Requires review*.

## Order of operations

1. Database and Redis are up.
2. Deploy the API. Its start command runs the migrations, then serves; watch the container log
   for `migrate deploy` finishing and for `Nexus API on http://…`.
3. Deploy the web application, built with `NEXT_PUBLIC_API_URL` set to the API's public URL.
4. Verify by behaviour (below), not by the platform's status indicator.

Deploy the API before the web application whenever both change: a new screen calling an
endpoint the old API does not have answers 404 until the API is current.

### Migrations and rollback

Migrations are forward-only and run automatically on start. Rolling back means deploying the
previous image, which is safe **only when no migration was applied in between**. Some
migrations change the shape of existing data rather than add to it — `20260820140000`, for
example, renames a table so that recorded prices survive — and an older image would not know
the new shape. Before rolling back, list the migrations between the two images
(`ls backend/prisma/migrations`) and, if there are any, roll forward with a fix instead.

Never edit a migration that a database has already applied: Prisma records a checksum per
migration and refuses to continue when it changes. Add a new migration.

## Coolify

The current demonstration environment runs on Coolify with one application per image. Settings
that matter, learned from the first deployment:

- **Build pack: Dockerfile**, for both applications. Coolify's default, Nixpacks, ignores the
  Dockerfiles and pins a Node version below the one Prisma requires, so the build fails.
- **Base directory** `/backend` for the API and `/frontend` for the web application; ports
  `8000` and `3000`.
- `DATABASE_URL` has **one** path segment — `postgresql://user:password@host:5432/nexus`. A
  URL with two segments points the driver at a database that does not exist.
- Both JWT secrets must be at least 32 characters, or the API refuses to start and says which
  variable is short (`ENVIRONMENT.md` shows how to generate them).
- `NEXT_PUBLIC_API_URL` goes into the web application's **build** variables.
- Automatic deployment on push is off; each deployment is started from the panel, API first.
- Do not restart the proxy from the panel: the panel itself is served through it, and a proxy
  that comes back without the panel's own route answers `404 page not found` for the panel.
  That is *no route*, not *no page*; it is recovered by restarting the Coolify container over
  SSH.

Secrets are entered in the panel, never committed. The only committed configuration is
`.env.example` in each application, with placeholders.

**Staging and production on Coolify** are two Coolify projects, each with its own four
resources — PostgreSQL, Redis, the API and the web application — so neither environment can
reach the other's data. In each project the applications point at that project's database and
Redis over Coolify's internal network, and the web application is built with that project's API
host. Set `APP_ENV` in each (`staging`, `production`); *Platform Admin → Services* then shows
the environment's name beside every service.

⚠️ **Before redeploying an environment, check its variables against what the API now refuses.**
A real provider without its key stops the API at start — `DOCUMENT_EXTRACTOR=ai` with no
`GEMINI_API_KEY`, `MAIL_PROVIDER=resend` with no `RESEND_API_KEY`, `STORAGE_PROVIDER=s3` with no
`S3_BUCKET` — where an earlier release quietly ran such a configuration on the stand-in. Either
set the key or set the variable back to its stand-in. With `APP_ENV=production` the API also
refuses the document and billing stand-ins, because one shows a sample reading instead of the
document and the other grants any plan without payment. An environment that is not production
sets `APP_ENV` to `staging`.

## Staging and production

Two environments are two pairs of applications with **separate** databases, Redis instances,
secrets and host names. What differs between them is configuration only:

| | Staging | Production |
|---|---|---|
| `NODE_ENV` | `production` | `production` |
| `APP_ENV` | `staging` | `production` |
| `FRONTEND_ORIGIN` | the staging web host | the production web host |
| `DOCUMENT_EXTRACTOR` | `stub`, or `gemini`/`claude` with a test key | `gemini` or `claude` with the production key |
| `MAIL_PROVIDER` | `none`, or `resend` sending to the team's own addresses | `resend` with a verified sending domain |
| `BILLING_PROVIDER` | `stub`, or `stripe` with **test** keys (a live key is refused) | `stripe` with live keys and the live webhook secret |
| `STORAGE_PROVIDER` | `local` with a mounted volume, or `s3` with a staging bucket | `s3` with the production bucket |
| `ERROR_REPORTER` | `none`, or `bugsnag` (reports as *staging*) | `bugsnag` (reports as *production*) |
| `NEXT_PUBLIC_APP_ENV` (web build) | `staging` | `production` |

Every provider has a stand-in that needs no credentials, so staging can run with none of the
keys and still exercise every path; production supplies them all. Each service is moved from
its stand-in to a test key one at a time, and checked once, as
[`PROVIDERS.md`](PROVIDERS.md) describes. The full list of variables is in
[`ENVIRONMENT.md`](ENVIRONMENT.md).

### Subscriptions on a database that predates them

Organizations registered before subscriptions were enforced carry a trial end date nobody read.
Migration `20260915120000` gives every organization still on a trial that had already ended
fourteen more days, counted from the moment the migration runs, so the release closes nobody
without notice. After that an ended trial refuses changes until a plan is chosen on the
*Subscription* page. To extend a trial by hand, from a shell inside the API container:

```bash
echo "UPDATE \"Organization\" SET \"trialEndsAt\" = now() + interval '14 days' WHERE slug = '<slug>';" \
  | npx prisma db execute --stdin
```

A database that ran on the stand-in billing provider keeps its `stub_…` customer and
subscription identifiers. With `BILLING_PROVIDER=stripe` they are ignored: such an organization
has no Stripe customer until its first checkout creates one.

### AWS

The images do not change for AWS. The layout is the API and web images on ECS Fargate behind an
Application Load Balancer polling `/health`, PostgreSQL on RDS, Redis on ElastiCache, documents
on S3 (`STORAGE_PROVIDER=s3`, credentials from the task role), the containers' stdout collected
by CloudWatch Logs, and secrets from Secrets Manager. [`deploy/aws/`](deploy/aws/README.md) holds
the task definitions, the IAM policies and the order of the commands that create them.

Every API log line is one JSON object carrying `service`, `environment`, the request id and —
for a signed-in request — `organizationId`, `userId` and `locationId`, so CloudWatch Logs
Insights can answer *what did this organization's requests do* without a separate pipeline.
Cookies, the authorization header, the session cookies a response sets and the Stripe
signature are redacted before a line is written.

## After the first deployment of an environment

The demo seed does not run inside the runtime image (it needs `ts-node`, which the image does
not carry), so a new environment starts with an empty database. Create accounts through the API:

```bash
API=https://<api host>
curl -s -X POST $API/api/auth/register -H 'Content-Type: application/json' \
  -d '{"organizationName":"<organization>","fullName":"<name>","email":"<email>","password":"<password>"}'
```

That registers an organization with its owner. Every other member is invited from the *Team*
screen; with `MAIL_PROVIDER=none` the invitation link is returned to the administrator who
sent it, to pass on by hand.

**A platform administrator** — the account that opens `/admin/*` — is an ordinary account with
one flag set in the database. Register it as above, then from a shell inside the API container:

```bash
echo "UPDATE \"User\" SET \"isPlatformAdmin\" = true WHERE email = '<email>';" \
  | npx prisma db execute --stdin
```

The container carries `prisma.config.ts` and `DATABASE_URL`, so no other connection is needed.
Choose a password of its own for that account and keep it out of documents and chat.

## Verify by behaviour

```bash
API=https://<api host>
curl -s $API/health                                   # 200, status ok, database up
for p in units menus vendor-products purchasing/drafts billing/subscription admin/queue/state; do
  printf '%-28s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' $API/api/$p)"
done                                                  # all 401: the routes exist and need a sign-in
                                                      # a 404 means an old image or a missing migration
```

Then in the browser: sign in; switch the location in the header and see the numbers follow it;
upload a document on *Documents* and see it reach *Requires review* — that is the Redis check;
open `/admin/queue` as the platform administrator (any other account gets 404). If a provider
key was added, use the check listed for that variable in [`ENVIRONMENT.md`](ENVIRONMENT.md).

## Local run from the same images

```bash
docker compose -f docker-compose.yml -f docker-compose.deploy.yml up -d --build
cd backend && npx prisma db seed     # demo data, from the host
```

This is the deployment shape on one machine — API on :8000, web on :3000, secrets as
development placeholders — and is the fastest way to prove an image before it is deployed.
