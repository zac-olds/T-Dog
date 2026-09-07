# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

T-Dog is a court-side video recording and clip-delivery product, made of two independently deployed apps in one repo:

- **`api/`** — Rails 8 API-only backend (Ruby 3.4.5, PostgreSQL, Sidekiq/Redis)
- **root `src/`** — React 19 + TypeScript + Vite frontend (early scaffold, not yet wired to the API)

Domain flow: a `Facility` has many `Court`s; each `Court` has one `Camera`. A user starts a `Session` on a court, an **external recorder service** (a separate deployable — not part of this repo) records video against the court's camera and uploads a clip to S3, then the API hands back a presigned S3 download URL, gated behind Stripe billing.

## Architecture

- **The recorder is a separate service, not in this repo.** The API only contains the client side (`RecorderClient`, in `api/app/services/`) that calls out to it over HTTP, and the inbound webhook (`V1::RecordersController#webhook`) that the recorder calls back into. `RECORDER_URL` defaults to `http://localhost:4000` for local dev against that other service.
- **Two-directional JWT auth**, both minted by the same `JwtService`:
  - Recorder → Rails: recorder calls `POST /v1/recorders/heartbeat` and `/webhook` with a JWT of `role: 'recorder'`; `ApplicationController#authenticate_recorder!` checks it.
  - Rails → Recorder: `RecorderClient.jwt` mints a `role: 'rails'` token when the API calls the recorder.
- **Session lifecycle**: `create` (status `active`) → `stop` (status `processing` — the line enqueuing `ClipRequestJob` is currently commented out in `sessions_controller.rb`, so nothing actually notifies the recorder to clip yet) → recorder posts `clip_uploaded` to the webhook (sets `s3_key`, status `delivered`) → `presigned_download` returns a time-limited S3 URL via `S3Presigner`.
- **Billing**: `V1::BillingController#checkout` creates a Stripe Checkout session (fixed `STRIPE_PRICE_ID`, one line item). `V1::StripeWebhooksController` verifies the Stripe signature and switches on `checkout.session.completed`, but doesn't yet do anything with the event (no code links a completed payment back to a `Session`).
- **Background jobs**: the app runs Sidekiq/Redis (`sidekiq` gem, mounted at `/admin/sidekiq`) even though Rails 8's default `solid_queue`/`solid_cache`/`solid_cable` gems are also in the Gemfile — Sidekiq is what's actually used for jobs like `ClipRequestJob`.
- **CORS** is preconfigured in `api/config/initializers/cors.rb` for `http://localhost:5173` only (Vite's default port) — update this if the frontend moves origin.
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
bin/setup                          # install deps + prepare db
bin/rails server                   # run the API
bin/rails db:create db:migrate     # set up the database
bin/rails test                     # full test suite
bin/rails test test/models/session_test.rb        # single test file
bin/rails test test/models/session_test.rb:12      # single test at a line
bin/rubocop                        # lint (rubocop-rails-omakase style)
bin/brakeman                       # static security scan
```

Note: most model tests (`api/test/models/*_test.rb`) are still empty generated stubs (`# test "the truth" ...` commented out) — controller tests under `api/test/controllers/` have real coverage.

### Required environment variables

Backend: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (or `Rails.application.credentials.jwt_secret`), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `APP_BASE_URL`, `RECORDER_URL`. In development/test, `dotenv-rails` loads these from `api/.env`.

### CI

There are two independent CI workflows that have drifted apart — be aware of both if you touch CI or dependencies:
- `.github/workflows/ci.yml` (root): boots Postgres 15 + Redis, runs `bin/rails test` in `api/`, then `npm install && npm run build` for the frontend.
- `api/.github/workflows/ci.yml`: Brakeman scan, Rubocop lint, and `bin/rails test` against Postgres only (Redis service is commented out).
