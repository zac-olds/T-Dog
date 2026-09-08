# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

T-Dog is a court-side video recording and clip-delivery product, made of two independently deployed apps in one repo:

- **`api/`** — NestJS (TypeScript) backend: PostgreSQL via TypeORM, Redis/BullMQ for background jobs
- **root `src/`** — React 19 + TypeScript + Vite frontend (early scaffold, not yet wired to the API)

The API was originally Rails and was fully rewritten to NestJS — see `plans/nestjs-migration.md` for the migration history, every deliberate deviation from the old Rails behavior, and a parity audit against Rails' old test suite. That document is worth reading before assuming "the way Rails did X" is relevant; several things were intentionally changed, not just ported.

Domain flow: a `Facility` has many `Court`s; each `Court` has one `Camera`. A user starts a `Session` on a court, an **external recorder service** (a separate deployable — not part of this repo) records video against the court's camera and uploads a clip to S3, then the API hands back a presigned S3 download URL, gated behind Stripe billing.

## Architecture

- **The recorder is a separate service, not in this repo.** The API only contains the client side (`RecorderClientService`, `api/src/common/recorder-client/`) that calls out to it over HTTP, and the inbound webhook (`POST /v1/recorders/webhook`, `api/src/recorders/`) that the recorder calls back into.
- **Two-directional JWT auth**, both signed with the same `JWT_SECRET` (HS256, via `@nestjs/jwt`, registered globally in `app.module.ts`):
  - Recorder → API: `RecorderAuthGuard` (`api/src/common/guards/`) checks for `role: "recorder"` on `POST /v1/recorders/heartbeat` and `/webhook`. Throws 401 on failure (not Nest's guard-default 403).
  - API → Recorder: `RecorderClientService` mints a `role: "rails", svc: "api"` token when calling the recorder. (The claim value `"rails"` is a holdover from the old Rails implementation's contract with the recorder — the recorder service expects that exact string, so it wasn't changed.)
- **Session lifecycle**: `create` (status `active`) → `stop` (status `processing`, enqueues a BullMQ `clip-request` job) → the job processor calls the recorder → recorder posts `clip_uploaded` to the webhook (sets `s3Key`, status `delivered`) → `presigned_download` returns a time-limited S3 URL via `S3PresignerService` (`api/src/common/s3/`).
- **No separate worker process**: the BullMQ processor (`api/src/jobs/clip-request/`) runs in-process inside the same Nest app that serves HTTP — there's no separately-bootstrapped consumer. Deployment is a single container.
- **Billing**: `POST /v1/payments/checkout` requires a `sessionId`, stores it in the Stripe Checkout session's `metadata.session_id`, and `POST /v1/webhooks/stripe` uses that to mark the session `paid: true` on `checkout.session.completed`. Stripe signature verification needs the raw request body — the app boots with `NestFactory.create(AppModule, { rawBody: true })`, consumed via `req.rawBody` in `StripeWebhooksController`.
- **JSON field naming**: the API uses `camelCase` (`courtId`, `startedAt`) everywhere **except** the recorder's webhook body and the outbound clip-request payload, which stay `snake_case` — that's an external service's wire contract, not something this app controls.
- **Database migrations**: TypeORM owns them (`api/src/migrations/`), `synchronize` is always `false`. `api/src/data-source.ts` is a standalone `DataSource` used only by the migration CLI (`npm run migration:run`/`:revert`/`:generate`) — it runs via `tsx` directly against the TypeScript source, not compiled output, which is why the Dockerfile copies `src/` and `tsconfig.json` into the runtime image alongside `dist/`.
- **CORS** is configured for `http://localhost:5173` only (Vite's default port) — update `CORS_ORIGIN` if the frontend moves origin.
- The two apps do not share code or types; the frontend has no API client yet.

## Commands

### Frontend (repo root)

```
npm install
npm run dev       # Vite dev server
npm run build     # tsc -b typecheck + production build
npm run lint       # ESLint
npm run preview   # preview production build
```

### Backend (`api/`)

```
npm install --legacy-peer-deps     # --legacy-peer-deps is required, see api/README.md
npm run start:dev                  # http://localhost:3000
npm run migration:run              # apply pending migrations
npm run build                      # nest build (tsc)
npm run lint                       # oxlint
npm test                           # unit tests (vitest)
npm run test:e2e                   # e2e tests (vitest + supertest) — needs a running Postgres + Redis
```

Run a single test file: `npx vitest run path/to/file.spec.ts` (unit) or `npx vitest run --config ./vitest.config.e2e.ts path/to/file.e2e-spec.ts` (e2e).

### Required environment variables (backend)

See `api/README.md` for the full table. In dev/test these load from `api/.env` (copy from `.env.example`).

### CI

- `.github/workflows/frontend-ci.yml` — builds the Vite frontend.
- `.github/workflows/api-ci.yml` — lints, builds, runs migrations, and runs the full test suite for `api/` against real Postgres + Redis service containers.
- `.github/workflows/api-deploy.yml` — builds and pushes a Docker image to GHCR, then SSHes into a server to redeploy via Docker Compose. **Manual-only** (`workflow_dispatch`) until a real deploy server exists and its secrets (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`) are configured — see `api/README.md`'s Deployment section before wiring this to run automatically on push.
