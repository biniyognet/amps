# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""F6 risk badge: the score rules, then the demo network's two story assets."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import seed_network
from app.api import risk
from app.api.risk import score_asset
from app.db import get_db
from app.models import Asset, AssetStatus, Base


# ── rules ──
def test_pump_like_is_red():
    r = score_asset(4, 1, 23, 20, None, vital=True)
    assert r["level"] == "red" and r["score"] == 11
    assert r["reasons"][:3] == ["failed 4 times in 12 months", "breakdown open now",
                                "past codal life (23 of 20 yrs)"]


def test_transformer_like_is_amber():
    r = score_asset(2, 0, 4, 35, {"state": "ok"}, vital=True)
    assert r["level"] == "amber" and r["score"] == 4


def test_one_signal_alone_stays_green():
    assert score_asset(0, 0, 30, 20, None)["level"] == "green"          # old, nothing else
    assert score_asset(0, 1, None, None, None)["level"] == "green"      # open breakdown only
    assert score_asset(0, 0, None, None, {"state": "overdue", "never_done": True})["level"] == "green"


def test_nothing_scores_zero():
    assert score_asset(0, 0, 2, 20, {"state": "ok"}) == {"score": 0, "level": "green", "reasons": []}


def test_vital_point_needs_a_failure():
    assert score_asset(0, 0, None, None, None, vital=True)["score"] == 0


def test_pm_reasons():
    assert score_asset(0, 0, None, None, {"state": "overdue", "never_done": True})["reasons"] == ["PM never done"]
    assert score_asset(0, 0, None, None, {"state": "overdue", "next_frequency": "Monthly",
                                          "days_left": -12})["reasons"] == ["Monthly PM overdue 12 d"]
    assert score_asset(0, 0, None, None, {"state": "long_overdue"})["reasons"] == ["5-Yearly PM overdue"]
    assert score_asset(0, 0, 17, 20, None)["reasons"] == ["near codal life (17 of 20 yrs)"]


def test_reasons_heaviest_first():
    r = score_asset(1, 1, 25, 20, {"state": "overdue", "never_done": True})
    assert r["reasons"] == ["breakdown open now", "past codal life (25 of 20 yrs)",
                            "PM never done", "failed once in 12 months"]


# ── the demo network ──
@pytest.fixture(scope="module")
def demo():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Session = sessionmaker(bind=engine, autoflush=False)
    mp = pytest.MonkeyPatch()
    mp.setattr(seed_network, "init_db", lambda: Base.metadata.create_all(engine))
    mp.setattr(seed_network, "SessionLocal", Session)
    seed_network.seed()
    mp.undo()

    app = FastAPI()
    app.include_router(risk.router, prefix="/api/risk")

    def _db():
        db = Session()
        try:
            yield db
        finally:
            db.close()
    app.dependency_overrides[get_db] = _db
    rows = TestClient(app).get("/api/risk").json()
    with Session() as db:
        spares = {f"{a.location.parent.name if a.location and a.location.parent else None}|{a.code}"
                  for a in db.scalars(select(Asset).where(
                      Asset.status.in_([AssetStatus.SPARE, AssetStatus.DECOMMISSIONED]))).all()}
    return {f"{r['line']}|{r['asset_code']}": r for r in rows}, rows, spares


def _one(by, code):
    hit = [r for k, r in by.items() if k.endswith(f"|{code}")]
    assert len(hit) == 1, code
    return hit[0]


def test_pump_motor_1_is_red(demo):
    r = _one(demo[0], "CWT-AM-MTR-01")
    assert r["level"] == "red"
    assert "breakdown open now" in r["reasons"][:3]


def test_ptr_1_is_amber(demo):
    assert _one(demo[0], "EGS-CG-PTR-01")["level"] == "amber"


def test_sorted_and_no_empty_rows(demo):
    rows = demo[1]
    scores = [r["score"] for r in rows]
    assert scores == sorted(scores, reverse=True) and all(s > 0 for s in scores)
    assert sum(r["level"] == "red" for r in rows) < 20      # red stays rare enough to mean something


def test_spares_left_out(demo):
    assert demo[2], "seed has spares"
    assert not set(demo[0]) & demo[2]
