# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Asset register endpoints — v0.2, DB-backed."""
import csv
import io
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from app.api.auth import current_user, current_writer, optional_user, scope_location_ids
from app.db import audit, get_db
from app.engine import (SCHEDULE_FREQ, build_schedule, summarize_schedule)
from app.models import (Asset, AssetClass, AssetStatus, AuditLog, Criticality,
                        Location, LocationKind, LogEntry, LogEntryType, PMPlan,
                        WorkOrder)

router = APIRouter()

# Mounted at /api/lines — the landing page's public directory of sites.
lines_router = APIRouter()


class LineOut(BaseModel):
    name: str
    stations: int
    assets: int
    initiator: bool  # the first site registered — where the system began


@lines_router.get("", response_model=list[LineOut])
def list_lines(db: Session = Depends(get_db)):
    """Every SITE in the location tree (e.g. each metro line), with counts.
    Creation order — the first site is the deployment's initiator and leads
    the landing page. Public: this is the walk-up surface."""
    out = []
    sites = db.scalars(select(Location).where(Location.kind == LocationKind.SITE)
                       .order_by(Location.id)).all()
    for i, site in enumerate(sites):
        child_ids = [c.id for c in site.children]
        n_assets = 0
        if child_ids:
            n_assets = len(db.scalars(select(Asset.id).where(Asset.location_id.in_(child_ids))).all())
        out.append(LineOut(name=site.name, stations=len(child_ids),
                           assets=n_assets, initiator=(i == 0)))
    return out


class AssetIn(BaseModel):
    code: str
    name: str
    asset_class: str
    location: str
    make_model: str | None = None
    criticality: str = "B"  # A / B / C
    system: str | None = None  # reporting rollup, e.g. "Traction / PS"
    status: str = "in_service"
    line: str | None = None  # parent site in the location tree, e.g. "Green Line"
    commissioned_on: date | None = None  # in service since — a technical detail
    description: str | None = None       # a fuller description of the asset
    remarks: str | None = None           # free-form remarks
    codal_life_years: int | None = None  # prescribed service life, in years
    depot: str | None = None             # maintenance depot code, e.g. SHY / KHG / CPD
    location_detail: str | None = None   # fine equipment location within the station


class AssetUpdate(BaseModel):
    """Every field optional — a PATCH carries only what changed. `code` may be
    corrected but is the QR-tag identity, so the client is warned to reprint."""
    code: str | None = None
    name: str | None = None
    asset_class: str | None = None
    location: str | None = None
    make_model: str | None = None
    criticality: str | None = None
    system: str | None = None
    status: str | None = None
    line: str | None = None
    commissioned_on: date | None = None
    description: str | None = None
    remarks: str | None = None
    codal_life_years: int | None = None
    depot: str | None = None
    location_detail: str | None = None


class AssetOut(AssetIn):
    id: int


def _to_out(a: Asset) -> AssetOut:
    return AssetOut(
        id=a.id, code=a.code, name=a.name,
        asset_class=a.asset_class.name, location=a.location.name,
        make_model=a.make_model, status=a.status.value,
        criticality=a.criticality.value, system=a.system,
        line=a.location.parent.name if a.location.parent else None,
        commissioned_on=a.commissioned_on,
        description=a.description, remarks=a.remarks,
        codal_life_years=a.codal_life_years, depot=a.depot,
        location_detail=a.location_detail,
    )


def _to_out_slim(a: Asset) -> AssetOut:
    """List-row serializer: same shape as _to_out but drops the three heavy
    free-text fields (make_model, description, remarks) that no register/tag/
    dashboard list renders — they're only shown on the asset detail page, which
    fetches the full record via /api/assets/{code}. Trims the list payload the
    coordinators' laptops parse on every register load."""
    return AssetOut(
        id=a.id, code=a.code, name=a.name,
        asset_class=a.asset_class.name, location=a.location.name,
        make_model=None, status=a.status.value,
        criticality=a.criticality.value, system=a.system,
        line=a.location.parent.name if a.location.parent else None,
        commissioned_on=a.commissioned_on,
        description=None, remarks=None,
        codal_life_years=a.codal_life_years, depot=a.depot,
        location_detail=a.location_detail,
    )


