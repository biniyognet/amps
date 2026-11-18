# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Planned maintenance — the forward schedule a contractor commits to (e.g. a
monthly schedule letter), and the one-click path from a plan to a logbook entry.

A plan is not a record. "Done" files a normal MAINTENANCE log entry under the
signed-in user and closes the plan; a matching entry logged any other way (the
sheet puller, a manual entry) closes it on reconcile — same asset, same month,
the planned cycle or a longer one (a longer service fulfils the shorter ones).
"""
import csv
import io
from collections import defaultdict
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.assets import visible_asset
from app.api.auth import current_writer, is_anonymous, optional_user, scope_location_ids
from app.api.logbook import LogEntryIn, _add_one
from app.db import audit, get_db
from app.engine import SCHEDULE_FREQ
from app.models import Asset, Location, LogEntry, LogEntryType, PMPlanned

router = APIRouter()

OPEN = ("planned", "rescheduled")
STATUSES = ("planned", "rescheduled", "done", "skipped")


# ---- shapes -----------------------------------------------------------------

class PlannedIn(BaseModel):
    asset_code: str
    asset_id: int | None = None       # pins the row when a code repeats across stations
    planned_date: date
    cycle: str
    task: str | None = None
    contractor: str | None = None
    source: str | None = None


class PlannedOut(BaseModel):
    id: int
    asset_id: int
    asset_code: str
    asset_name: str | None = None
    system: str | None = None
    station: str | None = None
    location_detail: str | None = None
    planned_date: date
    cycle: str
    task: str | None = None
    contractor: str | None = None
    source: str | None = None
    status: str
    state: str                        # today | upcoming | overdue | done | skipped
    original_date: date | None = None
    note: str | None = None
    log_entry_id: int | None = None
    done_on: date | None = None
    closed_by: str | None = None


class DoneIn(BaseModel):
    """Every field optional — one click with no details files the plan as done
    on its planned date."""
    done_date: date | None = None     # default: the planned date
    shift: str = "G"
    time: str | None = None
    attended_by: str | None = None
    remarks: str | None = None        # the entry text; default names the plan
    action_taken: str | None = None   # default: the plan's task
    consumables: str | None = None
    checksheet: dict | None = None


class BulkDoneIn(DoneIn):
    ids: list[int] = Field(min_length=1, max_length=500)


class PlannedPatch(BaseModel):
    planned_date: date | None = None  # reschedule
    status: str | None = None         # skipped | planned (reopen a skipped row)
    note: str | None = None


# ---- helpers ----------------------------------------------------------------

def _norm_cycle(c: str) -> str:
    for k in SCHEDULE_FREQ:
        if k.lower() == (c or "").strip().lower():
            return k
    raise HTTPException(422, f"unknown cycle {c!r} — one of {', '.join(SCHEDULE_FREQ)}")


def _state(p: PMPlanned, today: date) -> str:
    if p.status in ("done", "skipped"):
        return p.status
    if p.planned_date < today:
        return "overdue"
    return "today" if p.planned_date == today else "upcoming"


def _out(p: PMPlanned, today: date) -> PlannedOut:
    a = p.asset
    return PlannedOut(
        id=p.id, asset_id=p.asset_id, asset_code=a.code, asset_name=a.name,
        system=a.system, station=(a.location.name if a.location else None),
        location_detail=a.location_detail, planned_date=p.planned_date, cycle=p.cycle,
        task=p.task, contractor=p.contractor, source=p.source, status=p.status,
        state=_state(p, today), original_date=p.original_date, note=p.note,
        log_entry_id=p.log_entry_id, done_on=p.done_on, closed_by=p.closed_by)


def _scoped(q, db: Session, user):
    """Plans of assets inside the user's line (and depot) — mirrors visible_asset."""
    q = q.join(Asset, PMPlanned.asset_id == Asset.id)
    scope = scope_location_ids(db, user)
    if scope is not None:
        q = q.where(Asset.location_id.in_(scope))
    if getattr(user, "depot", None):
        q = q.where(Asset.depot == user.depot)
    return q


def _get(db: Session, pid: int, user) -> PMPlanned:
    p = db.scalars(_scoped(select(PMPlanned).where(PMPlanned.id == pid), db, user)).first()
    if not p:
        raise HTTPException(404, "planned row not found")
    return p


def _month(d: date) -> tuple[date, date]:
    start = d.replace(day=1)
    end = (start.replace(year=start.year + 1, month=1) if start.month == 12
           else start.replace(month=start.month + 1))
    return start, end


