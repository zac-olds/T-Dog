# T-Dog API

Rails 8 API-only backend for the T-Dog court recording product. See the [root README](../README.md) for how this fits with the frontend and the external recorder service.

## Requirements

- Ruby 3.4.5 (see `.ruby-version`)
- PostgreSQL
- Redis (for Sidekiq)

## Setup

```
bin/setup                          # bundle install + db:prepare
bin/rails db:create db:migrate     # if you need to run these steps separately
bin/rails server                   # http://localhost:3000
```

Sidekiq (background jobs) needs to be run separately in development if you're testing anything that enqueues a job:

```
bundle exec sidekiq
```

The Sidekiq web UI is mounted at `/admin/sidekiq`.

## Environment variables

In development/test these are loaded from a `.env` file via `dotenv-rails`.

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `REDIS_URL` | Sidekiq |
| `JWT_SECRET` | Signs/verifies the recorder-service JWTs (falls back to `Rails.application.credentials.jwt_secret`) |
| `RECORDER_URL` | Base URL of the external recorder service (defaults to `http://localhost:4000`) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | S3 access for presigned clip downloads |
| `S3_BUCKET` | Bucket the recorder uploads clips into |
| `STRIPE_SECRET_KEY` | Stripe API access |
| `STRIPE_PRICE_ID` | Price used for the checkout line item |
| `STRIPE_WEBHOOK_SECRET` | Verifies incoming Stripe webhook signatures |
| `APP_BASE_URL` | Used to build Stripe Checkout success/cancel URLs |

## Data model

```
Facility ──< Court ──1 Camera
                │
                └──< Session
```

- **Facility** — a venue; has many courts.
- **Court** — belongs to a facility, has one camera.
- **Camera** — RTSP/ONVIF connection details for a court's physical camera.
- **Session** — a single recording, belongs to a court. Tracks `status` (`active` → `processing` → `delivered`), `started_at`/`ended_at`, the resulting `s3_key`, and a random `token`.

## API (all routes under `/v1`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/facilities`, `/facilities/:id` | List/show facilities |
| GET | `/courts`, `/courts/:id` | List/show courts (optionally filter by `?slug=`), including camera connection info |
| POST | `/sessions` | Start a session on a court |
| GET | `/sessions/:id` | Session status |
| POST | `/sessions/:id/stop` | End a session (marks `processing`) |
| GET | `/sessions/:id/presigned_download` | Get a time-limited S3 URL once the clip is `delivered` |
| POST | `/recorders/heartbeat` | Recorder service liveness check (requires recorder JWT) |
| POST | `/recorders/webhook` | Recorder reports events (e.g. `clip_uploaded`) (requires recorder JWT) |
| POST | `/payments/billing/checkout` | Create a Stripe Checkout session |
| POST | `/webhooks/stripe` | Stripe webhook receiver |

The `recorders` endpoints require an `Authorization: Bearer <jwt>` header with a token minted by `JwtService` carrying `role: 'recorder'`.

## Testing & linting

```
bin/rails test                                       # full suite
bin/rails test test/models/session_test.rb            # one file
bin/rails test test/models/session_test.rb:12          # one test, by line
bin/rubocop                                          # style (rubocop-rails-omakase)
bin/brakeman                                          # static security scan
```

Note: the model test files under `test/models/` are still empty generated stubs; the controller tests under `test/controllers/` have the real coverage today.

## Known gaps

These are true of the code as it stands today — worth knowing before assuming a feature works end-to-end:

- `Session#stop` does not actually enqueue `ClipRequestJob` yet (the call is commented out in `sessions_controller.rb`), so nothing currently tells the recorder service to produce a clip.
- `StripeWebhooksController` verifies and switches on `checkout.session.completed` but doesn't yet do anything with it — a completed payment isn't linked back to unlocking a session's clip.
- CORS (`config/initializers/cors.rb`) only allows `http://localhost:5173`.

## Deployment

Deployed via [Kamal](https://kamal-deploy.org) (see `config/deploy.yml` and `.kamal/`), with Thruster in front of Puma.
