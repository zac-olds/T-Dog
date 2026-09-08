# T-Dog API (NestJS)

NestJS rewrite of the T-Dog API, replacing `../api` (Rails). See [`../plans/nestjs-migration.md`](../plans/nestjs-migration.md) for the full migration plan, decisions, and phase-by-phase status.

**Current status: Phase 5 — parity audit complete, no gaps found.** Every Rails controller test has an equal-or-stronger Nest equivalent (see `plans/nestjs-migration.md`'s "Parity audit findings"). Phase 6 (cutover) is the only thing left. Don't point the frontend at this yet.

## API (implemented so far, all under `/v1`)

| Route | Notes |
|---|---|
| `GET /facilities` | List (up to 50), `{ id, name, slug }` each |
| `GET /facilities/:id` | Single facility + its courts (`{ id, name, slug }` each); 404 if not found |
| `GET /courts` | List (up to 50), `{ id, name, slug }` each — no camera info |
| `GET /courts?slug=...` | Filtered by slug, includes `facilityId` and `camera` (`null` if the court has none) |
| `GET /courts/:id` | Full court detail + `camera`; 404 if not found |
| `POST /sessions` | Body `{ courtId, userContact? }`. Creates a session (`status: "active"`), returns `{ id, token, status, startedAt }`. 404 if the court doesn't exist. Returns **200**, not Nest's default 201 — matches Rails' plain `render json:` |
| `GET /sessions/:id` | Full session record; 404 if not found |
| `POST /sessions/:id/stop` | Sets `status: "processing"`, `endedAt: now`, and enqueues a clip-request job for the recorder (200) |
| `GET /sessions/:id/presigned_download` | Presigned S3 GET URL if `s3Key` is set, else 404 |
| `POST /recorders/heartbeat` | Requires a recorder JWT (`Authorization: Bearer <token>`, `role: "recorder"`). Returns `{ ok: true, time }` (200) |
| `POST /recorders/webhook` | Requires a recorder JWT. Body (external contract, snake_case): `{ event, session_id?, s3_key?, duration_s? }`. On `event: "clip_uploaded"`, updates the session (`status: "delivered"`, `s3Key`, `durationS`) — 404 if the session doesn't exist. Other event values are accepted as no-ops (200), matching Rails' `case` statement |
| `POST /payments/checkout` | Body `{ sessionId }`. Creates a Stripe Checkout session for that recording session and returns `{ url }` (200). 404 if the session doesn't exist |
| `POST /webhooks/stripe` | Verifies the Stripe signature (raw body required — see below). On `checkout.session.completed`, marks the linked session `paid: true`. Empty 200 body on success (matching Rails' `head :ok`), 400 on a bad/missing signature |

`GET /health` is the one route not under `/v1` (ops check, not part of the API contract).

## Billing (Phase 4)

- **`POST /payments/checkout` replaces Rails' `/payments/billing/checkout`** — the extra `billing` path segment looked like routing-DSL leftover (a sub-action nested under `payments` for no clear reason) rather than an intentional shape, so it's simplified since nothing depends on the old path.
- **Real session linkage — this is new functionality, not a port.** Rails' `checkout` action never took a session/court parameter at all and had no way to know which recording a payment was for; its Stripe webhook handler extracted the completed checkout object and then did nothing with it. This app requires `sessionId` on checkout, stores it in the Stripe session's `metadata.session_id`, and the webhook uses that to mark the right session `paid: true` — closing a gap that didn't have a partial implementation to extend, only a stub.
- **New column**: `sessions.paid` (boolean, default `false`) — added by a real migration (`AddPaidToSessions`), since Rails has no equivalent column anywhere.
- **Raw body requirement**: Stripe signature verification needs the exact raw request bytes, not Nest's parsed JSON body. Enabled via `NestFactory.create(AppModule, { rawBody: true })` in `main.ts`, consumed via `req.rawBody` in `StripeWebhooksController`. Tests that hit this route must also pass `{ rawBody: true }` when creating the test app — see `test/stripe-webhooks.e2e-spec.ts`.
- **Stripe SDK note**: `checkout.sessions.create` is a real network call to Stripe, so it can't be exercised end-to-end in tests without real credentials — `test/payments.e2e-spec.ts` mocks the `stripe` package for that reason. Webhook signature verification (`stripe.webhooks.constructEvent`) is a local HMAC computation with no network call, so `test/stripe-webhooks.e2e-spec.ts` tests it for real, including a hand-computed valid signature.

## Recorder integration (Phase 3)

- **Auth**: a shared-secret JWT (`JWT_SECRET`, HS256, via `@nestjs/jwt`) in both directions, mirroring Rails' `JwtService`:
  - Recorder → API: `RecorderAuthGuard` (`src/common/guards/`) checks `Authorization: Bearer <token>` has `role: "recorder"` on both `recorders` routes. Missing/invalid/wrong-role → 401 (matching Rails' `head :unauthorized`, not Nest's guard default of 403).
  - API → Recorder: `RecorderClientService` (`src/common/recorder-client/`) mints a `role: "rails"` token when calling out to the recorder.
- **Outbound call**: `POST /sessions/:id/stop` enqueues a BullMQ job (`src/jobs/clip-request/`, queue name `clip-request`) instead of calling the recorder inline — matching Rails' `ActiveJob`/Sidekiq pattern. The job processor loads the session (with its court's camera) and calls `RecorderClientService.requestClip`, which `POST`s to `${RECORDER_URL}/api/clip`.
- **Outbound wire format stays snake_case** (`session_id`, `court_id`, `rtsp_url`, ...) — that's the external recorder service's contract, not something this app controls, so it's exempt from the camelCase convention below.
- **Closes the Phase 2 gap**: Rails' `stop` action has the `ClipRequestJob.perform_later` call commented out, so it never actually notifies the recorder today. This app's `stop` really enqueues the job.

**Deviation from Rails' `courts#index`**: the Rails controller returns bare positional arrays (`[[1, "Court 1", "court-1"], ...]`) for the no-slug case, via `Court.limit(50).pluck(...)`, which is inconsistent with every other endpoint's object-shaped JSON. That looks like an artifact of using `pluck` rather than an intentional contract — nothing consumes this API yet (the frontend isn't wired up), so there's no compatibility reason to replicate it. This app returns `{ id, name, slug }` objects in both the filtered and unfiltered cases instead.

**JSON field naming**: this app uses `camelCase` keys (`courtId`, `userContact`, `startedAt`) rather than Rails' `snake_case` (`court_id`, `user_contact`, `started_at`). Nothing currently consumes this API, so there's no compatibility reason to keep Rails' Ruby-idiomatic casing in a TypeScript app — this is a deliberate, permanent convention for the rewrite, not a gap to close later.

## Requirements

- Node.js 22+
- PostgreSQL

## Setup

```
cp .env.example .env    # edit DATABASE_URL if needed
npm install --legacy-peer-deps
npm run migration:run   # creates facilities/courts/cameras/sessions tables
npm run start:dev       # http://localhost:3000
```

`npm install` needs `--legacy-peer-deps` for now — see the note in the migration plan's Phase 0 status if this is still required by the time you read this; it's an npm/peer-dependency resolution issue with the current `@nestjs/cli`/`vitest` versions, unrelated to this app's own code.

Health check: `curl http://localhost:3000/health` → `{"status":"ok"}` (also confirms the DB connection is alive).

## Database migrations (TypeORM)

This app owns its own database and migration history — it is **not** pointed at Rails' database (see the migration plan's "Database migrations" decision). The initial migration recreates the schema Rails already has (`facilities`, `courts`, `cameras`, `sessions`) so the two are structurally compatible.

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
npm run test:e2e    # e2e tests (vitest + supertest), needs a running Postgres
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

All planned modules are implemented — see the migration plan for what's left (cutover).

## Deployment

Docker Compose on a single server, replacing Rails' Kamal setup (see the migration plan's "Deployment" decision — Kamal was never actually configured for a real server, so there was nothing working to preserve). One `app` service handles both HTTP and BullMQ job processing in the same process — there's no separate worker container, matching Rails' own default of running Solid Queue inside the Puma process rather than a dedicated machine.

