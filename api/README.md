# T-Dog API

NestJS API for T-Dog, a court-side video recording and clip-delivery product. This replaced an earlier Rails implementation — see [`../plans/nestjs-migration.md`](../plans/nestjs-migration.md) for the full migration history, the decisions made along the way, and the parity audit against the old Rails test suite.

## API (all under `/v1`)

| Route | Notes |
|---|---|
| `GET /facilities` | List (up to 50), `{ id, name, slug }` each |
| `GET /facilities/:id` | Single facility + its courts (`{ id, name, slug }` each); 404 if not found |
| `GET /courts` | List (up to 50), `{ id, name, slug }` each — no camera info |
| `GET /courts?slug=...` | Filtered by slug, includes `facilityId` and `camera` (`null` if the court has none) |
| `GET /courts/:id` | Full court detail + `camera`; 404 if not found |
| `POST /sessions` | Body `{ courtId, userContact? }`. Creates a session (`status: "active"`), returns `{ id, token, status, startedAt }`. 404 if the court doesn't exist |
| `GET /sessions/:id` | Full session record; 404 if not found |
| `POST /sessions/:id/stop` | Sets `status: "processing"`, `endedAt: now`, and enqueues a clip-request job for the recorder |
| `GET /sessions/:id/presigned_download` | Presigned S3 GET URL if `s3Key` is set, else 404 |
| `POST /recorders/heartbeat` | Requires a recorder JWT (`Authorization: Bearer <token>`, `role: "recorder"`). Returns `{ ok: true, time }` |
| `POST /recorders/webhook` | Requires a recorder JWT. Body (external contract, snake_case): `{ event, session_id?, s3_key?, duration_s? }`. On `event: "clip_uploaded"`, updates the session (`status: "delivered"`, `s3Key`, `durationS`) — 404 if the session doesn't exist. Other event values are accepted as no-ops |
| `POST /payments/checkout` | Body `{ sessionId }`. Creates a Stripe Checkout session for that recording session and returns `{ url }`. 404 if the session doesn't exist |
| `POST /webhooks/stripe` | Verifies the Stripe signature (raw body required — see below). On `checkout.session.completed`, marks the linked session `paid: true`. Empty 200 body on success, 400 on a bad/missing signature |

`GET /health` is the one route not under `/v1` (ops check, not part of the API contract).

**JSON field naming**: `camelCase` (`courtId`, `userContact`, `startedAt`), except the recorder's webhook body and the outbound clip-request payload, which stay `snake_case` — that's an external service's wire contract, not this app's own convention.

## Requirements

- Node.js 22+
- PostgreSQL, Redis

## Setup

```
cp .env.example .env    # edit DATABASE_URL if needed
npm install --legacy-peer-deps
npm run migration:run   # creates/updates the schema
npm run start:dev       # http://localhost:3000
```

`npm install` needs `--legacy-peer-deps` — an npm/peer-dependency resolution issue with the current `@nestjs/cli`/`vitest` versions, unrelated to this app's own code.

Health check: `curl http://localhost:3000/health` → `{"status":"ok"}` (also confirms the DB connection is alive).

## Database migrations (TypeORM)

```
npm run migration:run       # apply pending migrations
npm run migration:revert    # roll back the last migration
npm run migration:generate -- src/migrations/SomeName   # after changing entities
```

`synchronize` is always `false` — schema changes only ever happen through migrations, never auto-sync.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `PORT` | HTTP port (default `3000`) |
| `CORS_ORIGIN` | Allowed CORS origin (default `http://localhost:5173`, matching the Vite frontend) |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET` | Used to presign session clip downloads. Presigning is a local signature computation (no network call), so any non-empty values work for local dev/tests without real AWS access |
| `REDIS_URL` | BullMQ connection, for the clip-request queue |
| `JWT_SECRET` | Signs/verifies the recorder ↔ API JWTs |
| `RECORDER_URL` | External recorder service base URL (default `http://localhost:4000`) |
| `APP_BASE_URL` | Used to build the `callback_url` sent to the recorder, and Stripe's `success_url`/`cancel_url` |
| `STRIPE_SECRET_KEY` | Stripe API key. Only `POST /payments/checkout` needs this to actually work (a real network call); webhook verification doesn't need a real key |
| `STRIPE_PRICE_ID` | Price used for the checkout line item |
| `STRIPE_WEBHOOK_SECRET` | Verifies incoming Stripe webhook signatures |

## Scripts

```
npm run build       # tsc via nest build
npm run start:dev   # watch mode
npm run lint         # oxlint
npm test            # unit tests (vitest)
npm run test:e2e    # e2e tests (vitest + supertest), needs a running Postgres + Redis
```

