# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Snap & Report end to end on a throwaway SQLite DB, Gemini mocked."""
import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="amps-snap-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/t.db"
os.environ["AMPS_MEDIA_DIR"] = os.path.join(_tmp, "media")
os.environ["AMPS_AUTH"] = "0"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.api import ai, snap  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (Asset, AssetClass, Attachment, LogEntry, LogEntryType,  # noqa: E402
                        Location, LocationKind)

JPEG = b"\xff\xd8\xff\xe0" + b"snap-test-photo" * 40
DRAFT = {"fault_type": "Overheating", "severity": "high", "likely_cause": "Loose cable lug",
         "suggested_action": "Retighten and thermal-scan", "safety_note": "Isolate first",
         "confidence": 0.82, "recommend": {"failure": True, "job_card": True},
         "summary": "Hot spot on incomer lug"}


@pytest.fixture(scope="module")
def client():
    init_db()
    with SessionLocal() as db:
        site = Location(name="Test Site", kind=LocationKind.SITE)
        cls = AssetClass(name="Snap Test Panel")
        db.add_all([site, cls]); db.flush()
        for code in ("SNAP-01", "SNAP-02", "SNAP-03"):
            db.add(Asset(code=code, name=f"Panel {code}", asset_class_id=cls.id, location_id=site.id))
        db.commit()
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def gemini(monkeypatch):
    monkeypatch.setattr(ai, "PROVIDER", "gemini")
    monkeypatch.setattr(ai, "GEMINI_KEY", "test")
    monkeypatch.setattr(ai, "_throttle", lambda ip: None)
    seen = {}

    def fake(prompt, photo):
        seen.update(prompt=prompt, photo=photo)
        return dict(DRAFT)
    monkeypatch.setattr(snap, "_gemini_draft", fake)
    return seen


def _analyze(client, code, photo=True):
    files = {"photo": ("lug.jpg", JPEG, "image/jpeg")} if photo else None
    r = client.post("/api/snap/analyze", data={"asset_code": code, "remarks": "smell of burning"}, files=files)
    assert r.status_code == 200, r.text
    return r.json()


def _photos(entry_id):
    with SessionLocal() as db:
        return db.scalars(select(Attachment).where(Attachment.entry_id == entry_id)).all()


def test_analyze_sends_photo_and_history(client, gemini):
    out = _analyze(client, "SNAP-01")
    assert out["draft"]["severity"] == "high" and out["vision"] is True
    assert out["photo_token"]
    assert gemini["photo"][1] == "image/jpeg"
    assert "SNAP-01" in gemini["prompt"] and "smell of burning" in gemini["prompt"]


def test_job_card_raises_failure_and_photo_on_both(client):
    out = _analyze(client, "SNAP-01")
    r = client.post("/api/snap/submit", json={
        "asset_code": "SNAP-01", "remarks": "smell of burning", "draft": out["draft"],
        "make_failure": True, "make_job_card": True, "agency": "Siemens OEM",
        "photo_token": out["photo_token"], "ai_model": "gemini-2.5-flash"})
    assert r.status_code == 201, r.text
    res = r.json()
    assert res["failure_id"] and res["job_card_id"] and not res["failure_existing"]
    with SessionLocal() as db:
        card = db.get(LogEntry, res["job_card_id"])
        fail = db.get(LogEntry, res["failure_id"])
        assert card.type == LogEntryType.JOB_CARD and card.attended_by == "Siemens OEM"
        assert card.rectifies_id == fail.id and fail.type == LogEntryType.FAILURE
        assert "confirmed by open" in card.text and fail.fault_type == "Overheating"
        assert card.action_taken == "Retighten and thermal-scan"
    assert len(_photos(res["failure_id"])) == 1 and len(_photos(res["job_card_id"])) == 1
    # the new agency now offers itself in the dropdown
    assert "Siemens OEM" in client.get("/api/snap/agencies").json()


def test_failure_only_one_entry(client):
    out = _analyze(client, "SNAP-02")
    r = client.post("/api/snap/submit", json={
        "asset_code": "SNAP-02", "draft": out["draft"], "make_failure": True,
        "make_job_card": False, "photo_token": out["photo_token"]})
    assert r.status_code == 201, r.text
    res = r.json()
    assert res["job_card_id"] is None and res["photo_attached"]
    with SessionLocal() as db:
        n = len(db.scalars(select(LogEntry).join(Asset).where(Asset.code == "SNAP-02")).all())
    assert n == 1


def test_nothing_ticked_is_422(client):
    r = client.post("/api/snap/submit", json={"asset_code": "SNAP-03", "make_failure": False,
                                              "make_job_card": False})
    assert r.status_code == 422


def test_job_card_needs_agency_free_text_ok(client):
    body = {"asset_code": "SNAP-03", "remarks": "breaker trips", "make_failure": False,
            "make_job_card": True}
    assert client.post("/api/snap/submit", json=body).status_code == 422
    r = client.post("/api/snap/submit", json={**body, "agency": "Local electrician (new)"})
    assert r.status_code == 201 and r.json()["failure_id"]


def test_second_card_joins_open_failure(client):
    out = _analyze(client, "SNAP-01")   # SNAP-01's failure from the first test is still open
    r = client.post("/api/snap/submit", json={
        "asset_code": "SNAP-01", "draft": out["draft"], "make_job_card": True,
        "agency": "Civil dept", "photo_token": out["photo_token"]})
    res = r.json()
    assert res["failure_existing"] is True
    assert len(_photos(res["failure_id"])) == 1        # old failure keeps just its own photo
    assert len(_photos(res["job_card_id"])) == 1


def test_ai_down_keeps_photo_for_manual(client, monkeypatch):
    def boom(prompt, photo):
        raise ValueError("bad json")
    monkeypatch.setattr(snap, "_gemini_draft", boom)
    monkeypatch.setattr(ai, "FALLBACK_URL", "")
    out = _analyze(client, "SNAP-02")
    assert out["draft"] is None and out["photo_token"] and out["note"]


def test_expired_photo_token_is_410(client):
    r = client.post("/api/snap/submit", json={"asset_code": "SNAP-02", "make_failure": True,
                                              "photo_token": "deadbeef"})
    assert r.status_code == 410
