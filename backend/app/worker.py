# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
"""The worker half of the split server: `python -m app.worker`.

BRPOPs app.jobs.QUEUE (5s timeout so SIGTERM is noticed promptly), dispatches
through app.jobs.HANDLERS, and publishes job.done either way. A bad job (one
the handler raises on, or one that isn't even valid JSON) is logged and
counted done ok=false — it never takes the loop down. A heartbeat key
(amps:worker:hb, ex=30) is refreshed every loop so /api/jobs/status can tell
a live worker from a dead one.

Without AMPS_REDIS_URL there is nothing to pop (the api already ran every job
inline) — the loop idles rather than exit, so the process stays a valid
compose/k8s service either way.
"""
import json
import logging
import os
import signal
import time

from app import events
from app.jobs import QUEUE, run_job

log = logging.getLogger("amps.worker")
HB_KEY = "amps:worker:hb"
HB_TTL = 30
POLL_TIMEOUT = 5

_stop = False
_blocking = None


def _blocking_client():
    """Own Redis client for BRPOP. The shared events client has a 1s socket
    timeout (right for publish/cache), which a 5s BRPOP always overruns: every
    poll raised "Timeout reading from socket", and a job the server handed out
    as the client gave up could be lost. Read timeout here = poll + 5s."""
    global _blocking
    url = os.environ.get("AMPS_REDIS_URL")
    if not url:
        return None
    if _blocking is None:
        try:
            import redis
            _blocking = redis.Redis.from_url(url, socket_timeout=POLL_TIMEOUT + 5,
                                             socket_connect_timeout=2)
        except Exception as e:  # noqa: BLE001
            log.warning("redis unavailable (%s)", e)
            return None
    return _blocking


def _on_term(signum, frame):
    global _stop
    log.info("signal %s received, exiting after the current loop", signum)
    _stop = True


def run_once(r) -> bool:
    """One BRPOP + dispatch against redis client `r`. Returns True iff a job
    was popped (False on an empty-queue timeout) — kept a plain function of
    `r` so tests can drive it directly with fakeredis."""
    popped = r.brpop(QUEUE, timeout=POLL_TIMEOUT)
    try:
        r.set(HB_KEY, str(int(time.time())), ex=HB_TTL)
    except Exception as e:  # noqa: BLE001 — heartbeat is best-effort
        log.warning("heartbeat set failed: %s", e)
    if not popped:
        return False
    _, raw = popped
    try:
        job = json.loads(raw)
    except Exception as e:  # noqa: BLE001 — unparseable job: count it done, don't crash
        log.warning("bad job payload (%s): %r", e, raw)
        events.publish("job.done", {"id": "", "kind": None, "ok": False, "ms": 0})
        return True
    run_job(job)
    return True


def main():
    logging.basicConfig(level=logging.INFO)
    signal.signal(signal.SIGTERM, _on_term)
    signal.signal(signal.SIGINT, _on_term)
    log.info("amps worker started (queue=%s)", QUEUE)
    while not _stop:
        r = _blocking_client()
        if r is None:
            if int(time.time()) % 60 < POLL_TIMEOUT:  # don't spam the log every 5s
                log.warning("AMPS_REDIS_URL not set/reachable — idling, nothing to pop")
            time.sleep(POLL_TIMEOUT)
            continue
        try:
            run_once(r)
        except Exception as e:  # noqa: BLE001 — a redis blip must not kill the worker
            log.warning("worker loop error: %s", e)
            time.sleep(1)
    log.info("amps worker exiting")


if __name__ == "__main__":
    main()
