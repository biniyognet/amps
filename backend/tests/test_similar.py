# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Seen before (F1) on a throwaway SQLite DB, Gemini embeddings mocked."""
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta

os.environ.setdefault("AMPS_AUTH", "0")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import func, select  # noqa: E402

from app.api import ai, similar  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (Asset, AssetClass, FailureEmbedding, Location, LocationKind,  # noqa: E402
                        LogEntry, LogEntryType)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import embed_failures  # noqa: E402

KEY = "sk-test-never-shown"
NOW = datetime(2026, 11, 20, 9, 0)
# (asset, days ago, fault, remark, fix or None = still open)
STORY = [
    ("SIM-MTR-01", 200, "Mechanical seal leak", "water spraying from drive end seal, pump isolated",
     "DE mechanical seal replaced, alignment checked"),
    ("SIM-MTR-02", 100, "Mechanical seal leak", "seal leaking drip on pump motor, vibration high",
     "Seal replaced, soft foot shimmed, laser alignment"),
    ("SIM-HSC-01", 90, "HSCB tripped on overcurrent", "breaker tripped overcurrent relay evening peak",
     "Relay settings checked, reclosed"),
    ("SIM-MTR-01", 60, "Bearing overheating", "bearing hot noise from motor drive end",
     "Bearing 6312 replaced"),
    ("SIM-MTR-02", 30, "Mechanical seal leak", "seal leaking again on pump", None),          # open: no fix to show
    ("SIM-MTR-01", 1, "Mechanical seal leak", "pump motor seal leak 4th time water on terminal box", None),
    ("SIM-MTR-02", 0, "Mechanical seal leak", "seal leak later than the query", "Seal replaced"),  # after the query
]


def fake_vec(text):
    """Deterministic stand-in for gemini-embedding-001: hashed bag of words."""
    v = [0.0] * 64
    for w in re.findall(r"\w+", text.lower()):
        v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 64] += 1.0
    return v


@pytest.fixture(scope="module")
def client():
    init_db()
    with SessionLocal() as db:
        if db.scalar(select(Asset).where(Asset.code == "SIM-MTR-01")) is None:
            site = Location(name="Similar Test Site", kind=LocationKind.SITE)
            cls = AssetClass(name="Similar Test Pump")
            db.add_all([site, cls])
            db.flush()
            assets = {c: Asset(code=c, name=f"Unit {c}", asset_class_id=cls.id, location_id=site.id)
                      for c in ("SIM-MTR-01", "SIM-MTR-02", "SIM-HSC-01")}
            db.add_all(assets.values())
            db.flush()
            for code, ago, fault, remark, fix in STORY:
                at = NOW - timedelta(days=ago)
                f = LogEntry(at=at, log_date=at.date(), type=LogEntryType.FAILURE, fault_type=fault,
                             category="Pump", asset=assets[code], text=remark, entered_by="t")
                db.add(f)
                db.flush()
                if fix:
                    db.add(LogEntry(at=at + timedelta(hours=6), log_date=at.date(),
                                    type=LogEntryType.RECTIFICATION, rectifies_id=f.id, asset=assets[code],
                                    action_taken=fix, text=fix, attended_by="Crew A", entered_by="t"))
            db.commit()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def gemini(monkeypatch):
    monkeypatch.setattr(ai, "PROVIDER", "gemini")
    monkeypatch.setattr(ai, "GEMINI_KEY", KEY)
    calls = []

    def fake(texts):
        calls.append(list(texts))
        return [fake_vec(t) for t in texts]
    monkeypatch.setattr(similar, "_embed", fake)
    return calls


