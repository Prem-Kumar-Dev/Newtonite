# Operations Under Pressure

An internal tool for creating, assigning, tracking and resolving operational work items across teams.
It's built for the Newtonite software engineering challenge.

- Design (workflow, permissions, data model, API): [docs/DESIGN.md](docs/DESIGN.md)
- Decisions and trade-offs: [ENGINEERING_DECISIONS.md](ENGINEERING_DECISIONS.md)
- Demo script and talking points: [docs/DEMO.md](docs/DEMO.md)

**Stack:** FastAPI · SQLAlchemy 2 · Alembic · PostgreSQL 16 · pytest · React + Vite + TanStack Query (frontend)

## Run it

```bash
docker compose up --build
```

Then open **http://localhost:5173** and sign in with one of the demo accounts listed on the login page.

This starts four containers:

| Service | What it does |
|---|---|
| `db` | PostgreSQL 16. Creates the `ops` database, plus `ops_test` for the tests on first start. |
| `api` | Runs the migrations, seeds demo data if the database is empty, then serves the API on http://localhost:8000. |
| `worker` | The outbox worker (`python -m app.worker`) that turns activity into notifications. It starts once the API is healthy. |
| `web` | The React app, built and served by nginx on http://localhost:5173. nginx proxies `/api` to the API, so the browser only talks to one origin. |

The first start seeds 4 teams, 12 users and 20,000 work items, which takes about 30 seconds; until then the app
shows errors on sign-in. Later starts skip the seed. Interactive API docs are at http://localhost:8000/docs.

To start again from an empty database: `docker compose down -v && docker compose up --build`.

### Frontend

The React app lives in `frontend/` (React 18, Vite, TanStack Query, React Router). To work on it with hot
reload, run the API (with Docker or as below) and then:

```bash
cd frontend
npm ci
npm run dev        # http://localhost:5173, proxies /api to http://localhost:8000 (override with API_URL)
npm test           # 10 unit tests (Vitest + Testing Library)
npm run build      # type-check and production build
```

Both the dev server and the nginx container proxy `/api`, so CORS never comes into play. The API's
`CORS_ORIGINS` setting only matters if you serve the frontend from another origin.

How the frontend handles the hard cases:

- **Polling:** lists, the dashboard, item pages and notifications refetch every 20 s and on window focus.
- **Claim is optimistic:** the page shows "Claiming…" straight away. On `409 already_claimed` it rolls back and
  shows who got the item, using the current item the server sent back.
- **Stale edits:** on `409 version_conflict` the edit form keeps your draft, shows the latest version, and
  lets you re-apply your change on top of it.
- **Retries:** each click gets a fresh `Idempotency-Key`. Automatic retries reuse it, so a retry can't
  duplicate work.
- **Buttons come from the server:** the item page shows only the actions in the item's `allowed_actions`.
  The server enforces the same rules either way.

### Logins

All seeded users have the password `password`:

| Email | Role |
|---|---|
| admin@example.com | Admin (acts as Lead everywhere) |
| alice@example.com | Lead, Support |
| priya@example.com | Lead, Payments |
| erin@example.com | Lead, Engineering |
| grace@example.com | Lead, Compliance |
| bob@example.com | Member, Support + Payments |
| dana@example.com | Member, Engineering + Support |
| carol / dev / frank / henry @example.com | Member of one team (Support / Payments / Engineering / Compliance) |
| victor@example.com | Viewer, Support + Compliance |

Good pairs for the demo: **bob** and **carol** (both Support members) to race a claim, **alice** to approve
Support work, **priya** to show that Support items are invisible outside the team, and **victor** to show a
read-only user.

### Configuration

Settings are read from environment variables (or `backend/.env`), see `backend/app/config.py`:

| Variable | Default |
|---|---|
| `DATABASE_URL` | `postgresql+psycopg://postgres:postgres@localhost:5432/ops` |
| `JWT_SECRET` | a dev-only value. Set your own outside local development. |
| `JWT_TTL_MINUTES` | `720` |
| `IDEMPOTENCY_TTL_HOURS` | `24` |
| `OUTBOX_MAX_ATTEMPTS` | `5` |
| `CORS_ORIGINS` | `http://localhost:5173` |

## Run without Docker

You need Python 3.12+ and a local PostgreSQL 16 with databases `ops` and `ops_test`.

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
export DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/ops
alembic upgrade head
python -m app.seed                  # --items 50000 for a bigger data set
uvicorn app.main:app --reload       # API
python -m app.worker                # in a second terminal: notifications worker
```

## Tests

The tests run against a real Postgres, because the behaviours that matter most are database behaviours: row
races, conditional updates, unique constraints and `SKIP LOCKED`. A mock or SQLite would not reproduce them
honestly. Each test run drops and rebuilds the schema with the Alembic migration, so the tests also prove
the migration works.

The suite drops and rebuilds the schema of the database it runs against, so it refuses to start unless the
database name ends in `_test`. It defaults to `ops_test`. If you exported `DATABASE_URL` for the dev database
(as in the section above), point it at `ops_test` as below.

```bash
cd backend
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/ops_test pytest