**Stack**: `docker-compose.yml` defines `postgres`, `redis`, `app`, and `caddy` (via [caddy-docker-proxy](https://github.com/lucaslorentz/caddy-docker-proxy), which watches Docker labels and automatically reverse-proxies + issues a Let's Encrypt cert for whatever `APP_DOMAIN` is set to — no hand-written Caddyfile needed).

**One-time server setup** (not automated — do this once per server):
1. Install Docker + the Compose plugin.
2. Create `/opt/tdog-api/` on the server, copy `docker-compose.yml` there.
3. Create `/opt/tdog-api/.env` with real values for every variable in `.env.example`, including the three deploy-only ones at the bottom (`POSTGRES_PASSWORD`, `APP_DOMAIN`, `IMAGE`).
4. Open ports 80/443 (Caddy/ACME) — port 3000 is intentionally loopback-only (see the `ports:` comment in `docker-compose.yml`), reachable for debugging only via an SSH tunnel.

**CI/CD**: `.github/workflows/api-nest-deploy.yml` builds the image, pushes it to GHCR, then SSHes into the server to `docker compose pull && docker compose up -d`. It triggers on push to `main` (once `api-nest/` actually lives there) or manually via `workflow_dispatch`. It needs three repo secrets that don't exist yet: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`. Until they're set, a triggered run just fails at the SSH step — harmless, not destructive.

**Accepted tradeoffs** (same as the original Kamal-vs-Compose decision): brief downtime per deploy (container restart, not a health-checked traffic flip) and no automatic rollback on a bad deploy.

**Verified locally**: built the image, ran the full compose stack (`postgres` + `redis` + `app`) end-to-end — migrations run automatically on container start via the `CMD`, the app connects to both dependencies over the compose network, serves real traffic on the loopback-bound port, and survives a restart (migrations are idempotent — already-applied ones are just skipped). Along the way, found and fixed a real bug: the Dockerfile didn't copy `tsconfig.json` into the runtime image, so `tsx`/esbuild couldn't see `experimentalDecorators: true` and silently fell back to native stage-3 decorator semantics, which broke every TypeORM entity decorator.
