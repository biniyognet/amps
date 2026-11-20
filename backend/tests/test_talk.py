# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""ampsTalk: device registration, token auth, Pub/Sub envelope, auto failure."""
import base64
import json
import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="amps-talk-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmp}/t.db")
os.environ.setdefault("AMPS_MEDIA_DIR", os.path.join(_tmp, "media"))
os.environ["AMPS_AUTH"] = "0"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.db import SessionLocal, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (Asset, AssetClass, AuditLog, IoTReading, LogEntry,  # noqa: E402
                        LogEntryType, Location, LocationKind)


@pytest.fixture(scope="module")
def client():
    init_db()
    with SessionLocal() as db:
        site = db.scalar(select(Location).where(Location.name == "Talk Test Site"))
        cls = db.scalar(select(AssetClass).where(AssetClass.name == "Talk Test Transformer"))
        if site is None:
            site = Location(name="Talk Test Site", kind=LocationKind.SITE); db.add(site)
        if cls is None:
            cls = AssetClass(name="Talk Test Transformer"); db.add(cls)
        db.flush()
        for code in ("TALK-TX1", "TALK-TX2"):
            if db.scalar(select(Asset).where(Asset.code == code)) is None:
                db.add(Asset(code=code, name=f"Transformer {code}", asset_class_id=cls.id,
                             location_id=site.id))
        db.commit()
    with TestClient(app) as c:
        yield c


def _register(client, code, asset, bands):
    r = client.post("/api/talk/devices", json={"code": code, "name": f"Temp probe {code}",
                                               "asset_code": asset, "thresholds": bands})
    assert r.status_code == 201, r.text
    return r.json()["token"]


def test_register_once_token_never_listed(client):
    token = _register(client, "TT-01", "TALK-TX1", {"temp_c": {"max": 85}})
    assert token.startswith("amt_")
    listed = client.get("/api/talk/devices").json()
    dev = next(d for d in listed if d["code"] == "TT-01")
    assert dev["token"] is None and dev["thresholds"] == {"temp_c": {"max": 85.0}}
    assert client.post("/api/talk/devices", json={"code": "TT-01", "name": "dup",
                                                  "asset_code": "TALK-TX1"}).status_code == 409


def test_bad_token_and_unknown_device_same_401(client):
    body = {"device": "TT-01", "readings": [{"metric": "temp_c", "value": 40}]}
    assert client.post("/api/talk/telemetry", json=body,
                       headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.post("/api/talk/telemetry", json={**body, "device": "ghost"},
                       headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.post("/api/talk/telemetry", json=body).status_code == 401


def test_normal_reading_no_failure_then_breach_files_one(client):
    token = _register(client, "TT-02", "TALK-TX2", {"temp_c": {"max": 85}, "oil_level_pct": {"min": 30}})
    h = {"Authorization": f"Bearer {token}"}
    ok = client.post("/api/talk/telemetry", headers=h, json={
        "device": "TT-02", "readings": [{"metric": "temp_c", "value": 62.5, "unit": "°C"}]}).json()
    assert ok["accepted"] == 1 and ok["breaches"] == 0 and ok["failure_id"] is None

    hot = client.post("/api/talk/telemetry", headers=h, json={"device": "TT-02", "readings": [
        {"metric": "temp_c", "value": 91.2, "unit": "°C", "ts": "2026-11-20T10:15:00+05:30"},
        {"metric": "oil_level_pct", "value": 55}]}).json()
    assert hot["breaches"] == 1 and hot["failure_id"] and hot["failure_existing"] is False
    with SessionLocal() as db:
        f = db.get(LogEntry, hot["failure_id"])
        assert f.type == LogEntryType.FAILURE and f.asset.code == "TALK-TX2"
        assert "91.2" in f.text and "max limit 85" in f.text and f.fault_type == "temp_c high (sensor)"
        assert f.at.strftime("%H:%M") == "10:15"
        assert db.scalar(select(AuditLog).where(AuditLog.entity_id == f.id,
                                                AuditLog.action == "ampstalk")).actor == "ampsTalk:TT-02"
        rows = db.scalars(select(IoTReading).where(IoTReading.entry_id == f.id)).all()
        assert [r.metric for r in rows] == ["temp_c"]

    # still hot: joins the open failure, never a second one
    again = client.post("/api/talk/telemetry", headers=h, json={
        "device": "TT-02", "readings": [{"metric": "oil_level_pct", "value": 12}]}).json()
    assert again["failure_id"] == hot["failure_id"] and again["failure_existing"] is True


def test_pubsub_push_envelope(client):
    token = _register(client, "TT-03", "TALK-TX1", {"temp_c": {"max": 85}})
    payload = {"device": "TT-03", "readings": [{"metric": "temp_c", "value": 70}]}
    env = {"message": {"data": base64.b64encode(json.dumps(payload).encode()).decode(),
                       "attributes": {"token": token}, "messageId": "1"},
           "subscription": "projects/p/subscriptions/amps-talk"}
    r = client.post("/api/talk/telemetry", json=env)
    assert r.status_code == 200 and r.json()["accepted"] == 1
    last = client.get("/api/talk/readings", params={"device": "TT-03"}).json()
    assert last[0]["value"] == 70 and last[0]["breach"] is None


def test_too_many_readings_413(client):
    token = _register(client, "TT-04", "TALK-TX1", {})
    r = client.post("/api/talk/telemetry", headers={"X-AMPS-Device-Token": token}, json={
        "device": "TT-04", "readings": [{"metric": "v", "value": 1}] * 501})
    assert r.status_code == 413
