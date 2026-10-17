from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update

from app import worker
from app.models import Notification, OutboxMessage, OutboxStatus


def run_worker(db):
    db.execute(update(OutboxMessage).values(available_at=datetime.now(UTC) - timedelta(seconds=1)))
    db.commit()
    while worker.process_batch(db):
        pass


def test_claim_notifies_the_creator_not_the_actor(world, db):
    item = world.api(world.lead).create_item(world.support.id)
    world.api(world.member).post(f"/api/items/{item['id']}/claim")
    run_worker(db)
    notified = {n.user_id for n in db.execute(select(Notification)).scalars()}
    assert notified == {world.lead.id}


def test_submitting_for_approval_notifies_team_leads(world, db):
    member = world.api(world.member)
    item = member.create_item(world.payments.id, type="payment", title="Refund")
    claimed = member.post(f"/api/items/{item['id']}/claim").json()
    member.transition(claimed, "submit")
    run_worker(db)
    lead_messages = [n.message for n in db.execute(select(Notification).where(Notification.user_id == world.lead.id)).scalars()]
    assert any("AWAITING_APPROVAL" in m for m in lead_messages)


def test_running_a_job_twice_does_not_duplicate_notifications(world, db):
    item = world.api(world.lead).create_item(world.support.id)
    world.api(world.member).post(f"/api/items/{item['id']}/claim")
    run_worker(db)
    first = db.execute(select(Notification)).scalars().all()

    # Simulate a crash after the side effect but before the job was marked done.
    db.execute(update(OutboxMessage).values(status=OutboxStatus.PENDING))
    db.commit()
    run_worker(db)
    assert len(db.execute(select(Notification)).scalars().all()) == len(first)


def test_failing_jobs_back_off_then_go_dead_without_blocking_others(world, db, monkeypatch):
    item = world.api(world.lead).create_item(world.support.id)
    good_id = db.execute(select(OutboxMessage.id)).scalar_one()
    poison = OutboxMessage(event_type="activity", payload={"event_id": 999_999, "item_id": item["id"]})
    db.add(poison)
    db.commit()
    monkeypatch.setattr(worker.settings, "outbox_max_attempts", 3)

    for _ in range(3):
        run_worker(db)

    db.expire_all()
    poison = db.get(OutboxMessage, poison.id)
    assert poison.status == OutboxStatus.DEAD
    assert poison.attempts == 3
    assert "not found" in poison.last_error
    assert db.get(OutboxMessage, good_id).status == OutboxStatus.DONE


def test_failed_job_is_scheduled_for_later(world, db):
    world.api(world.lead).create_item(world.support.id)
    poison = OutboxMessage(event_type="activity", payload={"event_id": 999_999, "item_id": 999_999})
    db.add(poison)
    db.commit()
    run_worker(db)
    db.expire_all()
    poison = db.get(OutboxMessage, poison.id)
    assert poison.status == OutboxStatus.PENDING
    assert poison.available_at > datetime.now(UTC)
