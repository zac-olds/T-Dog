# T-Dog API (NestJS)

NestJS rewrite of the T-Dog API, replacing `../api` (Rails). See [`../plans/nestjs-migration.md`](../plans/nestjs-migration.md) for the full migration plan, decisions, and phase-by-phase status.

**Current status: Phase 0 (scaffold) only.** There are no business routes yet — just app bootstrap, database connectivity, and a health check. Don't point the frontend at this yet.

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
  entities/       TypeORM entities (Facility, Court, Camera, Session)
  migrations/     TypeORM migrations
  config/         env var validation
  health/         GET /health
  data-source.ts  standalone TypeORM DataSource used by the migration CLI
  app.module.ts
  main.ts
```

Business modules (`facilities`, `courts`, `sessions`, `recorders`, `payments`, etc.) land in later phases — see the migration plan.