def _get_or_create_class(db: Session, name: str) -> AssetClass:
    obj = db.scalar(select(AssetClass).where(AssetClass.name == name))
    if not obj:
        obj = AssetClass(name=name)
        db.add(obj)
        db.flush()
    return obj


def _get_or_create_location(db: Session, name: str, line: str | None = None) -> Location:
    obj = db.scalar(select(Location).where(Location.name == name))
    if not obj:
        obj = Location(name=name, kind=LocationKind.STATION)
        db.add(obj)
        db.flush()
    if line and obj.parent is None:
        site = db.scalar(select(Location).where(Location.name == line))
        if not site:
            site = Location(name=line, kind=LocationKind.SITE)
            db.add(site)
            db.flush()
        obj.parent_id = site.id
        db.flush()
    return obj


def visible_asset(db: Session, code: str, user) -> Asset:
    """The asset with this code inside the user's scope — else 404. Codes repeat
    across lines, so a scoped user resolves to THEIR line's asset; an unscoped
    admin gets the first match (rare — admins rarely fetch by bare code).

    Codes carry spaces/parens and some imported ones have stray leading/trailing
    or doubled whitespace or case drift, so an exact match can miss what the eye
    reads as the same code. Fall back to a whitespace-collapsed, case-insensitive
    compare before giving up."""
    from sqlalchemy import func

    def _scoped(q):
        scope = scope_location_ids(db, user)
        if scope is not None:
            q = q.where(Asset.location_id.in_(scope))
        if getattr(user, "depot", None):
            q = q.where(Asset.depot == user.depot)
        return q

    obj = db.scalars(_scoped(select(Asset).where(Asset.code == code))).first()
    if not obj:
        # tolerant match: trim + case-insensitive (covers stray edge whitespace)
        norm = code.strip().lower()
        obj = db.scalars(_scoped(select(Asset).where(func.lower(func.trim(Asset.code)) == norm))).first()
    if not obj:
        # last resort: collapse *all* whitespace and compare in Python (handles
        # doubled internal spaces) — bounded to the scope, so never a full scan
        want = " ".join(code.split()).lower()
        for a in db.scalars(_scoped(select(Asset))).all():
            if " ".join(a.code.split()).lower() == want:
                obj = a
                break
    if not obj:
        raise HTTPException(404, "asset not found")
    return obj


@router.get("", response_model=list[AssetOut])
def list_assets(db: Session = Depends(get_db), user=Depends(optional_user)):
    # Eager-load the relationships _to_out touches (class, location, its parent
    # line) so the register list is one query, not 1 + 3·N lazy round-trips.
    q = select(Asset).options(
        joinedload(Asset.asset_class),
        joinedload(Asset.location).joinedload(Location.parent),
    )
    scope = scope_location_ids(db, user)
    if scope is not None:
        q = q.where(Asset.location_id.in_(scope))
    # a depot-scoped account (e.g. an SSE) sees only its depot's assets
    if getattr(user, "depot", None):
        q = q.where(Asset.depot == user.depot)
    return [_to_out_slim(a) for a in db.scalars(q).all()]


def _line_site(db: Session, line: str | None):
    """The SITE (line) row for a line name, if it exists."""
    if not line:
        return None
    return db.scalar(select(Location).where(Location.name == line,
                                            Location.kind == LocationKind.SITE))


