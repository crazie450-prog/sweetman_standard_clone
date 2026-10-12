# Outside services: stand-in, test key, live key

Every outside service the product uses runs at one of three levels, chosen per environment by
its variable ([`ENVIRONMENT.md`](ENVIRONMENT.md)):

| Level | Where | What it costs |
|---|---|---|
| **Stand-in** | the default: development, the test suites, a demonstration environment | nothing; no request leaves the API |
| **Test key** | staging, and a one-off check before production | nothing, or cents: test modes and free tiers |
| **Live key** | production | the client's own accounts |

A real provider chosen without its key stops the API at start, and a live Stripe key is refused
unless `APP_ENV=production`. *Platform Admin → Services* shows the level each service runs at.

**Move one service at a time**, check it once with the command below, then move the next. The
automated suites always run on stand-ins; they never spend a key.

## The check

From `backend/`, with the environment's variables in place:

```bash
npm run check:providers                          # every service; stand-ins are skipped
npm run check:providers -- --only=documents      # one service
npm run check:providers -- --mail-to=me@example.com --notify
```

Each real provider receives **one** request — one short invoice read by the model, one small
object written and removed, one message to the address given, the three Stripe prices read
(nothing is created or charged), one test error. Keys are never printed. The command exits
non-zero when a check fails.

## Service by service

### Document reading — Gemini or Claude

| | |
|---|---|
| Stand-in | `DOCUMENT_EXTRACTOR=stub`: spreadsheets are read locally, a PDF or image gets sample values, a Word file fails with a sentence saying no model is configured. |
| Test key | **Gemini**: an API key from Google AI Studio; the free tier is rate-limited and enough for checks. **Claude**: an API key from the Anthropic Console with a small prepaid balance; one check costs a fraction of a cent. |
| Switch | `DOCUMENT_EXTRACTOR=gemini` + `GEMINI_API_KEY`, `DOCUMENT_EXTRACTOR=pair` + `GEMINI_API_KEY` (a draft by `GEMINI_DRAFT_MODEL`, checked by `GEMINI_REVIEW_MODEL`), or `DOCUMENT_EXTRACTOR=claude` + `ANTHROPIC_API_KEY`. Claude reads with `claude-opus-5-5` at `ANTHROPIC_EFFORT=low` unless told otherwise, and answers in the JSON schema of the document type. |
| Check | `--only=documents`: the sample invoice comes back with its vendor and both lines. Then upload a real PDF invoice on the Documents screen and watch it reach *Requires review* with its own lines. |

Spreadsheets never reach a model at any level, so they cost nothing.

### File storage — S3

| | |
|---|---|
| Stand-in | `STORAGE_PROVIDER=local`: files on the API server's disk. Mount a volume at `STORAGE_LOCAL_DIR` or they are lost on redeploy. |
| Test | **MinIO**, locally and free: `docker compose --profile s3 up -d`, then `STORAGE_PROVIDER=s3`, `S3_BUCKET=nexus-documents`, `S3_ENDPOINT=http://localhost:9000`, `S3_FORCE_PATH_STYLE=true`, `AWS_ACCESS_KEY_ID=nexus`, `AWS_SECRET_ACCESS_KEY=nexus_dev_s3`. Or a staging bucket in AWS. |
| Switch | `STORAGE_PROVIDER=s3` + `S3_BUCKET` + `AWS_REGION` (+ `S3_ENDPOINT` for anything but Amazon S3). |
| Check | `--only=storage`, then upload a document and watch it reach *Requires review* — the worker reads the file back from the store. The backend suite also covers this store: `S3_TEST_ENDPOINT=http://localhost:9000 npx jest --config test/jest-e2e.json --testPathPatterns storage-s3`. |

### Email — Resend

| | |
|---|---|
| Stand-in | `MAIL_PROVIDER=none`: nothing is sent; invitation and reset links are shown to the administrator who asked. |
| Test key | A free Resend account. Until a sending domain is verified, mail goes from `onboarding@resend.dev` and only to the account owner's own address. |
| Switch | `MAIL_PROVIDER=resend` + `RESEND_API_KEY` (+ `MAIL_FROM` on a verified domain). |
| Check | `--mail-to=<the account owner's address>`: one message arrives. Then invite a teammate and see the invitation arrive and the link disappear from the screen. |

### Subscription billing — Stripe

| | |
|---|---|
| Stand-in | `BILLING_PROVIDER=stub`: choosing a plan records it at once; nothing is charged. |
| Test key | Stripe **test mode**: `sk_test_…` from the dashboard, three monthly prices (Starter, Professional, Enterprise), and a webhook secret — locally from `stripe listen --forward-to localhost:8000/api/billing/webhook`, on staging from the endpoint registered in the test-mode dashboard. No card is ever charged in test mode. |
| Switch | `BILLING_PROVIDER=stripe` + `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PROFESSIONAL`, `STRIPE_PRICE_ENTERPRISE`. |
| Webhook version | Events are generated in the API version of the endpoint, or the account's default when the endpoint sets none. Register the endpoint with the version the `stripe` package pins (`node_modules/stripe/cjs/apiVersion.js`), or any version from `2025-03-31.basil` on; locally run `stripe listen --latest`. The driver also reads the older shape (a period on the subscription rather than on its items, `invoice.subscription` rather than `invoice.parent`), so an older account default degrades nothing, but the version the SDK was built against is the one that is tested. |
| Check | `--only=billing` reads the three prices and says *test mode*. Then, as the owner on *Subscription*: *Upgrade* with card `4242 4242 4242 4242` → the plan shows *Active* once the webhook arrives; *Switch to* another plan → the same subscription changes; *Manage billing* opens the portal and a card changed there to `4000 0000 0000 0341` fails the next renewal, which a Stripe test clock can bring forward → *Past due*. `stripe trigger` is not a check here: it creates a customer no organization knows, and the API rightly ignores it. |

### Error monitoring — BugSnag

| | |
|---|---|
| Stand-in | `ERROR_REPORTER=none`: unhandled errors are logged only; the browser loads nothing. |
| Test key | A free BugSnag project; one for the API and one for the browser, or one for both. |
| Switch | API: `ERROR_REPORTER=bugsnag` + `BUGSNAG_API_KEY`. Browser: the build arguments `NEXT_PUBLIC_BUGSNAG_API_KEY` and `NEXT_PUBLIC_APP_ENV`. Only `staging` and `production` report. |
| Check | `--notify` on staging: one test error appears in the project under *staging*. |

### Logs — CloudWatch

There is no key: the API writes one JSON object per line to stdout at every level. On AWS the
task definition sends it to CloudWatch Logs ([`deploy/aws/`](deploy/aws/README.md)); on Coolify
the panel keeps it. Check by signing in and finding the request in the log with its
`organizationId`, and no cookie in it.
