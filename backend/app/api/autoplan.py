# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Auto-plan a week — due and overdue PM laid onto the days the roster can
actually staff, highest priority first, one station's jobs kept together.

Preview writes nothing. A supervisor reviews the board (optionally with a
Gemini explanation), then approves it: approval files ordinary PMPlanned rows,
so the plan is done, rescheduled and reconciled like any other.
"""
import urllib.error
from collections import defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api import ai
from app.api.auth import current_writer, is_anonymous, optional_user, scope_location_ids
from app.api.maintenance import schedule_all
from app.api.planned import OPEN, PlannedIn, _create
from app.db import get_db
from app.engine import SCHEDULE_FREQ, overdue_days, priority_score
from app.models import Asset, AssetStatus, PMPlanned, RosterEntry, RosterPattern

router = APIRouter()

DUE = ("overdue", "long_overdue", "grace", "due_soon")
TEAM = 2                 # people per maintenance team
JOBS_PER_TEAM = 3        # PM jobs one team closes in a maintenance window
DEFAULT_CAPACITY = 6     # jobs/day when no active roster covers the scope
SOURCE = "AMPS auto-plan"
DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


class AutoIn(BaseModel):
    date_from: date | None = None     # default: next Monday
    days: int = 7
    station: str | None = None
    system: str | None = None
    capacity: int | None = None       # jobs/day override; default from the roster
    explain: bool = False             # ask Gemini to explain the plan


class ApplyIn(BaseModel):
    jobs: list[PlannedIn]


def _next_monday(today: date) -> date:
    return today + timedelta(days=(7 - today.weekday()) % 7 or 7)


def _capacity(db: Session, user) -> tuple[dict[int, int], dict[int, int], str]:
    """Jobs per weekday from the active roster: people on a maintenance-window
    shift, paired into teams. Scoped to the planner's line."""
    pats = db.scalars(select(RosterPattern).where(RosterPattern.is_active.is_(True))).all()
    people = defaultdict(set)
    line_id = None if is_anonymous(user) else getattr(user, "line_id", None)
    for p in pats:
        window = {s.strip() for s in (p.maintenance_window_shifts or "N").split(",") if s.strip()}
        for e in db.scalars(select(RosterEntry).where(RosterEntry.pattern_id == p.id)
                            .options(selectinload(RosterEntry.user))).all():
            if e.shift.value not in window:
                continue
            if line_id and e.user and e.user.line_id not in (None, line_id):
                continue
            people[e.weekday].add(e.user_id)
    if not people:
        return ({d: DEFAULT_CAPACITY for d in range(7)}, {d: 0 for d in range(7)},
                "no active roster for this scope — default capacity")
    staff = {d: len(people.get(d, ())) for d in range(7)}
    cap = {d: (n // TEAM) * JOBS_PER_TEAM for d, n in staff.items()}
    names = ", ".join(p.name for p in pats)
    return cap, staff, f"roster '{names}': maintenance-window staff ÷ {TEAM} × {JOBS_PER_TEAM} jobs"


def _candidates(db: Session, user, date_to: date, station, system) -> tuple[list[dict], int]:
    """One job per asset: the longest cycle that falls due by `date_to` (a longer
    service fulfils the shorter ones). Assets with an open plan are skipped."""
    summaries = [s for s in schedule_all(db, user) if s.state in DUE or
                 any(d and d <= date_to for d in s.cycle_due.values())]
    if not summaries:
        return [], 0
    codes = {s.asset_code for s in summaries}
    assets = defaultdict(list)
    for a in db.scalars(select(Asset).where(Asset.code.in_(codes))
                        .options(selectinload(Asset.location))).all():
        if a.status in (AssetStatus.DECOMMISSIONED, AssetStatus.SPARE):
            continue
        line = a.location.parent.name if a.location and a.location.parent else None
        assets[(a.code, line)].append(a)
    scope = scope_location_ids(db, user)
    planned = set(db.scalars(select(PMPlanned.asset_id).where(PMPlanned.status.in_(OPEN))).all())
    last_contractor = {}
    for aid, who in db.execute(select(PMPlanned.asset_id, PMPlanned.contractor)
                               .where(PMPlanned.contractor.isnot(None))
                               .order_by(PMPlanned.planned_date)).all():
        last_contractor[aid] = who
    jobs, already = [], 0
    for s in summaries:
        for a in assets.get((s.asset_code, s.line), []):
            if scope is not None and a.location_id not in scope:
                continue
            stn = a.location.name if a.location else None
            if station and stn != station:
                continue
            if system and a.system != system:
                continue
            due = {c: d for c, d in s.cycle_due.items() if d and d <= date_to and c in SCHEDULE_FREQ}
            if not due:
                continue
            if a.id in planned:
                already += 1
                continue
            cycle = max(due, key=lambda c: SCHEDULE_FREQ[c])
            covers = sorted((c for c in due if c != cycle), key=lambda c: SCHEDULE_FREQ[c])
            od = overdue_days(due[cycle])
            crit = a.criticality.value
            why = [f"{od}d overdue" if od else f"due {due[cycle]:%d %b}", f"criticality {crit}"]
            if s.cycles.get(cycle) == "long_overdue":
                why.append("long overdue")
            if covers:
                why.append("covers " + ", ".join(covers))
            jobs.append({"asset_id": a.id, "asset_code": a.code, "asset_name": a.name,
                         "station": stn, "line": s.line, "system": a.system,
                         "criticality": crit, "cycle": cycle, "covers": covers,
                         "due": due[cycle], "overdue_days": od,
                         "score": priority_score(crit, od),
                         "contractor": last_contractor.get(a.id),
                         "reason": " · ".join(why)})
    jobs.sort(key=lambda j: (-j["score"], j["due"], j["station"] or "", j["asset_code"]))
    return jobs, already


def _lay_out(jobs: list[dict], days: list[date], cap: dict[int, int]) -> tuple[list[dict], list[dict]]:
    """Greedy, priority first. A job joins a day that already visits its station
    if that day is at most one day later than the earliest free day — one trip
    per station, without pushing urgent work back."""
    left = {d: cap.get(d.weekday(), 0) for d in days}
    board = {d: [] for d in days}
    backlog = []
    for j in jobs:
        free = [d for d in days if left[d] > 0]
        if not free:
            backlog.append(j)
            continue
        first = free[0]
        same = [d for d in free if (d - first).days <= 1 and
                any(x["station"] == j["station"] for x in board[d])]
        d = same[0] if same else first
        board[d].append({**j, "planned_date": d})
        left[d] -= 1
    out = []
    for d in days:
        stations = defaultdict(int)
        for j in board[d]:
            stations[j["station"] or "—"] += 1
        out.append({"date": d, "weekday": DAYS[d.weekday()], "capacity": cap.get(d.weekday(), 0),
                    "stations": dict(stations), "jobs": board[d]})
    return out, backlog


def _summary_text(board, backlog, basis) -> str:
    n = sum(len(d["jobs"]) for d in board)
    od = sum(1 for d in board for j in d["jobs"] if j["overdue_days"])
    a = sum(1 for d in board for j in d["jobs"] if j["criticality"] == "A")
    busiest = max(board, key=lambda d: len(d["jobs"]), default=None)
    parts = [f"{n} jobs planned over {len(board)} days ({od} overdue, {a} on criticality-A assets)."]
    if busiest and busiest["jobs"]:
        parts.append(f"Busiest day {busiest['weekday']} {busiest['date']:%d %b} with "
                     f"{len(busiest['jobs'])} jobs at {len(busiest['stations'])} station(s).")
    if backlog:
        parts.append(f"{len(backlog)} more due jobs did not fit the roster and stay in the backlog.")
    parts.append(f"Capacity: {basis}.")
    return " ".join(parts)


def _gemini_explain(board, backlog, basis) -> str:
    lines = []
    for d in board:
        for j in d["jobs"]:
            lines.append(f"{d['weekday']} {d['date']}: {j['asset_code']} @ {j['station']} "
                         f"{j['cycle']} — {j['reason']}")
    for j in backlog[:15]:
        lines.append(f"BACKLOG: {j['asset_code']} @ {j['station']} {j['cycle']} — {j['reason']}")
    prompt = ("You are a maintenance planning assistant. A supervisor must approve this "
              "week's preventive-maintenance plan. In 4-6 short bullet points, explain why it is "
              "ordered this way (criticality x days overdue, station grouping, roster capacity), "
              "name the riskiest items, and flag anything the supervisor should check before "
              f"approving. Plain text, no markdown headings.\n\nCapacity: {basis}\n\n" +
              "\n".join(lines[:120]))
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{ai.GEMINI_MODEL}:generateContent"
    resp = ai._post(url, {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 600,
                             "thinkingConfig": {"thinkingBudget": 0}},
    }, {"x-goog-api-key": ai.GEMINI_KEY})
    parts = (resp.get("candidates") or [{}])[0].get("content", {}).get("parts") or []
    return "".join(p.get("text", "") for p in parts).strip()


@router.post("")
def preview(body: AutoIn, request: Request, db: Session = Depends(get_db),
            user=Depends(optional_user)):
    """Draft a week's plan. Writes nothing."""
    if is_anonymous(user):
        raise HTTPException(401, "login required")
    start = body.date_from or _next_monday(date.today())
    days = [start + timedelta(days=i) for i in range(max(1, min(body.days, 14)))]
    cap, staff, basis = _capacity(db, user)
    if body.capacity:
        cap, basis = {d: body.capacity for d in range(7)}, f"{body.capacity} jobs/day (set by planner)"
    jobs, already = _candidates(db, user, days[-1], body.station, body.system)
    board, backlog = _lay_out(jobs, days, cap)
    for d in board:
        d["staff"] = staff.get(d["date"].weekday(), 0)
    out = {"date_from": days[0], "date_to": days[-1], "capacity_basis": basis,
           "board": board, "backlog": backlog, "already_planned": already,
           "summary": _summary_text(board, backlog, basis), "explanation": None, "model": None}
    if body.explain and any(d["jobs"] for d in board):
        if not ai._enabled() or ai.PROVIDER != "gemini":
            out["explanation_note"] = "Gemini is not configured on this server."
        else:
            ai._throttle(request.client.host if request.client else "-")
            try:
                out["explanation"], out["model"] = _gemini_explain(board, backlog, basis), ai.GEMINI_MODEL
            except (urllib.error.URLError, TimeoutError, KeyError, ValueError, IndexError):
                out["explanation_note"] = "Gemini is busy — the plan above is still valid."
    return out


@router.post("/apply")
def apply(body: ApplyIn, db: Session = Depends(get_db), user=Depends(current_writer)):
    """Supervisor approval: file the reviewed jobs as planned rows."""
    if not body.jobs:
        raise HTTPException(422, "nothing to approve")
    if len(body.jobs) > 500:
        raise HTTPException(422, "too many jobs in one approval")
    stamp = f"{SOURCE} · approved by {user.username} {date.today():%d %b %Y}"
    rows = [r.model_copy(update={"source": stamp}) for r in body.jobs]
    res = _create(db, rows, user)
    db.commit()
    return res
