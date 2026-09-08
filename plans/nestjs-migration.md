# API Migration Plan: Rails → NestJS

## Status

Update this table as work happens — it's the source of truth for where the migration actually stands, not just what was planned.

**Branching**: each phase gets its own branch and PR, merged into the integration branch `feature/nestjs-migration` — not `main`. `main` stays untouched by the (incomplete) rewrite until phase 6 (cutover), when `feature/nestjs-migration` gets PR'd into `main` in one shot.

| Phase | Description | Status | Notes |
|---|---|---|---|
| 0 | Scaffold (`api-nest/` boots, own DB, initial TypeORM migration, CI) | Merged | PR #2, merged into `feature/nestjs-migration`. |
| 1 | Read-only endpoints (`facilities`, `courts`) | Merged | PR #3, merged into `feature/nestjs-migration`. `facilities` implemented for real (gap fix). Deviated from Rails' `courts#index`: returns objects instead of positional arrays for the no-slug case — see `api-nest/README.md`. |
| 2 | Sessions (full lifecycle + S3 presigner) | Merged | PR #4, merged into `feature/nestjs-migration`. `create`/`stop` use `@HttpCode(200)` to match Rails' plain `render json:` (Nest defaults POST to 201). Established (retroactively covering Phase 1 too): JSON keys are camelCase, not Rails' snake_case — see `api-nest/README.md`. |
| 3 | Recorder integration (JWT guard, heartbeat/webhook, clip job wiring) | Merged | PR #5, merged into `feature/nestjs-migration`. Closes the Phase 2 gap: `stop` now really enqueues a BullMQ `clip-request` job, processed by calling the recorder over HTTP. `RecorderAuthGuard` throws 401 (not Nest's guard-default 403). Outbound/inbound recorder wire format stays snake_case (external contract). Caught and fixed a CI-only test failure along the way (`ConfigService` falling back to real `process.env`). |
| 4 | Billing (payments/checkout, Stripe webhook linked to sessions) | Merged | PR #6, merged into `feature/nestjs-migration`. `POST /v1/payments/checkout` replaces Rails' oddly-nested `/payments/billing/checkout`. Session linkage (checkout → `metadata.session_id` → webhook marks `sessions.paid = true`) is genuinely new functionality — Rails' checkout never took a session param and its webhook handler was a total no-op. New `sessions.paid` column via a real migration (`AddPaidToSessions`). |
| 5 | Parity test pass | In review | Branch `nestjs/phase-5-parity-pass` → `feature/nestjs-migration`. Audited every Rails controller test against the Nest suite (see "Parity audit findings" below) — no gaps found, Nest's coverage is equal or stronger everywhere. Found a latent Rails bug: `RecorderClient.clip`'s `callback_url` would crash (`Missing host to link to!`) if the commented-out job enqueue were ever un-commented, since `default_url_options` is only configured for ActionMailer, never for general routes — confirming this app's `APP_BASE_URL`-based callback URL isn't just a style choice, it's a necessary fix. Did a full clean-room verification: fresh `node_modules`, fresh Postgres + Redis, both migrations from scratch, full unit + e2e suite (37/37), and a single continuous manual walkthrough hitting every documented endpoint in one real flow (facility → court → camera → session → stop → recorder clip request → recorder webhook → presigned download → Stripe webhook), confirming they all compose correctly together. |
| 6 | Cutover (Docker Compose + GitHub Actions live, `api/` retired) | In review (infra only) | Branch `nestjs/phase-6-cutover` → `feature/nestjs-migration`. Built and locally verified: `Dockerfile`, `docker-compose.yml` (app + postgres + redis + caddy — no separate worker, see below), `.github/workflows/api-nest-deploy.yml`. **Not done yet, needs input**: actually pointing a real server/domain at this and retiring Rails — see the question posed alongside this PR. Found and fixed a real bug: the Dockerfile didn't copy `tsconfig.json` into the runtime image, so `tsx`/esbuild silently used native stage-3 decorator semantics instead of legacy ones, breaking every TypeORM entity decorator. |

## Decisions

