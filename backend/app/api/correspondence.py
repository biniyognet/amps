# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Correspondence trail — official letters and emails per line.

A read-mostly register imported from each line's coordination sheet: one row
per letter/email, with the scanned document link, an OCR/summary, and the
asset(s) it concerns. Reads are line-scoped like the logbook; the bulk import
is writer-only and idempotent on (line, SL) so re-imports update in place.
"""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.auth import current_writer, optional_user
from app.db import audit, get_db
from app.models import Correspondence, Location, LocationKind

router = APIRouter()


def _parse_date(s):
    if not s:
        return None
    s = str(s).strip().split()[0]
    for f in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%d-%m-%y", "%d/%m/%y"):
        try:
            return datetime.strptime(s, f).date()
        except ValueError:
            pass
    return None


def _resolve_line(db: Session, name: str | None):
    if not name:
        return None
    return db.scalar(select(Location).where(Location.kind == LocationKind.SITE,
                                            func.lower(Location.name) == name.strip().lower()))


class CorrOut(BaseModel):
    id: int
    seq: int | None
    date: date | None
    mode: str
    ref_no: str | None
    subject: str | None
    related_assets: str | None
    brief: str | None
    sender: str | None
    recipient: str | None
    copy_to: str | None
    link: str | None
    drafting_date: date | None
    drafting_by: str | None
    line: str | None


def _out(c: Correspondence, line_name: str | None) -> CorrOut:
    return CorrOut(id=c.id, seq=c.seq, date=c.corr_date, mode=c.mode, ref_no=c.ref_no,
                   subject=c.subject, related_assets=c.related_assets, brief=c.brief,
                   sender=c.sender, recipient=c.recipient, copy_to=c.copy_to, link=c.link,
                   drafting_date=c.drafting_date, drafting_by=c.drafting_by, line=line_name)


@router.get("", response_model=list[CorrOut])
def list_correspondence(line: str | None = None, mode: str | None = None,
                        db: Session = Depends(get_db), user=Depends(optional_user)):
    """Letters/emails, newest first. Scoped to the caller's line; `line` filters
    further (and is how HQ/admin picks one). `mode` = letter | email."""
    q = select(Correspondence)
    if user.line_id is not None:
        q = q.where(Correspondence.line_id == user.line_id)
    elif line:
        site = _resolve_line(db, line)
        q = q.where(Correspondence.line_id == (site.id if site else -1))
    if mode:
        q = q.where(func.lower(Correspondence.mode) == mode.strip().lower())
    q = q.order_by(Correspondence.corr_date.desc().nullslast(), Correspondence.seq.desc())
    names = {loc.id: loc.name for loc in db.scalars(select(Location)).all()}
    return [_out(c, names.get(c.line_id)) for c in db.scalars(q).all()]


class CorrIn(BaseModel):
    seq: int | None = None
    date: str | None = None
    mode: str | None = "letter"
    ref_no: str | None = None
    subject: str | None = None
    related_assets: str | None = None
    brief: str | None = None
    sender: str | None = None
    recipient: str | None = None
    copy_to: str | None = None
    link: str | None = None
    ocr: str | None = None
    drafting_date: str | None = None
    drafting_by: str | None = None


class ImportIn(BaseModel):
    line: str
    rows: list[CorrIn]


@router.post("/import")
def import_correspondence(body: ImportIn, db: Session = Depends(get_db),
                          user=Depends(current_writer)):
    """Idempotent bulk import. Keyed on (line, seq): a row with a known SL is
    updated in place, a new SL is inserted, so re-running the sheet is safe.
    Rows without an SL are appended (no natural key to match on)."""
    site = _resolve_line(db, body.line)
    if not site:
        raise HTTPException(404, f"unknown line '{body.line}'")
    if user.line_id is not None and user.line_id != site.id:
        raise HTTPException(403, "you can only import into your own line")
    existing = {c.seq: c for c in db.scalars(
        select(Correspondence).where(Correspondence.line_id == site.id,
                                     Correspondence.seq.isnot(None))).all()}
    created = updated = 0
    for r in body.rows:
        mode = (r.mode or "letter").strip().lower()
        if mode not in ("letter", "email"):
            mode = "letter"
        fields = dict(corr_date=_parse_date(r.date), mode=mode, ref_no=r.ref_no,
                      subject=r.subject, related_assets=r.related_assets, brief=r.brief,
                      sender=r.sender, recipient=r.recipient, copy_to=r.copy_to,
                      link=r.link, ocr=r.ocr, drafting_date=_parse_date(r.drafting_date),
                      drafting_by=r.drafting_by)
        row = existing.get(r.seq) if r.seq is not None else None
        if row:
            for k, v in fields.items():
                setattr(row, k, v)
            updated += 1
        else:
            db.add(Correspondence(line_id=site.id, seq=r.seq, **fields))
            created += 1
    audit(db, "correspondence", site.id, "import",
          detail=f"created={created} updated={updated} line={body.line}", actor=user.username)
    db.commit()
    total = db.scalar(select(func.count()).select_from(Correspondence)
                      .where(Correspondence.line_id == site.id))
    return {"created": created, "updated": updated, "total": total}
