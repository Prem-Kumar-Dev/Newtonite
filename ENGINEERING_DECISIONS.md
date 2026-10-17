# Engineering Decisions

Five decisions that shape this system, with the trade-offs behind each. The full design is in
[docs/DESIGN.md](docs/DESIGN.md).

## 1. PostgreSQL as the single source of truth, including for async work

**Decision:** Postgres holds the data, the activity log, idempotency keys and a transactional **outbox**
for background jobs. There is no Redis or message broker.

**Why:** a state change, its history event and its "notify people" job commit in one transaction, so we
can never notify about a change that rolled back, or lose the notification for a change that committed.
Postgres row locks (`FOR UPDATE SKIP LOCKED`) are enough for a small worker pool.

**Trade-off:** polling the outbox adds a little latency (about 1 s) and won't scale like a dedicated queue.
At larger scale we would relay the outbox to Kafka or SQS and keep the same transactional guarantee.

## 2. Optimistic concurrency with a `version` column, plus atomic conditional updates

**Decision:** every work item carries a `version`. Writes must send `If-Match: <version>`, and the update
runs `WHERE id = :id AND version = :expected`. Claim is a single conditional `UPDATE ... WHERE assignee_id IS NULL`.

**Why:** most edits don't actually conflict, so pessimistic locks held across a user's think-time would
hurt throughput. Conditional updates make the race resolve inside the database, so exactly one of two
simultaneous claimers wins without application-level locking.

**Trade-off:** the losing user gets a 409 and must re-apply their change. We return the current item so
the UI can show what changed instead of a bare error. We don't do field-level merging.

## 3. Idempotency keys on mutating endpoints

**Decision:** clients send an `Idempotency-Key` per user action. The server stores `(user, key) → request
hash + response` and replays the stored response on retry.

**Why:** "I'm not sure the first click worked" is listed explicitly in the brief. Without keys, a retried
create makes a duplicate item, and a retried comment posts twice.

**Trade-off:** extra writes and a table to expire (24 h). The key is stored in the same transaction as
the effect, so a crash can't leave a key without its effect.

## 4. Authorization by team role, checked per resource on the server

**Decision:** roles live on the membership (`VIEWER/MEMBER/LEAD` per team) and a global `is_admin`.
A single `authorize(user, action, item)` function is called by every mutation, and every list query is
filtered to the caller's teams in SQL. Items outside your teams return 404, not 403.

**Why:** the brief requires server-enforced permissions. One function makes the rules auditable and
testable as a table. Returning 404 avoids leaking that an item exists.

**Trade-off:** no fine-grained per-item ACLs (for example, sharing one item with another team). That
would be the next step if cross-team work becomes common.

## 5. Append-only activity log written in the same transaction as the change

**Decision:** every change to status, assignee, priority or content, and every comment, inserts an
`activity_events` row in the same transaction as the change. Events are never updated or deleted.

**Why:** "important actions should not silently disappear." Writing the event alongside the change means
history can't drift from the actual data. It's also the input to the outbox and notifications.

**Trade-off:** the table grows without bound. It's indexed by `(item_id, id)` and read with cursor
pagination. At scale we would partition it by month.

## Also decided (short)

- **Keyset (cursor) pagination, not offset**, so deep pages stay fast with tens of thousands of items.
- **Postgres full-text search** (generated `tsvector` + GIN) instead of Elasticsearch. It's good enough at this scale.
- **Polling instead of websockets**, because stale writes are already caught by versioning.
- **Not built:** email, attachments, SSO, real-time push, SLA timers.

<!-- TODO after build: fill in "what failed / what I'd change at 10x scale" from real experience -->