def _create_one(db: Session, asset: AssetIn, user) -> Asset:
    """Shared by single create and bulk import — same validation, same audit."""
    if user.line_id is not None:
        my_line = db.get(Location, user.line_id).name
        if asset.line and asset.line != my_line:
            raise HTTPException(403, f"your account manages {my_line} only")
        asset.line = my_line  # scoped users always register into their own line
    # a depot-scoped account always registers into its own depot
    depot = (user.depot if getattr(user, "depot", None) else asset.depot) or None
    try:
        crit = Criticality(asset.criticality)
        status = AssetStatus(asset.status)
    except ValueError as e:
        raise HTTPException(422, str(e))
    site = _line_site(db, asset.line)
    loc = _get_or_create_location(db, asset.location, asset.line)
    # codes are unique PER LOCATION — a depot spans several substations and the
    # metro reuses generic codes (BAT CH-1, ACDB-1 …) at EACH one, so the same
    # code legitimately repeats across stations; only a true same-location
    # duplicate is a conflict.
    if db.scalar(select(Asset).where(Asset.code == asset.code,
                                     Asset.location_id == loc.id)):
        raise HTTPException(409, f"asset code {asset.code} already exists at {asset.location}")
    obj = Asset(
        code=asset.code, name=asset.name, make_model=asset.make_model,
        criticality=crit, system=asset.system, status=status,
        commissioned_on=asset.commissioned_on,
        description=asset.description, remarks=asset.remarks,
        codal_life_years=asset.codal_life_years, depot=depot,
        location_detail=asset.location_detail,
        asset_class=_get_or_create_class(db, asset.asset_class),
        location=loc,
        line_id=(loc.parent_id if loc.parent_id else (site.id if site else None)),
    )
    db.add(obj)
    db.flush()
    audit(db, "asset", obj.id, "created", detail=f"code={obj.code}", actor=user.username)
    return obj


@router.post("", response_model=AssetOut, status_code=201)
def create_asset(asset: AssetIn, db: Session = Depends(get_db), user=Depends(current_writer)):
    obj = _create_one(db, asset, user)
    db.commit()
    db.refresh(obj)
    return _to_out(obj)


# ---- bulk import: the sheet-to-register bridge -----------------------------
# Every line fills the same CSV (the Green Line format is the standard);
# supervisors download the sample, fill it for their line, upload it back.

# The full register template. Required: code, name, asset_class, location.
# Everything after is optional — leave a cell blank to skip it.
#   criticality      A (vital) / B (important) / C (tolerable); default B
#   status           in_service / under_maintenance / out_of_service / decommissioned
#   commissioned_on  in service since — YYYY-MM-DD
#   description      a fuller description of the asset (free text)
#   remarks          free-form remarks
#   codal_life_years the prescribed service life in years (whole number)
#   Monthly … 5-Yearly  the PM cycles this asset needs — one column per cycle;
#                    put TRUE (or a tick) in each cycle that applies. All blank ⇒
#                    the schedule is inferred from the logbook instead.
#   last_maintenance last PM date (YYYY-MM-DD) — records a MAINTENANCE log entry
#                    (one per cycle above) dated that day, so the asset is no
#                    longer "awaiting 1st service" and next-due is computed from
#                    it. Applied to assets already on the register too, and
#                    dedup-safe, so re-uploading a sheet with new dates just adds
#                    the missing PM records.
SAMPLE_CSV = """code,name,asset_class,location,line,system,make_model,criticality,status,commissioned_on,description,remarks,codal_life_years,Monthly,Quarterly,Half-Yearly,Yearly,5-Yearly,last_maintenance
B2HB11,VCB,33KV SWITCHGEAR,Baranagar,Blue Line,HT · 33kV,"SIEMENS LTD.,INDIA",A,in_service,2019-03-15,33kV vacuum circuit breaker — incomer feeder,Under AMC,25,,,,TRUE,,2025-11-06
LP-C-01(BARA),Concourse Light Panel,DISTRIBUTION BOARD,Baranagar,Blue Line,LT · LT Panels,,B,in_service,,Concourse lighting distribution panel,,15,,TRUE,,TRUE,,2026-01-10
AHU-M1(BARA),AHU Unit 1,ECS- AXIAL FLOW FAN,Baranagar,Blue Line,LT · ECS (AC),M/S VOLTAS,B,in_service,,Air handling unit for concourse,Belt due for review,20,TRUE,,TRUE,TRUE,,
"""