| Question | Decision |
|---|---|
| Cutover strategy | Parallel build in a new folder; swap in once at full parity (no strangler-fig proxy) |
| ORM | TypeORM |
| Database migrations | TypeORM owns migrations from day one — `api-nest/` runs against its own database with its own migration history, not the live Rails-managed one. Rails is never run alongside Nest, so there's no simultaneous-ownership problem to coordinate. |
| Known gaps (missing facilities/payments controllers, clip job never enqueued, Stripe webhook not linked to sessions) | Fix during migration, not replicated as-is |
| Repo layout during development | New `api-nest/` folder alongside `api/`; `api/` is deleted and `api-nest/` renamed to `api/` at cutover |
| Deployment | Drop Kamal. Use Docker Compose (app + Postgres + Redis + reverse proxy) on the target server, deployed via a GitHub Actions workflow that SSHes in, pulls the new image, and runs `docker compose up -d`. |

## Goal

Replace `api/` (Rails 8, API-only) with a NestJS (TypeScript/Node) service that serves the same `/v1` contract to the frontend and to the external recorder service, on the same PostgreSQL database.

## Current state inventory (Rails)

This is what actually exists today — used as the source of truth for parity.

### Data model (Postgres, 4 tables)
- `facilities` — `name`, `slug` (unique)
- `courts` — belongs to `facility`; `name`, `slug` (unique)
- `cameras` — belongs to `court` (1:1); `rtsp_url`, `onvif_url`, `make`, `model`
- `sessions` — belongs to `court`; `user_contact`, `status`, `started_at`, `ended_at`, `duration_s`, `s3_key`, `token` (random, assigned on create)

### Routes / controllers (all under `/v1`)
| Route | Controller | Notes |
|---|---|---|
| `GET /facilities`, `/facilities/:id` | **none exists** | Routed but `V1::FacilitiesController` was never created — this 500s today. Needs a real decision (see below). |
| `GET /courts`, `/courts/:id` | `V1::CourtsController` | `index` supports `?slug=` filter; both include nested camera fields |
| `POST /sessions`, `GET /sessions/:id`, `POST /sessions/:id/stop`, `GET /sessions/:id/presigned_download` | `V1::SessionsController` | see lifecycle below |
| `POST /recorders/heartbeat`, `POST /recorders/webhook` | `V1::RecordersController` | requires recorder JWT (`role: 'recorder'`) |
| `resources :payments` + `POST /payments/billing/checkout` | `V1::BillingController` (checkout only) | **`PaymentsController` doesn't exist either** — same gap as facilities, the CRUD routes 500 |
| `POST /webhooks/stripe` | `V1::StripeWebhooksController` | verifies Stripe signature |
| `mount Sidekiq::Web => "/admin/sidekiq"` | — | ops UI, not part of the app's API contract |

### Session lifecycle
`create` (status `active`) → `stop` (status `processing` — **note: does not currently enqueue any job**, `ClipRequestJob.perform_later` is commented out in the controller) → recorder calls `POST /recorders/webhook` with `event=clip_uploaded` (sets `s3_key`, status `delivered`) → `GET /sessions/:id/presigned_download` returns an S3 presigned URL.

### Auth
- Two-directional JWT via a single shared secret (`JwtService`, HS256, `jwt` gem):
  - Recorder → API: `Authorization: Bearer <jwt>` with `role: 'recorder'`, checked by `ApplicationController#authenticate_recorder!` on the two recorder endpoints only.
  - API → Recorder: API mints a `role: 'rails'` token when calling out to the recorder service.
- No auth at all on `facilities`/`courts`/`sessions`/`billing` endpoints today (no user accounts, no session cookies — `user_contact` is just a free-text string captured on session create).

### External integrations
- **Recorder service** (separate deployable, not in this repo): `RecorderClient` POSTs to `${RECORDER_URL}/api/clip` with session/camera details + a callback URL; recorder calls back via the webhook above. `RECORDER_URL` defaults to `http://localhost:4000`.
- **AWS S3**: `S3Presigner` generates presigned GET URLs (`aws-sdk-s3`).
- **Stripe**: Checkout Session creation (`billing_controller`) + webhook signature verification (`stripe_webhooks_controller`), fixed `STRIPE_PRICE_ID` line item. `checkout.session.completed` is handled but currently does nothing with the event (not linked back to a session).
- **Sidekiq + Redis**: `Rails.application.config.active_job.queue_adapter = :sidekiq`. Only one job exists, `ClipRequestJob` (currently never enqueued — see above). `solid_queue`/`solid_cache`/`solid_cable` gems are present in the Gemfile but unused (Sidekiq is the real adapter; no ActionCable channels exist; nothing reads from Solid Cache).
- **ActionMailer**: configured (`application_mailer.rb`, layout views) but no mailer classes send anything — dead scaffold.
- **CORS**: locked to `http://localhost:5173` (Vite dev server) via `rack-cors`.