# or, with Docker running:
docker compose run --rm -e DATABASE_URL=postgresql+psycopg://postgres:postgres@db:5432/ops_test api pytest
```

If Docker says `database "ops_test" does not exist`, the `pgdata` volume was created before the test database
script existed. Run `docker compose down -v` once to recreate it.

Frontend tests: `cd frontend && npm test`.

What the backend tests cover (41 tests):

| Risk | Tests |
|---|---|
| Two people claim the same item | `test_concurrency.py`: 10 simultaneous claims, exactly one wins, the losers are told who won |
| Stale edits overwrite newer data | `test_concurrency.py`: version check, 409 with the current item, 428 without `If-Match` |
| Double clicks and retries duplicate work | `test_idempotency.py`: replay, concurrent duplicates, key reuse, failed requests can be retried |
| Users see or change other teams' work | `test_authorization.py`: 404 for outsiders, per-role checks |
| Workflow rules bypassed | `test_workflow.py`: approval can't be skipped, nobody approves work they own or submitted, reasons required |
| History silently lost | `test_workflow.py`: every change has an event and an outbox job, a rejected change records nothing |
| Async jobs duplicate or block | `test_outbox.py`: re-runs don't duplicate, poison jobs back off then go dead |
| Lists break at scale | `test_listing.py`: cursor pagination with tied timestamps, views, search |

## Architecture

```
 Browser (React + TanStack Query)                frontend/src
    │  JWT · If-Match: <version> · Idempotency-Key: <per click>
    ▼
 nginx (web) or the Vite dev server: serves the app, proxies /api
    ▼
 FastAPI  /api/*                              backend/app/api/routes.py
    │  authorize(user, action, item)          backend/app/permissions.py
    │  workflow table                         backend/app/workflow.py
    │  item operations                        backend/app/items.py
    │  one transaction per mutation           backend/app/idempotency.py (run_mutation)
    ▼
 PostgreSQL
    work_items (version column)    activity_events (append-only)    comments
    idempotency_keys               outbox                           notifications
    ▲
    │  SELECT ... FOR UPDATE SKIP LOCKED, every second
 Worker  python -m app.worker                 backend/app/worker.py
```

- **One transaction per user action.** Every mutation goes through `run_mutation`, which commits the item
  change, its activity events, its outbox rows and its idempotency key together, or none of them.
- **Concurrency is resolved in the database.** Claims are a conditional `UPDATE ... WHERE assignee_id IS NULL`,
  and every other write is `UPDATE ... WHERE version = :expected`. Zero rows updated means someone else won,
  and the API returns 409 with the current item.
- **Permissions are checked per item on the server.** Roles belong to a team membership. List queries are
  filtered to the caller's teams in SQL, and items outside them return 404.
- **Side effects are asynchronous and safe to repeat.** The worker turns outbox rows into notifications. A
  unique `(user_id, event_id)` constraint makes a job that runs twice harmless, and failing jobs back off,
  then are parked as `dead` so they can't block the queue.
- **Lists stay fast as data grows.** Keyset (cursor) pagination, partial indexes for each dashboard view, and
  Postgres full-text search over a generated `tsvector` column.

The API contract is in [docs/DESIGN.md §5](docs/DESIGN.md#5-api). Errors always have the shape
`{"error": {"code", "message", "details"}}`, and 409 conflicts include the current item in `details.current`.

## Known limitations

These are deliberate scope cuts or gaps we know about, roughly in order of how much they would matter.

- **No team or membership management.** Teams, users and roles come from the seed. There are no admin
  endpoints for them yet, although the permission model supports it.
- **No field-level merge on conflicts.** A stale edit gets a 409 with the latest item, and the user re-applies
  their change. We don't merge non-overlapping field edits automatically.
- **Tokens can't be revoked early.** JWTs last 12 hours and there is no logout list. Roles are re-read from the
  database on every request, so removing someone from a team takes effect immediately anyway.
- **No login throttling or rate limiting.**
- **Dead outbox jobs need SQL to retry.** There is no admin screen for them. Reset them with
  `UPDATE outbox SET status = 'pending', attempts = 0 WHERE status = 'dead'`.
- **Seeded history is thin.** Seeded items only have a `created` event, so an item seeded as `CLOSED` has no
  recorded path to get there. Items created through the app have full history.
- **No real-time push.** The UI polls every 20 s and refetches on focus. Stale writes are caught by versioning, so the
  cost is freshness, not correctness.
- **Search is English full-text over title and description only.** It doesn't cover comments and doesn't handle
  typos. Searching for a number such as `#123` also matches that item's id.
- **The activity log grows without bound.** It's indexed for per-item reads but not partitioned or archived.
- **The Docker image is a development image.** It includes the test dependencies, runs as root, and runs a
  single uvicorn process.
- **Not built:** email, attachments, SSO and sign-up, SLA timers.