def reconcile(db: Session, rows: list[PMPlanned]) -> int:
    """Close open plans already covered by a logged MAINTENANCE entry — same
    asset, same calendar month, the planned cycle or a longer one. Returns how
    many closed; the caller commits."""
    open_rows = [p for p in rows if p.status in OPEN]
    if not open_rows:
        return 0
    lo = min(_month(p.planned_date)[0] for p in open_rows)
    hi = max(_month(p.planned_date)[1] for p in open_rows)
    logs = db.scalars(select(LogEntry).where(
        LogEntry.type == LogEntryType.MAINTENANCE,
        LogEntry.asset_id.in_({p.asset_id for p in open_rows}),
        LogEntry.log_date >= lo, LogEntry.log_date < hi,
        func.coalesce(LogEntry.retracted, False).is_(False),
    )).all()
    by_asset = defaultdict(list)
    for e in logs:
        if e.subtype in SCHEDULE_FREQ:
            by_asset[e.asset_id].append(e)
    closed = 0
    for p in open_rows:
        need = SCHEDULE_FREQ.get(p.cycle, 0)
        start, end = _month(p.planned_date)
        hits = [e for e in by_asset[p.asset_id]
                if start <= e.log_date < end and SCHEDULE_FREQ[e.subtype] >= need]
        if hits:
            e = min(hits, key=lambda e: abs((e.log_date - p.planned_date).days))
            p.status, p.log_entry_id, p.done_on, p.closed_by = "done", e.id, e.log_date, "reconcile"
            audit(db, "pm_planned", p.id, "reconciled", detail=f"log_entry={e.id}")
            closed += 1
    return closed


def _query(db, user, date_from, date_to, month, system, station, contractor,
           status, cycle, q):
    stmt = _scoped(select(PMPlanned), db, user).options(
        selectinload(PMPlanned.asset).selectinload(Asset.location))
    if month:
        try:
            date_from, date_to = _month(datetime.strptime(month, "%Y-%m").date())
        except ValueError:
            raise HTTPException(422, "month must be YYYY-MM")
        stmt = stmt.where(PMPlanned.planned_date >= date_from, PMPlanned.planned_date < date_to)
    else:
        if date_from:
            stmt = stmt.where(PMPlanned.planned_date >= date_from)
        if date_to:
            stmt = stmt.where(PMPlanned.planned_date <= date_to)
    if system:
        stmt = stmt.where(Asset.system == system)
    if station:
        stmt = stmt.where(Asset.location_id.in_(
            select(Location.id).where(Location.name == station)))
    if contractor:
        stmt = stmt.where(PMPlanned.contractor == contractor)
    if cycle:
        stmt = stmt.where(PMPlanned.cycle == cycle)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(Asset.code.ilike(like) | Asset.name.ilike(like)
                          | PMPlanned.task.ilike(like) | PMPlanned.source.ilike(like))
    rows = db.scalars(stmt.order_by(PMPlanned.planned_date, Asset.code)).all()
    if reconcile(db, rows):
        db.commit()
    today = date.today()
    if status:
        want = set(status.split(","))
        rows = [p for p in rows if p.status in want or _state(p, today) in want]
    return rows


# ---- reads ------------------------------------------------------------------

@router.get("", response_model=list[PlannedOut])
def list_planned(date_from: date | None = None, date_to: date | None = None,
                 month: str | None = None, system: str | None = None,
                 station: str | None = None, contractor: str | None = None,
                 status: str | None = None, cycle: str | None = None,
                 q: str | None = None,
                 db: Session = Depends(get_db), user=Depends(optional_user)):
    """The schedule, filtered. `status` takes a stored status or a derived
    state (today/upcoming/overdue), comma-separated. Open rows already covered
    by a logged entry are closed on the way out (auto-reconcile)."""
    if is_anonymous(user):
        raise HTTPException(401, "login required")
    rows = _query(db, user, date_from, date_to, month, system, station,
                  contractor, status, cycle, q)
    today = date.today()
    return [_out(p, today) for p in rows]


@router.get("/facets")
def facets(db: Session = Depends(get_db), user=Depends(optional_user)):
    """Values for the inline filter row — only what the schedule actually holds."""
    if is_anonymous(user):
        raise HTTPException(401, "login required")
    rows = db.scalars(_scoped(select(PMPlanned), db, user).options(
        selectinload(PMPlanned.asset).selectinload(Asset.location))).all()
    def uniq(vals):
        return sorted({v for v in vals if v})
    return {
        "systems": uniq(p.asset.system for p in rows),
        "stations": uniq(p.asset.location.name if p.asset.location else None for p in rows),
        "contractors": uniq(p.contractor for p in rows),
        "cycles": sorted(uniq(p.cycle for p in rows), key=lambda c: SCHEDULE_FREQ.get(c, 0)),
        "months": uniq(p.planned_date.strftime("%Y-%m") for p in rows),
    }


