# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Agency register: who maintains what, and how auto-plan splits in-house
roster work from the AMC agencies' own schedules."""
import io
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import agencies, autoplan, planned
from app.api.agencies import Resolver, _key, contract_state
from app.db import get_db
from app.models import (Agency, AgencyScope, Asset, AssetClass, Base, Criticality, Location,
                        LocationKind, LogEntry, LogEntryType, PMPlanned, ShiftCode)

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
        fan, pump = AssetClass(name="Fan"), AssetClass(name="Pump")
        db.add_all([esp, sea, fan, pump])
        db.flush()
        # TVS fans are on Aerodyne's AMC at depot CPD; pumps stay in-house
        spec = [("TVF-01", esp, fan, "TVS", "CPD", 60), ("TVF-02", sea, fan, "TVS", "CPD", 50),
                ("TVF-03", sea, fan, "TVS", "BYP", 45),
                ("PMP-01", esp, pump, "Pumping", "CPD", 40), ("PMP-02", sea, pump, "Pumping", "CPD", 35)]
        for code, stn, cls, system, depot, ago in spec:
            a = Asset(code=code, name=code, asset_class_id=cls.id, location_id=stn.id,
                      line_id=line.id, system=system, depot=depot, criticality=Criticality.B)
            db.add(a)
            db.flush()
            d = TODAY - timedelta(days=ago)
            db.add(LogEntry(at=d, log_date=d, shift=ShiftCode.GENERAL,
                            type=LogEntryType.MAINTENANCE, subtype="Monthly",
                            text="pm", entered_by="seed", asset_id=a.id))
        aero = Agency(name="Aerodyne Service", kind="amc", contract_no="LOA/CPD/AMC/01",
                      valid_from=TODAY - timedelta(days=300), valid_to=TODAY + timedelta(days=5),
                      aliases="M/s Aerodyne, Aerodyne AMC")
        aero.scopes.append(AgencyScope(system="TVS", depot="CPD"))
        db.add_all([aero, Agency(name="In-house (section)", kind="in_house")])
        db.commit()

    def _db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(agencies.router, prefix="/api/agencies")
    app.include_router(autoplan.router, prefix="/api/planned/auto")
    app.include_router(planned.router, prefix="/api/planned")
    app.dependency_overrides[get_db] = _db
    return TestClient(app), Session


def _asset(db, code):
    return db.scalar(select(Asset).where(Asset.code == code))


def _preview(c):
    r = c.post("/api/planned/auto", json={"date_from": str(MON), "capacity": 10})
    assert r.status_code == 200, r.text
    return r.json()


def test_key_ignores_case_punctuation_and_ms():
    assert _key("M/s. Aerodyne-Service") == _key("AERODYNE SERVICE") == "aerodyneservice"


def test_resolver_most_specific_rule_and_override(env):
    _, Session = env
    with Session() as db:
        aero = db.scalar(select(Agency).where(Agency.name == "Aerodyne Service"))
        oem = Agency(name="Fan OEM", kind="oem")
        # a narrower rule: the OEM does the Yearly on the fans at Sealdah
        sea = db.scalar(select(Location).where(Location.name == "Sealdah"))
        oem.scopes.append(AgencyScope(system="TVS", location_id=sea.id, cycles="Yearly"))
        db.add(oem)
        db.commit()
        who = Resolver(db)
        t1, t2, t3, p1 = (_asset(db, c) for c in ("TVF-01", "TVF-02", "TVF-03", "PMP-01"))
        assert who.who(t1, "Monthly").name == "Aerodyne Service"
        assert who.who(t2, "Monthly").name == "Aerodyne Service"   # OEM rule is Yearly only
        assert who.who(t2, "Yearly").name == "Fan OEM"              # more specific wins
        assert who.who(t3, "Monthly") is None                      # other depot: in-house
        assert who.who(p1, "Monthly") is None
        p1.agency_id = aero.id                                     # per-asset override
        assert who.who(p1, "Monthly").name == "Aerodyne Service"
        assert who.canonical("m/s aerodyne") == "Aerodyne Service"
        assert who.canonical("Someone Else") == "Someone Else"
        assert who.kind_of("Aerodyne AMC") == "amc"


