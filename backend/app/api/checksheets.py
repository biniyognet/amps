"""Checksheet FORMAT library — governed create/edit with IC (in-charge) approval.

A format is the blank a technician prints and fills by hand. Lifecycle:
    draft → (submit) → pending → (approve) → published
                                 (reject, reason) → draft
Editing a PUBLISHED format forks a new draft version that supersedes the old one
when approved; the old stays live until then, then is archived. Only PUBLISHED
formats appear in Printables. Every transition is written to the audit trail.
"""
import json
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import current_approver, current_user, current_writer, optional_user
from app.db import audit, get_db
from app.models import (AuditLog, ChecksheetFormat, ChecksheetStatus, Location,
                        LocationKind, UserRole)

router = APIRouter()


# ---- schemas ---------------------------------------------------------------

class ChecksheetItem(BaseModel):
    activity: str = Field(min_length=1)
    prescribed: str = ""          # prescribed value / acceptance limit (optional)
    freqs: list[str] = []         # frequency columns this activity is DUE at (subset of the format's)
    section: str = ""             # heading it sits under on the printed sheet ("Compressor · Motor")


class FormatIn(BaseModel):
    label: str = Field(min_length=1)
    title: str = ""
    grp: str = "HT"
    system: str | None = None     # asset-register system it serves, e.g. "LT · ECS (AC)"
    asset_code: str | None = None
    asset_class: str | None = None
    frequency: str | None = None
    frequencies: list[str] = []   # cycle groups, e.g. ["Monthly","Yearly"]
    slots: list[str] = []         # log-sheet columns (e.g. 8:00 AM … / Week 1-4): prints a readings grid
    items: list[ChecksheetItem] = []


class FormatOut(BaseModel):
    id: int
    slug: str
    grp: str
    system: str | None
    label: str
    title: str
    asset_code: str | None
    asset_class: str | None
    frequency: str | None
    frequencies: list[str]
    slots: list[str]
    items: list[ChecksheetItem]
    version: int
    status: str
    supersedes_id: int | None
    reject_reason: str | None
    created_by: str
    created_at: datetime
    updated_at: datetime
    approved_by: str | None
    approved_at: datetime | None


class RejectIn(BaseModel):
    reason: str = Field(min_length=1)


def _slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:80] or "format"


def _jlist(raw: str | None) -> list[str]:
    try:
        vals = json.loads(raw or "[]")
    except ValueError:
        vals = []
    return [str(x).strip() for x in vals if str(x).strip()]


def _freqs(f: ChecksheetFormat) -> list[str]:
    return _jlist(getattr(f, "frequencies_json", None))


def _slots(f: ChecksheetFormat) -> list[str]:
    return _jlist(getattr(f, "slots_json", None))


def _items(f: ChecksheetFormat) -> list[ChecksheetItem]:
    try:
        raw = json.loads(f.items_json or "[]")
    except ValueError:
        raw = []
    cols = _freqs(f)
    out = []
    for it in raw:
        if isinstance(it, str):
            out.append(ChecksheetItem(activity=it, prescribed="", freqs=[]))
        elif isinstance(it, dict):
            fr = [str(x).strip() for x in (it.get("freqs") or []) if str(x).strip()]
            out.append(ChecksheetItem(activity=str(it.get("activity", "")).strip(),
                                      prescribed=str(it.get("prescribed", "")).strip(),
                                      freqs=[c for c in fr if not cols or c in cols],
                                      section=str(it.get("section") or "").strip()))
    return [i for i in out if i.activity]


def _to_out(f: ChecksheetFormat) -> FormatOut:
    return FormatOut(
        id=f.id, slug=f.slug, grp=f.grp, system=f.system, label=f.label, title=f.title,
        asset_code=f.asset_code, asset_class=f.asset_class, frequency=f.frequency, frequencies=_freqs(f),
        slots=_slots(f),
        items=_items(f), version=f.version, status=f.status.value, supersedes_id=f.supersedes_id,
        reject_reason=f.reject_reason, created_by=f.created_by, created_at=f.created_at,
        updated_at=f.updated_at, approved_by=f.approved_by, approved_at=f.approved_at)