@router.get("/summary")
def summary(month: str | None = None, system: str | None = None,
            station: str | None = None,
            db: Session = Depends(get_db), user=Depends(optional_user)):
    """Planned vs done per contractor for a month (default: this month)."""
    if is_anonymous(user):
        raise HTTPException(401, "login required")
    month = month or date.today().strftime("%Y-%m")
    rows = _query(db, user, None, None, month, system, station, None, None, None, None)
    today = date.today()
    by = defaultdict(lambda: defaultdict(int))
    for p in rows:
        k = p.contractor or "—"
        by[k]["planned"] += 1
        by[k][_state(p, today)] += 1
    out = []
    for k, c in sorted(by.items()):
        due = c["planned"] - c["upcoming"] - c["today"] - c["skipped"]
        out.append({"contractor": k, "planned": c["planned"], "done": c["done"],
                    "overdue": c["overdue"], "today": c["today"], "upcoming": c["upcoming"],
                    "skipped": c["skipped"],
                    "compliance": round(100 * c["done"] / due) if due > 0 else None})
    return {"month": month, "contractors": out}


# ---- writes -----------------------------------------------------------------

def _create(db: Session, rows: list[PlannedIn], user) -> dict:
    created, dupes, errors = [], 0, []
    for i, r in enumerate(rows, 1):
        try:
            asset = visible_asset(db, r.asset_code, user, asset_id=r.asset_id)
            cycle = _norm_cycle(r.cycle)
        except HTTPException as exc:
            errors.append({"row": i, "asset_code": r.asset_code, "error": exc.detail})
            continue
        exists = db.scalar(select(PMPlanned.id).where(
            PMPlanned.asset_id == asset.id, PMPlanned.planned_date == r.planned_date,
            PMPlanned.cycle == cycle))
        if exists:
            dupes += 1
            continue
        p = PMPlanned(asset_id=asset.id, line_id=asset.line_id, planned_date=r.planned_date,
                      cycle=cycle, task=(r.task or "").strip() or None,
                      contractor=(r.contractor or "").strip()[:120] or None,
                      source=(r.source or "").strip()[:200] or None,
                      created_by=user.username)
        db.add(p)
        created.append(p)
    db.flush()
    for p in created:
        audit(db, "pm_planned", p.id, "created",
              detail=f"{p.planned_date} {p.cycle} {p.source or ''}".strip(), actor=user.username)
    return {"created": len(created), "duplicates": dupes, "errors": errors}


@router.post("")
def create_planned(rows: list[PlannedIn], db: Session = Depends(get_db),
                   user=Depends(current_writer)):
    """Bulk-add plan rows (a letter's worth). Same asset + date + cycle twice is
    skipped as a duplicate; unknown assets come back as row errors."""
    res = _create(db, rows, user)
    db.commit()
    return res


PLANNED_SAMPLE_CSV = """asset_code,planned_date,cycle,contractor,source,task
TVF-01(PNL),2026-11-20,Monthly,TVS AMC,Letter No. 1638,Monthly PM of tunnel ventilation fan
"""


