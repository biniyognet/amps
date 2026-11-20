# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Asset risk badge (F6) — red / amber / green per asset, with the reasons.

Read-only and computed on request from what the register already holds:
breakdowns in the last 12 months, a breakdown open right now, age against the
codal life, and PM overdue. No stored score, no migration — the badge can never
drift from the logbook it is read from. Points are plain integers so the "why"
tooltip reads the same numbers the sort uses."""
from collections import Counter
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.api.auth import optional_user, scope_location_ids
from app.api.logbook import open_failures_by_asset
from app.api.maintenance import schedule_all
from app.db import get_db
from app.models import Asset, AssetStatus, Criticality, Location, LogEntry, LogEntryType

router = APIRouter()

RED, AMBER = 7, 4          # red ≈ three signals together, amber ≈ two; one alone stays green
NEAR_LIFE = 0.8            # past 80% of codal life counts as "near"


def score_asset(fails_12m: int, open_now: int, age_years: float | None,
                life_years: int | None, pm: dict | None, vital: bool = False) -> dict:
    """One asset's risk: {score, level, reasons}. `pm` is the asset's schedule
    summary (state, never_done, next_frequency, days_left) or None when it has
    no PM plan; `vital` = criticality A. Reasons are ordered by weight, heaviest first."""
    parts = []   # (points, reason)
    if fails_12m >= 3:
        parts.append((4, f"failed {fails_12m} times in 12 months"))
    elif fails_12m == 2:
        parts.append((3, "failed twice in 12 months"))
    elif fails_12m == 1:
        parts.append((1, "failed once in 12 months"))
    if vital and (fails_12m or open_now):
        parts.append((1, "vital (A) asset"))
    if open_now:
        parts.append((3, "breakdown open now" if open_now == 1 else f"{open_now} breakdowns open now"))
    if age_years is not None and life_years:
        if age_years > life_years:
            parts.append((3, f"past codal life ({age_years:.0f} of {life_years} yrs)"))
        elif age_years >= NEAR_LIFE * life_years:
            parts.append((1, f"near codal life ({age_years:.0f} of {life_years} yrs)"))
    state = (pm or {}).get("state")
    if state == "overdue":
        if pm.get("never_done"):
            parts.append((2, "PM never done"))
        else:
            late = -(pm.get("days_left") or 0)
            cyc = pm.get("next_frequency") or "PM"
            parts.append((2, f"{cyc} PM overdue {late} d" if late > 0 else f"{cyc} PM overdue"))
    elif state == "long_overdue":
        parts.append((1, "5-Yearly PM overdue"))
    parts.sort(key=lambda p: -p[0])
    score = sum(p for p, _ in parts)
    level = "red" if score >= RED else "amber" if score >= AMBER else "green"
    return {"score": score, "level": level, "reasons": [r for _, r in parts]}


class RiskOut(BaseModel):
    asset_code: str
    line: str | None = None     # codes repeat across lines — keyed line|code like the schedule
    score: int
    level: str                  # red | amber | green
    reasons: list[str]          # heaviest first; the badge tooltip shows the top 3


@router.get("", response_model=list[RiskOut])
def risk_all(db: Session = Depends(get_db), user=Depends(optional_user)):
    """Risk for every in-service asset the caller can see. Green assets with no
    signal at all are left out to keep the payload small — no row = green."""
    today = date.today()
    q = select(Asset).options(joinedload(Asset.location).joinedload(Location.parent)) \
        .where(Asset.status.notin_([AssetStatus.DECOMMISSIONED, AssetStatus.SPARE]))
    scope = scope_location_ids(db, user)
    if scope is not None:
        q = q.where(Asset.location_id.in_(scope))
    if getattr(user, "depot", None):
        q = q.where(Asset.depot == user.depot)
    assets = db.scalars(q).all()

    since = today - timedelta(days=365)
    fails = Counter(db.scalars(
        select(LogEntry.asset_id).where(
            LogEntry.type == LogEntryType.FAILURE, LogEntry.asset_id.is_not(None),
            LogEntry.log_date >= since,
            or_(LogEntry.retracted.is_(None), LogEntry.retracted.is_(False)))).all())
    opens = open_failures_by_asset(db=db, user=user)          # {line|code: {open, ack, jobcard, …}}
    sched = {f"{s.line or ''}|{s.asset_code}": s.model_dump() for s in schedule_all(db=db, user=user)}

    out = []
    for a in assets:
        line = a.location.parent.name if a.location and a.location.parent else None
        key = f"{line or ''}|{a.code}"
        o = opens.get(key) or {}
        age = (today - a.commissioned_on).days / 365.25 if a.commissioned_on else None
        r = score_asset(fails[a.id], o.get("open", 0) + o.get("ack", 0) + o.get("jobcard", 0),
                        age, a.codal_life_years, sched.get(key), a.criticality == Criticality.A)
        if r["score"]:
            out.append(RiskOut(asset_code=a.code, line=line, **r))
    out.sort(key=lambda r: -r.score)
    return out
