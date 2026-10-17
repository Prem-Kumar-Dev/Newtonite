# Operations Under Pressure

An internal tool for creating, assigning, tracking and resolving operational work items across teams.
It's built for the Newtonite software engineering challenge.

- Design: [docs/DESIGN.md](docs/DESIGN.md)
- Decisions and trade-offs: [ENGINEERING_DECISIONS.md](ENGINEERING_DECISIONS.md)

**Stack:** FastAPI · SQLAlchemy 2 · Alembic · PostgreSQL 16 · pytest · (React + TanStack Query frontend: in progress)

## Run it

```bash
docker compose up --build
```

This starts Postgres, the API on http://localhost:8000 (interactive docs at http://localhost:8000/docs) and
the background worker. On first start the API runs the migrations and seeds 4 teams, 12 users and 20,000 items.

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
| carol / dev / frank / henry @example.com | Member of one team |
| victor@example.com | Viewer, Support + Compliance |

## Run without Docker

You need Python 3.12+ and a local PostgreSQL 16 with databases `ops` and `ops_test`.

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
export DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/ops
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload       # API
python -m app.worker                # in a second terminal: notifications worker
```

## Tests

The tests run against a real Postgres (`ops_test`), because the behaviours that matter most are database
behaviours: row races, conditional updates, unique constraints and `SKIP LOCKED`.

```bash
cd backend && pytest
# or, with Docker running:
docker compose run --rm -e DATABASE_URL=postgresql+psycopg://postgres:postgres@db:5432/ops_test api pytest
```

What they cover:

| Risk | Tests |
|---|---|
| Two people claim the same item | `test_concurrency.py`: 10 simultaneous claims, exactly one wins |
| Stale edits overwrite newer data | `test_concurrency.py`: version check, 409 with the current item |
| Double clicks / retries duplicate work | `test_idempotency.py`: replay, concurrent duplicates, key reuse |
| Users see or change other teams' work | `test_authorization.py`: 404 for outsiders, per-role checks |
| Workflow rules bypassed | `test_workflow.py`: approval can't be skipped, four-eyes rule, reasons required |
| History silently lost | `test_workflow.py`: every change has an event and an outbox job; failures leave no trace |
| Async jobs duplicate or block | `test_outbox.py`: re-runs don't duplicate, poison jobs back off then go dead |
| Lists break at scale | `test_listing.py`: cursor pagination with tied timestamps, views, search |

## Known limitations

To be completed at the end of the build.
