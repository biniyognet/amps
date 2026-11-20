# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
"""Event bus: every write becomes an event the UI hears live over /api/ws.

publish(kind, data) is sync and never raises — a write must not fail because
nobody is listening. With AMPS_REDIS_URL set, events go through Redis pub/sub
(channel amps:events), so any number of api replicas and the worker share one
stream. Without it, an in-process fan-out serves a single api (laptop, tests).

Growth path: in-process → Redis pub/sub → Kafka/Pub/Sub topic, same publish().
"""
import asyncio
import json
import logging
import os
import time

log = logging.getLogger("amps.events")
CHANNEL = "amps:events"
_redis = None
_local: set[asyncio.Queue] = set()
_loop: asyncio.AbstractEventLoop | None = None


def redis_client():
    """Shared sync Redis client, or None when AMPS_REDIS_URL is unset/unreachable."""
    global _redis
    url = os.environ.get("AMPS_REDIS_URL")
    if not url:
        return None
    if _redis is None:
        try:
            import redis
            _redis = redis.Redis.from_url(url, socket_timeout=1, socket_connect_timeout=1)
        except Exception as e:  # noqa: BLE001 — no redis lib = in-process mode
            log.warning("redis unavailable (%s); in-process mode", e)
            return None
    return _redis


def publish(kind: str, data: dict | None = None) -> None:
    msg = json.dumps({"kind": kind, "data": data or {}, "ts": time.time()}, default=str)
    r = redis_client()
    if r is not None:
        try:
            r.publish(CHANNEL, msg)
            return
        except Exception as e:  # noqa: BLE001
            log.warning("redis publish failed (%s); local fan-out", e)
    _fanout(msg)


def _fanout(msg: str) -> None:
    for q in list(_local):
        try:
            if _loop and _loop.is_running():
                _loop.call_soon_threadsafe(q.put_nowait, msg)
            else:
                q.put_nowait(msg)
        except Exception:  # noqa: BLE001 — a full/closed queue drops this one event
            pass


async def subscribe():
    """Async iterator of event JSON strings for one websocket client."""
    global _loop
    r = redis_client()
    if r is not None:
        import redis.asyncio as aredis
        ar = aredis.Redis.from_url(os.environ["AMPS_REDIS_URL"])
        ps = ar.pubsub()
        await ps.subscribe(CHANNEL)
        try:
            async for m in ps.listen():
                if m.get("type") == "message":
                    yield m["data"].decode() if isinstance(m["data"], bytes) else m["data"]
        finally:
            await ps.unsubscribe(CHANNEL)
            await ar.aclose()
        return
    _loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    _local.add(q)
    try:
        while True:
            yield await q.get()
    finally:
        _local.discard(q)
