# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Maintaining agencies — the section's own staff and the AMC / OEM agencies,
each with a contract and scope rules saying which assets and cycles it covers.

`Resolver` answers "who maintains this asset for this cycle?": the asset's own
override first, else the most specific matching rule, else the section
(in-house). Auto-plan uses it to keep AMC work off the roster, and planned
rows use `canonical()` so "TVS AMC" and "M/s Voltara" count as one agency.
"""
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.auth import current_user, is_anonymous, optional_user
from app.db import audit, get_db
from app.engine import SCHEDULE_FREQ
from app.models import Agency, AgencyScope, Asset, AssetClass, Location, UserRole

router = APIRouter()

KINDS = ("in_house", "amc", "oem")
EXPIRING_DAYS = 45       # a contract ending within this window is flagged


def _key(name: str | None) -> str:
    """Spelling-insensitive key: case, punctuation and a leading "M/s" ignored."""
    s = re.sub(r"^\s*m\s*/\s*s\.?\s*", "", (name or "").lower())
    return re.sub(r"[^a-z0-9]+", "", s)


def _aliases(a: Agency) -> list[str]:
    return [x.strip() for x in re.split(r"[,\n;]", a.aliases or "") if x.strip()]


def _cycles(s: AgencyScope) -> set[str] | None:
    c = {x.strip() for x in (s.cycles or "").split(",") if x.strip()}
    return c or None


def contract_state(a: Agency, today: date | None = None) -> str:
    """in_house | valid | expiring | expired | not_started | open (no dates)."""
    if a.kind == "in_house":
        return "in_house"
    today = today or date.today()
    if a.valid_to and a.valid_to < today:
        return "expired"
    if a.valid_from and a.valid_from > today:
        return "not_started"
    if a.valid_to and (a.valid_to - today).days <= EXPIRING_DAYS:
        return "expiring"
    return "valid" if (a.valid_from or a.valid_to) else "open"


def in_contract(a: Agency, d: date) -> bool:
    return (not a.valid_from or d >= a.valid_from) and (not a.valid_to or d <= a.valid_to)


class Resolver:
    """Loads the register once per request; `who(asset, cycle)` → Agency | None
    (None = in-house, nobody registered)."""

    def __init__(self, db: Session):
        self.agencies = {a.id: a for a in db.scalars(
            select(Agency).options(selectinload(Agency.scopes))).all()}
        self.rules = [(s, self.agencies[s.agency_id], _cycles(s))
                      for a in self.agencies.values() for s in a.scopes]
        self.by_key = {}
        for a in self.agencies.values():
            for n in [a.name, *_aliases(a)]:
                self.by_key.setdefault(_key(n), a)

    def __bool__(self):
        return bool(self.agencies)

    def who(self, asset: Asset, cycle: str | None = None) -> Agency | None:
        if asset.agency_id and asset.agency_id in self.agencies:
            return self.agencies[asset.agency_id]
        best, rank = None, -1
        for s, a, cyc in self.rules:
            if a.line_id and a.line_id != asset.line_id:
                continue
            if s.system and s.system != asset.system:
                continue
            if s.depot and s.depot != asset.depot:
                continue
            if s.asset_class_id and s.asset_class_id != asset.asset_class_id:
                continue
            if s.location_id and s.location_id != asset.location_id:
                continue
            if cyc and cycle and cycle not in cyc:
                continue
            r = sum(1 for v in (s.system, s.depot, s.asset_class_id, s.location_id, cyc) if v)
            if r > rank or (r == rank and best and a.id < best.id):
                best, rank = a, r
        return best

    def canonical(self, name: str | None) -> str | None:
        """The register name for a free-text contractor, or the text itself."""
        name = (name or "").strip()
        if not name:
            return None
        a = self.by_key.get(_key(name))
        return a.name if a else name

    def kind_of(self, name: str | None) -> str | None:
        a = self.by_key.get(_key(name)) if name else None
        return a.kind if a else None


def is_in_house(a: Agency | None) -> bool:
    return a is None or a.kind == "in_house"


# ---- API --------------------------------------------------------------------

class ScopeIO(BaseModel):
    system: str | None = None
    depot: str | None = None
    asset_class: str | None = None     # by name
    station: str | None = None         # by name
    cycles: list[str] = []


class AgencyIn(BaseModel):
    name: str
    kind: str = "amc"
    contract_no: str | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    aliases: list[str] = []
    note: str | None = None
    scopes: list[ScopeIO] = []


def _manager(user=Depends(current_user)):
    """The register is a contract record: in-charge or admin edits it."""
    if user.role not in (UserRole.INCHARGE, UserRole.ADMIN):
        raise HTTPException(403, "the agency register needs an in-charge or admin account")
    return user


def _out(db: Session, a: Agency, today: date) -> dict:
    cls = {c.id: c.name for c in db.scalars(select(AssetClass)).all()}
    loc = {s.location_id: None for s in a.scopes if s.location_id}
    for lid in loc:
        l = db.get(Location, lid)
        loc[lid] = l.name if l else None
    return {"id": a.id, "name": a.name, "kind": a.kind, "contract_no": a.contract_no,
            "valid_from": a.valid_from, "valid_to": a.valid_to, "aliases": _aliases(a),
            "note": a.note, "contract_state": contract_state(a, today),
            "days_left": (a.valid_to - today).days if a.valid_to else None,
            "scopes": [{"id": s.id, "system": s.system, "depot": s.depot,
                        "asset_class": cls.get(s.asset_class_id), "station": loc.get(s.location_id),
                        "cycles": sorted(_cycles(s) or (), key=lambda c: SCHEDULE_FREQ.get(c, 0))}
                       for s in a.scopes]}


def _apply(db: Session, a: Agency, body: AgencyIn):
    if body.kind not in KINDS:
        raise HTTPException(422, f"kind must be one of {', '.join(KINDS)}")
    if body.valid_from and body.valid_to and body.valid_to < body.valid_from:
        raise HTTPException(422, "contract ends before it starts")
    name = body.name.strip()[:120]
    if not name:
        raise HTTPException(422, "name is required")
    clash = db.scalar(select(Agency).where(Agency.name == name, Agency.id != (a.id or 0)))
    if clash:
        raise HTTPException(409, f"{name} is already in the register")
    a.name, a.kind, a.note = name, body.kind, (body.note or "").strip() or None
    a.contract_no = (body.contract_no or "").strip()[:120] or None
    a.valid_from, a.valid_to = body.valid_from, body.valid_to
    a.aliases = ", ".join(x.strip() for x in body.aliases if x.strip()) or None
    a.scopes.clear()
    for s in body.scopes:
        cyc = [c for c in s.cycles if c in SCHEDULE_FREQ]
        bad = [c for c in s.cycles if c not in SCHEDULE_FREQ]
        if bad:
            raise HTTPException(422, f"unknown cycle {bad[0]!r}")
        cid = lid = None
        if s.asset_class:
            cid = db.scalar(select(AssetClass.id).where(AssetClass.name == s.asset_class))
            if cid is None:
                raise HTTPException(422, f"unknown asset class {s.asset_class!r}")
        if s.station:
            lid = db.scalar(select(Location.id).where(Location.name == s.station))
            if lid is None:
                raise HTTPException(422, f"unknown station {s.station!r}")
        a.scopes.append(AgencyScope(system=(s.system or "").strip() or None,
                                    depot=(s.depot or "").strip() or None,
                                    asset_class_id=cid, location_id=lid,
                                    cycles=",".join(cyc) or None))


@router.get("")
def list_agencies(db: Session = Depends(get_db), user=Depends(optional_user)):
    if is_anonymous(user):
        raise HTTPException(401, "login required")
    today = date.today()
    rows = db.scalars(select(Agency).options(selectinload(Agency.scopes))
                      .order_by(Agency.kind != "in_house", Agency.name)).all()
    return [_out(db, a, today) for a in rows]


@router.post("")
def create_agency(body: AgencyIn, db: Session = Depends(get_db), user=Depends(_manager)):
    a = Agency()
    _apply(db, a, body)
    db.add(a)
    db.flush()
    audit(db, "agency", a.id, "created", detail=f"{a.name} ({a.kind})", actor=user.username)
    db.commit()
    return _out(db, a, date.today())


@router.put("/{aid}")
def update_agency(aid: int, body: AgencyIn, db: Session = Depends(get_db), user=Depends(_manager)):
    a = db.get(Agency, aid)
    if not a:
        raise HTTPException(404, "agency not found")
    _apply(db, a, body)
    audit(db, "agency", a.id, "updated", detail=f"{a.name} ({a.kind})", actor=user.username)
    db.commit()
    return _out(db, a, date.today())


@router.delete("/{aid}")
def delete_agency(aid: int, db: Session = Depends(get_db), user=Depends(_manager)):
    """Removes the register entry only; planned rows keep their contractor text."""
    a = db.get(Agency, aid)
    if not a:
        raise HTTPException(404, "agency not found")
    for asset in db.scalars(select(Asset).where(Asset.agency_id == aid)).all():
        asset.agency_id = None
    audit(db, "agency", a.id, "deleted", detail=a.name, actor=user.username)
    db.delete(a)
    db.commit()
    return {"deleted": aid}