REQUIRED_COLS = ("code", "name", "asset_class", "location")
# columns fed straight to AssetIn
OPTIONAL_COLS = ("line", "system", "make_model", "criticality", "status",
                 "commissioned_on", "description", "remarks", "codal_life_years",
                 "depot", "location_detail")

# the five schedule cycles, each a checkbox column in the register sheet
CYCLE_LABELS = ("Monthly", "Quarterly", "Half-Yearly", "Yearly", "5-Yearly")
# maintenance-plan columns, handled separately (they seed pm_plans, not the asset)
PLAN_COLS = CYCLE_LABELS + ("last_maintenance", "maintenance_cycles")

# accept the master-sheet abbreviations as well as the full labels
_CYCLE_ALIASES = {
    "m": "Monthly", "monthly": "Monthly",
    "q": "Quarterly", "quarterly": "Quarterly",
    "hy": "Half-Yearly", "half-yearly": "Half-Yearly", "half yearly": "Half-Yearly", "halfyearly": "Half-Yearly",
    "y": "Yearly", "yearly": "Yearly", "annual": "Yearly", "annually": "Yearly",
    "5y": "5-Yearly", "5-yearly": "5-Yearly", "5 yearly": "5-Yearly", "5yearly": "5-Yearly",
}
_TRUTHY = {"true", "yes", "y", "1", "x", "✓", "✔", "checked", "tick", "☑"}


def _parse_cycles(raw: str) -> list[str]:
    """Parse a free-text 'maintenance_cycles' cell into canonical labels."""
    out = []
    for part in raw.replace(",", ";").replace("|", ";").split(";"):
        key = part.strip().lower()
        if not key:
            continue
        label = _CYCLE_ALIASES.get(key)
        if label and label not in out:
            out.append(label)
    return out


def _cycles_from_row(raw: dict) -> list[str]:
    """The asset's PM cycles from a CSV row. Per-cycle checkbox columns
    (Monthly … 5-Yearly = TRUE) take precedence; otherwise the legacy free-text
    'maintenance_cycles' cell is parsed."""
    picked = [c for c in CYCLE_LABELS
              if str(raw.get(c) or "").strip().lower() in _TRUTHY]
    if picked:
        return picked
    return _parse_cycles(raw.get("maintenance_cycles") or "")


def _parse_date(raw: str):
    """Parse a date cell — ISO or day-first (the sheets' DD/MM/YYYY)."""
    raw = (raw or "").strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            pass
    return None


@router.get("/import/sample")
def import_sample():
    """The standard register template — one row per asset, any line."""
    return Response(SAMPLE_CSV, media_type="text/csv", headers={
        "Content-Disposition": 'attachment; filename="amps-asset-register-sample.csv"'})


class ImportOut(BaseModel):
    created: int
    skipped: int            # asset already existed (not re-created) — still updated below
    failed: int
    plans_added: int = 0    # pm_plans created for new/existing assets
    logs_added: int = 0     # maintenance logs created from last_maintenance dates
    errors: list[str]  # first errors, "line N: reason"


def _get_or_create_asset(db: Session, asset: AssetIn, user) -> tuple[Asset, bool]:
    """Resolve the asset for an import row at its own location, creating it if
    absent. Returns (asset, created?). Unlike the bare create path this does NOT
    409 on an existing code — an import that carries a maintenance plan or a
    last_maintenance date must still be applied to an asset already on the
    register (that was the silent gap: existing rows were skipped whole, so a
    newly-added last-maintenance date never seeded the schedule)."""
    if user.line_id is not None:
        my_line = db.get(Location, user.line_id).name
        if asset.line and asset.line != my_line:
            raise HTTPException(403, f"your account manages {my_line} only")
        asset.line = my_line
    loc = _get_or_create_location(db, asset.location, asset.line)
    existing = db.scalar(select(Asset).where(Asset.code == asset.code,
                                             Asset.location_id == loc.id))
    if existing:
        return existing, False
    return _create_one(db, asset, user), True


