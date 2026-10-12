# Environment variables

The API validates its environment on start ([`backend/src/config/env.validation.ts`](backend/src/config/env.validation.ts))
and refuses to run with a missing or malformed value, naming the variable. The commented
templates are [`backend/.env.example`](backend/.env.example) and
[`frontend/.env.example`](frontend/.env.example); copy them to `.env` and `.env.local`
respectively — both are git-ignored.

One principle runs through the list: **every external service sits behind a provider chosen by
a variable, and the default provider needs no credentials.** Document extraction, mail, billing,
document storage and crash reporting all work out of the box on a stand-in, and switch to the
real service when the keys are set. The code is the same in both cases.

Three rules hold that principle in place:

- **The provider is chosen by its variable, never by the presence of a key.** Choosing a real
  provider without its key stops the API at start, naming the key; nothing falls back to a
  stand-in in silence.
- **A live Stripe key is refused outside production.** `APP_ENV` names the environment; a staging
  API given `sk_live_…` does not start.
- **An administrator can see what each service runs on**: *Platform Admin → Services*
  (`GET /api/admin/integrations`) lists the provider and whether it is a stand-in, never a key.

## Backend

### Core

| Variable | Required | Default | What it does | How to check |
|---|---|---|---|---|
| `NODE_ENV` | no | `development` | `development`, `test` or `production`. Staging runs as `production`. | — |
| `APP_ENV` | no | `production` when `NODE_ENV` is, otherwise `development` | `development`, `staging` or `production`: the environment's name. BugSnag reports under it, every log line carries it, and anything but `production` refuses a live Stripe key, while `production` refuses the document and billing stand-ins. Set `staging` on staging. | *Platform Admin → Services* names it. |
| `PORT` | no | `8000` | The port the API listens on. | `GET /health` on that port. |

### Database and queue

| Variable | Required | Default | What it does | How to check |
|---|---|---|---|---|
| `DATABASE_URL` | **yes** | — | PostgreSQL connection string, one path segment: `postgresql://user:password@host:5432/nexus`. Read by the application and by `prisma migrate deploy` on start. | `GET /health` answers `database: up`. |
| `REDIS_URL` | **yes** | — | Redis for the document-processing queue: `redis://host:6379`, with a password as `redis://:password@host:6379`. | Upload a document; it reaches *Requires review*. Validation checks only that the value is a URL, so an unreachable Redis is **not** reported by `/health`. |

### Authentication and CORS