def _get(client, code="SIM-MTR-01", **kw):
    r = client.get("/api/similar", params={"asset_code": code, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_seen_before_ranks_earlier_fixed_seal_leaks_first(client, gemini):
    out = _get(client)
    assert out["mode"] == "embedding" and out["model"] == similar.EMBED_MODEL
    assert out["query"]["open"] and "4th time" in out["query"]["description"]
    m = out["matches"]
    assert 1 <= len(m) <= 3
    assert m[0]["fault_type"] == "Mechanical seal leak" and m[1]["fault_type"] == "Mechanical seal leak"
    assert {x["asset_code"] for x in m[:2]} == {"SIM-MTR-01", "SIM-MTR-02"}   # same asset AND a sister unit
    assert all(x["fix"] for x in m) and m[0]["downtime_hrs"] == 6.0
    assert m[0]["score"] >= m[-1]["score"]
    descs = {x["description"] for x in m}
    assert "seal leaking again on pump" not in descs            # open, nothing fixed it yet
    assert "seal leak later than the query" not in descs        # not "before"


def test_vectors_are_stored_once_and_reembedded_only_when_text_changes(client, gemini):
    _get(client)
    gemini.clear()
    _get(client)
    assert gemini == []                                         # all cached
    with SessionLocal() as db:
        e = db.scalar(select(LogEntry).where(LogEntry.text == "bearing hot noise from motor drive end"))
        e.text = "bearing hot, grinding noise from motor drive end"
        eid = e.id
        db.commit()
    _get(client)
    assert len(gemini) == 1 and len(gemini[0]) == 1 and "grinding" in gemini[0][0]
    with SessionLocal() as db:
        row = db.get(FailureEmbedding, eid)
        assert row.dim == 64 and abs(sum(x * x for x in __import__("array").array("f", row.vector)) - 1) < 1e-4


def test_no_key_falls_back_to_keywords(client, monkeypatch):
    monkeypatch.setattr(ai, "PROVIDER", "")
    monkeypatch.setattr(similar, "_embed", lambda t: pytest.fail("must not call Gemini without a key"))
    out = _get(client)
    assert out["mode"] == "keyword" and out["model"] is None
    assert out["matches"][0]["fault_type"] == "Mechanical seal leak"


def test_embedding_error_falls_back_never_500(client, gemini, monkeypatch):
    def boom(texts):
        raise OSError(f"quota exceeded for key {KEY}")
    monkeypatch.setattr(similar, "_embed", boom)
    with SessionLocal() as db:   # force a cache miss so _embed is actually reached
        db.query(FailureEmbedding).delete()
        db.commit()
    r = client.get("/api/similar", params={"asset_code": "SIM-MTR-01"})
    assert r.status_code == 200 and r.json()["mode"] == "keyword"
    assert KEY not in r.text


def test_explicit_failure_and_unknowns(client, gemini):
    with SessionLocal() as db:
        hsc = db.scalar(select(LogEntry).where(LogEntry.fault_type == "HSCB tripped on overcurrent"))
        fid = hsc.id
    out = _get(client, code="SIM-HSC-01", failure_id=fid)
    assert out["query"]["failure_id"] == fid and not out["query"]["open"]
    assert all(x["failure_id"] != fid for x in out["matches"])
    assert client.get("/api/similar", params={"asset_code": "SIM-MTR-01", "failure_id": fid}).status_code == 404
    assert client.get("/api/similar", params={"asset_code": "NO-SUCH"}).status_code == 404


def test_backfill_embeds_everything_once(client, gemini):
    with SessionLocal() as db:
        db.query(FailureEmbedding).delete()
        db.commit()
        r1 = embed_failures.backfill(db)
        r2 = embed_failures.backfill(db)
        total = db.scalar(select(func.count()).select_from(FailureEmbedding))
    assert r1["embedded_new"] == r1["failures"] == total >= len(STORY)
    assert r2["embedded_new"] == 0
    assert all(len(c) <= similar.BATCH for c in gemini)


def test_embed_request_shape(monkeypatch):
    """The real _embed: right endpoint, key in the header (never the URL), task + dim set."""
    seen = {}

    class Resp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return json.dumps({"embeddings": [{"values": [1.0, 0.0]}] * len(seen["body"]["requests"])}).encode()

    def fake_open(req, timeout):
        seen.update(url=req.full_url, key=req.get_header("X-goog-api-key"), body=json.loads(req.data))
        return Resp()
    monkeypatch.setattr(ai, "GEMINI_KEY", KEY)
    monkeypatch.setattr(similar.urllib.request, "urlopen", fake_open)
    assert similar._embed(["seal leak", "bearing hot"]) == [[1.0, 0.0], [1.0, 0.0]]
    assert seen["url"].endswith(f"/models/{similar.EMBED_MODEL}:batchEmbedContents") and KEY not in seen["url"]
    assert seen["key"] == KEY
    r0 = seen["body"]["requests"][0]
    assert r0["taskType"] == "SEMANTIC_SIMILARITY" and r0["outputDimensionality"] == similar.EMBED_DIM


def test_embed_ollama_embeddinggemma(monkeypatch):
    """AMPS_EMBED_PROVIDER=ollama: EmbeddingGemma on our own Ollama, document prompt
    on every text, no key needed, and embedding stays on without Gemini."""
    seen = {}

    def fake_post(url, body, headers, retries=2):
        seen.update(url=url, body=body, headers=headers)
        return {"embeddings": [[0.0, 2.0]] * len(body["input"])}
    monkeypatch.setattr(similar, "EMBED_PROVIDER", "ollama")
    monkeypatch.setattr(similar, "EMBED_URL", "http://ollama:11434")
    monkeypatch.setattr(similar, "EMBED_MODEL", "embeddinggemma")
    monkeypatch.setattr(ai, "GEMINI_KEY", "")
    monkeypatch.setattr(similar.ai, "_post", fake_post)
    assert similar.embed_enabled()
    assert similar._embed(["seal leak", "bearing hot"]) == [[0.0, 2.0], [0.0, 2.0]]
    assert seen["url"] == "http://ollama:11434/api/embed" and seen["body"]["model"] == "embeddinggemma"
    assert seen["body"]["input"] == ["title: none | text: seal leak", "title: none | text: bearing hot"]
    assert seen["headers"] == {}
