# API Migration Plan: Rails → NestJS

Status: **draft — open decisions below need answers before implementation starts**

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

## Target NestJS architecture (proposed)

```
api/                          # replaces the Rails app in place (see Option A/B below)
  src/
    facilities/               # controller + service
    courts/
    sessions/
    recorders/                # heartbeat + webhook, guarded by RecorderAuthGuard
    billing/                  # stripe checkout
    stripe-webhooks/
    common/
      guards/                 # JWT guard(s) for recorder auth
      jwt/                    # sign/verify helper, mirrors JwtService
      s3/                     # presigner service
      recorder-client/        # HTTP client to the external recorder service
    app.module.ts
    main.ts
  test/                       # e2e (supertest) — mirrors today's controller tests
```

- **Framework**: NestJS (Express adapter — no need for Fastify here, nothing perf-sensitive in this API).
- **ORM**: needs a decision (see Open Decisions). Either way, we reuse the *existing* Postgres schema/migrations rather than regenerating it — this is a backend swap, not a data model change.
- **Validation**: `class-validator` + `class-transformer` DTOs per endpoint (Rails currently does zero param validation — this is a strict improvement, not scope creep, since it's required to accept requests at all in Nest's idiomatic style).
- **Auth**: a small `JwtService` (using `@nestjs/jwt` or the `jsonwebtoken` package directly) replicating HS256 encode/decode with the same claims shape, plus a `RecorderAuthGuard` replicating `authenticate_recorder!`. Same shared secret env var (`JWT_SECRET`) so recorder-side tooling doesn't change.
- **Background jobs**: BullMQ + Redis replaces Sidekiq (same Redis instance, conceptually equivalent). Only one job to port: `ClipRequestJob`. Decision needed on whether to finally wire it up (see Open Decisions — "known gaps").
- **Config**: `@nestjs/config` reading the same env var names documented in `api/README.md`, so ops/deploy scripts and CI secrets don't need to change.
- **CORS**: Nest's built-in `enableCors()`, same allowed origin.
- **Stripe**: official `stripe` npm package, same webhook signature verification pattern.
- **AWS S3**: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`.
- **Testing**: Jest (Nest's default) for unit tests, `supertest` for e2e/controller-level tests — mapped 1:1 from the existing Rails controller tests so coverage doesn't regress.
- **Deployment**: Kamal supports arbitrary Dockerized services, so it can stay if desired — this is a Dockerfile change, not a Kamal replacement (see Open Decisions).

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

1. **Scaffold** — new Nest app boots, connects to the same Postgres DB (read-only smoke test), health check endpoint, CI wired up (lint + test + build), CORS + config plumbing in place. No business routes yet.
2. **Read-only endpoints** — `facilities` (implementing it for real, since the Rails route never worked), `courts` (incl. `?slug=` filter and nested camera serialization).
3. **Sessions** — full lifecycle (`create`, `show`, `stop`, `presigned_download`), including the S3 presigner service.
4. **Recorder integration** — JWT guard + `heartbeat`/`webhook`, plus the outbound `RecorderClient` and (decision needed) actually wiring `stop` → clip-request job → recorder call.
5. **Billing** — Stripe checkout + webhook verification. Decide whether to close the "webhook does nothing" gap by linking `checkout.session.completed` to a session/payment record.
6. **Parity test pass** — port/replicate the existing Rails controller tests as Nest e2e tests; confirm identical request/response shapes against the frontend's (currently nonexistent) expectations.
7. **Cutover** — see Option A/B under Open Decisions.

## Open decisions (need your input before implementation starts)

1. **Cutover strategy**: (a) build the whole Nest app in parallel (e.g. `api-nest/` or a feature branch) and swap it in behind the same reverse proxy once it has full parity, or (b) migrate module-by-module behind a router that proxies unmigrated routes to the still-running Rails app (strangler fig). Given the API's small surface area (5 real controllers), (a) is likely simpler and is what this plan assumes unless you'd rather do (b).
2. **ORM**: TypeORM (closer to ActiveRecord's feel, migrations-as-code) vs. Prisma (stronger typing/DX, separate schema file, different migration workflow). No strong lean from the codebase either way — this is a preference call.
3. **Known gaps** — do we fix them as part of the migration, or replicate them as-is for a pure like-for-like port?
   - `facilities`/`payments` routes exist but have no controller (500 today).
   - `Session#stop` never actually enqueues the clip job.
   - Stripe `checkout.session.completed` webhook doesn't link back to a session.
4. **Deployment target**: keep Kamal (just point it at a Node Dockerfile instead of the Rails one), or move to something else? No signal in the repo that Kamal itself needs to change — recommend keeping it unless you have a reason to switch.
5. **Repo layout**: replace `api/` in place once cutover happens, or land the new service under a different folder name (e.g. `api-nest/`) so both can coexist during development and CI can run both until cutover? Given decision #1, if we go with (a) a parallel build, a temporary separate folder is probably necessary regardless of the final name.

## Non-goals

- No changes to the frontend in this effort (it isn't wired to the API yet regardless).
- No changes to the external recorder service or its contract (`RECORDER_URL`, webhook payload shapes, JWT claims) — the Nest API needs to remain a compatible client/server for it.
- No database schema changes beyond what's needed to fix the "known gaps" above, if we decide to fix them.
