# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Planned maintenance API — plan → one-click done → logbook entry, reconcile."""
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import planned
from app.db import get_db
from app.models import (Asset, AssetClass, Base, Location, LocationKind, LogEntry,
                        LogEntryType, PMPlanned, ShiftCode)

TODAY = date.today()


@pytest.fixture
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    with Session() as db:
        line = Location(name="Green", kind=LocationKind.SITE)
        db.add(line)
        db.flush()
        stn = Location(name="Esplanade", kind=LocationKind.STATION, parent_id=line.id)
        cls = AssetClass(name="Fan")
        db.add_all([stn, cls])
        db.flush()
        db.add_all([
            Asset(code="TVF-01", name="Tunnel fan 1", asset_class_id=cls.id,
                  location_id=stn.id, line_id=line.id, system="TVS"),
            Asset(code="TVF-02", name="Tunnel fan 2", asset_class_id=cls.id,
                  location_id=stn.id, line_id=line.id, system="TVS"),
        ])
        db.commit()

    def _db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(planned.router, prefix="/api/planned")
    app.dependency_overrides[get_db] = _db
    return TestClient(app), Session


def _plan(c, code="TVF-01", when=TODAY - timedelta(days=1), cycle="Monthly", **kw):
    r = c.post("/api/planned", json=[{"asset_code": code, "planned_date": str(when),
                                      "cycle": cycle, "contractor": "TVS AMC",
                                      "source": "Letter 1638", **kw}])
    assert r.status_code == 200, r.text
    return r.json()


def test_create_dedupes_and_reports_unknown_assets(env):
    c, _ = env
    assert _plan(c)["created"] == 1
    res = c.post("/api/planned", json=[
        {"asset_code": "TVF-01", "planned_date": str(TODAY - timedelta(days=1)), "cycle": "monthly"},
        {"asset_code": "NOPE", "planned_date": str(TODAY), "cycle": "Monthly"},
        {"asset_code": "TVF-02", "planned_date": str(TODAY), "cycle": "Fortnightly"},
    ]).json()
    assert res["created"] == 0 and res["duplicates"] == 1
    assert [e["asset_code"] for e in res["errors"]] == ["NOPE", "TVF-02"]


def test_states_and_filters(env):
    c, _ = env
    _plan(c, when=TODAY - timedelta(days=2))
    _plan(c, code="TVF-02", when=TODAY, cycle="Quarterly")
    _plan(c, when=TODAY + timedelta(days=3))
    rows = c.get("/api/planned").json()
    assert [r["state"] for r in rows] == ["overdue", "today", "upcoming"]
    assert rows[0]["station"] == "Esplanade" and rows[0]["system"] == "TVS"
    assert len(c.get("/api/planned", params={"status": "overdue,today"}).json()) == 2
    assert len(c.get("/api/planned", params={"cycle": "Quarterly"}).json()) == 1
    assert len(c.get("/api/planned", params={"system": "HVAC"}).json()) == 0
    f = c.get("/api/planned/facets").json()
    assert f["cycles"] == ["Monthly", "Quarterly"] and f["contractors"] == ["TVS AMC"]


def test_one_click_done_files_a_maintenance_entry(env):
    c, Session = env
    _plan(c, task="Clean impeller")
    pid = c.get("/api/planned").json()[0]["id"]
    r = c.post(f"/api/planned/{pid}/done", json={})
    assert r.status_code == 200, r.text
    with Session() as db:
        e = db.get(LogEntry, r.json()["log_entry_id"])
        assert e.type == LogEntryType.MAINTENANCE and e.subtype == "Monthly"
        assert e.log_date == TODAY - timedelta(days=1)       # defaults to the planned date
        assert e.asset.code == "TVF-01" and e.system == "TVS"
        assert e.action_taken == "Clean impeller" and e.attended_by == "TVS AMC"
    row = c.get("/api/planned").json()[0]
    assert row["state"] == "done" and row["log_entry_id"] == e.id
    assert c.post(f"/api/planned/{pid}/done", json={}).status_code == 409


def test_done_rejects_a_future_date(env):
    c, _ = env
    _plan(c, when=TODAY + timedelta(days=5))
    pid = c.get("/api/planned").json()[0]["id"]
    assert c.post(f"/api/planned/{pid}/done", json={}).status_code == 422


def test_bulk_done_keeps_going_past_a_bad_row(env):
    c, _ = env
    _plan(c)
    _plan(c, code="TVF-02")
    _plan(c, when=TODAY + timedelta(days=5))
    ids = [r["id"] for r in c.get("/api/planned").json()]
    res = c.post("/api/planned/done", json={"ids": ids, "attended_by": "Bipin"}).json()
    assert len(res["done"]) == 2 and len(res["errors"]) == 1


def test_reconcile_closes_plan_from_a_longer_cycle_entry(env):
    c, Session = env
    _plan(c, when=TODAY.replace(day=1), cycle="Monthly")
    with Session() as db:
        a = db.scalar(select(Asset).where(Asset.code == "TVF-01"))
        db.add(LogEntry(at=TODAY, log_date=TODAY.replace(day=1), shift=ShiftCode.GENERAL,
                        type=LogEntryType.MAINTENANCE, subtype="Quarterly",
                        text="sheet puller", entered_by="sheet", asset_id=a.id))
        db.commit()
    row = c.get("/api/planned").json()[0]
    assert row["state"] == "done" and row["closed_by"] == "reconcile"


def test_shorter_cycle_entry_does_not_close_a_longer_plan(env):
    c, Session = env
    _plan(c, when=TODAY.replace(day=1), cycle="Yearly")
    with Session() as db:
        a = db.scalar(select(Asset).where(Asset.code == "TVF-01"))
        db.add(LogEntry(at=TODAY, log_date=TODAY.replace(day=1), shift=ShiftCode.GENERAL,
                        type=LogEntryType.MAINTENANCE, subtype="Monthly",
                        text="monthly only", entered_by="sheet", asset_id=a.id))
        db.commit()
    assert c.get("/api/planned").json()[0]["status"] == "planned"


def test_reschedule_skip_and_summary(env):
    c, _ = env
    _plan(c)
    _plan(c, code="TVF-02")
    a, b = [r["id"] for r in c.get("/api/planned").json()]
    new = TODAY + timedelta(days=2)
    r = c.patch(f"/api/planned/{a}", json={"planned_date": str(new), "note": "shutdown"}).json()
    assert r["status"] == "rescheduled" and r["original_date"] == str(TODAY - timedelta(days=1))
    assert c.patch(f"/api/planned/{b}", json={"status": "skipped"}).json()["state"] == "skipped"
    s = c.get("/api/planned/summary", params={"month": new.strftime("%Y-%m")}).json()
    assert s["contractors"][0]["contractor"] == "TVS AMC"


def test_csv_import_dry_run_then_commit(env):
    c, _ = env
    body = ("asset_code,planned_date,cycle,contractor,source,task\n"
            f"TVF-01,{TODAY},Monthly,TVS AMC,L1638,PM\n"
            "TVF-02,not-a-date,Monthly,,,\n")
    files = {"file": ("p.csv", body, "text/csv")}
    dry = c.post("/api/planned/import", files=files).json()
    assert dry["created"] == 1 and len(dry["errors"]) == 1 and not dry["committed"]
    assert c.get("/api/planned").json() == []
    files = {"file": ("p.csv", body, "text/csv")}
    assert c.post("/api/planned/import", params={"commit": True}, files=files).json()["created"] == 1
    assert len(c.get("/api/planned").json()) == 1
