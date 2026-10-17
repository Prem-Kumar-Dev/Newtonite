# Engineering Decisions

Five decisions that shape this system, with the trade-offs behind each. The full design is in
[docs/DESIGN.md](docs/DESIGN.md).

## 1. PostgreSQL as the single source of truth, including for async work

**Decision:** Postgres holds the data, the activity log, idempotency keys and a transactional **outbox**
for background jobs. There is no Redis or message broker.

**How it works:** `record_event()` in `backend/app/items.py` writes the history event and its outbox row
together, and `run_mutation()` in `backend/app/idempotency.py` commits them with the item change. The worker
(`backend/app/worker.py`) claims up to 50 due rows with `FOR UPDATE SKIP LOCKED`, so several workers can run
side by side without taking the same job. Delivery is at-least-once: notifications are inserted with
`ON CONFLICT (user_id, event_id) DO NOTHING`, so running a job twice is harmless. A failing job is retried
with exponential backoff (2 s, 4 s, 8 s… capped at 5 min) and parked as `dead` after 5 attempts, so one bad
message can't block the queue.

**Why:** a state change, its history event and its "notify people" job commit in one transaction, so we
can never notify about a change that rolled back, or lose the notification for a change that committed.
It's one less moving part to run and to reason about when things fail.

**Trade-off:** the worker polls once a second when idle, which adds up to about a second of latency and
won't scale like a dedicated queue. At larger scale we would relay the outbox to Kafka or SQS and keep the
same transactional guarantee. Dead jobs have no admin screen yet and are retried with SQL.

## 2. Optimistic concurrency with a `version` column, plus atomic conditional updates

**Decision:** every work item carries a `version`. Edits, assignments and workflow transitions must send
`If-Match: <version>` (428 if it's missing), and the update runs `WHERE id = :id AND version = :expected`.
Claim is a single conditional `UPDATE ... WHERE assignee_id IS NULL AND status = 'OPEN'` and doesn't need a
version, because "is it still unassigned?" is the only thing that matters for a claim.

**Why:** most edits don't actually conflict, so pessimistic locks held across a user's think-time would
hurt throughput. Conditional updates make the race resolve inside the database, so exactly one of ten
simultaneous claimers wins without any application-level locking. A database check constraint also
guarantees that `IN_PROGRESS` and `AWAITING_APPROVAL` items always have an owner.

**Trade-off:** the losing user gets a 409 and must re-apply their change. We return the current item
(`details.current`) so the UI can show what changed and who won instead of a bare error. We don't do
field-level merging. Comments deliberately don't bump the version, so a comment never makes someone's
in-progress edit stale.

## 3. Idempotency keys on mutating endpoints

**Decision:** clients send an `Idempotency-Key` per user action, generated once per click and reused on
retry. The server stores `(user, key) → request hash + response` and replays the stored response, with an
`Idempotent-Replayed: true` header.

**How it works:** the key row is inserted first with `ON CONFLICT DO NOTHING`. If a duplicate arrives while
the first request is still running, Postgres makes its insert wait on the unique index until the first one
commits, so two copies of a request never both run. The same key with a different body, path or `If-Match`
returns 422. Only successful responses are stored: if the operation fails, the key rolls back with it and a
retry runs again.

**Why:** "I'm not sure the first click worked" is listed explicitly in the brief. Without keys, a retried
create makes a duplicate item, and a retried comment posts twice.

**Trade-off:** an extra write per request and a table to expire. The worker purges keys older than 24 h
once an hour. The key is stored in the same transaction as the effect, so a crash can't leave a key
without its effect, or the reverse.

## 4. Authorization by team role, checked per resource on the server

**Decision:** roles live on the membership (`VIEWER < MEMBER < LEAD` per team) plus a global `is_admin` that
acts as Lead everywhere. One function, `authorize(user, action, item)` in `backend/app/permissions.py`, is
called by every item endpoint, and every list query is filtered to the caller's teams in SQL. Items outside
your teams return 404, not 403. Inside your team, an action your role doesn't allow returns 403.

**Why:** the brief requires server-enforced permissions. One function makes the rules auditable and
testable as a table. Returning 404 to outsiders avoids leaking that an item exists. Roles are re-read from
the database on every request, so removing someone from a team takes effect immediately even though their
JWT is still valid. The item response includes `allowed_actions`, computed by the same function, so the UI
shows the right buttons without duplicating the rules.

**Trade-off:** no fine-grained per-item ACLs (for example, sharing one item with another team). That would
be the next step if cross-team work becomes common.

## 5. Append-only activity log written in the same transaction as the change

**Decision:** every change to status, assignee, priority or content, and every comment, inserts an
`activity_events` row in the same transaction as the change. Events are never updated or deleted, and items
are never deleted either: they are cancelled.

**Why:** "important actions should not silently disappear." Writing the event alongside the change means
history can't drift from the actual data, and a rejected change records nothing. Reasons are captured where
they matter most: `reject` and `reopen` require a comment, which is linked to the status event. The log is
also the input to the outbox and notifications.

**Trade-off:** the table grows without bound. It's indexed by `(item_id, id DESC)` and read with cursor
pagination, so one item's timeline stays fast. At scale we would partition it by month.

## Also decided (short)

- **Keyset (cursor) pagination, not offset**, so deep pages stay fast with tens of thousands of items. The
  cursor includes `id` as a tie-breaker, so identical timestamps never cause gaps or duplicates.
- **A partial index per dashboard view** ("assigned to me", "unassigned urgent", "awaiting approval"), so
  the counts stay cheap as closed work piles up.
- **Postgres full-text search** (generated `tsvector` + GIN) instead of Elasticsearch. It's good enough at
  this scale and stays consistent with the data with no sync job.
- **Polling instead of websockets**, because stale writes are already caught by versioning.
- **Tests against real Postgres, not SQLite or mocks**, because the risky behaviours are database behaviours.
- **Not built:** email, attachments, SSO, real-time push, SLA timers, team management screens.

## What we found while building it

- **The four-eyes rule had a gap.** It first only excluded the assignee, so a Lead could submit someone
  else's item for approval and then approve it themselves. Items now record who submitted them
  (`submitted_by_id`, migration `0002`), and neither the assignee nor the submitter can approve.
- **The test suite could wipe the dev database.** It drops the schema of whatever `DATABASE_URL` points at,
  so running `pytest` in a shell where the dev URL was exported would have deleted the demo data. It now
  refuses to run unless the database name ends in `_test`.
- **Startup order in Docker Compose.** The worker started as soon as the API container started, before the
  migrations ran, and the Postgres health check could pass during first-time init. Both were fixed with
  health checks, so the worker waits for a healthy API.

## What we would change at 10x scale

- Relay the outbox to a real queue (SQS or Kafka) and run more worker types, keeping the transactional write.
- Partition `activity_events` and `notifications` by month and archive old partitions.
- Push changes to open item pages over websockets or SSE instead of polling.
- Move search to a dedicated index if typo tolerance or search over comments becomes important.
- Add read replicas for list and dashboard queries, and connection pooling (PgBouncer) in front of Postgres.