### Auth/config plumbing
- `JWT_SECRET` (or Rails credentials), `DATABASE_URL`, `REDIS_URL`, `RECORDER_URL`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION`, `S3_BUCKET`, `STRIPE_SECRET_KEY`/`STRIPE_PRICE_ID`/`STRIPE_WEBHOOK_SECRET`, `APP_BASE_URL`. Loaded via `dotenv-rails` in dev/test.

### Tests
Controller tests exist and pass real coverage for `courts`, `sessions`, `recorders`, `billing`, `stripe_webhooks`. Model tests (`facility`, `court`, `camera`, `session`) are empty generated stubs with no real assertions.

### Deployment
Kamal (Docker-based) + Thruster in front of Puma. Two independent, drifted CI workflows (root vs `api/`) — see `CLAUDE.md`.

---

## Target NestJS architecture

```
api-nest/                     # new folder, coexists with api/ until cutover
  src/
    facilities/                # controller + service — implemented for real (gap fix)
    courts/
    sessions/
    recorders/                 # heartbeat + webhook, guarded by RecorderAuthGuard
    payments/                  # implemented for real (gap fix) — supersedes ad-hoc billing-only controller
    billing/                   # stripe checkout, nested under payments per the Rails route shape
    stripe-webhooks/           # now links checkout.session.completed to a session/payment (gap fix)
    jobs/
      clip-request/            # BullMQ processor, actually enqueued from sessions.stop() (gap fix)
    common/
      guards/                  # JWT guard(s) for recorder auth
      jwt/                     # sign/verify helper, mirrors JwtService
      s3/                      # presigner service
      recorder-client/         # HTTP client to the external recorder service
    entities/                  # TypeORM entities: Facility, Court, Camera, Session
    app.module.ts
    main.ts
  test/                        # e2e (supertest) — mirrors today's controller tests
```

- **Framework**: NestJS (Express adapter — no need for Fastify here, nothing perf-sensitive in this API).
- **ORM**: TypeORM, with its own migration history from the start (`synchronize: false` always — no schema auto-sync). `api-nest/` runs against its own database (local/dev/staging, separate from Rails' production database) throughout development, since Rails is never run at the same time as Nest. The initial TypeORM migration recreates the current 4-table schema (`facilities`, `courts`, `cameras`, `sessions`) to match Rails' `schema.rb`; later migrations add whatever the phase 4 gap fixes need (e.g. a `payments` table). This is a data-model-preserving rewrite, not a redesign — the recreated schema should be structurally identical to what Rails has today, plus additive changes.
- **Validation**: `class-validator` + `class-transformer` DTOs per endpoint (Rails currently does zero param validation — this is a strict improvement, not scope creep, since it's required to accept requests at all in Nest's idiomatic style).
- **Auth**: a small `JwtService` (using `@nestjs/jwt` or the `jsonwebtoken` package directly) replicating HS256 encode/decode with the same claims shape, plus a `RecorderAuthGuard` replicating `authenticate_recorder!`. Same shared secret env var (`JWT_SECRET`) so recorder-side tooling doesn't change.
- **Background jobs**: BullMQ + Redis replaces Sidekiq (same Redis instance, conceptually equivalent). `ClipRequestJob` is ported *and* actually wired up: `sessions.stop()` enqueues it, the processor calls the recorder client.
- **Config**: `@nestjs/config` reading the same env var names documented in `api/README.md`, so ops/deploy scripts and CI secrets don't need to change.
- **CORS**: Nest's built-in `enableCors()`, same allowed origin.
- **Stripe**: official `stripe` npm package, same webhook signature verification pattern; `checkout.session.completed` now updates the associated session/payment record instead of being a no-op.
- **AWS S3**: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`.
- **Testing**: Vitest (the current `@nestjs/cli new` default, as of Phase 0 — not Jest) for unit tests, `supertest` for e2e/controller-level tests — mapped 1:1 from the existing Rails controller tests so coverage doesn't regress, plus new tests for the previously-missing facilities/payments controllers.
- **Deployment**: Kamal is dropped. `api-nest/docker-compose.yml` defines the app, Postgres, Redis, and a reverse proxy (Traefik or Caddy, for TLS termination) as services. A GitHub Actions workflow (triggered on push to `main`, or on a release tag) builds the image, pushes it to a registry, then SSHes into the target server to `docker compose pull && docker compose up -d`. See the new "Deployment" section below for the tradeoffs this accepts.

## Deployment: Docker Compose + GitHub Actions (replaces Kamal)

