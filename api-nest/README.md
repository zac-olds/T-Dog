# T-Dog API (NestJS)

NestJS rewrite of the T-Dog API, replacing `../api` (Rails). See [`../plans/nestjs-migration.md`](../plans/nestjs-migration.md) for the full migration plan, decisions, and phase-by-phase status.

**Current status: Phase 2.** `facilities`, `courts`, and `sessions` are implemented; `recorders` and `payments` are still to come. Don't point the frontend at this yet.

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
| `POST /sessions/:id/stop` | Sets `status: "processing"`, `endedAt: now`. Returns `{ id, status, ok: true }` (200). Doesn't yet notify the recorder — that's Phase 3, matching Rails' current behavior (the enqueue call is commented out there too) |
| `GET /sessions/:id/presigned_download` | Presigned S3 GET URL if `s3Key` is set, else 404 |

`GET /health` is the one route not under `/v1` (ops check, not part of the API contract).

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
  common/s3/        S3 presigner service, shared by sessions (and later payments/recorders as needed)
  data-source.ts    standalone TypeORM DataSource used by the migration CLI
  configure-app.ts  shared app setup (global prefix, CORS, validation) used by main.ts and e2e tests
  app.module.ts
  main.ts
```

Remaining modules (`recorders`, `payments`, `stripe-webhooks`) land in later phases — see the migration plan.