def _dump_freqs(freqs: list[str], width: int = 20) -> str:
    seen, out = set(), []
    for c in freqs:
        c = str(c).strip()[:width]
        if c and c not in seen:
            seen.add(c); out.append(c)
    return json.dumps(out, ensure_ascii=False)


def _dump_items(items: list[ChecksheetItem], cols: list[str]) -> str:
    colset = set(cols)
    return json.dumps([{"activity": i.activity.strip(), "prescribed": i.prescribed.strip(),
                        "freqs": [c for c in i.freqs if c in colset],
                        **({"section": i.section.strip()[:120]} if i.section.strip() else {})}
                       for i in items if i.activity.strip()], ensure_ascii=False)


def _is_approver(user) -> bool:
    return getattr(user, "role", None) in (UserRole.INCHARGE, UserRole.ADMIN)


# ---- read ------------------------------------------------------------------

@router.get("/formats", response_model=list[FormatOut])
def list_formats(status: str | None = None, system: str | None = None, db: Session = Depends(get_db),
                 user=Depends(optional_user)):
    """Formats. Anonymous/viewer see only PUBLISHED (the printable library);
    a signed-in writer/approver sees drafts & pending too so they can work the
    editor and the approval queue. ?status= narrows to one state."""
    q = select(ChecksheetFormat)
    # checksheets are LINE-specific — a line-scoped user only ever sees their own
    # line's formats (plus any org-wide/null ones); Green's HT formats never leak
    # to a Blue coordinator. Admins / line-less accounts see all.
    if getattr(user, "line_id", None) is not None:
        q = q.where((ChecksheetFormat.line_id == user.line_id) | (ChecksheetFormat.line_id.is_(None)))
    signed_in = getattr(user, "id", None) is not None and getattr(user, "role", None) != UserRole.VIEWER
    if system:
        q = q.where(ChecksheetFormat.system == system)
    if status:
        q = q.where(ChecksheetFormat.status == ChecksheetStatus(status))
    elif not signed_in:
        q = q.where(ChecksheetFormat.status == ChecksheetStatus.PUBLISHED)
    else:
        q = q.where(ChecksheetFormat.status != ChecksheetStatus.ARCHIVED)
    rows = db.scalars(q.order_by(ChecksheetFormat.grp, ChecksheetFormat.label,
                                 ChecksheetFormat.version.desc())).all()
    return [_to_out(f) for f in rows]


@router.get("/formats/{fid}", response_model=FormatOut)
def get_format(fid: int, db: Session = Depends(get_db), user=Depends(optional_user)):
    f = db.get(ChecksheetFormat, fid)
    if not f:
        raise HTTPException(404, "format not found")
    return _to_out(f)


class AuditRow(BaseModel):
    at: datetime
    actor: str
    action: str
    detail: str | None


@router.get("/formats/{fid}/history", response_model=list[AuditRow])
def format_history(fid: int, db: Session = Depends(get_db), user=Depends(current_user)):
    """The audit trail for a format (and its whole version chain by slug)."""
    f = db.get(ChecksheetFormat, fid)
    if not f:
        raise HTTPException(404, "format not found")
    ids = [x.id for x in db.scalars(
        select(ChecksheetFormat).where(ChecksheetFormat.slug == f.slug)).all()]
    rows = db.scalars(
        select(AuditLog).where(AuditLog.entity == "checksheet_format",
                               AuditLog.entity_id.in_(ids or [fid]))
        .order_by(AuditLog.at.desc())).all()
    return [AuditRow(at=r.at, actor=r.actor, action=r.action, detail=r.detail) for r in rows]


# ---- author ----------------------------------------------------------------