Kamal is framework-agnostic (it's a general SSH+Docker deploy tool, not Rails-specific), so nothing about the Rails→Nest swap *required* dropping it — but since `api/config/deploy.yml` was still unconfigured placeholder values (`192.168.0.1`, `app.example.com`) and never actually used in production, there's no working setup to preserve. Given the app's small footprint (one API process, one Postgres, one Redis, one worker), Docker Compose is simpler to read/maintain than Kamal's conventions, at the cost of the deploy-time polish below.

- **`api-nest/docker-compose.yml`**: services for `app`, `postgres`, `redis`, and `caddy` (via caddy-docker-proxy, label-driven, handles TLS via Let's Encrypt automatically). **No separate `worker` service, unlike originally planned here**: the BullMQ `ClipRequestProcessor` (Phase 3) runs in-process inside the same Nest application that serves HTTP, not as a separately-bootstrapped consumer — so there's no distinct start command to give a second container. This matches Rails' own default (`SOLID_QUEUE_IN_PUMA: true` in `api/config/deploy.yml`) of running jobs inside the same process rather than a dedicated machine.
- **CI/CD**: `.github/workflows/api-nest-deploy.yml` builds and pushes the image to GHCR (using the built-in `GITHUB_TOKEN`, no extra registry credentials needed), then SSHes in to run `docker compose pull && docker compose up -d` on the target server.
- **Secrets**: server-side `.env` file (not committed) holding `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, AWS/Stripe keys, plus the deploy-only `POSTGRES_PASSWORD`/`APP_DOMAIN`/`IMAGE` — referenced by `docker-compose.yml`'s `env_file:`. GitHub Actions needs three repo secrets that don't exist yet: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` — until they're added, a triggered deploy run just fails harmlessly at the SSH step.
- **Accepted tradeoffs vs. Kamal**: brief downtime on each deploy (the app container restarts rather than a health-checked traffic flip), no automatic rollback on a bad deploy (would need to manually re-deploy the previous image tag), and TLS/reverse-proxy config is hand-maintained rather than automated.
- **Not in scope for this plan**: multi-server/high-availability deployment. Docker Compose is single-host; if this ever needs to scale beyond one server, that's a bigger infrastructure change (e.g. moving to ECS/Kubernetes) independent of this migration.

## Rails → Nest construct mapping

| Rails | NestJS |
|---|---|
| `ActiveRecord` model | ORM entity/model (TypeORM entity or Prisma model) |
| Controller action | Controller method + route decorator |
| Strong params (implicit, mostly absent here) | DTO class + `class-validator` decorators |
| `before_action` | Guard / Interceptor / Pipe, depending on purpose |
| Service object (`app/services`) | `@Injectable()` provider |
| `ActiveJob` + Sidekiq | BullMQ `Processor` + `Queue` |
| `config/routes.rb` | `@Controller('v1/...')` decorators per module |
| `Rails.application.credentials` / `ENV` | `ConfigService` (`@nestjs/config`) |
| `rack-cors` initializer | `app.enableCors({...})` in `main.ts` |

## Migration phases

0. **Scaffold** — `api-nest/` boots against its own Postgres database, health check endpoint, CI wired up (lint + test + build), CORS + config plumbing in place, TypeORM initial migration recreates the `facilities`/`courts`/`cameras`/`sessions` schema from scratch. No business routes yet.
1. **Read-only endpoints** — `facilities` (new, real implementation — the Rails route never worked), `courts` (incl. `?slug=` filter and nested camera serialization).
2. **Sessions** — full lifecycle (`create`, `show`, `stop`, `presigned_download`), including the S3 presigner service.
3. **Recorder integration** — JWT guard + `heartbeat`/`webhook`, the outbound `RecorderClient`, and wiring `stop` → BullMQ clip-request job → recorder call (closing the gap where this is currently a no-op).
4. **Billing** — `payments`/`billing` checkout + Stripe webhook verification, with `checkout.session.completed` now updating session/payment state (closing the current no-op gap).
5. **Parity test pass** — port the existing Rails controller tests as Nest e2e tests, plus new tests for facilities/payments; confirm identical request/response shapes for the frontend and the recorder service's contract.
6. **Cutover** — stand up the Docker Compose stack + GitHub Actions deploy workflow for `api-nest/`, point DNS/traffic at it, retire the Rails Kamal deploy, delete `api/`, rename `api-nest/` → `api/`. No production data to migrate (see note below).

## Notes on the confirmed decisions

- **No strangler-fig proxy** — Rails (`api/`) keeps serving all production traffic unchanged until `api-nest/` reaches full parity in phase 5; there's no intermediate state where some requests hit Nest and some hit Rails.
- **No shared database during development** — Rails is never run alongside Nest, so `api-nest/` builds and owns its own database and TypeORM migration history from phase 0 onward, independent of the live Rails database. This avoids two migration frameworks ever touching the same schema at once.
- **No data migration needed at cutover** — there's no existing production database with real data to carry over, so `api-nest/`'s database simply becomes the production database at cutover with nothing to import.
- **Gap fixes touch behavior, not just framework** — implementing real `facilities`/`payments` controllers and linking the Stripe webhook to sessions are functional changes, not pure ports. They'll get their own tests rather than being folded silently into "parity."

## Parity audit findings (Phase 5)

Every Rails controller test (`api/test/controllers/**`) checked against the Nest e2e suite:

| Rails test | Coverage in Nest | Verdict |
|---|---|---|
| `billing_controller_test.rb` | `test/payments.e2e-spec.ts` | Rails test file is an empty stub (commented-out placeholder) — Nest has real coverage where Rails had none |
| `stripe_webhooks_controller_test.rb` | `test/stripe-webhooks.e2e-spec.ts` | Same — empty Rails stub, real Nest coverage |
| `v1/courts_controller_test.rb` ("index by slug", "show") | `test/courts.e2e-spec.ts` | Covered, plus camera/facilityId assertions Rails' test doesn't make |
| `v1/recorders_controller_test.rb` ("heartbeat", "webhook clip_uploaded") | `test/recorders.e2e-spec.ts` | Covered, plus `duration_s` assertion and negative auth cases Rails' test doesn't have |
| `v1/sessions_controller_test.rb` ("create", "stop", "show", "presigned_download") | `test/sessions.e2e-spec.ts` | Covered; added the same `"amazonaws.com"` substring assertion Rails' `presigned_download` test makes, for an exact match |

No gaps found — every model test (`facility`, `court`, `camera`, `session`) is also an empty Rails stub, so there was nothing to port there either.

**Recorder contract fidelity** — re-verified field-by-field against `api/app/services/recorder_client.rb` and `api/app/controllers/v1/recorders_controller.rb`: outbound `POST /api/clip` body (`session_id`, `court_id`, `started_at`, `ended_at`, `rtsp_url`, `s3_bucket`, `s3_key_prefix`, `callback_url`), inbound webhook body (`event`, `session_id`, `s3_key`, `duration_s`), and JWT claim shapes (`role: "recorder"` inbound, `role: "rails", svc: "api"` outbound) all match exactly.

**A latent Rails bug, found while re-verifying the callback URL**: `RecorderClient.clip` builds `callback_url` via `Rails.application.routes.url_helpers.v1_recorders_webhook_url` — a `_url` helper, which requires a known host. `default_url_options` is only configured for `action_mailer` (`config/environments/{development,test,production}.rb`), never for routes generally. Called from a background job (no request context to infer a host from), this would raise `ActionController::UrlGenerationError: Missing host to link to!` — meaning if `ClipRequestJob.perform_later` were ever un-commented in Rails without also fixing this, the job would fail every time. It's never been caught because the job has never actually run. This confirms building `callback_url` from `APP_BASE_URL` in this app (Phase 3) wasn't just a reasonable substitute — it was a necessary fix for something that would have been broken on first real use.

**Full clean-room verification**: fresh `node_modules` (deleted and reinstalled), fresh Postgres and Redis containers, both migrations run from an empty database, full unit + e2e suite (37/37 passing), and a single continuous manual walkthrough — booted the real app plus a throwaway HTTP server standing in for the recorder, and drove one flow through every documented endpoint in order: create facility/court/camera → list and show facilities and courts → create a session → stop it (confirmed the recorder actually received the correctly-shaped clip request) → recorder webhook marks it delivered → presigned download returns a real `amazonaws.com` URL → Stripe webhook (real HMAC signature, no mocking) marks it paid. Every step's output was consistent with the others (same IDs, same session state carried through).

## Non-goals

- No changes to the frontend in this effort (it isn't wired to the API yet regardless).
- No changes to the external recorder service or its contract (`RECORDER_URL`, webhook payload shapes, JWT claims) — the Nest API needs to remain a compatible client/server for it.
- No database schema changes beyond what's needed to fix the "known gaps" above, if we decide to fix them.
