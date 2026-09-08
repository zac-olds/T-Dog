# T-Dog

Court-side video recording and clip-delivery product. A user starts a recording session on a court, an external recorder service captures and uploads the footage, and once payment is made the user gets a link to download their clip.

This repo contains two independently deployed apps:

| App | Path | Stack |
|---|---|---|
| API | [`api/`](api/README.md) | NestJS (TypeScript), PostgreSQL, Redis/BullMQ |
| Web | repo root (`src/`) | React 19, TypeScript, Vite |

> A third component — the **recorder service** that talks to the physical cameras — is a separate deployable and is not part of this repository. This repo only contains the API's client for calling it (`api/src/common/recorder-client/`) and the webhook that receives events from it (`POST /v1/recorders/webhook`).

The API was originally built in Rails and later rewritten in NestJS — see [`plans/nestjs-migration.md`](plans/nestjs-migration.md) for the full migration history, the decisions made along the way, and a parity audit against the old Rails test suite.

## How it fits together

```
Facility ──< Court ──1 Camera
                │
                └──< Session (created when a user starts recording)
```

1. A user starts a `Session` on a `Court` (`POST /v1/sessions`) — status becomes `active`.
2. The user stops the session (`POST /v1/sessions/:id/stop`) — status becomes `processing`, and a background job asks the recorder service to clip the footage and upload it to S3.
3. The recorder calls back with `POST /v1/recorders/webhook` (`event: clip_uploaded`) once the clip is in S3 — the session's status becomes `delivered`.
4. The user pays via Stripe Checkout (`POST /v1/payments/checkout`); the Stripe webhook marks the session `paid: true`.
5. `GET /v1/sessions/:id/presigned_download` returns a time-limited S3 URL for the clip.

Communication between the API and the recorder is authenticated with short-lived JWTs, in both directions.

## Getting started

### Prerequisites

- Node.js 22+
- PostgreSQL, Redis

### Backend (`api/`)

```
cd api
cp .env.example .env
npm install --legacy-peer-deps
npm run migration:run
npm run start:dev               # http://localhost:3000
```

See [`api/README.md`](api/README.md) for the full API reference, required environment variables, and deployment details.

### Frontend (root)

```
npm install
npm run dev                     # http://localhost:5173
```

The frontend is a fresh Vite/React scaffold and is not yet wired up to call the API.

## Repository layout

```
api/            NestJS API (see api/README.md)
src/            React frontend
  pages/        Route-level page components
  routes/       react-router route definitions
plans/          Design/migration planning docs
```

## CI

- [`.github/workflows/frontend-ci.yml`](.github/workflows/frontend-ci.yml) — builds the Vite frontend
- [`.github/workflows/api-ci.yml`](.github/workflows/api-ci.yml) — lints, builds, migrates, and tests the API against a real Postgres + Redis
- [`.github/workflows/api-deploy.yml`](.github/workflows/api-deploy.yml) — manual-only until a deploy server exists (see `api/README.md`'s Deployment section)

## For AI assistants

See [`CLAUDE.md`](CLAUDE.md) for architecture notes and command references aimed at Claude Code / other coding agents working in this repo.