@router.post("/formats", response_model=FormatOut, status_code=201)
def create_format(body: FormatIn, db: Session = Depends(get_db), user=Depends(current_writer)):
    """Author a NEW format as a draft."""
    cols = [str(c).strip() for c in body.frequencies if str(c).strip()]
    f = ChecksheetFormat(
        slug=_slugify(body.label), grp=(body.grp or "HT").strip()[:40],
        system=(body.system or "").strip()[:80] or None, slots_json=_dump_freqs(body.slots, 40),
        label=body.label.strip()[:120], title=body.title.strip()[:240] or body.label.strip()[:240],
        asset_code=(body.asset_code or None), asset_class=(body.asset_class or None),
        frequency=(body.frequency or None),
        frequencies_json=_dump_freqs(cols), items_json=_dump_items(body.items, cols),
        version=1, status=ChecksheetStatus.DRAFT,
        line_id=getattr(user, "line_id", None),   # scoped to the author's line
        created_by=user.username)
    db.add(f); db.flush()
    audit(db, "checksheet_format", f.id, "created",
          detail=f"{f.label} v{f.version} ({len(body.items)} items)", actor=user.username)
    db.commit(); db.refresh(f)
    return _to_out(f)


@router.put("/formats/{fid}", response_model=FormatOut)
def edit_format(fid: int, body: FormatIn, db: Session = Depends(get_db), user=Depends(current_writer)):
    """Edit a format. A DRAFT/rejected is edited in place; editing a PUBLISHED one
    forks a new draft version (same slug) that will supersede it on approval."""
    f = db.get(ChecksheetFormat, fid)
    if not f:
        raise HTTPException(404, "format not found")
    cols = [str(c).strip() for c in body.frequencies if str(c).strip()]
    if f.status in (ChecksheetStatus.DRAFT,):
        f.label = body.label.strip()[:120]
        f.title = body.title.strip()[:240] or f.label
        f.grp = (body.grp or f.grp).strip()[:40]
        f.system = (body.system or "").strip()[:80] or None
        f.slots_json = _dump_freqs(body.slots, 40)
        f.asset_code = body.asset_code or None
        f.asset_class = body.asset_class or None
        f.frequency = body.frequency or None
        f.frequencies_json = _dump_freqs(cols)
        f.items_json = _dump_items(body.items, cols)
        f.reject_reason = None
        audit(db, "checksheet_format", f.id, "edited",
              detail=f"{f.label} v{f.version} ({len(body.items)} items)", actor=user.username)
        db.commit(); db.refresh(f)
        return _to_out(f)
    if f.status == ChecksheetStatus.PENDING:
        raise HTTPException(409, "this version is awaiting approval — withdraw or wait")
    # published/archived → fork a new draft version
    latest = max(x.version for x in db.scalars(
        select(ChecksheetFormat).where(ChecksheetFormat.slug == f.slug)).all())
    nf = ChecksheetFormat(
        slug=f.slug, grp=(body.grp or f.grp).strip()[:40], label=body.label.strip()[:120],
        system=(body.system or "").strip()[:80] or None, slots_json=_dump_freqs(body.slots, 40),
        title=body.title.strip()[:240] or body.label.strip()[:240],
        asset_code=body.asset_code or None, asset_class=body.asset_class or None,
        frequency=body.frequency or None,
        frequencies_json=_dump_freqs(cols), items_json=_dump_items(body.items, cols),
        version=latest + 1, status=ChecksheetStatus.DRAFT, supersedes_id=f.id, line_id=f.line_id,
        created_by=user.username)
    db.add(nf); db.flush()
    audit(db, "checksheet_format", nf.id, "revised",
          detail=f"new draft v{nf.version} from published v{f.version}", actor=user.username)
    db.commit(); db.refresh(nf)
    return _to_out(nf)