@router.post("/import", response_model=ImportOut)
async def import_csv(request: Request, db: Session = Depends(get_db),
                     user=Depends(current_writer)):
    """Bulk-register assets from a CSV in the standard format.
    Existing codes are skipped, so repeat uploads are safe."""
    text = (await request.body()).decode("utf-8-sig", errors="replace")
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise HTTPException(422, "the CSV has no data rows")
    missing = [c for c in REQUIRED_COLS if c not in (rows[0].keys() or [])]
    if missing:
        raise HTTPException(422, f"missing required columns: {', '.join(missing)}")

    created = skipped = failed = plans_added = logs_added = 0
    errors: list[str] = []
    for n, raw in enumerate(rows, start=2):
        fields = {k: (raw.get(k) or "").strip()
                  for k in REQUIRED_COLS + OPTIONAL_COLS if (raw.get(k) or "").strip()}
        empty = [c for c in REQUIRED_COLS if c not in fields]
        if empty:
            failed += 1
            if len(errors) < 20:
                errors.append(f"line {n}: empty required field(s): {', '.join(empty)}")
            continue
        # dates arrive as text and may be day-first (the sheets' DD/MM/YYYY)
        if "commissioned_on" in fields:
            d = _parse_date(fields["commissioned_on"])
            if d:
                fields["commissioned_on"] = d
            else:
                del fields["commissioned_on"]
        try:
            obj, was_created = _get_or_create_asset(db, AssetIn(**fields), user)
            if was_created:
                created += 1
            else:
                skipped += 1  # already on the register — still apply plan + last PM below

            # maintenance plan — ensure a pm_plan exists for each cycle column.
            # Idempotent: never a second plan for a cycle the asset already has.
            cycles = _cycles_from_row(raw)
            if cycles:
                cycles = sorted(cycles, key=lambda x: SCHEDULE_FREQ[x])
                have = {p.frequency for p in db.scalars(
                    select(PMPlan).where(PMPlan.asset_id == obj.id)).all()}
                new_cycles = [f for f in cycles if f not in have]
                for f in new_cycles:
                    db.add(PMPlan(asset_id=obj.id, frequency=f))
                    plans_added += 1
                if new_cycles:
                    audit(db, "asset", obj.id, "pm_plan",
                          detail="imported: " + ", ".join(new_cycles), actor=user.username)

            # last_maintenance -> a real MAINTENANCE log entry (the source of
            # truth), one per applicable cycle, so it clears "awaiting 1st
            # service" and drives next-due via the normal log path. Dedup on
            # (asset, date, cycle) makes re-imports idempotent.
            lm = _parse_date(raw.get("last_maintenance") or "")
            if lm:
                subs = cycles or [p.frequency for p in db.scalars(
                    select(PMPlan).where(PMPlan.asset_id == obj.id)).all()
                    if p.frequency in SCHEDULE_FREQ]
                for f in (subs or [None]):
                    dup = db.scalar(select(LogEntry).where(
                        LogEntry.asset_id == obj.id, LogEntry.log_date == lm,
                        LogEntry.subtype == f,
                        LogEntry.type == LogEntryType.MAINTENANCE))
                    if dup:
                        continue
                    db.add(LogEntry(
                        asset_id=obj.id, log_date=lm, type=LogEntryType.MAINTENANCE,
                        subtype=f, line_id=obj.line_id,
                        attended_by="Register import", entered_by=user.username,
                        text=(f"{f or 'PM'} maintenance completed on "
                              f"{lm.isoformat()} — recorded from the asset "
                              f"register (pre-logbook); details not captured.")))
                    logs_added += 1

            db.commit()  # per row: one bad row can never sink the batch
        except HTTPException as e:
            db.rollback()
            if e.status_code == 409:
                skipped += 1
            else:
                failed += 1
                if len(errors) < 20:
                    errors.append(f"line {n}: {e.detail}")
        except ValidationError as e:
            db.rollback()
            failed += 1
            if len(errors) < 20:
                errors.append(f"line {n}: {e.errors()[0].get('msg', 'invalid row')}")
        except SQLAlchemyError as e:
            db.rollback()
            failed += 1
            if len(errors) < 20:
                errors.append(f"line {n}: {type(e).__name__}: {str(e.orig or e)[:120]}")
    return ImportOut(created=created, skipped=skipped, failed=failed,
                     plans_added=plans_added, logs_added=logs_added, errors=errors)


