# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Preventive-maintenance endpoints — v0.2.1: history-preserving, priority-ranked."""
from collections import defaultdict
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.auth import current_user, optional_user, scope_location_ids
from app.db import audit, get_db
from app.engine import (SCHEDULE_FREQ, build_schedule, next_due, overdue_days,
                        priority_score, summarize_schedule)
from app.models import (Asset, AssetStatus, LogEntry, LogEntryType, PMPlan,
                        PMSchedule, WorkOrder, WorkOrderStatus, WorkOrderType)

router = APIRouter()


class AssetScheduleSummary(BaseModel):
    asset_code: str
    line: str | None = None   # codes repeat across lines — qualify the key
    next_frequency: str | None
    next_due: date | None
    days_left: int | None
    state: str              # ok | due_soon | overdue | long_overdue
    never_done: bool = False  # routine-overdue but never once maintained
    overdue_count: int      # routine (short-cycle) overdue only
    long_overdue_count: int = 0   # 5-Yearly overdue / never started
    last_done: date | None = None   # most recent maintenance across all cycles
    cycles: dict[str, str] = {}     # per-cycle state, e.g. {Monthly: overdue, Yearly: ok}


@router.get("/schedule", response_model=list[AssetScheduleSummary])
def schedule_all(db: Session = Depends(get_db), user=Depends(optional_user)):
    """Per-asset maintenance-schedule health for the register — one grouped pass
    over the log plus any plans. Plan-driven where a plan exists, else inferred
    from the frequencies logged. Scoped to the caller's line like /due."""
    labels = list(SCHEDULE_FREQ)
    log_rows = db.execute(
        select(LogEntry.asset_id, LogEntry.subtype, func.max(LogEntry.log_date))
        .where(LogEntry.type == LogEntryType.MAINTENANCE, LogEntry.subtype.in_(labels),
               LogEntry.asset_id.isnot(None))
        .group_by(LogEntry.asset_id, LogEntry.subtype)).all()
    log_by = defaultdict(dict)
    for aid, sub, d in log_rows:
        if d:
            log_by[aid][sub] = d
    plan_freqs, plan_seeds = defaultdict(set), defaultdict(dict)
    for p in db.scalars(select(PMPlan)).all():
        if p.frequency in SCHEDULE_FREQ:
            plan_freqs[p.asset_id].add(p.frequency)
            if p.last_done_seed:
                plan_seeds[p.asset_id][p.frequency] = p.last_done_seed
    ids = set(log_by) | set(plan_freqs)
    code_by, line_by = {}, {}
    if ids:
        # Decommissioned (gone for good) and spare (held in reserve) assets are
        # not in active service — they must not count as overdue/due in the
        # schedule statistics, even with historical logs.
        for a in db.scalars(select(Asset).where(Asset.id.in_(ids))).all():
            if a.status in (AssetStatus.DECOMMISSIONED, AssetStatus.SPARE):
                continue
            code_by[a.id] = a.code
            line_by[a.id] = a.location.parent.name if a.location and a.location.parent else None
        ids &= set(code_by)
    out = []
    for aid in ids:
        log_dates, seeds = log_by.get(aid, {}), plan_seeds.get(aid, {})
        done = {}
        for f in SCHEDULE_FREQ:
            cands = [d for d in (log_dates.get(f), seeds.get(f)) if d]
            if cands:
                done[f] = max(cands)
        freqs = plan_freqs.get(aid) or set(log_dates)
        if not freqs:
            continue
        sched_rows = build_schedule(freqs, done)
        s = summarize_schedule(sched_rows)
        if s:
            last_done = max((r["last_done"] for r in sched_rows if r["last_done"]), default=None)
            cycles = {r["frequency"]: r["state"] for r in sched_rows}   # per-cycle state matrix
            out.append(AssetScheduleSummary(asset_code=code_by[aid], line=line_by.get(aid),
                                            last_done=last_done, cycles=cycles, **s))
    scope = scope_location_ids(db, user)
    if scope is not None:
        codes = {a.code for a in db.scalars(
            select(Asset).where(Asset.location_id.in_(scope))).all()}
        out = [o for o in out if o.asset_code in codes]
    return out


class PMDueItem(BaseModel):
    schedule_id: int
    asset_code: str
    criticality: str
    task: str
    next_due: date
    overdue_days: int
    priority: int


def due_query(db: Session, horizon_days: int = 0) -> list[PMDueItem]:
    """All PM items due within `horizon_days` of today (0 = due/overdue now),
    ranked by criticality-weighted priority, not date alone."""
    today = date.today()
    items: list[PMDueItem] = []
    for sched in db.scalars(select(PMSchedule)).all():
        due = sched.next_due or next_due(sched.frequency.value, sched.last_done)
        if (due - today).days <= horizon_days:
            asset = db.get(Asset, sched.asset_id)
            od = overdue_days(due, today)
            items.append(PMDueItem(
                schedule_id=sched.id, asset_code=asset.code,
                criticality=asset.criticality.value, task=sched.task,
                next_due=due, overdue_days=od,
                priority=priority_score(asset.criticality.value, od),
            ))
    return sorted(items, key=lambda i: -i.priority)


@router.get("/due", response_model=list[PMDueItem])
def due_list(horizon_days: int = 0, db: Session = Depends(get_db), user=Depends(optional_user)):
    """PM items due/overdue — the daily planning list, highest priority first."""
    items = due_query(db, horizon_days)
    scope = scope_location_ids(db, user)
    if scope is not None:
        codes = {a.code for a in db.scalars(
            select(Asset).where(Asset.location_id.in_(scope))).all()}
        items = [i for i in items if i.asset_code in codes]
    return items


class PMCompletion(BaseModel):
    done_by: str | None = None
    findings: str | None = None


class PMCompleted(BaseModel):
    schedule_id: int
    work_order_id: int
    asset_code: str
    task: str
    next_due: date


@router.post("/complete/{schedule_id}", response_model=PMCompleted)
def complete_pm(schedule_id: int, completion: PMCompletion | None = None,
                db: Session = Depends(get_db), user=Depends(current_user)):
    """Mark a PM task done today. Creates a closed preventive WORK ORDER —
    the asset's history record of who did what and what was found — and
    rolls the due date forward by the task's frequency."""
    sched = db.get(PMSchedule, schedule_id)
    if not sched:
        raise HTTPException(404, "schedule not found")
    completion = completion or PMCompletion()
    now = datetime.utcnow()
    wo = WorkOrder(
        asset_id=sched.asset_id, pm_schedule_id=sched.id,
        type=WorkOrderType.PREVENTIVE, status=WorkOrderStatus.DONE,
        title=f"PM: {sched.task}", findings=completion.findings,
        assigned_to=completion.done_by, opened_at=now, closed_at=now,
    )
    db.add(wo)
    sched.last_done = date.today()
    sched.next_due = next_due(sched.frequency.value, sched.last_done)
    db.flush()
    audit(db, "pm_schedule", sched.id, "completed",
          detail=f"work_order={wo.id}; next_due={sched.next_due}",
          actor=user.username)
    db.commit()
    asset = db.get(Asset, sched.asset_id)
    return PMCompleted(schedule_id=sched.id, work_order_id=wo.id,
                       asset_code=asset.code, task=sched.task,
                       next_due=sched.next_due)
