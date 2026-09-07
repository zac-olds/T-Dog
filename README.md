# T-Dog

Court-side video recording and clip-delivery product. A user starts a recording session on a court, an external recorder service captures and uploads the footage, and once payment is made the user gets a link to download their clip.

This repo contains two independently deployed apps:

| App | Path | Stack |
|---|---|---|
| API | [`api/`](api/README.md) | Ruby on Rails 8 (API-only), PostgreSQL, Sidekiq/Redis |
| Web | repo root (`src/`) | React 19, TypeScript, Vite |

> A third component — the **recorder service** that talks to the physical cameras — is a separate deployable and is not part of this repository. This repo only contains the API's client for calling it (`api/app/services/recorder_client.rb`) and the webhook that receives events from it (`POST /v1/recorders/webhook`).

## How it fits together

```
Facility ──< Court ──1 Camera
                │
                └──< Session (created when a user starts recording)
```

1. A user starts a `Session` on a `Court` (`POST /v1/sessions`) — status becomes `active`.
2. The user stops the session (`POST /v1/sessions/:id/stop`) — status becomes `processing`.
3. The API asks the recorder service to clip the footage (`RecorderClient`) and upload it to S3.
4. The recorder calls back with `POST /v1/recorders/webhook` (`event: clip_uploaded`) once the clip is in S3 — the session's status becomes `delivered`.
5. The user pays via Stripe Checkout (`POST /v1/payments/billing/checkout`).
6. Once delivered, `GET /v1/sessions/:id/presigned_download` returns a time-limited S3 URL for the clip.

Communication between the API and the recorder is authenticated with short-lived JWTs minted by `JwtService`, in both directions (`role: 'rails'` and `role: 'recorder'`).

## Getting started

### Prerequisites

- Ruby 3.4.5, PostgreSQL, Redis
- Node.js 22.x

### Backend (`api/`)

```
cd api
bin/setup                       # installs gems, prepares the database
bin/rails server                # http://localhost:3000
```

See [`api/README.md`](api/README.md) for the required environment variables, background jobs, and test commands.

### Frontend (root)

```
npm install
npm run dev                     # http://localhost:5173
```

The frontend is a fresh Vite/React scaffold and is not yet wired up to call the API.

## Repository layout

```
api/            Rails API (see api/README.md)
src/            React frontend
  pages/        Route-level page components
  routes/       react-router route definitions
```

## CI

Two GitHub Actions workflows currently exist and have drifted from each other — see [`CLAUDE.md`](CLAUDE.md#ci) for details:

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — runs the API test suite and the frontend build
- [`api/.github/workflows/ci.yml`](api/.github/workflows/ci.yml) — runs Brakeman, Rubocop, and the API test suite

## For AI assistants

See [`CLAUDE.md`](CLAUDE.md) for architecture notes and command references aimed at Claude Code / other coding agents working in this repo.