@router.get("/{code}", response_model=AssetOut)
def get_asset(code: str, db: Session = Depends(get_db), user=Depends(optional_user)):
    return _to_out(visible_asset(db, code, user))


def _line_of(a: Asset) -> str | None:
    return a.location.parent.name if a.location and a.location.parent else None


@router.patch("/{code}", response_model=AssetOut)
def update_asset(code: str, patch: AssetUpdate, db: Session = Depends(get_db),
                 user=Depends(current_writer)):
    """Edit an asset's technical details, one attributable change at a time.

    Every field that actually changes is written to the audit trail as
    was→now, so the register can always answer "who changed this, and from
    what". Line-scoped users may only touch their own line, and may not move
    an asset out of it. Append-only history survives a code change because the
    logbook links by id, not code — but printed QR tags carry the code, so a
    code change is flagged for reprinting."""
    a = visible_asset(db, code, user)  # 404s outside the caller's scope
    my_line = db.get(Location, user.line_id).name if user.line_id is not None else None

    changes: list[str] = []

    def note(field, old, new):
        changes.append(f"{field}: {old or '—'}→{new or '—'}")

    if patch.code is not None and patch.code != a.code:
        # codes are unique per location, so the clash check is scoped to it
        if db.scalar(select(Asset).where(Asset.code == patch.code,
                                         Asset.location_id == a.location_id)):
            raise HTTPException(409, f"asset code {patch.code} already exists at this location")
        note("code", a.code, patch.code)
        a.code = patch.code
    if patch.name is not None and patch.name != a.name:
        note("name", a.name, patch.name); a.name = patch.name
    if patch.make_model is not None and patch.make_model != (a.make_model or ""):
        note("make/model", a.make_model, patch.make_model)
        a.make_model = patch.make_model or None
    if patch.system is not None and patch.system != (a.system or ""):
        note("system", a.system, patch.system); a.system = patch.system or None
    if patch.commissioned_on is not None and patch.commissioned_on != a.commissioned_on:
        note("commissioned", a.commissioned_on, patch.commissioned_on)
        a.commissioned_on = patch.commissioned_on
    if patch.description is not None and patch.description != (a.description or ""):
        note("description", a.description, patch.description)
        a.description = patch.description or None
    if patch.remarks is not None and patch.remarks != (a.remarks or ""):
        note("remarks", a.remarks, patch.remarks); a.remarks = patch.remarks or None
    if patch.location_detail is not None and patch.location_detail != (a.location_detail or ""):
        note("location", a.location_detail, patch.location_detail); a.location_detail = patch.location_detail or None
    if patch.depot is not None and patch.depot != (a.depot or ""):
        note("depot", a.depot, patch.depot); a.depot = patch.depot or None
    if patch.codal_life_years is not None and patch.codal_life_years != a.codal_life_years:
        note("codal life", a.codal_life_years, patch.codal_life_years)
        a.codal_life_years = patch.codal_life_years
    if patch.criticality is not None and patch.criticality != a.criticality.value:
        try:
            note("criticality", a.criticality.value, patch.criticality)
            a.criticality = Criticality(patch.criticality)
        except ValueError as e:
            raise HTTPException(422, str(e))
    if patch.status is not None and patch.status != a.status.value:
        try:
            note("status", a.status.value, patch.status)
            a.status = AssetStatus(patch.status)
        except ValueError as e:
            raise HTTPException(422, str(e))
    if patch.asset_class is not None and patch.asset_class != a.asset_class.name:
        note("class", a.asset_class.name, patch.asset_class)
        a.asset_class = _get_or_create_class(db, patch.asset_class)
    # Location / line moves. A scoped user cannot move an asset off their line.
    new_line = patch.line if patch.line is not None else _line_of(a)
    if my_line is not None and new_line and new_line != my_line:
        raise HTTPException(403, f"your account manages {my_line} only")
    loc_changed = patch.location is not None and patch.location != a.location.name
    line_changed = patch.line is not None and new_line != _line_of(a)
    if loc_changed or line_changed:
        if loc_changed:
            note("location", a.location.name, patch.location)
        if line_changed:
            note("line", _line_of(a), new_line)
        a.location = _get_or_create_location(
            db, patch.location if patch.location is not None else a.location.name, new_line)

    if not changes:
        return _to_out(a)  # nothing to record — a no-op edit isn't an event

    db.flush()
    audit(db, "asset", a.id, "updated", detail=" · ".join(changes), actor=user.username)
    db.commit()
    db.refresh(a)
    return _to_out(a)


