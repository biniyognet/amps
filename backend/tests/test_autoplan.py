# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Auto-plan: due PM → roster-sized week board → supervisor approval → plan rows."""
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import autoplan, planned
from app.db import get_db
from app.models import (Asset, AssetClass, Base, Criticality, Location, LocationKind, LogEntry,
                        LogEntryType, PMPlanned, RosterEntry, RosterPattern, ShiftCode, User,
                        UserRole)

TODAY = date.today()
MON = autoplan._next_monday(TODAY)


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
        esp = Location(name="Esplanade", kind=LocationKind.STATION, parent_id=line.id)
        sea = Location(name="Sealdah", kind=LocationKind.STATION, parent_id=line.id)
        cls = AssetClass(name="Fan")
        db.add_all([esp, sea, cls])
        db.flush()
        spec = [("TVF-01", esp, Criticality.A, 60), ("TVF-02", esp, Criticality.C, 40),
                ("TVF-03", sea, Criticality.B, 45), ("TVF-04", sea, Criticality.B, 2)]
        for code, stn, crit, ago in spec:
            a = Asset(code=code, name=f"Fan {code}", asset_class_id=cls.id, location_id=stn.id,
                      line_id=line.id, system="TVS", criticality=crit)
            db.add(a)
            db.flush()
            d = TODAY - timedelta(days=ago)
            db.add(LogEntry(at=d, log_date=d, shift=ShiftCode.GENERAL,
                            type=LogEntryType.MAINTENANCE, subtype="Monthly",
                            text="pm", entered_by="seed", asset_id=a.id))
        db.commit()

    def _db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(autoplan.router, prefix="/api/planned/auto")
    app.include_router(planned.router, prefix="/api/planned")
    app.dependency_overrides[get_db] = _db
    return TestClient(app), Session


def _preview(c, **kw):
    r = c.post("/api/planned/auto", json={"date_from": str(MON), **kw})
    assert r.status_code == 200, r.text
    return r.json()


def _jobs(out):
    return [j for d in out["board"] for j in d["jobs"]]


def test_preview_orders_by_priority_and_writes_nothing(env):
    c, Session = env
    out = _preview(c, capacity=10)
    codes = [j["asset_code"] for j in _jobs(out)]
    assert "TVF-04" not in codes                    # done 2 days ago — not due this week
    assert codes[0] == "TVF-01"                     # criticality A, most overdue
    assert set(codes) == {"TVF-01", "TVF-02", "TVF-03"}
    assert "criticality A" in _jobs(out)[0]["reason"]
    with Session() as db:
        assert db.scalar(select(PMPlanned.id)) is None


def test_capacity_spills_to_backlog(env):
    c, _ = env
    out = _preview(c, capacity=1, days=2)
    assert len(_jobs(out)) == 2 and len(out["backlog"]) == 1
    assert out["backlog"][0]["asset_code"] == "TVF-02"     # lowest score waits
    assert "backlog" in out["summary"]


def test_station_grouping_keeps_one_trip(env):
    c, _ = env
    # 2/day: grouping never jumps priority — TVF-03 (Sealdah, B) outranks TVF-02
    # (Esplanade, C), so day 1 is the two most urgent and TVF-02 waits a day.
    out = _preview(c, capacity=2, days=2)
    day1 = {j["asset_code"] for j in out["board"][0]["jobs"]}
    assert day1 == {"TVF-01", "TVF-03"}
    assert [j["asset_code"] for j in out["board"][1]["jobs"]] == ["TVF-02"]


def test_roster_sets_capacity(env):
    c, Session = env
    with Session() as db:
        pat = RosterPattern(name="Base", is_active=True, maintenance_window_shifts="N")
        db.add(pat)
        for i in range(4):
            u = User(username=f"t{i}", full_name=f"Tech {i}", role=UserRole.TECHNICIAN)
            db.add(u)
            db.flush()
            db.add(RosterEntry(pattern=pat, user_id=u.id, weekday=MON.weekday(), shift=ShiftCode.NIGHT))
        db.commit()
    out = _preview(c)
    assert out["board"][0]["staff"] == 4 and out["board"][0]["capacity"] == 6
    assert out["board"][1]["capacity"] == 0
    assert "roster 'Base'" in out["capacity_basis"]


def test_apply_files_plan_rows_and_skips_planned_assets(env):
    c, Session = env
    out = _preview(c, capacity=10)
    jobs = [{"asset_code": j["asset_code"], "asset_id": j["asset_id"],
             "planned_date": j["planned_date"], "cycle": j["cycle"]} for j in _jobs(out)]
    r = c.post("/api/planned/auto/apply", json={"jobs": jobs})
    assert r.status_code == 200 and r.json()["created"] == 3
    with Session() as db:
        src = db.scalars(select(PMPlanned.source)).all()
    assert all(s.startswith("AMPS auto-plan · approved by") for s in src)
    again = _preview(c, capacity=10)
    assert _jobs(again) == [] and again["already_planned"] == 3


def test_explain_with_gemini_mocked(env, monkeypatch):
    c, _ = env
    monkeypatch.setattr(autoplan.ai, "PROVIDER", "gemini")
    monkeypatch.setattr(autoplan.ai, "GEMINI_KEY", "k")
    monkeypatch.setattr(autoplan.ai, "_throttle", lambda ip: None)
    seen = {}

    def fake(url, body, headers):
        seen["prompt"] = body["contents"][0]["parts"][0]["text"]
        return {"candidates": [{"content": {"parts": [{"text": "- TVF-01 first: criticality A"}]}}]}
    monkeypatch.setattr(autoplan.ai, "_post", fake)
    out = _preview(c, capacity=10, explain=True)
    assert out["explanation"].startswith("- TVF-01") and "TVF-03" in seen["prompt"]
