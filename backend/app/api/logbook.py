# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Digital shift logbook — v0.3.

Replaces the paper/spreadsheet running log a section keeps per shift.
Design rules:
  * APPEND-ONLY: entries are never edited or deleted. A mistake is corrected
    by a new entry with `corrects_id` pointing at the old one — exactly the
    discipline of a bound paper logbook, kept enforceable by software.
  * Optionally tied to an asset (by code), so scanning a QR tag can show
    everything ever logged against that equipment.
"""
import hashlib
import json
import os
import uuid
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.assets import visible_asset
from app.api.auth import AUTH_ON, current_user, current_writer, is_anonymous, optional_user
from app.db import audit, get_db
from app.checksheet_templates import templates_for
from app.models import (Asset, Attachment, LogEntry, LogEntryType, Location,
                        LocationKind, ShiftCode)

# ---- checksheet attachments: scanned sheets / photos / PDFs on local media ----
MEDIA_DIR = os.environ.get("AMPS_MEDIA_DIR", "/app/media")
ATTACH_MAX_BYTES = 8 * 1024 * 1024   # 8 MB post-compression ceiling (client compresses first)
ATTACH_MIME_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
                   "application/pdf": "pdf"}

router = APIRouter()


class LogEntryIn(BaseModel):
    log_date: date                      # the ruler date — backdating is normal
    shift: str = "G"                    # M/E/N/G (R retired from the book)
    type: str = "general"               # maintenance/failure/rectification/general
    subtype: str | None = None          # maintenance frequency (Monthly … Special)
    system: str | None = None           # coarse rollup (auto-filled from the asset)
    category: str | None = None         # asset class under the system (optional)
    time: str | None = None             # optional HH:MM — a single moment, no start/end
    text: str = Field(min_length=3)
    entered_by: str = ""                # ignored on authenticated deployments
    attended_by: str | None = None      # the crew that actually did the work
    consumables: str | None = None      # spares/materials consumed (free text)
    action_taken: str | None = None     # the work done / remarks (old-sheet column)
    # a filled structured checksheet: {template, name, results:[{label,status,reading}]}
    checksheet: dict | None = None
    asset_code: str | None = None
    corrects_id: int | None = None
    # failure rows only: when supply/equipment came back, and the fault class.
    # Omitted (or null) on an open breakdown — downtime stays uncomputed.
    end_date: date | None = None
    end_time: str | None = None
    fault_type: str | None = None
    # rectification rows: the failure entry this work fixes
    rectifies_id: int | None = None
    # Fast path for the common case — a failure written up after it was fixed.
    # Carries a whole second entry (its own date/time/shift/author narrative)
    # so one submit files two immutable rows instead of forcing two trips.
    rectification: "LogEntryIn | None" = None


class LogEntryOut(BaseModel):
    id: int
    at: datetime
    log_date: date
    shift: str
    type: str
    subtype: str | None
    system: str | None
    category: str | None
    text: str
    entered_by: str
    attended_by: str | None
    asset_code: str | None
    asset_name: str | None
    corrects_id: int | None
    rectifies_id: int | None
    # for a RECTIFICATION: the master failure it closes.
    # for a FAILURE resolved by one: the rectification that closed it.
    # both drive the read-only "linked entry" sub-form on the edit screen.
    rectifies: "EntryRef | None" = None
    resolved_by: "EntryRef | None" = None
    # a failure that has been acknowledged (demand raised / mail sent) but not
    # yet fixed — carries the acknowledgement entry; the failure stays "amber"
    acknowledged_by: "EntryRef | None" = None
    # a failure with a job card raised to the OEM/dept — carries it; "yellow".
    # The job card is closed by a later rectification (then state -> resolved).
    job_card_by: "EntryRef | None" = None
    # withdrawn responses kept for the audit trail (shown struck through)
    retracted_responses: "list[EntryRef]" = []
    # failure lifecycle: open | acknowledged | job_card | resolved (None for non-failures)
    state: str | None = None
    ended_at: datetime | None
    fault_type: str | None
    consumables: str | None
    station: str | None = None      # where the work was (station/location)
    action_taken: str | None = None  # the work done, distinct from report/cause
    # a filled structured checksheet attached to this entry, if any
    checksheet: dict | None = None
    # uploaded checksheet scans / photos / PDFs on this entry
    attachments: "list[AttachmentRef]" = []
    depot: str | None = None       # the asset's maintenance depot (SHY/KHG/CPD)
    down_hours: float | None


class AttachmentRef(BaseModel):
    id: int
    filename: str
    mime: str
    size: int
    uploaded_by: str
    uploaded_at: datetime
    url: str | None = None      # set for a link attachment (Drive etc.); file otherwise


class EntryRef(BaseModel):
    id: int
    log_date: date
    at: datetime
    fault_type: str | None
    text: str
    asset_code: str | None
    attended_by: str | None
    entered_by: str | None = None       # who raised it (Issued By, on a job card)
    consumables: str | None
    station: str | None = None
    action_taken: str | None = None
    via_job_card: bool = False
    checksheet: dict | None = None
    type: str | None = None       # the response kind (acknowledgement/job_card/rectification)
    retracted: bool = False       # a withdrawn response, kept for the audit trail
    attachments: "list[AttachmentRef]" = []   # scans/photos on this response (e.g. a job card)


def _attach_map(db: Session, entry_ids) -> dict[int, list["AttachmentRef"]]:
    """entry id -> its active (non-retracted) attachments, newest first."""
    ids = [i for i in entry_ids if i]
    if not ids:
        return {}
    rows = db.scalars(
        select(Attachment).where(Attachment.entry_id.in_(ids),
                                 Attachment.retracted.isnot(True))
        .order_by(Attachment.uploaded_at.desc())).all()
    out: dict[int, list[AttachmentRef]] = {}
    for a in rows:
        out.setdefault(a.entry_id, []).append(AttachmentRef(
            id=a.id, filename=a.filename, mime=a.mime, size=a.size,
            uploaded_by=a.uploaded_by, uploaded_at=a.uploaded_at, url=a.url))
    return out


def _failure_id_to_head(db: Session, entries: list[LogEntry]) -> dict[int, int]:
    """Every failure entry id -> its current head id, by walking corrects_id back
    from each head through the whole failure correction ancestry."""
    heads = [e for e in entries if e.type == LogEntryType.FAILURE]
    id_to_head = {}
    for h in heads:
        cur = h
        seen = set()
        while cur is not None and cur.id not in seen:
            id_to_head[cur.id] = h.id
            seen.add(cur.id)
            cur = db.get(LogEntry, cur.corrects_id) if cur.corrects_id else None
    return id_to_head


def _response_map(db: Session, entries: list[LogEntry],
                  etype: "LogEntryType") -> dict[int, LogEntry]:
    """failure HEAD id -> its LATEST ACTIVE linked response of `etype`.

    A response points at the failure via rectifies_id; editing the failure
    appends a correction (a new head), so we follow the chain and the head
    inherits the response pointed at any entry in its history. Latest dominates.
    RETRACTED responses are excluded here — an un-ticked acknowledgement stops
    counting toward the state but is NOT deleted (see _clear/_retracted_map)."""
    id_to_head = _failure_id_to_head(db, entries)
    if not id_to_head:
        return {}
    rows = db.scalars(
        select(LogEntry).where(LogEntry.rectifies_id.in_(id_to_head.keys()),
                               LogEntry.type == etype,
                               LogEntry.retracted.isnot(True))
        .order_by(LogEntry.at, LogEntry.id)
    ).all()
    out = {}
    for r in rows:                 # later rows overwrite earlier (latest dominates)
        out[id_to_head[r.rectifies_id]] = r
    return out


def _retracted_map(db: Session, entries: list[LogEntry]) -> dict[int, list[LogEntry]]:
    """failure HEAD id -> its RETRACTED responses (audit history — kept, struck).
    These were logged then un-ticked; they stay in the book for the audit trail."""
    id_to_head = _failure_id_to_head(db, entries)
    if not id_to_head:
        return {}
    rows = db.scalars(
        select(LogEntry).where(LogEntry.rectifies_id.in_(id_to_head.keys()),
                               LogEntry.retracted.is_(True))
        .order_by(LogEntry.at, LogEntry.id)
    ).all()
    out: dict[int, list[LogEntry]] = {}
    for r in rows:
        out.setdefault(id_to_head[r.rectifies_id], []).append(r)
    return out


def _drop_superseded(db: Session, rows: list[LogEntry]) -> list[LogEntry]:
    """Keep only current HEAD entries — an edit appends a correction that
    supersedes the old row, so a superseded failure must not be counted (it is
    the same breakdown as its head, and its responses map onto the head)."""
    superseded = set(db.scalars(
        select(LogEntry.corrects_id).where(LogEntry.corrects_id.is_not(None))).all())
    return [e for e in rows if e.id not in superseded]


def _recovery_map(db: Session, entries: list[LogEntry]) -> dict[int, LogEntry]:
    """failure HEAD id -> its latest RECTIFICATION (the entry that resolves it)."""
    return _response_map(db, entries, LogEntryType.RECTIFICATION)


def _ack_map(db: Session, entries: list[LogEntry]) -> dict[int, LogEntry]:
    """failure HEAD id -> its latest ACKNOWLEDGEMENT (noted, not yet resolved)."""
    return _response_map(db, entries, LogEntryType.ACKNOWLEDGEMENT)


def _jobcard_map(db: Session, entries: list[LogEntry]) -> dict[int, LogEntry]:
    """failure HEAD id -> its latest JOB_CARD (raised to OEM, not yet closed)."""
    return _response_map(db, entries, LogEntryType.JOB_CARD)


def _down_hours(e: LogEntry, recovered: datetime | None = None) -> float | None:
    """Downtime in hours, derived from the two timestamps.

    None means "not measurable", which is NOT the same as zero. Most imported
    history carries a failure date with no clock time, so start and end land
    on the same instant — that is a missing measurement, not an instant
    recovery, and averaging it in would flatter the MTTR into meaninglessness.
    Entries logged with real times measure properly.
    """
    end = e.ended_at or recovered
    if e.type != LogEntryType.FAILURE or not end or not e.at:
        return None
    hrs = (end - e.at).total_seconds() / 3600
    return round(hrs, 2) if hrs > 0 else None


def _load_checksheet(raw: str | None) -> dict | None:
    """Parse the stored checksheet JSON; tolerate legacy/bad rows as None."""
    if not raw:
        return None
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) and v.get("results") else None
    except (ValueError, TypeError):
        return None


def _dump_checksheet(cs: dict | None) -> str | None:
    """Serialise a filled checksheet to JSON, keeping only the fields we store."""
    if not cs or not isinstance(cs, dict):
        return None
    results = [
        {"label": str(r.get("label", ""))[:120],
         "status": (r.get("status") or "na"),
         "reading": (str(r.get("reading"))[:60] if r.get("reading") not in (None, "") else None)}
        for r in (cs.get("results") or []) if r.get("label")
    ]
    if not results:
        return None
    return json.dumps({"template": str(cs.get("template", ""))[:80] or None,
                       "name": str(cs.get("name", ""))[:120] or None,
                       "results": results}, ensure_ascii=False)


def _ref(x: LogEntry | None, attach: dict | None = None) -> "EntryRef | None":
    if x is None:
        return None
    return EntryRef(id=x.id, log_date=x.log_date, at=x.at, fault_type=x.fault_type,
                    text=x.text, asset_code=x.asset.code if x.asset else None,
                    attended_by=x.attended_by, entered_by=x.entered_by, consumables=x.consumables,
                    station=x.station or (x.asset.location.name if x.asset and x.asset.location else None),
                    action_taken=x.action_taken, via_job_card=bool(x.via_job_card),
                    checksheet=_load_checksheet(x.checksheet),
                    type=x.type.value, retracted=bool(x.retracted),
                    attachments=(attach or {}).get(x.id, []))


def _to_out(e: LogEntry, resolver: LogEntry | None = None,
            master: LogEntry | None = None,
            acker: LogEntry | None = None,
            jobcard: LogEntry | None = None,
            retracted: list | None = None,
            attach: dict | None = None) -> LogEntryOut:
    recovered = resolver.at if resolver else None
    # lifecycle only applies to a failure head, by dominance of the response:
    # rectification (resolved) > job card (job_card) > acknowledgement > open
    state = None
    if e.type == LogEntryType.FAILURE:
        state = ("resolved" if resolver else "job_card" if jobcard
                 else "acknowledged" if acker else "open")
    return LogEntryOut(
        id=e.id, at=e.at, log_date=e.log_date, shift=e.shift.value,
        type=e.type.value, subtype=e.subtype, system=e.system, category=e.category, text=e.text,
        entered_by=e.entered_by, attended_by=e.attended_by,
        asset_code=e.asset.code if e.asset else None,
        asset_name=e.asset.name if e.asset else None, corrects_id=e.corrects_id,
        rectifies_id=e.rectifies_id,
        rectifies=_ref(master, attach),        # response → its master failure
        resolved_by=_ref(resolver, attach),    # failure → the rectification that closed it
        acknowledged_by=_ref(acker, attach),   # failure → the acknowledgement noting it
        job_card_by=_ref(jobcard, attach),     # failure → the job card raised for it
        retracted_responses=[_ref(x, attach) for x in (retracted or [])],
        state=state,
        # ONLY a rectification ends a failure; ack/job-card leave it open
        ended_at=e.ended_at or recovered, fault_type=e.fault_type,
        consumables=e.consumables,
        station=e.station or (e.asset.location.name if e.asset and e.asset.location else None),
        action_taken=e.action_taken,
        checksheet=_load_checksheet(e.checksheet),
        attachments=(attach or {}).get(e.id, []),
        depot=(e.asset.depot if e.asset else None),
        down_hours=_down_hours(e, recovered),
    )


def _category_of(asset) -> str | None:
    """The asset's class — the entry's equipment category."""
    if not asset:
        return None
    cls = asset.asset_class.name if asset.asset_class else None
    return cls[:80] if cls else None


def _system_of(asset) -> str | None:
    """The asset's system rollup — the entry's coarse equipment tag."""
    return (asset.system[:80] if asset and asset.system else None)


def _latest_open_failure(db: Session, asset_id: int, user) -> LogEntry | None:
    """The asset's most recent still-open failure (current head, not resolved),
    line-scoped — the failure a freshly-issued job card should attach to."""
    q = select(LogEntry).where(LogEntry.type == LogEntryType.FAILURE,
                               LogEntry.asset_id == asset_id)
    if user.line_id is not None:
        q = q.where((LogEntry.line_id == user.line_id) | (LogEntry.line_id.is_(None)))
    heads = _drop_superseded(db, db.scalars(q).all())
    rec = _recovery_map(db, heads)
    opens = [e for e in heads if e.ended_at is None and e.id not in rec]
    return max(opens, key=lambda e: (e.log_date, e.at, e.id)) if opens else None


def _auto_failure_in(resp: LogEntryIn) -> LogEntryIn:
    """The failure implicitly raised when a job card or a rectification is filed
    on an asset that has none open. It INHERITS the response's own details — fault
    class, narrative, crew, date — so the failure carries the real description
    rather than a placeholder. A rectification then closes it at once (failure +
    its fix). The details come straight from the log entry being written."""
    return LogEntryIn(
        log_date=resp.log_date, time=resp.time, shift=resp.shift, type="failure",
        asset_code=resp.asset_code, system=resp.system, category=resp.category,
        fault_type=(resp.fault_type or "").strip() or None,
        attended_by=resp.attended_by,
        text=resp.text,
    )


# responses filed directly that must always hang off a tracked failure
_AUTO_FAILURE_KINDS = (LogEntryType.JOB_CARD, LogEntryType.RECTIFICATION)


@router.post("", response_model=LogEntryOut, status_code=201)
def add_entry(entry: LogEntryIn, db: Session = Depends(get_db), user=Depends(current_writer)):
    obj, rect = _add_one(db, entry, user)
    db.commit()
    db.refresh(obj)
    return _to_out(obj, rect if rect else None)


class BulkIn(BaseModel):
    entries: list[LogEntryIn]


class BulkResult(BaseModel):
    created: int
    failed: int
    errors: list[str]


@router.post("/bulk", response_model=BulkResult)
def bulk_add(body: BulkIn, db: Session = Depends(get_db), user=Depends(current_writer)):
    """Spreadsheet-style bulk entry: create many log rows in one request. Each row
    is committed independently, so one bad row never discards the good ones — the
    failures come back with their row number and reason."""
    created, errors = 0, []
    for i, e in enumerate(body.entries):
        try:
            _add_one(db, e, user)
            db.commit()
            created += 1
        except HTTPException as ex:
            db.rollback()
            errors.append(f"row {i + 1}: {ex.detail}")
        except Exception as ex:  # noqa: BLE001 — surface any per-row failure, keep going
            db.rollback()
            errors.append(f"row {i + 1}: {str(ex)[:140]}")
    return BulkResult(created=created, failed=len(errors), errors=errors[:60])


def _add_one(db: Session, entry: LogEntryIn, user):
    """Create one entry (+ auto failure-link + inline rectification). Flushes but
    does NOT commit — the caller commits (single) or commits per row (bulk)."""
    etype = LogEntryType(entry.type)
    # A job card or a rectification is always tracked against a failure. Filed
    # directly on an asset, it attaches to that asset's open failure; when none is
    # open the failure is raised automatically and the response tagged to it — so
    # neither ever floats free of a failure (invisible to the failure/job-card
    # boards). A rectification with no open failure thus files failure + fix together.
    link_failure = auto_failure = None
    create_in = entry
    if etype in _AUTO_FAILURE_KINDS and entry.asset_code:
        asset = visible_asset(db, entry.asset_code, user)
        if entry.rectifies_id is not None:
            link_failure = db.get(LogEntry, entry.rectifies_id)
            if not link_failure or link_failure.type != LogEntryType.FAILURE:
                raise HTTPException(422, "response target must be a failure")
        else:
            link_failure = _latest_open_failure(db, asset.id, user)
            if link_failure is None:
                auto_failure = _create_entry(db, _auto_failure_in(entry), user)
                link_failure = auto_failure
        # the link is set below by hand so both kinds go through one path
        create_in = entry.model_copy(update={"rectifies_id": None, "rectification": None})

    obj = _create_entry(db, create_in, user)
    if link_failure is not None:
        obj.rectifies_id = link_failure.id
        db.flush()
        audit(db, "log_entry", obj.id, "linked",
              detail=(f"{etype.value}->failure {link_failure.id}"
                      + (" (auto-raised)" if auto_failure else "")), actor=user.username)

    # A failure logged as already-rectified files BOTH rows in one transaction:
    # a half-written breakdown (failure with no fix, or a fix with no failure)
    # is worse than either outcome, so they commit together or not at all.
    rect = None
    if entry.rectification:
        if obj.type != LogEntryType.FAILURE:
            raise HTTPException(422, "only a failure entry can carry a rectification")
        rect_in = entry.rectification.model_copy(update={
            "type": "rectification",
            # the fix belongs to the same equipment even when the form omits it
            "asset_code": entry.rectification.asset_code or entry.asset_code,
            "rectification": None,
        })
        rect = _create_entry(db, rect_in, user, rectifies=obj)
        if rect.at < obj.at:
            raise HTTPException(422, "rectification cannot precede the failure")
    db.flush()
    return obj, rect


def _create_entry(db: Session, entry: LogEntryIn, user, rectifies: LogEntry | None = None) -> LogEntry:
    """Build and stage one log entry. Staged, not committed — the caller owns
    the transaction so a failure and its rectification land together."""
    asset = None
    if entry.asset_code:
        asset = visible_asset(db, entry.asset_code, user)
    if entry.corrects_id is not None:
        target = db.get(LogEntry, entry.corrects_id)
        if not target or (user.line_id is not None and target.line_id not in (user.line_id, None)):
            raise HTTPException(404, "entry to correct not found")
    etype = LogEntryType(entry.type)
    # an explicit rectifies_id lets an OPEN failure be closed later, which the
    # two-row form cannot reach — that entry already exists by then
    target = rectifies
    if target is None and entry.rectifies_id is not None:
        target = db.get(LogEntry, entry.rectifies_id)
        if target is None:
            raise HTTPException(404, "failure to rectify not found")
        if target.type != LogEntryType.FAILURE:
            raise HTTPException(422, "only a failure entry can be rectified")
    if target is not None and etype != LogEntryType.RECTIFICATION:
        raise HTTPException(422, "only a rectification entry can rectify a failure")
    # One date, optional time. `at` anchors the entry to its ruler date so a
    # backdated entry files under its day, not under "now"; midnight = no time
    # given (the UI hides 00:00).
    when = None
    if entry.time:
        try:
            when = datetime.strptime(entry.time, "%H:%M").time()
        except ValueError:
            raise HTTPException(422, "time must be HH:MM")
    at = datetime.combine(entry.log_date, when) if when else datetime.combine(entry.log_date, datetime.min.time())
    # Authorship. On a logged-in deployment the SIGNED-IN user authors the entry;
    # a deliberate override (e.g. a job card's "Issued by") is honoured, but the
    # demo/default sentinel the form sends ("demo.visitor") must NEVER overwrite
    # the real author — that regression mis-attributed every UI entry. On an open
    # deployment the form supplies the name. The audit trail always records the
    # REAL actor (user.username) separately, regardless of this field.
    form_author = (entry.entered_by or "").strip()
    if AUTH_ON:
        author = form_author if (form_author and form_author != "demo.visitor") else user.full_name
    else:
        author = form_author or "unknown"
    # system + category: explicit choice wins; else inherit from the asset
    system = (entry.system or "").strip()[:80] or _system_of(asset)
    category = (entry.category or "").strip()[:80] or _category_of(asset)
    # the shift is whatever the user records — maintenance is no longer forced to
    # night (it happens across shifts). Bad code falls back to General.
    try:
        shift = ShiftCode(entry.shift)
    except ValueError:
        shift = ShiftCode.GENERAL
    # Recovery moment: failure rows only, and never before the start.
    ended_at = None
    if etype == LogEntryType.FAILURE and entry.end_date:
        end_t = None
        if entry.end_time:
            try:
                end_t = datetime.strptime(entry.end_time, "%H:%M").time()
            except ValueError:
                raise HTTPException(422, "end_time must be HH:MM")
        ended_at = datetime.combine(entry.end_date, end_t or datetime.min.time())
        if ended_at < at:
            raise HTTPException(422, "recovery time cannot precede the failure")
    obj = LogEntry(
        at=at, log_date=entry.log_date, shift=shift,
        type=etype, subtype=(entry.subtype or None),
        system=(system or None), category=(category or None), text=entry.text,
        ended_at=ended_at,
        fault_type=((entry.fault_type or "").strip()[:120] or None
                    if etype == LogEntryType.FAILURE else None),
        entered_by=author,
        attended_by=((entry.attended_by or "").strip()[:200] or None),
        consumables=((entry.consumables or "").strip() or None),
        action_taken=((entry.action_taken or "").strip()[:2000] or None),
        checksheet=_dump_checksheet(entry.checksheet),
        asset=asset, corrects_id=entry.corrects_id,
        line_id=user.line_id,  # NULL = department-wide entry (HQ/admin)
    )
    db.add(obj)
    db.flush()
    if target is not None:
        obj.rectifies_id = target.id
        db.flush()
    audit(db, "log_entry", obj.id, "created",
          detail=f"date={obj.log_date} shift={obj.shift.value}"
                 + (f" rectifies={target.id}" if target else ""), actor=user.username)
    return obj


@router.get("", response_model=list[LogEntryOut])
def list_entries(log_date: date | None = None, shift: str | None = None,
                 asset_code: str | None = None, entry_type: str | None = None,
                 category: str | None = None, q: str | None = None,
                 date_from: date | None = None, date_to: date | None = None,
                 line: str | None = None, depot: str | None = None,
                 system: str | None = None, location: str | None = None,
                 limit: int = 200, offset: int = 0, response: Response = None,
                 db: Session = Depends(get_db), user=Depends(optional_user)):
    """The day's log, a shift's log, or one asset's complete logged history.
    Line-scoped users read their line's book plus department-wide entries.
    date_from/date_to bound the week/month/year views.

    Paged: the total row count comes back in X-Total-Count so the caller can
    say "1-100 of 3,966" instead of silently showing a truncated page — a
    year of this book is thousands of entries."""
    # The bulk ledger is login-only; the QR walk-up (a single asset's log,
    # scoped by asset_code) stays open. A single LINE's recent log is also open
    # to anonymous readers (the public per-line dashboard shows it) but capped so
    # it can never pull the whole 18,000-row operational book without a session.
    anon = is_anonymous(user)
    if anon and asset_code is None and not (line and line.strip()):
        raise HTTPException(401, "login required")
    if anon:
        limit = min(limit, 25)
    filters = []
    # An edit is a NEW entry that corrects an older one (append-only). The list
    # shows only the latest version of each chain — the entry it superseded is
    # hidden here but still reachable through /versions, WhatsApp-style.
    superseded = select(LogEntry.corrects_id).where(LogEntry.corrects_id.is_not(None))
    filters.append(LogEntry.id.not_in(superseded))
    if user.line_id is not None:
        filters.append((LogEntry.line_id == user.line_id) | (LogEntry.line_id.is_(None)))
    # depot scope: a depot-scoped account sees its own depot's assets PLUS
    # asset-less line-wide entries (e.g. imported job cards with no matched asset,
    # department notes) — those belong to no depot, so they must not vanish for a
    # depot user. The explicit ?depot= dropdown narrows strictly to that depot.
    if getattr(user, "depot", None):
        filters.append(LogEntry.asset_id.is_(None) | LogEntry.asset_id.in_(
            select(Asset.id).where(Asset.depot == user.depot)))
    if depot and depot.strip():
        filters.append(LogEntry.asset_id.in_(
            select(Asset.id).where(Asset.depot == depot.strip())))
    if line and line.strip():
        site = db.scalar(select(Location).where(Location.kind == LocationKind.SITE,
                                                func.lower(Location.name) == line.strip().lower()))
        if site:
            filters.append(LogEntry.line_id == site.id)
    if log_date:
        filters.append(LogEntry.log_date == log_date)
    if date_from:
        filters.append(LogEntry.log_date >= date_from)
    if date_to:
        filters.append(LogEntry.log_date <= date_to)
    if shift:
        filters.append(LogEntry.shift == ShiftCode(shift))
    if entry_type:
        filters.append(LogEntry.type == LogEntryType(entry_type))
    if category:
        filters.append(LogEntry.category == category)
    # system / location narrow by the linked asset's system and station — mirrors
    # the register's System and Location filters
    if system and system.strip():
        filters.append(LogEntry.asset_id.in_(
            select(Asset.id).where(Asset.system == system.strip())))
    if location and location.strip():
        loc = db.scalar(select(Location).where(
            func.lower(Location.name) == location.strip().lower()))
        if loc:
            filters.append(LogEntry.asset_id.in_(
                select(Asset.id).where(Asset.location_id == loc.id)))
    if q and q.strip():
        # free-text search across the record, crew, fault and system/class —
        # case-insensitive; matches the register's search box behaviour
        like = f"%{q.strip()}%"
        filters.append(
            LogEntry.text.ilike(like) | LogEntry.attended_by.ilike(like)
            | LogEntry.entered_by.ilike(like) | LogEntry.fault_type.ilike(like)
            | LogEntry.system.ilike(like) | LogEntry.category.ilike(like))
    if asset_code:
        asset = visible_asset(db, asset_code, user)
        filters.append(LogEntry.asset_id == asset.id)

    if response is not None:
        total = db.scalar(select(func.count()).select_from(LogEntry).where(*filters))
        response.headers["X-Total-Count"] = str(total)
        response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"

    q = (select(LogEntry).where(*filters)
         .order_by(LogEntry.log_date.desc(), LogEntry.at.desc(), LogEntry.id.desc())
         .offset(max(offset, 0)).limit(min(limit, 6000)))
    rows = db.scalars(q).all()
    rec = _recovery_map(db, rows)
    ack = _ack_map(db, rows)
    jc = _jobcard_map(db, rows)
    rt = _retracted_map(db, rows)
    # the master failure each response (rectification/ack/job-card) responds to —
    # for the edit sub-form and for grouping a response under its failure
    master_ids = {e.rectifies_id for e in rows if e.rectifies_id}
    masters = {}
    if master_ids:
        masters = {m.id: m for m in db.scalars(
            select(LogEntry).where(LogEntry.id.in_(master_ids))).all()}
    # attachments for the entries AND for every linked response shown on them
    att_ids = {e.id for e in rows}
    for m in (rec, ack, jc):
        att_ids |= {v.id for v in m.values()}
    att_ids |= {x.id for lst in rt.values() for x in lst}
    attach = _attach_map(db, att_ids)
    return [_to_out(e, rec.get(e.id), masters.get(e.rectifies_id), ack.get(e.id), jc.get(e.id), rt.get(e.id), attach) for e in rows]


@router.get("/{entry_id}/versions", response_model=list[LogEntryOut])
def entry_versions(entry_id: int, db: Session = Depends(get_db), user=Depends(current_user)):
    """The full edit trail of one entry, oldest first — the original and every
    correction made to it. Nothing is ever overwritten, so this is the honest
    history behind the 'edited' marker."""
    e = db.get(LogEntry, entry_id)
    if not e or (user.line_id is not None and e.line_id not in (user.line_id, None)):
        raise HTTPException(404, "entry not found")
    # walk up to the original, then forward through every correction
    root = e
    seen = {e.id}
    while root.corrects_id:
        prev = db.get(LogEntry, root.corrects_id)
        if not prev or prev.id in seen:
            break
        seen.add(prev.id); root = prev
    chain = [root]
    cur = root
    while True:
        nxt = db.scalar(select(LogEntry).where(LogEntry.corrects_id == cur.id))
        if not nxt or nxt.id in {c.id for c in chain}:
            break
        chain.append(nxt); cur = nxt
    rec = _recovery_map(db, chain)
    ack = _ack_map(db, chain)
    jc = _jobcard_map(db, chain)
    rt = _retracted_map(db, chain)
    return [_to_out(x, rec.get(x.id), None, ack.get(x.id), jc.get(x.id), rt.get(x.id)) for x in chain]


class RectificationIn(BaseModel):
    date: date
    time: str | None = None
    text: str = ""
    fault_type: str | None = None
    attended_by: str | None = None
    consumables: str | None = None
    via_job_card: bool = False   # the fix was carried out by the agency under a job card
    checksheet: dict | None = None  # a structured checksheet for the fix / job card


class ResolutionIn(BaseModel):
    """The FULL desired response state of a failure, reconciled in one call.

    Two independent axes:
    - `acknowledged` (a checkbox flag) + its `ack` note — noted / demand raised.
    - `progress`: open | job_card | rectified — how far the FIX has got, with its
      `detail`. RECTIFIED is terminal: it resolves the failure and clears the
      acknowledgement (a fixed failure needs no ack)."""
    acknowledged: bool = False
    ack: RectificationIn | None = None
    progress: str = "open"                 # open | job_card | rectified
    detail: RectificationIn | None = None


_RESP_PREFIX = {
    LogEntryType.RECTIFICATION: ("[RECTIFICATION] ", "Rectified"),
    LogEntryType.ACKNOWLEDGEMENT: ("[ACKNOWLEDGEMENT] ", "Acknowledged"),
    LogEntryType.JOB_CARD: ("[JOB CARD] ", "Job card issued"),
}


def _scope_ok(user, e: LogEntry) -> bool:
    return user.line_id is None or e.line_id in (user.line_id, None)


def _at_of(fail: LogEntry, r: "RectificationIn") -> datetime:
    when = None
    if r.time:
        try:
            when = datetime.strptime(r.time, "%H:%M").time()
        except ValueError:
            raise HTTPException(422, "time must be HH:MM")
    at = datetime.combine(r.date, when or datetime.min.time())
    if at < fail.at:
        raise HTTPException(422, "the response cannot precede the failure")
    return at


@router.put("/{failure_id}/resolution", response_model=LogEntryOut)
def set_resolution(failure_id: int, body: ResolutionIn,
                   db: Session = Depends(get_db), user=Depends(current_writer)):
    """Reconcile a failure's whole response state from the two-axis edit form.

    Acknowledged is an independent flag; progress (open/job_card/rectified) is the
    fix axis. The failure head never carries ended_at — resolution lives on the
    linked rectification. Dominance rectification > job_card > acknowledgement >
    open still derives the displayed state."""
    fail = db.get(LogEntry, failure_id)
    if not fail or fail.type != LogEntryType.FAILURE or not _scope_ok(user, fail):
        raise HTTPException(404, "failure not found")
    if body.progress not in ("open", "job_card", "rectified"):
        raise HTTPException(422, f"unknown progress '{body.progress}'")
    # A response may have been logged against an EARLIER version of this failure:
    # editing a failure appends a correction (new head), and its ack/job-card/fix
    # keep pointing at the old id. Collect the whole correction chain so we find
    # and reconcile those responses instead of orphaning them into duplicates.
    chain_ids, cur, seen = set(), fail, set()
    while cur is not None and cur.id not in seen:
        chain_ids.add(cur.id); seen.add(cur.id)
        cur = db.get(LogEntry, cur.corrects_id) if cur.corrects_id else None
    # only the ACTIVE (non-retracted) responses are the current state; retracted
    # ones stay in the book as audit history and are never touched here
    linked = db.scalars(
        select(LogEntry).where(LogEntry.rectifies_id.in_(chain_ids),
                               LogEntry.retracted.isnot(True))
        .order_by(LogEntry.at.desc(), LogEntry.id.desc())).all()
    by_type = {t: [e for e in linked if e.type == t] for t in (
        LogEntryType.RECTIFICATION, LogEntryType.JOB_CARD, LogEntryType.ACKNOWLEDGEMENT)}

    def _clear(t):
        # AUDIT-SAFE: withdraw by RETRACTING, never deleting — the log stays.
        for e in by_type[t]:
            e.retracted = True
        by_type[t] = []

    def _upsert(t, r: "RectificationIn"):
        is_rect = t == LogEntryType.RECTIFICATION
        prefix, default_text = _RESP_PREFIX[t]
        at = _at_of(fail, r)
        text = prefix + (r.text.strip() or default_text)
        existing = by_type[t]
        if existing:
            resp = existing[0]
            resp.at, resp.log_date, resp.text = at, r.date, text
            resp.fault_type = (r.fault_type or fail.fault_type)
            resp.attended_by = r.attended_by or None
            resp.consumables = (r.consumables or None) if is_rect else None
            resp.via_job_card = bool(r.via_job_card) if is_rect else None
            resp.checksheet = _dump_checksheet(r.checksheet)
            resp.retracted = None   # editing an active response keeps it active
            for extra in existing[1:]:
                extra.retracted = True   # older duplicates: retract, don't delete
        else:
            db.add(LogEntry(
                at=at, log_date=r.date, shift=ShiftCode.GENERAL, type=t,
                system=fail.system, category=fail.category,
                fault_type=(r.fault_type or fail.fault_type), text=text,
                entered_by=user.username, attended_by=r.attended_by or None,
                consumables=(r.consumables or None) if is_rect else None,
                via_job_card=bool(r.via_job_card) if is_rect else None,
                checksheet=_dump_checksheet(r.checksheet),
                rectifies_id=fail.id, asset_id=fail.asset_id, line_id=fail.line_id))

    # The three response logs are INDEPENDENT and coexist as history, with STATE
    # TRANSITION RULES that make each an immutable fact once logged:
    #   • Acknowledgement is SET-ONCE — it can never be un-ticked.
    #   • A RECTIFICATION is TERMINAL — once fixed it cannot be reverted/changed.
    #   • An issued JOB CARD only moves FORWARD to rectified, never back to open.
    #     It is kept when rectified: if the fix came from the agency the job card
    #     is fulfilled; if we did it ourselves (agency delayed) the job card reads
    #     "ignored/delayed" — derived from the rectification's via_job_card flag.
    existing_ack = next(iter(by_type[LogEntryType.ACKNOWLEDGEMENT]), None)
    existing_rect = next(iter(by_type[LogEntryType.RECTIFICATION]), None)
    existing_job = next(iter(by_type[LogEntryType.JOB_CARD]), None)

    # Acknowledgement — add or (harmlessly) refresh; NEVER clear a logged one.
    if body.acknowledged:
        if not body.ack:
            raise HTTPException(422, "an acknowledgement needs its note")
        _upsert(LogEntryType.ACKNOWLEDGEMENT, body.ack)
    elif existing_ack:
        raise HTTPException(409, "an acknowledgement is a logged fact — it cannot be withdrawn")

    # Progress — forward only; rectified terminal.
    if existing_rect:
        # terminal: keep it. Allow editing only the rectification's own detail.
        if body.progress == "rectified" and body.detail:
            _upsert(LogEntryType.RECTIFICATION, body.detail)
        elif body.progress != "rectified":
            raise HTTPException(409, "a rectified failure is final — it cannot be changed")
    elif body.progress == "rectified":
        if not body.detail:
            raise HTTPException(422, "a rectified failure needs the fix detail")
        _upsert(LogEntryType.RECTIFICATION, body.detail)  # any job card is kept
    elif body.progress == "job_card":
        if not body.detail:
            raise HTTPException(422, "a job card needs its detail")
        _upsert(LogEntryType.JOB_CARD, body.detail)
    elif existing_job:  # progress=open but a job card was already issued
        raise HTTPException(409, "an issued job card cannot be reverted to open")
    # else: open and never job-carded — nothing to record

    db.flush()
    audit(db, "log_entry", fail.id, "response-set",
          detail=f"ack={body.acknowledged} progress={body.progress}", actor=user.username)
    db.commit(); db.refresh(fail)
    rec = _recovery_map(db, [fail]); ack = _ack_map(db, [fail])
    jc = _jobcard_map(db, [fail]); rt = _retracted_map(db, [fail])
    return _to_out(fail, rec.get(fail.id), None, ack.get(fail.id), jc.get(fail.id), rt.get(fail.id))


@router.get("/bounds")
def logbook_bounds(db: Session = Depends(get_db), user=Depends(current_user)):
    """First and last dates the book actually covers.

    The week/month/year views anchor on the newest recorded date rather than
    on today: imported history can end months back, and anchoring on the
    calendar would open the book on an empty window."""
    from sqlalchemy import func

    q = select(func.min(LogEntry.log_date), func.max(LogEntry.log_date))
    if user.line_id is not None:
        q = q.where((LogEntry.line_id == user.line_id) | (LogEntry.line_id.is_(None)))
    first, last = db.execute(q).one()
    return {"first": first, "last": last}


@router.get("/failure-stats")
def failure_stats(days: int = 90, months: int = 6, line: str | None = None,
                  db: Session = Depends(get_db), user=Depends(optional_user)):
    """Breakdown KPIs off the one ledger — counts, downtime, MTTR, trend.

    Public (walk-up) surface: the aggregate figures and charts are open, but the
    detailed open-item list (fault text, crew) is only returned when signed in.
    Every figure is derived from failure log entries: nothing is stored
    pre-aggregated, so the tiles can never drift from the book."""
    from collections import Counter

    q = select(LogEntry).where(LogEntry.type == LogEntryType.FAILURE)
    if user.line_id is not None:
        q = q.where((LogEntry.line_id == user.line_id) | (LogEntry.line_id.is_(None)))
    if getattr(user, "depot", None):   # depot's assets + asset-less line-wide entries
        q = q.where(LogEntry.asset_id.is_(None) | LogEntry.asset_id.in_(
            select(Asset.id).where(Asset.depot == user.depot)))
    # optional public line filter: the walk-up failures board scopes to one line
    # so each line shows its own KPIs instead of the network total. Ignored when
    # it names a line the caller isn't already scoped to nothing.
    if line and line.strip():
        site = db.scalar(select(Location).where(Location.kind == LocationKind.SITE,
                                                func.lower(Location.name) == line.strip().lower()))
        if site:
            q = q.where(LogEntry.line_id == site.id)
    rows = _drop_superseded(db, db.scalars(q).all())   # count current heads only
    rec = _recovery_map(db, rows)
    ack = _ack_map(db, rows)
    jc = _jobcard_map(db, rows)
    recov_at = lambda e: (rec[e.id].at if e.id in rec else None)
    def _end(e):
        return e.ended_at or recov_at(e)

    today = date.today()
    window = today - timedelta(days=days)
    recent = [e for e in rows if e.log_date >= window]
    closed = [e for e in recent if _end(e) is not None]
    # only entries with real clock times can contribute to a duration figure
    measured = [e for e in recent if _down_hours(e, recov_at(e)) is not None]
    down = [_down_hours(e, recov_at(e)) for e in measured]
    # A breakdown still NEEDS ATTENTION when it names an asset and has no
    # rectification. Imported rows whose asset code never matched the register
    # are a data-quality problem, not outstanding work, so they are excluded.
    # Among the outstanding, by dominance: job card (yellow) > acknowledged
    # (amber) > open (red).
    outstanding = [e for e in rows if _end(e) is None and e.asset_id is not None]
    job_carded = [e for e in outstanding if e.id in jc]
    acknowledged = [e for e in outstanding if e.id not in jc and e.id in ack]
    open_now = [e for e in outstanding if e.id not in jc and e.id not in ack]
    unlinked = [e for e in rows if e.asset_id is None]

    # trend: failures per calendar month, oldest first, `months` buckets
    buckets: list[dict] = []
    y, m = today.year, today.month
    keys = []
    for _ in range(months):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    per_month = Counter(e.log_date.strftime("%Y-%m") for e in rows)
    for k in reversed(keys):
        buckets.append({"month": k, "count": per_month.get(k, 0)})

    by_class = Counter((e.category or "Unclassified") for e in recent)
    by_fault = Counter(e.fault_type for e in recent if e.fault_type)
    # repeat offenders: which equipment actually keeps failing
    by_asset = Counter(e.asset.code for e in recent if e.asset)
    # open breakdowns per line — the walk-up "all lines at a glance" board needs
    # a per-line open count; it is an aggregate number (no fault text/crew), so
    # it stays public. Line = the asset's parent site in the location tree.
    def _line_of(e):
        loc = e.asset.location if e.asset else None
        return (loc.parent.name if loc and loc.parent else None)
    # per-line breakdown counts both still-needs-attention states (open + ack)
    by_line_open = Counter(ln for ln in (_line_of(e) for e in outstanding) if ln)

    return {
        "days": days,
        "total": len(recent),
        "all_time": len(rows),
        "open": len(open_now),
        "acknowledged": len(acknowledged),
        "job_card": len(job_carded),
        "outstanding": len(outstanding),
        "unlinked": len(unlinked),
        "downtime_hours": round(sum(down), 1) if down else 0.0,
        "mttr_hours": round(sum(down) / len(down), 2) if down else None,
        "longest_hours": round(max(down), 2) if down else None,
        "closed": len(closed),
        # how many of the closed failures actually carry a measurable duration:
        # the UI needs this to say "based on N records" instead of implying
        # the MTTR speaks for every failure in the window
        "measured": len(measured),
        "unmeasured": len(closed) - len(measured),
        "unclosed_in_window": len(recent) - len(closed),
        "per_month": buckets,
        "by_class": [{"name": k, "count": v} for k, v in by_class.most_common(6)],
        "by_fault": [{"name": k, "count": v} for k, v in by_fault.most_common(6)],
        "by_asset": [{"name": k, "count": v} for k, v in by_asset.most_common(6)],
        # public per-line open count for the all-lines landing board
        "by_line_open": {k: v for k, v in by_line_open.items()},
        # the detailed open list (fault text, crew) is signed-in only; a public
        # walk-up sees the aggregate figures and charts, not the row detail.
        "open_items": ([] if is_anonymous(user) else [
            {"id": e.id, "asset_code": e.asset.code if e.asset else None,
             "log_date": e.log_date, "text": e.text[:160]}
            for e in sorted(open_now, key=lambda x: x.log_date, reverse=True)[:10]
        ]),
    }


@router.get("/open-failures-by-asset")
def open_failures_by_asset(db: Session = Depends(get_db), user=Depends(optional_user)):
    """{asset_code: {open, ack, jobcard, acknowledged, rectified, failure_id,
    failure_date}} — a public aggregate (counts only, no fault text/crew) so the
    register can flag faulty assets and offer quick acknowledge/rectify actions.

    A failure is OUTSTANDING until a RECTIFICATION closes it — acknowledgement
    and job card are independent flags that do NOT resolve it. So each asset
    reports two flags: `acknowledged` (some outstanding failure has an ack or
    job card) and — always false here since resolved ones are excluded —
    `rectified`. `failure_id`/`failure_date` point at the latest outstanding
    failure so a quick action can deep-link straight to it.
    Line-scoped like the rest of the failures surface."""
    q = select(LogEntry).where(LogEntry.type == LogEntryType.FAILURE)
    if user.line_id is not None:
        q = q.where((LogEntry.line_id == user.line_id) | (LogEntry.line_id.is_(None)))
    if getattr(user, "depot", None):
        q = q.where(LogEntry.asset_id.in_(select(Asset.id).where(Asset.depot == user.depot)))
    rows = _drop_superseded(db, db.scalars(q).all())   # current heads only
    rec = _recovery_map(db, rows)
    ack = _ack_map(db, rows)
    jc = _jobcard_map(db, rows)
    out: dict[str, dict] = {}
    for e in rows:
        if e.asset is None or e.ended_at is not None or e.id in rec:
            continue  # no asset, or resolved -> not outstanding
        # codes repeat across lines, so KEY BY line|code — an anonymous (unscoped)
        # viewer must not see a Blue asset's job card on the Green asset with the
        # same code. The frontend looks up by the same line|code key.
        loc = e.asset.location
        line = loc.parent.name if loc and loc.parent else ""
        key = f"{line}|{e.asset.code}"
        slot = out.setdefault(key, {
            "open": 0, "ack": 0, "jobcard": 0, "acknowledged": False,
            "rectified": False, "failure_id": None, "failure_date": None})
        is_ack, is_jc = e.id in ack, e.id in jc
        slot["jobcard" if is_jc else "ack" if is_ack else "open"] += 1
        if is_ack or is_jc:
            slot["acknowledged"] = True
        # keep the most recent outstanding failure for the deep-link target
        if slot["failure_date"] is None or e.log_date >= slot["failure_date"]:
            slot["failure_id"] = e.id
            slot["failure_date"] = e.log_date
    return out


# ---- bulk history import: scattered sheet logbooks -> one digital book ----
# One row = one entry, dated by a single `date`. Columns:
#   kind,date,type,group,asset_id,station,location,equipment,fault_type,
#   details,action_taken,consumables,attended_by,resolved_on,
#   closes_failure_ref,reported_by,repercussion
# kind is one of: maintenance | failure | rectification | general.
#  - maintenance takes its cycle from the type word (advances the schedule).
#  - failure: fill `resolved_on` once restored (blank = still open) + fault_type.
#    A failure never self-resolves — if resolved_on is given, its `action_taken`
#    is filed as a SEPARATE rectification that closes it (two-part everywhere).
#  - rectification: `closes_failure_ref` links it to the failure it fixes
#    ("ASSET@YYYY-MM-DD", "ASSET", "YYYY-MM-DD", or a failure id). If it matches
#    no open failure (or is blank), the rectification stands on its own — a
#    proactive/suo-moto fix or modification, recorded but not closing anything.
# `start`/`end` are still accepted as aliases for date/resolved_on (older sheets).
# Rows whose asset isn't in the register still import (the code is kept in the
# text). Duplicate-safe by content.

import csv as _csv
import io as _io

from fastapi import Request, Response
from sqlalchemy.exc import SQLAlchemyError

LOG_SAMPLE_CSV = """kind,date,type,group,asset_id,station,location,equipment,fault_type,details,action_taken,consumables,attended_by,resolved_on,closes_failure_ref,reported_by,repercussion
maintenance,2026-01-05,YEARLY MAINTENANCE,HT,B2HB11,Baranagar,TSS/ASS,VCB,,Maintenance done,,,PS Staff,,,,
failure,2026-02-10 14:30,FAILURE,HT,B2HB11,Baranagar,TSS/ASS,VCB,Communication fault,Failure of operation from SCADA,,,,PS Staff,,,TPC,Supply fed from standby
acknowledgement,2026-02-10 16:00,ACKNOWLEDGEMENT,HT,B2HB11,Baranagar,TSS/ASS,VCB,Communication fault,Comm card not available. Demand raised; mail sent to stores,,,PS Staff,,B2HB11@2026-02-10,,
job_card,2026-02-11 09:00,JOB CARD,HT,B2HB11,Baranagar,TSS/ASS,VCB,Communication fault,Job card issued to M/s Siemens to replace the comm card,,,PS Staff,,B2HB11@2026-02-10,,
rectification,2026-02-12 10:00,RECTIFICATION,HT,B2HB11,Baranagar,TSS/ASS,VCB,Communication fault,Faulty comm card replaced and re-tested,SCADA link verified,1× spare card; 2× PT fuse,PS Staff,2026-02-12 12:30,B2HB11@2026-02-10,,
general,2026-03-01,NOTE,HT,B2HB11,Baranagar,TSS/ASS,VCB,,Panel cleaned and inspected during patrol,,,PS Staff,,,,
"""


@router.get("/import/sample")
def logbook_import_sample():
    """The standard logbook template — maintenance and failure rows, any line."""
    return Response(LOG_SAMPLE_CSV, media_type="text/csv", headers={
        "Content-Disposition": 'attachment; filename="amps-logbook-sample.csv"'})


@router.get("/checksheet-templates")
def checksheet_templates(applies_to: str | None = None, asset_class: str | None = None,
                         subtype: str | None = None, user=Depends(optional_user)):
    """Predefined checksheet templates for a context (kind + asset class + freq).
    A writer picks one when logging maintenance / a job card, then ticks its
    items; the filled result is stored on the entry. Public read (no records)."""
    return templates_for(applies_to, asset_class, subtype)


# ---- checksheet attachments (scanned sheets / photos / PDFs) ----------------

@router.post("/{entry_id}/attachments", response_model=AttachmentRef, status_code=201)
async def upload_attachment(entry_id: int, file: UploadFile,
                            db: Session = Depends(get_db), user=Depends(current_writer)):
    """Attach a scanned checksheet / photo / PDF to a log entry (maintenance,
    job card, rectification …). The file is compressed client-side; we store the
    bytes on the local media disk and record metadata. sha256 dedups a re-upload
    of the same file to the same entry."""
    entry = db.get(LogEntry, entry_id)
    if not entry or (user.line_id is not None and entry.line_id not in (user.line_id, None)):
        raise HTTPException(404, "entry not found")
    ext = ATTACH_MIME_EXT.get(file.content_type or "")
    if not ext:
        raise HTTPException(422, "only JPEG / PNG / WebP images or PDF are accepted")
    data = await file.read()
    if not data:
        raise HTTPException(422, "empty file")
    if len(data) > ATTACH_MAX_BYTES:
        raise HTTPException(413, f"file too large ({len(data)//1024} KB) — compress or photograph the sheet instead")
    digest = hashlib.sha256(data).hexdigest()
    dup = db.scalar(select(Attachment).where(
        Attachment.entry_id == entry_id, Attachment.sha256 == digest,
        Attachment.retracted.isnot(True)))
    if dup:   # same file already on this entry — return the existing record
        return AttachmentRef(id=dup.id, filename=dup.filename, mime=dup.mime,
                             size=dup.size, uploaded_by=dup.uploaded_by, uploaded_at=dup.uploaded_at)
    sub = datetime.utcnow().strftime("%Y%m")
    os.makedirs(os.path.join(MEDIA_DIR, sub), exist_ok=True)
    stored = f"{sub}/{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(MEDIA_DIR, stored), "wb") as f:
        f.write(data)
    att = Attachment(
        entry_id=entry_id, filename=(file.filename or f"checksheet.{ext}")[:200],
        stored_name=stored, mime=file.content_type, size=len(data),
        sha256=digest, uploaded_by=user.username)
    db.add(att); db.flush()
    audit(db, "attachment", att.id, "uploaded",
          detail=f"entry={entry_id} {att.filename} {att.size}B", actor=user.username)
    db.commit(); db.refresh(att)
    return AttachmentRef(id=att.id, filename=att.filename, mime=att.mime,
                         size=att.size, uploaded_by=att.uploaded_by, uploaded_at=att.uploaded_at)


class AttachmentLinkIn(BaseModel):
    url: str
    filename: str | None = None


@router.post("/{entry_id}/attachments/link", response_model=AttachmentRef, status_code=201)
def attach_link(entry_id: int, body: AttachmentLinkIn,
                db: Session = Depends(get_db), user=Depends(current_writer)):
    """Attach a LINK (e.g. a Google Drive checksheet) to a log entry instead of
    uploading the file — the coordinator keeps the sheet in Drive and records its
    URL. No bytes are stored; sha256 of the URL dedups the same link on an entry."""
    entry = db.get(LogEntry, entry_id)
    if not entry or (user.line_id is not None and entry.line_id not in (user.line_id, None)):
        raise HTTPException(404, "entry not found")
    url = (body.url or "").strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(422, "a link must be a full http(s) URL")
    url = url[:600]
    digest = hashlib.sha256(url.encode()).hexdigest()
    dup = db.scalar(select(Attachment).where(
        Attachment.entry_id == entry_id, Attachment.sha256 == digest,
        Attachment.retracted.isnot(True)))
    if dup:
        return AttachmentRef(id=dup.id, filename=dup.filename, mime=dup.mime, size=dup.size,
                             uploaded_by=dup.uploaded_by, uploaded_at=dup.uploaded_at, url=dup.url)
    name = (body.filename or "").strip()[:200] or (
        "Drive checksheet" if "drive.google" in url or "docs.google" in url else "Linked checksheet")
    att = Attachment(entry_id=entry_id, filename=name, stored_name="", mime="link",
                     size=0, sha256=digest, uploaded_by=user.username, url=url)
    db.add(att); db.flush()
    audit(db, "attachment", att.id, "linked", detail=f"entry={entry_id} {url[:80]}", actor=user.username)
    db.commit(); db.refresh(att)
    return AttachmentRef(id=att.id, filename=att.filename, mime=att.mime, size=att.size,
                         uploaded_by=att.uploaded_by, uploaded_at=att.uploaded_at, url=att.url)


@router.get("/attachments/{att_id}")
def get_attachment(att_id: int, db: Session = Depends(get_db), user=Depends(optional_user)):
    """Stream an attachment's bytes (or redirect to a link attachment). Login-gated
    (operational) and line-scoped; a single-asset QR walk-up may still view its own
    asset's attachments."""
    att = db.get(Attachment, att_id)
    if not att or att.retracted:
        raise HTTPException(404, "attachment not found")
    entry = db.get(LogEntry, att.entry_id)
    if is_anonymous(user) and not (entry and entry.asset_id):
        raise HTTPException(401, "login required")
    if user.line_id is not None and entry and entry.line_id not in (user.line_id, None):
        raise HTTPException(404, "attachment not found")
    if att.url:   # a link attachment — send the viewer to it
        return RedirectResponse(att.url)
    path = os.path.join(MEDIA_DIR, att.stored_name)
    if not os.path.exists(path):
        raise HTTPException(410, "file missing from media store")
    # Photos and PDFs open in the browser (inline) so a job-card scan is visible
    # right where it's linked; anything else downloads.
    disp = "inline" if (att.mime.startswith("image/") or att.mime == "application/pdf") else "attachment"
    return FileResponse(path, media_type=att.mime, filename=att.filename,
                        content_disposition_type=disp)