## Structure

```
src/
  entities/         TypeORM entities (Facility, Court, Camera, Session)
  migrations/       TypeORM migrations
  config/           env var validation
  health/           GET /health
  facilities/       GET /v1/facilities, /v1/facilities/:id
  courts/           GET /v1/courts, /v1/courts/:id
  sessions/         POST /v1/sessions, GET /:id, POST /:id/stop, GET /:id/presigned_download
  recorders/        POST /v1/recorders/heartbeat, /webhook (JWT-guarded)
  payments/         POST /v1/payments/checkout
  stripe-webhooks/  POST /v1/webhooks/stripe
  jobs/clip-request/  BullMQ processor enqueued by sessions.stop()
  common/s3/              S3 presigner service
  common/guards/          RecorderAuthGuard
  common/recorder-client/ outbound HTTP client to the recorder service
  data-source.ts    standalone TypeORM DataSource used by the migration CLI
  configure-app.ts  shared app setup (global prefix, CORS, validation) used by main.ts and e2e tests
  app.module.ts
  main.ts
```

## Recorder integration

- **Auth**: a shared-secret JWT (`JWT_SECRET`, HS256, via `@nestjs/jwt`) in both directions — recorder → API (`role: "recorder"`, checked by `RecorderAuthGuard` in `src/common/guards/`, 401 on failure) and API → recorder (`role: "rails", svc: "api"`, minted by `RecorderClientService` in `src/common/recorder-client/`).
- **Outbound call**: `POST /sessions/:id/stop` enqueues a BullMQ job (`src/jobs/clip-request/`, queue name `clip-request`) rather than calling the recorder inline. The processor loads the session (with its court's camera) and calls `RecorderClientService.requestClip`, which `POST`s to `${RECORDER_URL}/api/clip`.
- **No separate worker process**: the BullMQ processor runs in-process, in the same Nest application that serves HTTP — there's no separately-bootstrapped consumer, so deployment is a single container (see Deployment below).

## Billing

- **Real session linkage**: `POST /payments/checkout` requires `sessionId`, stores it in the Stripe session's `metadata.session_id`, and the webhook uses that to mark the right session `paid: true` (a `sessions.paid` boolean column, added by the `AddPaidToSessions` migration).
- **Raw body requirement**: Stripe signature verification needs the exact raw request bytes, not Nest's parsed JSON body. Enabled via `NestFactory.create(AppModule, { rawBody: true })` in `main.ts`, consumed via `req.rawBody` in `StripeWebhooksController`. Tests that hit this route must also pass `{ rawBody: true }` when creating the test app — see `test/stripe-webhooks.e2e-spec.ts`.
- **Stripe SDK note**: `checkout.sessions.create` is a real network call to Stripe, so it can't be exercised end-to-end in tests without real credentials — `test/payments.e2e-spec.ts` mocks the `stripe` package for that reason. Webhook signature verification (`stripe.webhooks.constructEvent`) is a local HMAC computation with no network call, so `test/stripe-webhooks.e2e-spec.ts` tests it for real, including a hand-computed valid signature.

## Deployment

Docker Compose on a single server. One `app` service handles both HTTP and BullMQ job processing in the same process — see "No separate worker process" above.

**Stack**: `docker-compose.yml` defines `postgres`, `redis`, `app`, and `caddy` (via [caddy-docker-proxy](https://github.com/lucaslorentz/caddy-docker-proxy), which watches Docker labels and automatically reverse-proxies + issues a Let's Encrypt cert for whatever `APP_DOMAIN` is set to — no hand-written Caddyfile needed).

**One-time server setup** (not automated — do this once per server):
1. Install Docker + the Compose plugin.
2. Create `/opt/tdog-api/` on the server, copy `docker-compose.yml` there.
3. Create `/opt/tdog-api/.env` with real values for every variable in `.env.example`, including the three deploy-only ones at the bottom (`POSTGRES_PASSWORD`, `APP_DOMAIN`, `IMAGE`).
4. Open ports 80/443 (Caddy/ACME) — port 3000 is intentionally loopback-only (see the `ports:` comment in `docker-compose.yml`), reachable for debugging only via an SSH tunnel.

**CI/CD**: `.github/workflows/api-deploy.yml` builds the image, pushes it to GHCR, then SSHes into the server to `docker compose pull && docker compose up -d`. It's **manual-only** (`workflow_dispatch`) until a real server exists — no `push: main` trigger yet, so merging to `main` won't auto-publish an image before anyone's ready to deploy it. It needs three repo secrets that don't exist yet: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`.

**Accepted tradeoffs**: brief downtime per deploy (container restart, not a health-checked traffic flip) and no automatic rollback on a bad deploy.
