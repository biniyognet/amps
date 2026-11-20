# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
"""Read-through response cache for the hot aggregate GETs, plus write events.

Measured on the laptop before this (inside the container, no network):
/api/risk 1.55 s · /api/logbook/open-failures-by-asset 1.1–1.3 s ·
/api/logbook/failure-stats 0.8 s · /api/assets 0.75–1.2 s (2.7 MB) ·
/api/maintenance/schedule 0.77 s (1.5 MB) — recomputed on every page load.

How it stays correct without touching the endpoints:
  * key = path + query + the caller's session cookie (each scope its own copy)
    + a global data version
  * any successful write (POST/PUT/PATCH/DELETE 2xx) bumps the version, so
    every cached read is stale the moment data changes, and the write is
    published on the event bus (kind "write") for live UI refresh
  * TTL (AMPS_CACHE_TTL, default 120 s) bounds anything the version misses

Store: Redis when AMPS_REDIS_URL is set (shared by every api replica, the
version too), else an in-process LRU-ish dict. AMPS_CACHE=0 turns it off.
Responses carry X-AMPS-Cache: hit|miss so the speed-up is visible in DevTools.
"""
import hashlib
import os
import time

from app import events

DEFAULT_PATHS = ("/api/assets", "/api/risk", "/api/lines", "/api/logbook/open-failures-by-asset",
                 "/api/logbook/failure-stats", "/api/maintenance/schedule", "/api/checksheets/formats")
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# POSTs that change no shared data (login, AI drafts) or that report their own
# events (ampsTalk telemetry publishes talk.reading / failure.raised itself)
NOT_WRITES = ("/api/auth/", "/api/ai/", "/api/snap/analyze", "/api/talk/telemetry", "/api/similar")
VERSION_KEY = "amps:cache:ver"
_MAX_LOCAL = 256


class _Local:
    def __init__(self):
        self.ver = 0
        self.d: dict[str, tuple[float, bytes]] = {}

    def get(self, k):
        hit = self.d.get(k)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        self.d.pop(k, None)
        return None

    def set(self, k, v, ttl):
        if len(self.d) >= _MAX_LOCAL:
            for old in sorted(self.d, key=lambda x: self.d[x][0])[: _MAX_LOCAL // 4]:
                self.d.pop(old, None)
        self.d[k] = (time.monotonic() + ttl, v)


_local = _Local()


def _version(r) -> str:
    if r is not None:
        try:
            return (r.get(VERSION_KEY) or b"0").decode()
        except Exception:  # noqa: BLE001
            pass
    return str(_local.ver)


def bump() -> None:
    """Invalidate every cached read (called after any write)."""
    _local.ver += 1
    _local.d.clear()
    r = events.redis_client()
    if r is not None:
        try:
            r.incr(VERSION_KEY)
        except Exception:  # noqa: BLE001
            pass


def _pack(status: int, headers: list, body: bytes) -> bytes:
    ct = next((v for k, v in headers if k == b"content-type"), b"application/json")
    return status.to_bytes(2, "big") + len(ct).to_bytes(2, "big") + ct + body


def _unpack(blob: bytes):
    status = int.from_bytes(blob[:2], "big")
    n = int.from_bytes(blob[2:4], "big")
    return status, blob[4:4 + n], blob[4 + n:]


class CacheMiddleware:
    """Pure ASGI (websockets and streaming pass straight through)."""

    def __init__(self, app, paths=None, ttl=None):
        self.app = app
        env_paths = os.environ.get("AMPS_CACHE_PATHS")
        self.paths = set(paths or (env_paths.split(",") if env_paths else DEFAULT_PATHS))
        self.ttl = int(ttl or os.environ.get("AMPS_CACHE_TTL", "120"))
        self.on = os.environ.get("AMPS_CACHE", "1") != "0"

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not self.on:
            return await self.app(scope, receive, send)
        method, path = scope["method"], scope["path"].rstrip("/") or "/"
        if method in WRITE_METHODS and path.startswith("/api/") and not path.startswith(NOT_WRITES):
            return await self._write(scope, receive, send, method, path)
        if method != "GET" or path not in self.paths:
            return await self.app(scope, receive, send)

        hdrs = dict(scope.get("headers") or [])
        who = hashlib.sha1(hdrs.get(b"cookie", b"") + hdrs.get(b"authorization", b"")).hexdigest()[:12]
        r = events.redis_client()
        key = f"amps:cache:{_version(r)}:{who}:{path}?{scope.get('query_string', b'').decode()}"
        blob = None
        if r is not None:
            try:
                blob = r.get(key)
            except Exception:  # noqa: BLE001
                r = None
        if r is None:
            blob = _local.get(key)
        if blob is not None:
            status, ct, body = _unpack(blob)
            await send({"type": "http.response.start", "status": status,
                        "headers": [(b"content-type", ct), (b"content-length", str(len(body)).encode()),
                                    (b"x-amps-cache", b"hit")]})
            return await send({"type": "http.response.body", "body": body})

        start, chunks = {}, []

        async def capture(msg):
            if msg["type"] == "http.response.start":
                start.update(msg)
                msg = {**msg, "headers": [*msg.get("headers", []), (b"x-amps-cache", b"miss")]}
                return await send(msg)
            if msg["type"] == "http.response.body":
                chunks.append(msg.get("body", b""))
                if not msg.get("more_body") and start.get("status") == 200:
                    blob = _pack(200, start.get("headers", []), b"".join(chunks))
                    if r is not None:
                        try:
                            r.set(key, blob, ex=self.ttl)
                        except Exception:  # noqa: BLE001
                            _local.set(key, blob, self.ttl)
                    else:
                        _local.set(key, blob, self.ttl)
            await send(msg)

        await self.app(scope, receive, capture)

    async def _write(self, scope, receive, send, method, path):
        status = {}

        async def watch(msg):
            if msg["type"] == "http.response.start":
                status["s"] = msg["status"]
            await send(msg)

        await self.app(scope, receive, watch)
        if 200 <= status.get("s", 500) < 300:
            bump()
            events.publish("write", {"method": method, "path": path})