@router.delete("/attachments/{att_id}", status_code=204)
def delete_attachment(att_id: int, db: Session = Depends(get_db), user=Depends(current_writer)):
    """Withdraw an attachment — audit-safe: the row + file are kept, flagged out."""
    att = db.get(Attachment, att_id)
    if not att or att.retracted:
        raise HTTPException(404, "attachment not found")
    entry = db.get(LogEntry, att.entry_id)
    if user.line_id is not None and entry and entry.line_id not in (user.line_id, None):
        raise HTTPException(404, "attachment not found")
    att.retracted = True
    audit(db, "attachment", att.id, "retracted", detail=f"entry={att.entry_id}", actor=user.username)
    db.commit()
    return Response(status_code=204)


# the logbook 'kind' cell → entry type; blank/unknown defaults to maintenance
_KIND_TYPE = {
    "maintenance": LogEntryType.MAINTENANCE,
    "failure": LogEntryType.FAILURE,
    "rectification": LogEntryType.RECTIFICATION,
    "acknowledgement": LogEntryType.ACKNOWLEDGEMENT,
    "acknowledgment": LogEntryType.ACKNOWLEDGEMENT,
    "job_card": LogEntryType.JOB_CARD,
    "job card": LogEntryType.JOB_CARD,
    "jobcard": LogEntryType.JOB_CARD,
    "general": LogEntryType.GENERAL,
}


