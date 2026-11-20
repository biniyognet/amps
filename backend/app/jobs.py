# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
"""Job queue: the api answers fast, slow work runs off to the side.

enqueue(kind, payload) hands a job to a worker. With AMPS_REDIS_URL set it
LPUSHes onto the Redis list `amps:jobs` (app.worker BRPOPs it, one process,
any number of api replicas); without it (laptop, tests, Redis unreachable)
the handler just runs inline, synchronously, so behaviour away from Redis is
exactly today's — nothing waits on a worker that doesn't exist.

Growth path: inline → Redis list → Kafka/Pub/Sub topic, same enqueue()/HANDLERS.

Handlers are tiny and registered with @handler("kind"); each gets its own DB
session (opened here, closed after) and whatever it returns is logged, never
required. A handler must not take the caller down — run_job() catches,
publishes job.done ok=false, and moves on either way.
"""
import json
import logging
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Callable

from app import events
from app.db import SessionLocal

log = logging.getLogger("amps.jobs")
QUEUE = "amps:jobs"

HANDLERS: dict[str, Callable] = {}


def handler(kind: str):
    """Register a job handler: @handler("kind") def fn(payload: dict, db): ..."""
    def deco(fn: Callable) -> Callable:
        HANDLERS[kind] = fn
        return fn
    return deco


def enqueue(kind: str, payload: dict | None = None) -> str:
    """Hand off a job, returning its id. Redis reachable → queued for the
    worker; otherwise (or if the LPUSH itself fails) run now, inline, so the
    demo/tests see the same result either way."""
    job = {"id": uuid.uuid4().hex, "kind": kind, "payload": payload or {}, "ts": time.time()}
    r = events.redis_client()
    if r is not None:
        try:
            r.lpush(QUEUE, json.dumps(job, default=str))
            return job["id"]
        except Exception as e:  # noqa: BLE001 — queue down: fall back to inline
            log.warning("redis enqueue failed (%s); running %s inline", e, kind)
    run_job(job)
    return job["id"]


def run_job(job: dict) -> bool:
    """Execute one job dict (as enqueue() or the worker's BRPOP produced it),
    publish job.done, never raise. Returns whether the handler succeeded."""
    kind, job_id = job.get("kind"), job.get("id", "")
    fn = HANDLERS.get(kind)
    t0 = time.time()
    ok = False
    if fn is None:
        log.warning("unknown job kind %r (id %s)", kind, job_id)
    else:
        db = SessionLocal()
        try:
            fn(job.get("payload") or {}, db)
            ok = True
        except Exception as e:  # noqa: BLE001 — a bad job must not crash the worker/api
            log.warning("job %s (%s) failed: %s", job_id, kind, e)
        finally:
            db.close()
    events.publish("job.done", {"id": job_id, "kind": kind, "ok": ok,
                                "ms": round((time.time() - t0) * 1000, 1)})
    return ok


# ---- handlers ---------------------------------------------------------------


@handler("similar.reindex")
def _similar_reindex(payload: dict, db):
    """Refresh failure-embedding vectors so 'Seen before' ranks on fresh text
    (new failures logged since the last pass). `limit` in payload caps how
    many missing/stale embeddings this run builds; unset embeds everything due.
    No embedding provider configured → a cheap no-op, counts stay at zero."""
    from app.api.auth import _OPEN_USER
    from app.api.similar import embed_enabled, ensure_vectors, failure_heads

    if not embed_enabled():
        return {"embedded": 0, "candidates": 0, "reason": "no embedding provider configured"}
    heads = failure_heads(db, _OPEN_USER)  # unscoped: reindex the whole estate
    vecs = ensure_vectors(db, heads, cap=payload.get("limit"))
    return {"embedded": len(vecs), "candidates": len(heads)}


@handler("bq.export")
def _bq_export(payload: dict, db):
    """Run scripts/bq_export.py's exporter (buildathon F4) into out_dir
    (payload), default the media dir's bq-export subfolder. Loaded by file
    path so app/ never has to carry scripts/ on its import path."""
    import importlib.util

    default_dir = os.path.join(os.environ.get("AMPS_MEDIA_DIR", "/"), "bq-export")
    out_dir = payload.get("out_dir") or default_dir
    os.makedirs(out_dir, exist_ok=True)
    scripts_dir = Path(__file__).resolve().parents[2] / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    spec = importlib.util.spec_from_file_location("amps_bq_export", scripts_dir / "bq_export.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    old_argv = sys.argv
    try:
        sys.argv = ["bq_export.py", "--out", out_dir]
        mod.main()
    finally:
        sys.argv = old_argv
    return {"out_dir": out_dir}


@handler("talk.breach")
def _talk_breach(payload: dict, db):
    """ampsTalk already filed the failure row on breach; this re-announces it
    on the event bus with a short, human summary (asset code + fault) for
    anything subscribed to failure.raised — no Gemini call needed."""
    from app.models import LogEntry

    failure_id = payload.get("failure_id")
    entry = db.get(LogEntry, failure_id) if failure_id else None
    if entry is None:
        return {"failure_id": failure_id, "found": False}
    asset_code = entry.asset.code if entry.asset else None
    summary = " · ".join(s for s in (asset_code, entry.fault_type, entry.text) if s)
    events.publish("failure.raised", {"failure_id": entry.id, "asset_code": asset_code,
                                      "summary": summary})
    return {"failure_id": entry.id, "found": True}