@router.get("/import/sample")
def import_sample():
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(PLANNED_SAMPLE_CSV, media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=planned-sample.csv"})


@router.post("/import")
async def import_planned(file: UploadFile = File(...), commit: bool = False,
                         db: Session = Depends(get_db), user=Depends(current_writer)):
    """CSV intake (asset_code, planned_date, cycle, contractor, source, task).
    Without commit=1 it is a dry run — nothing is written, the counts and row
    errors come back for review."""
    raw = (await file.read()).decode("utf-8-sig", errors="replace")
    rows, errors = [], []
    for i, rec in enumerate(csv.DictReader(io.StringIO(raw)), 1):
        rec = {(k or "").strip().lower(): (v or "").strip() for k, v in rec.items()}
        try:
            rows.append(PlannedIn(
                asset_code=rec.get("asset_code") or rec.get("asset") or "",
                planned_date=date.fromisoformat(rec.get("planned_date") or rec.get("date") or ""),
                cycle=rec.get("cycle") or rec.get("frequency") or "",
                contractor=rec.get("contractor"), source=rec.get("source"),
                task=rec.get("task")))
        except ValueError as exc:
            errors.append({"row": i, "asset_code": rec.get("asset_code"), "error": str(exc)[:200]})
    res = _create(db, rows, user)
    res["errors"] = errors + res["errors"]
    if commit:
        db.commit()
    else:
        db.rollback()
    res["committed"] = commit
    return res


def _done(db: Session, p: PMPlanned, body: DoneIn, user) -> LogEntry:
    if p.status == "done":
        raise HTTPException(409, f"plan {p.id} is already done")
    if p.status == "skipped":
        raise HTTPException(409, f"plan {p.id} was skipped — reopen it first")
    when = body.done_date or p.planned_date
    if when > date.today():
        raise HTTPException(422, "cannot mark done on a future date")
    text = (body.remarks or "").strip() or (
        f"{p.cycle} maintenance done as planned"
        + (f" by {p.contractor}" if p.contractor else "")
        + (f" ({p.source})" if p.source else ""))
    entry = LogEntryIn(
        log_date=when, shift=body.shift, time=body.time, type="maintenance",
        subtype=p.cycle, system=p.asset.system, text=text, asset_code=p.asset.code,
        attended_by=body.attended_by or p.contractor,
        action_taken=body.action_taken or p.task, consumables=body.consumables,
        checksheet=body.checksheet)
    obj, _ = _add_one(db, entry, user)
    # a code can repeat across stations — pin the entry to the planned asset
    obj.asset = p.asset
    p.status, p.log_entry_id, p.done_on, p.closed_by = "done", obj.id, when, user.username
    db.flush()
    audit(db, "pm_planned", p.id, "done", detail=f"log_entry={obj.id}", actor=user.username)
    return obj


@router.post("/{pid}/done")
def mark_done(pid: int, body: DoneIn | None = None, db: Session = Depends(get_db),
              user=Depends(current_writer)):
    """One click: file the MAINTENANCE log entry and close the plan."""
    p = _get(db, pid, user)
    obj = _done(db, p, body or DoneIn(), user)
    db.commit()
    return {"id": p.id, "log_entry_id": obj.id, "done_on": p.done_on}


@router.post("/done")
def mark_done_bulk(body: BulkDoneIn, db: Session = Depends(get_db),
                   user=Depends(current_writer)):
    """Done ×N. Each row files its own entry on its own planned date unless a
    done_date is given; one bad row does not block the rest."""
    done, errors = [], []
    details = body.model_dump(exclude={"ids"})
    for pid in body.ids:
        try:
            p = _get(db, pid, user)
            with db.begin_nested():
                obj = _done(db, p, DoneIn(**details), user)
            done.append({"id": pid, "log_entry_id": obj.id})
        except HTTPException as exc:
            errors.append({"id": pid, "error": exc.detail})
    db.commit()
    return {"done": done, "errors": errors}


@router.patch("/{pid}")
def update_planned(pid: int, body: PlannedPatch, db: Session = Depends(get_db),
                   user=Depends(current_writer)):
    """Reschedule (new date), skip, or reopen a skipped row. Done rows are
    closed by their log entry — retract that entry instead."""
    p = _get(db, pid, user)
    if p.status == "done":
        raise HTTPException(409, "a done plan is closed by its log entry")
    if body.planned_date and body.planned_date != p.planned_date:
        p.original_date = p.original_date or p.planned_date
        p.planned_date = body.planned_date
        p.status = "rescheduled"
    if body.status:
        if body.status not in ("skipped", "planned"):
            raise HTTPException(422, "status may be set to skipped or planned")
        p.status = ("rescheduled" if body.status == "planned" and p.original_date
                    else body.status)
    if body.note is not None:
        p.note = body.note.strip() or None
    audit(db, "pm_planned", p.id, "updated",
          detail=f"{p.status} {p.planned_date}", actor=user.username)
    db.commit()
    return _out(p, date.today())


@router.delete("/{pid}")
def delete_planned(pid: int, db: Session = Depends(get_db), user=Depends(current_writer)):
    """Remove a mis-entered plan row. Done rows stay — they carry a log entry."""
    p = _get(db, pid, user)
    if p.status == "done":
        raise HTTPException(409, "a done plan cannot be deleted")
    audit(db, "pm_planned", p.id, "deleted",
          detail=f"{p.asset.code} {p.planned_date} {p.cycle}", actor=user.username)
    db.delete(p)
    db.commit()
    return {"deleted": pid}