def _maint_subtype(type_text: str) -> str | None:
    """Maintenance frequency from a sheet TYPE cell — 'HALF' before 'YEARLY'."""
    t = (type_text or "").upper()
    if "HALF" in t: return "Half-Yearly"
    if "QUARTER" in t: return "Quarterly"
    # 'MONTH' before 'WEEK' so a 'Weekly & Monthly' cell reads as the longer
    # (monthly) cycle it fulfils; a plain 'Weekly' falls through to Weekly.
    if "MONTH" in t: return "Monthly"
    if "WEEK" in t: return "Weekly"
    if "YEAR" in t: return "Yearly"
    if "MAINT" in t or "TESTING" in t: return "Special"
    return None


def _parse_dt(s: str) -> datetime | None:
    s = (s or "").strip()
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _resolve_failure_ref(db: Session, ref: str, row_asset):
    """Find the OPEN failure a rectification closes, from a sheet reference.

    Accepts: a failure id ('#123' or '123'), 'ASSET@YYYY-MM-DD', 'ASSET',
    or 'YYYY-MM-DD' (asset then taken from the rectification's own row).
    Matches the asset's open failure (ended_at NULL) on that date, else its
    most recent open failure. Returns the LogEntry or None."""
    ref = (ref or "").strip()
    if not ref:
        return None
    # the session is autoflush=False, so a failure added earlier in THIS import
    # isn't queryable until flushed — do it so a failure+fix in one file links.
    db.flush()
    # a bare failure id
    bare = ref.lstrip("#")
    if bare.isdigit():
        f = db.get(LogEntry, int(bare))
        return f if f and f.type == LogEntryType.FAILURE else None
    code, _, date_s = ref.partition("@")
    code = code.strip()
    date_s = date_s.strip()
    # if the left side looks like a date and there's no '@', it IS the date
    if not date_s and _parse_dt(code):
        date_s, code = code, ""
    asset = None
    if code:
        asset = db.scalar(select(Asset).where(Asset.code == code))
    asset = asset or row_asset
    if asset is None:
        return None
    q = (select(LogEntry).where(LogEntry.asset_id == asset.id,
                                LogEntry.type == LogEntryType.FAILURE,
                                LogEntry.ended_at.is_(None))
         .order_by(LogEntry.log_date.desc(), LogEntry.id.desc()))
    open_fails = db.scalars(q).all()
    if not open_fails:
        return None
    d = _parse_dt(date_s)
    if d:
        for f in open_fails:
            if f.log_date == d.date():
                return f
    return open_fails[0]   # latest open failure