@router.post("/formats/{fid}/submit", response_model=FormatOut)
def submit_format(fid: int, db: Session = Depends(get_db), user=Depends(current_writer)):
    """Submit a draft for IC approval → pending."""
    f = db.get(ChecksheetFormat, fid)
    if not f:
        raise HTTPException(404, "format not found")
    if f.status != ChecksheetStatus.DRAFT:
        raise HTTPException(409, f"only a draft can be submitted (this is {f.status.value})")
    if not _items(f):
        raise HTTPException(422, "add at least one activity before submitting")
    f.status = ChecksheetStatus.PENDING
    audit(db, "checksheet_format", f.id, "submitted", detail=f"v{f.version} for approval", actor=user.username)
    db.commit(); db.refresh(f)
    return _to_out(f)


@router.post("/formats/{fid}/withdraw", response_model=FormatOut)
def withdraw_format(fid: int, db: Session = Depends(get_db), user=Depends(current_writer)):
    """Pull a pending format back to draft (author changed their mind)."""
    f = db.get(ChecksheetFormat, fid)
    if not f:
        raise HTTPException(404, "format not found")
    if f.status != ChecksheetStatus.PENDING:
        raise HTTPException(409, "only a pending format can be withdrawn")
    f.status = ChecksheetStatus.DRAFT
    audit(db, "checksheet_format", f.id, "withdrawn", detail=f"v{f.version} back to draft", actor=user.username)
    db.commit(); db.refresh(f)
    return _to_out(f)


# ---- approve / reject (IC / in-charge) ---------------------------------------

@router.post("/formats/{fid}/approve", response_model=FormatOut)
def approve_format(fid: int, db: Session = Depends(get_db), user=Depends(current_approver)):
    """Approve a pending format → published. Any prior published version of the
    same slug is archived (the new one becomes the single live blank)."""
    f = db.get(ChecksheetFormat, fid)
    if not f:
        raise HTTPException(404, "format not found")
    if f.status != ChecksheetStatus.PENDING:
        raise HTTPException(409, f"only a pending format can be approved (this is {f.status.value})")
    for prev in db.scalars(select(ChecksheetFormat).where(
            ChecksheetFormat.slug == f.slug,
            ChecksheetFormat.status == ChecksheetStatus.PUBLISHED)).all():
        prev.status = ChecksheetStatus.ARCHIVED
        audit(db, "checksheet_format", prev.id, "archived",
              detail=f"superseded by v{f.version}", actor=user.username)
    f.status = ChecksheetStatus.PUBLISHED
    f.approved_by = user.username
    f.approved_at = datetime.utcnow()
    f.reject_reason = None
    audit(db, "checksheet_format", f.id, "approved", detail=f"v{f.version} published", actor=user.username)
    db.commit(); db.refresh(f)
    return _to_out(f)


@router.post("/formats/{fid}/reject", response_model=FormatOut)
def reject_format(fid: int, body: RejectIn, db: Session = Depends(get_db), user=Depends(current_approver)):
    """Reject a pending format → back to draft with the reason recorded."""
    f = db.get(ChecksheetFormat, fid)
    if not f:
        raise HTTPException(404, "format not found")
    if f.status != ChecksheetStatus.PENDING:
        raise HTTPException(409, "only a pending format can be rejected")
    f.status = ChecksheetStatus.DRAFT
    f.reject_reason = body.reason.strip()[:2000]
    audit(db, "checksheet_format", f.id, "rejected", detail=body.reason.strip()[:200], actor=user.username)
    db.commit(); db.refresh(f)
    return _to_out(f)


@router.delete("/formats/{fid}", status_code=204)
def delete_format(fid: int, db: Session = Depends(get_db), user=Depends(current_writer)):
    """Discard a DRAFT (only). Published/archived versions are permanent history."""
    f = db.get(ChecksheetFormat, fid)
    if not f:
        raise HTTPException(404, "format not found")
    if f.status != ChecksheetStatus.DRAFT:
        raise HTTPException(409, "only a draft can be deleted")
    audit(db, "checksheet_format", f.id, "deleted", detail=f"{f.label} v{f.version}", actor=user.username)
    db.delete(f); db.commit()