class AuditOut(BaseModel):
    at: datetime
    actor: str
    action: str
    detail: str | None


@router.get("/{code}/audit", response_model=list[AuditOut])
def asset_audit(code: str, db: Session = Depends(get_db), user=Depends(current_user)):
    """The change history for one asset, newest first. Writers only — the
    walk-up QR surface shows the record, not who has edited it."""
    a = visible_asset(db, code, user)
    rows = db.scalars(
        select(AuditLog).where(AuditLog.entity == "asset", AuditLog.entity_id == a.id)
        .order_by(AuditLog.at.desc(), AuditLog.id.desc())
    ).all()
    return [AuditOut(at=r.at, actor=r.actor, action=r.action, detail=r.detail) for r in rows]


# ---------------- maintenance schedule + plan ----------------

class ScheduleRow(BaseModel):
    frequency: str
    last_done: date | None
    via: str | None           # the longer cycle that fulfilled this one, if any
    next_due: date | None
    days_left: int | None
    state: str                # ok | due_soon | overdue | never


class ScheduleSummary(BaseModel):
    next_frequency: str | None
    next_due: date | None
    days_left: int | None
    state: str
    overdue_count: int


class ScheduleOut(BaseModel):
    planned: list[str]        # the frequencies the plan explicitly sets
    has_plan: bool            # false ⇒ rows are inferred from the log (fallback)
    rows: list[ScheduleRow]
    summary: ScheduleSummary | None


def _asset_schedule(db: Session, a: Asset) -> ScheduleOut:
    """Build one asset's schedule: log dates + optional plan seeds, rolled up."""
    labels = list(SCHEDULE_FREQ)
    log_rows = db.execute(
        select(LogEntry.subtype, func.max(LogEntry.log_date))
        .where(LogEntry.asset_id == a.id, LogEntry.type == LogEntryType.MAINTENANCE,
               LogEntry.subtype.in_(labels))
        .group_by(LogEntry.subtype)).all()
    log_dates = {sub: d for sub, d in log_rows if d}
    plans = db.scalars(select(PMPlan).where(PMPlan.asset_id == a.id)).all()
    planned = {p.frequency for p in plans if p.frequency in SCHEDULE_FREQ}
    seeds = {p.frequency: p.last_done_seed for p in plans if p.last_done_seed}
    done = {}
    for f in SCHEDULE_FREQ:
        cands = [d for d in (log_dates.get(f), seeds.get(f)) if d]
        if cands:
            done[f] = max(cands)
    # a plan, once set, is authoritative; without one, infer from what's logged
    freqs = planned if planned else set(log_dates)
    rows = build_schedule(freqs, done)
    return ScheduleOut(
        planned=sorted(planned, key=lambda x: SCHEDULE_FREQ[x]),
        has_plan=bool(planned), rows=rows, summary=summarize_schedule(rows))


@router.get("/{code}/schedule", response_model=ScheduleOut)
def asset_schedule(code: str, db: Session = Depends(get_db), user=Depends(optional_user)):
    """One asset's maintenance schedule — open like the rest of the walk-up
    record (single-asset scope). Plan-driven when a plan exists, else inferred."""
    return _asset_schedule(db, visible_asset(db, code, user))