class LogImportOut(BaseModel):
    log_entries: int
    failures: int
    skipped: int
    failed: int
    errors: list[str]


@router.post("/import", response_model=LogImportOut)
async def import_history(request: Request, line: str | None = None,
                         db: Session = Depends(get_db),
                         user=Depends(current_writer)):
    # `line` scopes the whole import to one site (e.g. ?line=Green Line): rows
    # with no matching asset would otherwise land with a NULL line and leak
    # into every coordinator's book, so an asset-less row falls back to this.
    import_line_id = None
    if line and line.strip():
        site = db.scalar(select(Location).where(Location.kind == LocationKind.SITE,
                                                func.lower(Location.name) == line.strip().lower()))
        if not site:
            raise HTTPException(422, f"unknown line '{line}' — no such site")
        import_line_id = site.id
    text = (await request.body()).decode("utf-8-sig", errors="replace")
    rows = list(_csv.DictReader(_io.StringIO(text)))
    if not rows or "details" not in rows[0] or not ({"date", "start"} & set(rows[0])):
        raise HTTPException(422, "expected the standard logbook CSV "
                                 "(see /api/logbook/import/sample)")

    # preload once: register codes and already-imported content keys.
    # ONE ledger — every row (maintenance and failure) becomes a log entry.
    # Codes repeat across lines, so scope the code->asset map to the import's line
    # (?line=) when given, else fall back to a global map (last-wins).
    asset_q = select(Asset)
    if import_line_id:
        asset_q = asset_q.where(Asset.line_id == import_line_id)
    assets = {a.code: a for a in db.scalars(asset_q).all()}
    have_logs = {(str(e[0]), e[1] or '', e[2]) for e in
                 db.execute(select(LogEntry.log_date, Asset.code, LogEntry.text)
                            .outerjoin(Asset, LogEntry.asset_id == Asset.id)).all()}

    n_logs = n_fails = skipped = failed = 0
    errors: list[str] = []
    batch = 0
    for n, r in enumerate(rows, start=2):
        get = lambda k: (r.get(k) or "").strip()
        getfirst = lambda *ks: next((v for v in (get(k) for k in ks) if v), "")
        # one date per entry ('date'); failures may add a recovery ('resolved_on').
        # 'start'/'end' kept as aliases so the older two-date sheets still import.
        start = _parse_dt(getfirst("date", "start")) or _parse_dt(getfirst("resolved_on", "end"))
        if not start:
            failed += 1
            if len(errors) < 20:
                errors.append(f"line {n}: no usable date")
            continue
        details = get("details") or get("fault_type") or get("type") or "entry"
        asset = assets.get(get("asset_id"))
        etype = _KIND_TYPE.get(get("kind").lower(), LogEntryType.MAINTENANCE)
        is_failure = etype == LogEntryType.FAILURE
        try:
            # a failure never self-resolves: if the row carries a recovery date,
            # the fix (action_taken) is filed as a SEPARATE rectification that
            # closes it, so the two-part model holds everywhere.
            resolved = (_parse_dt(getfirst("resolved_on", "end"))
                        if is_failure else None)
            if resolved and resolved < start:
                resolved = None
            action = get("action_taken")

            bits = [details]
            if get("fault_type"): bits.append(f"fault: {get('fault_type')}")
            # the action belongs to the fix — only fold it into the entry text
            # when there is no separate rectification to carry it
            if action and not (is_failure and resolved): bits.append(f"action: {action}")
            if is_failure and get("reported_by"): bits.append(f"reported by: {get('reported_by')}")
            if is_failure and get("repercussion"): bits.append(f"repercussion: {get('repercussion')}")
            if get("equipment"): bits.append(f"equipment: {get('equipment')}")
            if not asset and get("asset_id"): bits.append(f"asset: {get('asset_id')}")
            if not asset and get("station"): bits.append(f"at: {get('station')} {get('location')}".strip())
            typ = get("type") or get("kind") or "entry"
            body_text = f"[{typ}] " + " · ".join(bits)
            key = (start.date().isoformat(), asset.code if asset else '', body_text)
            if key in have_logs:
                skipped += 1
                continue
            have_logs.add(key)
            # asset's own line first, then the import-wide line, then the
            # importer's line — never NULL for an asset-less row when ?line= is set
            line_id = ((asset.location.parent_id if asset and asset.location else None)
                       or import_line_id or user.line_id)
            # system + category = the asset's rollup + class; category falls
            # back to the CSV group cell when the asset is unmatched
            system = _system_of(asset)
            category = _category_of(asset) or (get("group")[:80] or None)
            # a rectification (kind=rectification) may name the failure it closes
            # via closes_failure_ref ("ASSET@YYYY-MM-DD" / asset / date / id).
            rectifies = None
            if etype == LogEntryType.RECTIFICATION and get("closes_failure_ref"):
                rectifies = _resolve_failure_ref(db, get("closes_failure_ref"), asset)
            # a standalone rectification carries its own recovery time
            end = _parse_dt(getfirst("resolved_on", "end")) if etype == LogEntryType.RECTIFICATION else None
            if end and end < start:
                end = None
            fault = (get("fault_type")[:120] or None) if etype in (LogEntryType.FAILURE, LogEntryType.RECTIFICATION) else None
            attended = (get("attended_by") or "imported record")[:120]
            new = LogEntry(
                at=start, log_date=start.date(),
                shift=ShiftCode.GENERAL,   # sheets carry no shift — don't assume night
                type=etype,
                subtype=_maint_subtype(get("type")) if etype == LogEntryType.MAINTENANCE else None,
                system=system, category=category,
                ended_at=end,   # failures never self-resolve (see below); rects carry it
                fault_type=fault,
                text=body_text, entered_by=attended,
                attended_by=(get("attended_by")[:200] or None),
                # a failure consumes nothing — spares go on the fix (auto-rect below)
                consumables=(None if is_failure else (get("consumables") or None)),
                station=(f"{get('station')} {get('location')}".strip()[:160] or None),
                action_taken=(action[:2000] or None),
                rectifies_id=rectifies.id if rectifies else None,
                asset=asset, line_id=line_id)
            db.add(new)
            if is_failure:
                n_fails += 1
            else:
                n_logs += 1
            # auto-pair: a resolved failure gets a rectification that closes it
            if is_failure and resolved:
                db.flush()   # need the failure's id to link the rectification
                rect = LogEntry(
                    at=resolved, log_date=resolved.date(), shift=ShiftCode.GENERAL,
                    type=LogEntryType.RECTIFICATION, system=system, category=category,
                    fault_type=fault,
                    text="[RECTIFICATION] " + (action or "Rectified"),
                    entered_by=attended, attended_by=(get("attended_by")[:200] or None),
                    consumables=(get("consumables") or None),
                    rectifies_id=new.id, asset=asset, line_id=line_id)
                db.add(rect)
                n_logs += 1
            batch += 1
            if batch >= 500:
                db.commit()
                batch = 0
        except (SQLAlchemyError, ValueError) as e:
            db.rollback()
            batch = 0
            failed += 1
            if len(errors) < 20:
                errors.append(f"line {n}: {type(e).__name__}: {str(e)[:120]}")
    db.commit()
    audit(db, "log_entry", 0, "history-import",
          detail=f"logs={n_logs} failures={n_fails} skipped={skipped} failed={failed}",
          actor=user.username)
    db.commit()
    return LogImportOut(log_entries=n_logs, failures=n_fails,
                        skipped=skipped, failed=failed, errors=errors)
