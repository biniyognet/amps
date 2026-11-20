# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Read cache (hit/miss, invalidated by writes), gzip, and the /api/ws event stream."""
import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="amps-cache-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmp}/t.db")
os.environ.setdefault("AMPS_MEDIA_DIR", os.path.join(_tmp, "media"))
os.environ["AMPS_AUTH"] = "0"

import json  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import cache, events  # noqa: E402
from app.db import init_db  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    init_db()
    with TestClient(app) as c:
        yield c


def test_hot_get_hits_after_miss_and_write_invalidates(client):
    cache.bump()
    a = client.get("/api/lines")
    assert a.status_code == 200 and a.headers["x-amps-cache"] == "miss"
    b = client.get("/api/lines")
    assert b.headers["x-amps-cache"] == "hit" and b.json() == a.json()
    r = client.post("/api/assets", json={"code": "CACHE-1", "name": "Cache pump", "asset_class": "Pump",
                                         "location": "Cache Site"})
    assert r.status_code in (200, 201), r.text
    assert client.get("/api/lines").headers["x-amps-cache"] == "miss"


def test_uncached_path_has_no_header(client):
    assert "x-amps-cache" not in client.get("/api/correspondence").headers


def test_gzip_on_big_json(client):
    r = client.get("/api/assets", headers={"Accept-Encoding": "gzip"})
    if len(r.content) >= 1024:
        assert r.headers.get("content-encoding") == "gzip"


def test_redis_mode_shares_cache(client, monkeypatch):
    fakeredis = pytest.importorskip("fakeredis")
    monkeypatch.setattr(events, "_redis", fakeredis.FakeRedis())
    monkeypatch.setenv("AMPS_REDIS_URL", "redis://fake")
    cache._local.d.clear()
    assert client.get("/api/lines").headers["x-amps-cache"] == "miss"
    cache._local.d.clear()                       # a second replica: empty memory, same redis
    assert client.get("/api/lines").headers["x-amps-cache"] == "hit"
    v = events._redis.get(cache.VERSION_KEY)
    cache.bump()
    assert events._redis.get(cache.VERSION_KEY) != v


def test_ws_hears_writes(client):
    with client.websocket_connect("/api/ws") as ws:
        assert json.loads(ws.receive_text())["kind"] == "hello"
        events.publish("write", {"method": "POST", "path": "/api/x"})
        msg = json.loads(ws.receive_text())
        assert msg["kind"] == "write" and msg["data"]["path"] == "/api/x"