class PlanIn(BaseModel):
    frequencies: list[str]                     # the cycles this asset is scheduled for
    seeds: dict[str, date | None] = {}         # optional last-done baseline per cycle


@router.put("/{code}/plan", response_model=ScheduleOut)
def set_plan(code: str, plan: PlanIn, db: Session = Depends(get_db),
             user=Depends(current_writer)):
    """Set the asset's maintenance plan — which cycles it needs, with optional
    seed dates. Replaces the plan wholesale; the change is audited. Writers only,
    line-scoped (a plan on an asset outside your line 404s).

    A seed (last-done) date is a claim that a PM was performed that day, so it
    also lands a real MAINTENANCE log entry — the logbook is AMPS's source of
    truth, so the date is visible and auditable there, not just a hidden baseline
    on the plan. Dedup on (asset, date, cycle) keeps re-saving the plan
    idempotent; the seed is kept too (harmless — the schedule takes the max of
    log and seed — and it keeps the plan editor's date field populated)."""
    a = visible_asset(db, code, user)
    bad = [f for f in plan.frequencies if f not in SCHEDULE_FREQ]
    if bad:
        raise HTTPException(422, f"unknown frequency: {', '.join(bad)}")
    existing = db.scalars(select(PMPlan).where(PMPlan.asset_id == a.id)).all()
    old = {p.frequency for p in existing}
    for p in existing:
        db.delete(p)
    db.flush()
    new = set(plan.frequencies)
    logged: list[str] = []
    for f in sorted(new, key=lambda x: SCHEDULE_FREQ[x]):
        seed = plan.seeds.get(f)
        db.add(PMPlan(asset_id=a.id, frequency=f, last_done_seed=seed))
        if seed:
            dup = db.scalar(select(LogEntry).where(
                LogEntry.asset_id == a.id, LogEntry.log_date == seed,
                LogEntry.subtype == f, LogEntry.type == LogEntryType.MAINTENANCE))
            if not dup:
                db.add(LogEntry(
                    asset_id=a.id, log_date=seed, type=LogEntryType.MAINTENANCE,
                    subtype=f, line_id=a.line_id,
                    attended_by="PM plan (last-done)", entered_by=user.username,
                    text=(f"{f} maintenance completed on {seed.isoformat()} — "
                          f"recorded via the asset's maintenance plan; details "
                          f"not captured.")))
                logged.append(f"{f}@{seed.isoformat()}")
    if old != new:
        added = sorted(new - old, key=lambda x: SCHEDULE_FREQ[x])
        removed = sorted(old - new, key=lambda x: SCHEDULE_FREQ[x])
        parts = []
        if added:
            parts.append("added " + ", ".join(added))
        if removed:
            parts.append("removed " + ", ".join(removed))
        audit(db, "asset", a.id, "pm_plan", detail="; ".join(parts), actor=user.username)
    if logged:
        audit(db, "asset", a.id, "pm_log", detail="last-done logged: " + ", ".join(logged),
              actor=user.username)
    db.commit()
    db.refresh(a)
    return _asset_schedule(db, a)


class HistoryItem(BaseModel):
    work_order_id: int
    type: str
    status: str
    title: str
    findings: str | None
    done_by: str | None
    closed_at: str | None


@router.get("/{code}/history", response_model=list[HistoryItem])
def asset_history(code: str, db: Session = Depends(get_db), user=Depends(optional_user)):
    """The asset's history card — every work order, newest first.
    This is the screen a supervisor opens after scanning the QR tag."""
    obj = visible_asset(db, code, user)
    orders = db.scalars(
        select(WorkOrder).where(WorkOrder.asset_id == obj.id)
        .order_by(WorkOrder.opened_at.desc())
    ).all()
    return [HistoryItem(
        work_order_id=w.id, type=w.type.value, status=w.status.value,
        title=w.title, findings=w.findings, done_by=w.assigned_to,
        closed_at=w.closed_at.isoformat() if w.closed_at else None,
    ) for w in orders]
