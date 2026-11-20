# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
"""/api/jobs — queue status, and a guarded manual enqueue for ops/debug.

GET /status is open (a dashboard tile); POST /enqueue is gated by
current_writer like any other write, and only accepts a known job kind.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import events
from app.api.auth import current_writer
from app.jobs import HANDLERS, QUEUE, enqueue
from app.worker import HB_KEY

router = APIRouter()


class EnqueueIn(BaseModel):
    kind: str
    payload: dict = {}


@router.get("/status")
def status():
    """mode: whether jobs are queued to a worker or run inline right now;
    queue_depth: jobs waiting (redis mode only); worker_alive: the heartbeat
    key is present (a worker process BRPOPd within the last 30s)."""
    r = events.redis_client()
    if r is None:
        return {"mode": "inline", "queue_depth": 0, "worker_alive": False}
    try:
        return {"mode": "redis", "queue_depth": r.llen(QUEUE), "worker_alive": bool(r.exists(HB_KEY))}
    except Exception:  # noqa: BLE001 — redis blip: report it as unreachable, not a 500
        return {"mode": "redis", "queue_depth": 0, "worker_alive": False}


@router.post("/enqueue")
def api_enqueue(body: EnqueueIn, user=Depends(current_writer)):
    if body.kind not in HANDLERS:
        raise HTTPException(422, f"unknown job kind {body.kind!r}")
    return {"id": enqueue(body.kind, body.payload)}