| Variable | Required | Default | What it does | How to check |
|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | **yes** | — | Signs access tokens. At least 32 characters; generate with `openssl rand -base64 48`. | The API starts; a sign-in sets the cookies. |
| `JWT_REFRESH_SECRET` | **yes** | — | Signs refresh tokens. Must differ from the access secret. | Same. Rotating either secret signs everyone out. |
| `JWT_ACCESS_TTL` | no | `15m` | Access token lifetime. | — |
| `JWT_REFRESH_TTL` | no | `7d` | Refresh token lifetime; a session ends when it lapses unused. | — |
| `FRONTEND_ORIGIN` | no | `http://localhost:3000` | The exact origin of the web application, for CORS with credentials. A wildcard does not work with cookie authentication. | Sign-in from the deployed web application succeeds; a wrong origin fails in the browser console with a CORS error. |
| `AUTH_RATE_LIMIT` | no | `on`, except `off` when `APP_ENV` is `development` | Limits sign-in attempts per minute from one address: 20 for sign-in, 10 for a password reset or accepting an invitation, 5 for registration and forgot-password. Beyond that the route answers 429. | Six forgot-password requests within a minute from one address: the sixth answers 429. |
| `TRUST_PROXY` | no | `1` | How many proxies stand in front of the API (Coolify's Traefik, an AWS load balancer). The client address the rate limit counts is read through them; `0` counts the connection itself. | Two people signing in from different networks are counted apart. |

### Document storage

| Variable | Required | Default | What it does | How to check |
|---|---|---|---|---|
| `STORAGE_PROVIDER` | no | `s3` when `S3_BUCKET` is set, otherwise `local` | `local`: uploaded files are kept in a local directory. `s3`: uploads go to an S3 bucket, with credentials from the standard AWS environment (task role, instance profile or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`). With `s3` and no bucket the API does not start. | *Platform Admin → Services* shows *File storage: S3*. |
| `S3_BUCKET` | with `s3` | empty | The bucket name. | Upload a document and find the object in the bucket. |
| `S3_ENDPOINT` | no | empty | Empty: Amazon S3. Set: an S3-compatible store at that URL — MinIO locally (`docker compose --profile s3 up -d`, `http://localhost:9000`) or any provider speaking the S3 API. | Same. |
| `S3_FORCE_PATH_STYLE` | no | `false` | `true` addresses the bucket in the path (`endpoint/bucket/key`), which MinIO needs. | Same. |
| `AWS_REGION` | with `s3` | `us-east-1` | The bucket's region. | Same. |
| `STORAGE_LOCAL_DIR` | no | `./.storage` | Where files are kept when no bucket is set. In a container this is inside the container unless a volume is mounted, so use S3 for anything that must survive a redeploy. | The directory fills after an upload. |

### Document extraction

| Variable | Required | Default | What it does | How to check |
|---|---|---|---|---|
| `DOCUMENT_EXTRACTOR` | no | `stub` | `stub`: a deterministic stand-in that calls no external service; spreadsheets (sales and invoice tables) are parsed locally in every mode, and a PDF or image answers with sample values so the review flow can be shown without a key. `gemini` (or `ai`, its earlier name): PDFs, images and Word files go to Gemini. `claude`: the same files go to Claude. `pair`: Gemini reads each file twice, a cheap model writes a draft and a stronger one answers only with corrections; when the check fails the draft is kept and the log says why. | With a model, an uploaded PDF invoice reaches review with its own vendor and lines, not the sample ones. |
| `GEMINI_API_KEY` | with `gemini` | empty | The Gemini API key. With `gemini` and no key the API does not start. | Same. |
| `GEMINI_MODEL` | no | `gemini-flash-lite-latest` | The model name sent to Gemini. | — |
| `GEMINI_DRAFT_MODEL` | no | `gemini-3.5-flash-lite` | With `pair`, the model that writes the draft. Uses `GEMINI_API_KEY`. | |
| `GEMINI_REVIEW_MODEL` | no | `gemini-3.8-flash` | With `pair`, the model that checks the draft against the file. | A warning in the API log names it when a check fails. |
| `ANTHROPIC_API_KEY` | with `claude` | empty | The Anthropic API key. With `claude` and no key the API does not start. | Same. |
| `ANTHROPIC_MODEL` | no | `claude-opus-5-5` | The Claude model the documents are sent to. | — |
| `ANTHROPIC_EFFORT` | no | `low` | How much effort Claude spends on a document: `low`, `medium` or `high`. Higher reads harder layouts more carefully, more slowly and at a higher cost. | Any other value stops the API at start. |

### Mail

| Variable | Required | Default | What it does | How to check |
|---|---|---|---|---|
| `MAIL_PROVIDER` | no | `none` | `none`: nothing is sent; an invitation or an administrator-issued password reset returns its link to the administrator who asked, to pass on by hand, and the public *forgot password* form leads nowhere. `resend`: mail is delivered through Resend. | With `resend`, an invitation arrives by mail and the API response no longer carries the link. |
| `RESEND_API_KEY` | with `resend` | empty | The Resend API key. With `resend` and no key the API does not start. | Same. |
| `MAIL_FROM` | with `resend` | empty | The sender, on a domain verified with Resend, e.g. `Nexus <no-reply@example.com>`. | The mail arrives from that address. |

### Billing

| Variable | Required | Default | What it does | How to check |
|---|---|---|---|---|
| `BILLING_PROVIDER` | no | `stub` | `stub`: choosing a plan records it directly with no payment; the webhook accepts events signed with `BILLING_WEBHOOK_SECRET`. `stripe`: Stripe Checkout, the Customer Portal and Stripe's signed webhooks. With `stripe` the API refuses to start unless the secret key and the webhook secret are both set, and warns at start for each plan that has no price. | `GET /api/billing/subscription` answers `"provider": "stripe"`. |
| `BILLING_WEBHOOK_SECRET` | with `stub` in tests | empty | Shared secret for the stand-in webhook: HMAC-SHA256 of the request body, sent in the `stripe-signature` header. Any random string; the test suites read it from `.env`. | The billing e2e suite passes. |
| `STRIPE_SECRET_KEY` | with `stripe` | empty | The Stripe secret key (`sk_test_…` on staging, `sk_live_…` in production; a live key stops the API unless `APP_ENV` is `production`). | *Upgrade* on the Subscription page opens a Stripe Checkout page; with a subscription already in place the button reads *Switch to* and changes that subscription instead. |
| `STRIPE_WEBHOOK_SECRET` | with `stripe` | empty | The signing secret of the webhook endpoint `POST /api/billing/webhook` (`whsec_…`). Locally: `stripe listen --forward-to localhost:8000/api/billing/webhook` prints one. | After a checkout completes, the subscription shows *Active*; a webhook with a wrong signature answers 400. |
| `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PROFESSIONAL`, `STRIPE_PRICE_ENTERPRISE` | with `stripe` | empty | The Stripe price id (`price_…`) of each paid plan; the plans themselves are defined in Stripe. | Checkout opens with the right plan and amount. |
| `BILLING_PER_LOCATION` | no | `false` | `true`: the subscription quantity is the number of active locations, updated when a location is created, archived or restored. `false`: one seat per organization. | `GET /api/billing/subscription` reports `seats` equal to the active locations. |
| `BILLING_GRACE_DAYS` | no | `7` | How long after a failed payment an account keeps writing before it is restricted to reading. 0 to 90. | A past-due account inside the window sees a warning; past it, every change answers 402. |

### Crash reporting

| Variable | Required | Default | What it does | How to check |
|---|---|---|---|---|
| `ERROR_REPORTER` | no | `bugsnag` when `BUGSNAG_API_KEY` is set, otherwise `none` | `none`: unhandled errors are logged only. `bugsnag`: they are also reported to BugSnag, under the release stage `APP_ENV`; only `staging` and `production` report. With `bugsnag` and no key the API does not start. | *Platform Admin → Services* shows *Error monitoring: BugSnag*. |
| `BUGSNAG_API_KEY` | with `bugsnag` | empty | The BugSnag project key. | A 500 appears in the BugSnag project under the environment's stage. |
| `APP_VERSION` | no | empty | The version BugSnag attaches to each report, e.g. the commit hash. | The report shows it. |

## Frontend

| Variable | Required | Default | What it does | How to check |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | no | `http://localhost:8000` | The API base URL. **Inlined into the browser bundle at build time**, so it is a build argument of the web image and must be a URL the browser can reach. | The sign-in form works; a wrong value shows as failed requests in the browser's network tab. |
| `NEXT_PUBLIC_BUGSNAG_API_KEY` | no | empty | A BugSnag key for errors raised in the browser. Empty: nothing is loaded and nothing is reported. Build argument. | An error thrown in the browser console appears in the BugSnag project. |
| `NEXT_PUBLIC_APP_ENV` | no | `development` | The release stage browser errors report under; only `staging` and `production` report. Build argument. | The report shows that stage. |

Every `NEXT_PUBLIC_*` value ships to the browser. No secret belongs in the frontend
environment; every key above lives in the API.

## Before an environment goes to production

- Replace both JWT secrets with values generated for that environment.
- Use database and Redis passwords that have never been shared in writing.
- Issue keys of your own for Gemini, Resend, Stripe and BugSnag; do not reuse keys inherited
  from an earlier system.
- Set `FRONTEND_ORIGIN` to the exact production web origin and `NEXT_PUBLIC_API_URL` to the
  production API URL.
- Point `STRIPE_WEBHOOK_SECRET` at the endpoint registered in the Stripe dashboard for that
  environment; test and live endpoints have different secrets.
- Set `S3_BUCKET`, or mount a volume at `STORAGE_LOCAL_DIR`, so uploaded documents survive a
  redeploy.
- Set `APP_ENV=production` on production and `APP_ENV=staging` on staging, then open
  *Platform Admin → Services* and check that every service runs on the provider intended.
