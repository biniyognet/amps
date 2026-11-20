# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
"""Job queue: inline synchronous path (no Redis, today's behaviour) and
Redis-mode (fakeredis) — enqueue, worker dispatch, job.done, bad-job safety."""
import os
import tempfile
from datetime import date

_tmp = tempfile.mkdtemp(prefix="amps-jobs-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmp}/j.db")
os.environ.setdefault("AMPS_MEDIA_DIR", os.path.join(_tmp, "media"))
os.environ["AMPS_AUTH"] = "0"

import fakeredis  # noqa: E402
import pytest  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app import events, jobs, worker  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
from app.models import (Asset, AssetClass, LogEntry, LogEntryType, Location,  # noqa: E402
                        LocationKind)


@pytest.fixture(scope="module", autouse=True)
def _db():
    init_db()


@pytest.fixture
def failure_id():
    """A real FAILURE log entry so talk.breach has something to re-announce."""
    with SessionLocal() as db:
        site = db.scalar(select(Location).where(Location.name == "Jobs Test Site"))
        if site is None:
            site = Location(name="Jobs Test Site", kind=LocationKind.SITE)
            db.add(site)
            db.flush()
        cls = db.scalar(select(AssetClass).where(AssetClass.name == "Jobs Test Transformer"))
        if cls is None:
            cls = AssetClass(name="Jobs Test Transformer")
            db.add(cls)
            db.flush()
        asset = db.scalar(select(Asset).where(Asset.code == "JOBS-TX1"))
        if asset is None:
            asset = Asset(code="JOBS-TX1", name="Transformer JOBS-TX1",
                          asset_class_id=cls.id, location_id=site.id)
            db.add(asset)
            db.flush()
        entry = LogEntry(type=LogEntryType.FAILURE, log_date=date.today(), asset_id=asset.id,
                         text="oil temp high", fault_type="temp_c high (sensor)")
        db.add(entry)
        db.commit()
        return entry.id


def _capture(monkeypatch):
    seen = []
    monkeypatch.setattr(events, "publish", lambda kind, data=None: seen.append((kind, data)))
    return seen


# ---- inline mode (no AMPS_REDIS_URL) ----------------------------------------

def test_inline_mode_runs_handler_synchronously(monkeypatch, failure_id):
    monkeypatch.delenv("AMPS_REDIS_URL", raising=False)
    seen = _capture(monkeypatch)

    job_id = jobs.enqueue("talk.breach", {"failure_id": failure_id})

    assert job_id
    assert [k for k, _ in seen] == ["failure.raised", "job.done"]
    assert seen[0][1]["failure_id"] == failure_id and seen[0][1]["asset_code"] == "JOBS-TX1"
    done = seen[1][1]
    assert done["id"] == job_id and done["kind"] == "talk.breach" and done["ok"] is True
    assert isinstance(done["ms"], float)


def test_inline_mode_unknown_kind_never_raises(monkeypatch):
    monkeypatch.delenv("AMPS_REDIS_URL", raising=False)
    seen = _capture(monkeypatch)

    job_id = jobs.enqueue("no.such.kind", {})

    assert job_id
    assert seen and seen[-1][0] == "job.done"
    assert seen[-1][1] == {"id": job_id, "kind": "no.such.kind", "ok": False, "ms": seen[-1][1]["ms"]}


def test_inline_mode_similar_reindex_is_a_cheap_noop_without_gemini(monkeypatch):
    monkeypatch.delenv("AMPS_REDIS_URL", raising=False)
    monkeypatch.delenv("AMPS_GEMINI_API_KEY", raising=False)
    seen = _capture(monkeypatch)

    jobs.enqueue("similar.reindex", {})

    assert seen[-1][0] == "job.done" and seen[-1][1]["ok"] is True


# ---- redis mode (fakeredis) --------------------------------------------------

def test_redis_mode_enqueue_then_worker_run_once(monkeypatch, failure_id):
    fake = fakeredis.FakeRedis()
    monkeypatch.setenv("AMPS_REDIS_URL", "redis://fake:6379/0")
    monkeypatch.setattr(events, "_redis", fake)
    seen = _capture(monkeypatch)

    job_id = jobs.enqueue("talk.breach", {"failure_id": failure_id})
    assert fake.llen(jobs.QUEUE) == 1       # queued for the worker, not run yet
    assert seen == []                        # nothing ran inline

    popped = worker.run_once(fake)

    assert popped is True
    assert fake.llen(jobs.QUEUE) == 0
    assert fake.exists(worker.HB_KEY)         # heartbeat set this loop
    assert [k for k, _ in seen] == ["failure.raised", "job.done"]
    done = seen[1][1]
    assert done["id"] == job_id and done["kind"] == "talk.breach" and done["ok"] is True


def test_redis_mode_empty_queue_times_out_without_a_job(monkeypatch):
    fake = fakeredis.FakeRedis()
    monkeypatch.setenv("AMPS_REDIS_URL", "redis://fake:6379/0")
    monkeypatch.setattr(events, "_redis", fake)
    monkeypatch.setattr(worker, "POLL_TIMEOUT", 0.2)  # don't make the test wait the real 5s

    popped = worker.run_once(fake)

    assert popped is False
    assert fake.exists(worker.HB_KEY)         # heartbeat still refreshed on an idle poll


def test_redis_mode_bad_job_payload_counts_done_ok_false(monkeypatch):
    fake = fakeredis.FakeRedis()
    monkeypatch.setenv("AMPS_REDIS_URL", "redis://fake:6379/0")
    monkeypatch.setattr(events, "_redis", fake)
    seen = _capture(monkeypatch)
    fake.lpush(jobs.QUEUE, "not json")

    popped = worker.run_once(fake)

    assert popped is True
    assert seen and seen[-1] == ("job.done", {"id": "", "kind": None, "ok": False, "ms": 0})