def test_contract_state():
    a = SimpleNamespace(kind="amc", valid_from=TODAY - timedelta(days=10), valid_to=TODAY + timedelta(days=5))
    assert contract_state(a, TODAY) == "expiring"
    assert contract_state(a, TODAY + timedelta(days=6)) == "expired"
    assert contract_state(SimpleNamespace(kind="in_house", valid_from=None, valid_to=None)) == "in_house"


def test_autoplan_keeps_amc_work_off_the_roster(env):
    c, Session = env
    with Session() as db:
        t1, t2 = _asset(db, "TVF-01"), _asset(db, "TVF-02")
        # the agency's own sheet: TVF-01 slipped (alias spelling), TVF-02 after the contract ends
        db.add_all([PMPlanned(asset_id=t1.id, line_id=t1.line_id, cycle="Monthly",
                              planned_date=TODAY - timedelta(days=3), contractor="M/s Aerodyne"),
                    PMPlanned(asset_id=t2.id, line_id=t2.line_id, cycle="Monthly",
                              planned_date=TODAY + timedelta(days=9), contractor="Aerodyne AMC")])
        db.commit()
    out = _preview(c)
    board = {j["asset_code"] for d in out["board"] for j in d["jobs"]}
    assert board == {"TVF-03", "PMP-01", "PMP-02"}      # in-house only; TVF-03 is another depot
    assert out["register"] is True
    (ag,) = out["agencies"]
    assert ag["agency"] == "Aerodyne Service" and ag["contract_state"] == "expiring"
    assert ag["due"] == 2 and ag["scheduled"] == 2 and ag["gaps"] == []
    assert [s["asset_code"] for s in ag["slipped"]] == ["TVF-01"]
    assert ag["slipped"][0]["late_days"] == 3
    assert [s["asset_code"] for s in ag["out_of_contract"]] == ["TVF-02"]
    assert "Outside agencies" in out["summary"]


def test_autoplan_flags_gap_when_agency_schedule_misses_an_asset(env):
    c, _ = env
    (ag,) = _preview(c)["agencies"]
    assert sorted(j["asset_code"] for j in ag["gaps"]) == ["TVF-01", "TVF-02"]
    assert ag["scheduled"] == 0


def test_no_register_keeps_old_behaviour(env):
    c, Session = env
    with Session() as db:
        for a in db.scalars(select(Agency)).all():
            db.delete(a)
        db.commit()
    out = _preview(c)
    assert len({j["asset_code"] for d in out["board"] for j in d["jobs"]}) == 5
    assert out["agencies"] == [] and out["register"] is False


def test_covering_plan_needs_a_long_enough_cycle():
    m = SimpleNamespace(cycle="Monthly", planned_date=TODAY)
    y = SimpleNamespace(cycle="Yearly", planned_date=TODAY + timedelta(days=4))
    assert autoplan._covering_plan([m], "Yearly") is None     # a Monthly can't stand in for a Yearly
    assert autoplan._covering_plan([m, y], "Yearly") is y
    assert autoplan._covering_plan([y, m], "Monthly") is m    # earliest that covers


def test_import_tagged_with_agency_files_canonical_name(env):
    c, Session = env
    csv = f"asset_code,planned_date,cycle\nTVF-01,{TODAY + timedelta(days=2)},Monthly\n"
    r = c.post("/api/planned/import", params={"commit": 1, "agency": "m/s aerodyne"},
               files={"file": ("aero.csv", io.BytesIO(csv.encode()), "text/csv")})
    assert r.status_code == 200, r.text
    with Session() as db:
        assert db.scalar(select(PMPlanned.contractor)) == "Aerodyne Service"
    rows = c.get("/api/planned").json()
    assert rows[0]["contractor"] == "Aerodyne Service" and rows[0]["agency_kind"] == "amc"


def test_planned_row_without_contractor_shows_resolved_agency(env):
    c, Session = env
    with Session() as db:
        t1 = _asset(db, "TVF-01")
        db.add(PMPlanned(asset_id=t1.id, line_id=t1.line_id, cycle="Monthly", planned_date=TODAY))
        db.commit()
    (row,) = c.get("/api/planned").json()
    assert row["contractor"] == "Aerodyne Service" and row["agency_kind"] == "amc"
