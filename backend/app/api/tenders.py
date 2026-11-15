# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Tenders & drawings — volume index, contract reader, issues, clauses and marks.

Signed-in only. The contract register (tenders, volumes, drawings) is a curated
JSON file (app/data/tenders.json). Issues, their clauses and their linked
letters / failures / job cards, and the reader's notes and bookmarks live in
the database (tender_* tables, created here so the core schema is untouched),
so anyone with write access can build an issue by hand from the reader.
The reader serves the searchable PDF of each volume (contracts/c{k}/V{n}/volume.pdf,
range requests) with page images + page text as fallback. Contract c{k} = the register
entry whose "key" is c{k} (c1 = Siemens PS, the default when no ?c= is given).
An issue's evidence trail = its linked letters/MoMs and job cards, every other
letter whose text matches the issue's keywords, and the Green Line logbook
history of the same equipment — failures, job cards, rectifications (keyword match +
entries linked by hand).
"""
import json
import os
import re
import threading
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, and_, or_, select, text, update
from sqlalchemy.orm import Mapped, Session, mapped_column

from app import gdrive
from app.api.auth import current_user, current_writer, scope_location_ids
from app.db import SessionLocal, engine, get_db
from app.models import Asset, Base, Correspondence, Location, LogEntry, LogEntryType, UserRole

router = APIRouter()

DATA = Path(__file__).resolve().parent.parent / "data" / "tenders.json"
CONTRACTS = Path(os.environ.get("AMPS_MEDIA_DIR", "/app/media")) / "contracts"
NOTES = CONTRACTS / "notes.json"   # pre-database notes, imported once
VOL = re.compile(r"^V[1-9]$")
CT = re.compile(r"^c[1-9]$")
_lock = threading.Lock()


class TenderIssue(Base):
    __tablename__ = "tender_issues"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="Open")
    keywords: Mapped[str] = mapped_column(Text, default="")        # plain, comma-separated
    pattern: Mapped[str | None] = mapped_column(Text)               # optional advanced regex (overrides keywords)
    asset_pattern: Mapped[str | None] = mapped_column(Text)
    actions: Mapped[str] = mapped_column(Text, default="[]")       # JSON [[item, status, next], …]
    by: Mapped[str] = mapped_column(String(120), default="")
    at: Mapped[datetime] = mapped_column(default=datetime.now)


class IssueClause(Base):
    __tablename__ = "tender_issue_clauses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    issue_id: Mapped[str] = mapped_column(ForeignKey("tender_issues.id", ondelete="CASCADE"), index=True)
    contract: Mapped[str] = mapped_column(String(80), default="Siemens PS")
    vol: Mapped[str] = mapped_column(String(80))                   # "V2" or "V2 Employer's Req."
    pdf_p: Mapped[str] = mapped_column(String(20))
    printed_p: Mapped[str] = mapped_column(String(20), default="—")
    clause: Mapped[str] = mapped_column(String(120), default="")
    topic: Mapped[str] = mapped_column(String(200), default="")
    extract: Mapped[str] = mapped_column(Text, default="")
    use: Mapped[str] = mapped_column(Text, default="")
    by: Mapped[str] = mapped_column(String(120), default="")
    user: Mapped[str] = mapped_column(String(80), default="")
    at: Mapped[datetime] = mapped_column(default=datetime.now)


class IssueLink(Base):
    """A letter/MoM (ref_id = correspondence id), a failure (ref_id = failure id)
    or a job card (not in AMPS yet: jc no., date and subject carried here)."""
    __tablename__ = "tender_issue_links"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    issue_id: Mapped[str] = mapped_column(ForeignKey("tender_issues.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10))                  # letter | log | jobcard  (log = logbook entry)
    ref_id: Mapped[int | None] = mapped_column(Integer)
    jc: Mapped[str | None] = mapped_column(String(60))
    date: Mapped[str | None] = mapped_column(String(10))
    subject: Mapped[str | None] = mapped_column(Text)
    why: Mapped[str] = mapped_column(Text, default="")
    key: Mapped[bool] = mapped_column(Boolean, default=False)
    by: Mapped[str] = mapped_column(String(120), default="")
    user: Mapped[str] = mapped_column(String(80), default="")
    at: Mapped[datetime] = mapped_column(default=datetime.now)


class TenderMark(Base):
    """Reader note / ★ important / 🔖 bookmark on a volume page, optionally tied to an issue."""
    __tablename__ = "tender_marks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    contract: Mapped[str] = mapped_column(String(4), default="c1")   # register key c1…c9
    vol: Mapped[str] = mapped_column(String(4))
    page: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(10), default="note")
    title: Mapped[str] = mapped_column(String(120), default="")
    text: Mapped[str] = mapped_column(Text, default="")
    issue_id: Mapped[str | None] = mapped_column(String(40))
    tags: Mapped[str] = mapped_column(Text, default="")      # optional, comma-joined
    assets: Mapped[str] = mapped_column(Text, default="")    # optional asset codes, comma-joined
    status: Mapped[str] = mapped_column(String(12), default="")   # "" | pending | verified
    system: Mapped[str] = mapped_column(String(80), default="")   # optional asset-register system
    by: Mapped[str] = mapped_column(String(120), default="")
    user: Mapped[str] = mapped_column(String(80), default="")
    at: Mapped[datetime] = mapped_column(default=datetime.now)


LEGACY_FAILURE_LOG = {254: 17734, 255: 17937}   # failures.id → the same event in log_entries
LOG_KINDS = (LogEntryType.FAILURE, LogEntryType.JOB_CARD, LogEntryType.RECTIFICATION)
LOG_LABEL = {LogEntryType.FAILURE: "failure", LogEntryType.JOB_CARD: "job card", LogEntryType.RECTIFICATION: "rectification"}
LINE = os.environ.get("AMPS_STANDARD_LINE", "Green Line")
_TABLES = [TenderIssue.__table__, IssueClause.__table__, IssueLink.__table__, TenderMark.__table__]
_ready = False


def _ensure():
    """Create the tender_* tables and seed them once: issues from tenders.json, notes from notes.json."""
    global _ready
    if _ready:
        return
    with _lock:
        if _ready:
            return
        Base.metadata.create_all(engine, tables=_TABLES)
        with engine.begin() as cx:   # marks predate multi-contract: every old one is on c1
            cx.execute(text("ALTER TABLE tender_marks ADD COLUMN IF NOT EXISTS contract VARCHAR(4) NOT NULL DEFAULT 'c1'"))
            cx.execute(text("ALTER TABLE tender_marks ADD COLUMN IF NOT EXISTS tags TEXT NOT NULL DEFAULT ''"))
            cx.execute(text("ALTER TABLE tender_marks ADD COLUMN IF NOT EXISTS assets TEXT NOT NULL DEFAULT ''"))
            cx.execute(text("ALTER TABLE tender_marks ADD COLUMN IF NOT EXISTS status VARCHAR(12) NOT NULL DEFAULT ''"))
            cx.execute(text("ALTER TABLE tender_marks ADD COLUMN IF NOT EXISTS system VARCHAR(80) NOT NULL DEFAULT ''"))
        with SessionLocal() as db:
            if db.scalar(select(TenderIssue.id).limit(1)) is None:
                for i in json.loads(DATA.read_text(encoding="utf-8")).get("issues", []):
                    _seed_issue(db, i)
            if db.scalar(select(TenderMark.id).limit(1)) is None and NOTES.is_file():
                for n in json.loads(NOTES.read_text(encoding="utf-8")):
                    db.add(TenderMark(vol=n["vol"], page=n["page"], kind=n.get("kind", "note"), text=n.get("text", ""),
                                      by=n.get("by", ""), user=n.get("user", ""),
                                      at=datetime.fromisoformat(n["at"]) if n.get("at") else datetime.now()))
            # failure links once pointed at the legacy failures table; the logbook now carries them
            for old, new in LEGACY_FAILURE_LOG.items():
                db.execute(update(IssueLink).where(IssueLink.kind == "failure", IssueLink.ref_id == old)
                           .values(kind="log", ref_id=new))
            db.commit()
        _ready = True


def _seed_issue(db: Session, i: dict):
    db.add(TenderIssue(id=i["id"], title=i["title"], summary=i.get("summary", ""), status=i.get("status", "Open"),
                       keywords=i.get("keywords", "ETS, BLS, emergency trip, blue light, spurious trip"),
                       pattern=i.get("match"), asset_pattern=i.get("asset_match"),
                       actions=json.dumps(i.get("actions", []), ensure_ascii=False), by="seed"))
    db.flush()
    for r in i.get("intel", []):
        db.add(IssueClause(issue_id=i["id"], **{k: str(r.get(k, "")) for k in
                           ("contract", "vol", "pdf_p", "printed_p", "clause", "topic", "extract", "use")}, by="seed"))
    for x in i.get("trail", []):
        if "corr" in x:
            db.add(IssueLink(issue_id=i["id"], kind="letter", ref_id=x["corr"], why=x.get("why", ""), by="seed"))
        else:
            db.add(IssueLink(issue_id=i["id"], kind="jobcard", jc=x["jc"], date=x.get("date"),
                             subject=x.get("subject"), why=x.get("why", ""), by="seed"))
    for fid in i.get("key_failures", []):
        db.add(IssueLink(issue_id=i["id"], kind="log", ref_id=LEGACY_FAILURE_LOG.get(fid, fid), key=True, by="seed"))


def _rx(iss: TenderIssue) -> str | None:
    """Postgres ARE for the issue's letter/failure match: the advanced pattern if set,
    else the plain keywords as whole words (\\y = word boundary in Postgres)."""
    if iss.pattern:
        return iss.pattern
    words = [w.strip() for w in iss.keywords.split(",") if len(w.strip()) >= 2]
    return r"\y(" + "|".join(re.escape(w).replace(r"\ ", r"\s+") for w in words) + r")\y" if words else None


def _who(user) -> dict:
    return {"by": user.full_name or user.username, "user": user.username}


def _own(row, user, what: str):
    if row.user != user.username and user.role != UserRole.ADMIN:
        raise HTTPException(403, f"only the author or an admin can remove {what}")


def _can_edit(db: Session, user) -> bool:
    """Tenders and issues belong to the Green Line desk: its logins (and admins / department-wide
    accounts) edit; every other line reads only. Personal notes and bookmarks stay open to any writer."""
    if user.role == UserRole.ADMIN:
        return True
    if user.role == UserRole.VIEWER:
        return False
    return user.line_id is None or user.line_id == db.scalar(select(Location.id).where(Location.name == LINE))


def tender_editor(db: Session = Depends(get_db), user=Depends(current_writer)):
    if not _can_edit(db, user):
        raise HTTPException(403, "tenders and issues are edited by Green Line logins — this account can read only")
    return user


def _issue(db: Session, iid: str) -> TenderIssue:
    iss = db.get(TenderIssue, iid)
    if not iss:
        raise HTTPException(404, "no such issue")
    return iss


@lru_cache(maxsize=1)
def _register() -> tuple[dict, dict]:
    """key → short name and short name → key, from the contract register (c1 = Siemens PS)."""
    ts = [t for t in json.loads(DATA.read_text(encoding="utf-8")).get("tenders", []) if t.get("key")]
    return {t["key"]: t.get("short") or t["title"] for t in ts}, {t.get("short") or t["title"]: t["key"] for t in ts}


def _clause(c: IssueClause) -> dict:
    return {"id": c.id, "contract": c.contract, "c": _register()[1].get(c.contract, "c1"), "vol": c.vol, "pdf_p": c.pdf_p, "printed_p": c.printed_p,
            "clause": c.clause, "topic": c.topic, "extract": c.extract, "use": c.use, "by": c.by, "user": c.user}


@router.get("")
def tenders_intel(db: Session = Depends(get_db), user=Depends(current_user)):
    _ensure()
    out = json.loads(DATA.read_text(encoding="utf-8"))
    cl = {}
    for c in db.scalars(select(IssueClause).order_by(IssueClause.id)):
        cl.setdefault(c.issue_id, []).append(_clause(c))
    issues = db.scalars(select(TenderIssue).order_by((TenderIssue.status != "Open"), TenderIssue.at.desc()))
    out["issues"] = [{"id": i.id, "title": i.title, "summary": i.summary, "status": i.status, "keywords": i.keywords,
                      "match": _rx(i), "advanced": bool(i.pattern), "actions": json.loads(i.actions or "[]"),
                      "intel": cl.get(i.id, []), "by": i.by, "at": i.at.isoformat(timespec="minutes")}
                     for i in issues]
    out["can_edit"] = _can_edit(db, user)
    return out


class IssueIn(BaseModel):
    id: str = Field(default="", max_length=40, pattern=r"^[A-Za-z0-9-]*$")
    title: str = Field(min_length=3, max_length=200)
    summary: str = Field(default="", max_length=5000)
    status: str = Field(default="Open", pattern=r"^(Open|Watching|Closed)$")
    keywords: str = Field(default="", max_length=500)


class IssuePatch(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=200)
    summary: str | None = Field(default=None, max_length=5000)
    status: str | None = Field(default=None, pattern=r"^(Open|Watching|Closed)$")
    keywords: str | None = Field(default=None, max_length=500)
    actions: list[list[str]] | None = None


@router.post("/issues")
def create_issue(body: IssueIn, db: Session = Depends(get_db), user=Depends(tender_editor)):
    _ensure()
    iid = (body.id or re.sub(r"[^A-Z0-9]+", "-", body.title.upper()).strip("-")[:24].rstrip("-")).upper()
    if not iid:
        raise HTTPException(422, "give the issue an ID")
    if db.get(TenderIssue, iid):
        raise HTTPException(409, f"issue {iid} already exists — pick another ID")
    iss = TenderIssue(id=iid, title=body.title.strip(), summary=body.summary.strip(), status=body.status,
                      keywords=body.keywords.strip(), actions="[]", by=_who(user)["by"])
    db.add(iss)
    db.commit()
    return {"id": iid}


@router.patch("/issues/{iid}")
def update_issue(iid: str, body: IssuePatch, db: Session = Depends(get_db), user=Depends(tender_editor)):
    _ensure()
    iss = _issue(db, iid)
    for k, v in body.model_dump(exclude_none=True).items():
        if k == "actions":
            v = json.dumps([[str(c)[:200] for c in (a + ["", "", ""])[:3]] for a in v], ensure_ascii=False)
        elif k == "keywords" and v.strip() != iss.keywords:
            iss.pattern = None   # plain keywords replace the seeded regex once edited
        setattr(iss, k, v.strip() if isinstance(v, str) and k != "actions" else v)
    db.commit()
    return {"ok": True}


class ClauseIn(BaseModel):
    c: str = Field(default="c1", pattern=r"^c[1-9]$")
    vol: str = Field(pattern=r"^V[1-9]$")
    pdf_p: str = Field(pattern=r"^\d{1,4}(\s*[–-]\s*\d{1,4})?$")
    printed_p: str = Field(default="", max_length=20)
    clause: str = Field(min_length=1, max_length=120)
    topic: str = Field(default="", max_length=200)
    extract: str = Field(default="", max_length=4000)
    use: str = Field(default="", max_length=4000)


@router.post("/issues/{iid}/clauses")
def add_clause(iid: str, body: ClauseIn, db: Session = Depends(get_db), user=Depends(tender_editor)):
    _ensure()
    _issue(db, iid)
    _vol(body.vol, body.c)
    b = body.model_dump()
    b["contract"] = _register()[0].get(b.pop("c"), "Siemens PS")
    c = IssueClause(issue_id=iid, **dict(b, printed_p=body.printed_p.strip() or "—"), **_who(user))
    db.add(c)
    db.commit()
    return _clause(c)


@router.delete("/issues/{iid}/clauses/{cid}")
def delete_clause(iid: str, cid: int, db: Session = Depends(get_db), user=Depends(tender_editor)):
    c = db.get(IssueClause, cid)
    if not c or c.issue_id != iid:
        raise HTTPException(404, "no such clause")
    _own(c, user, "a clause")
    db.delete(c)
    db.commit()
    return {"ok": True}


class LinkIn(BaseModel):
    kind: str = Field(pattern=r"^(letter|log|jobcard)$")
    ref_id: int | None = None
    jc: str = Field(default="", max_length=60)
    date: str = Field(default="", pattern=r"^(\d{4}-\d{2}-\d{2})?$")
    subject: str = Field(default="", max_length=1000)
    why: str = Field(default="", max_length=1000)
    key: bool = False


@router.post("/issues/{iid}/links")
def add_link(iid: str, body: LinkIn, db: Session = Depends(get_db), user=Depends(tender_editor)):
    _ensure()
    _issue(db, iid)
    if body.kind == "jobcard":
        if not body.jc.strip() or not body.subject.strip():
            raise HTTPException(422, "a job card needs its number and subject")
        ln = IssueLink(issue_id=iid, kind="jobcard", jc=body.jc.strip(), date=body.date or None,
                       subject=body.subject.strip(), why=body.why.strip(), key=body.key, **_who(user))
    else:
        model = Correspondence if body.kind == "letter" else LogEntry
        if not body.ref_id or not db.get(model, body.ref_id):
            raise HTTPException(404, f"no such {body.kind}")
        dup = db.scalar(select(IssueLink.id).where(IssueLink.issue_id == iid, IssueLink.kind == body.kind,
                                                   IssueLink.ref_id == body.ref_id))
        if dup:
            raise HTTPException(409, f"that {body.kind} is already linked")
        ln = IssueLink(issue_id=iid, kind=body.kind, ref_id=body.ref_id, why=body.why.strip(), key=body.key, **_who(user))
    db.add(ln)
    db.commit()
    return {"id": ln.id}


@router.delete("/issues/{iid}/links/{lid}")
def delete_link(iid: str, lid: int, db: Session = Depends(get_db), user=Depends(tender_editor)):
    ln = db.get(IssueLink, lid)
    if not ln or ln.issue_id != iid:
        raise HTTPException(404, "no such link")
    _own(ln, user, "a link")
    db.delete(ln)
    db.commit()
    return {"ok": True}


def _vol(vol: str, c: str = "c1") -> Path:
    # contract and vol are whitelisted, never a path
    if not VOL.match(vol) or not CT.match(c):
        raise HTTPException(404, "no such volume")
    d = CONTRACTS / c / vol
    if not d.is_dir() and not gdrive.can_pull(f"contracts/{c}/{vol}/volume.pdf"):
        raise HTTPException(404, "volume not on file")
    return d


@lru_cache(maxsize=48)
def _text(vol: str, c: str = "c1") -> list[str]:
    return json.loads((_vol(vol, c) / "text.json").read_text(encoding="utf-8"))


@router.get("/read/{vol}/page/{n}")
def page_image(vol: str, n: int, c: str = "c1", user=Depends(current_user)):
    f = _vol(vol, c) / f"{n:04d}.jpg"
    if n < 1 or not f.is_file():
        raise HTTPException(404, "no such page")
    return FileResponse(f, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@router.get("/read/{vol}/pdf")
def volume_pdf(vol: str, c: str = "c1", user=Depends(current_user)):
    f = _vol(vol, c) / "volume.pdf"
    st = gdrive.pull(f"contracts/{c}/{vol}/volume.pdf", wait=50)  # missing on the server → pulled from Drive
    if st["state"] == "fetching":
        raise HTTPException(503, f"fetching from Drive ({st['got'] >> 20} of {(st['size'] or 0) >> 20} MB), try again shortly")
    if not f.is_file():
        raise HTTPException(404, "no PDF for this volume yet")
    return FileResponse(f, media_type="application/pdf", headers={"Cache-Control": "private, max-age=86400"})


@router.get("/read/{vol}/text/{n}")
def page_text(vol: str, n: int, c: str = "c1", user=Depends(current_user)):
    pages = _text(vol, c)
    if not 1 <= n <= len(pages):
        raise HTTPException(404, "no such page")
    return {"c": c, "vol": vol, "page": n, "pages": len(pages), "text": pages[n - 1]}


@router.get("/search")
def search(q: str, vol: str = "", c: str = "c1", user=Depends(current_user)):
    """Case-insensitive phrase search across one contract's volumes; one hit per page, with a snippet."""
    q = q.strip()
    if len(q) < 3 or not CT.match(c):
        return {"q": q, "hits": [], "total": 0}
    vols = [vol] if vol else sorted(p.name for p in (CONTRACTS / c).glob("V*") if VOL.match(p.name) and (p / "text.json").is_file())
    rx = re.compile(re.escape(q).replace(r"\ ", r"\s+"), re.I)
    hits, total = [], 0
    for v in vols:
        for i, t in enumerate(_text(v, c), 1):
            found = list(rx.finditer(t))
            if not found:
                continue
            total += 1
            if len(hits) < 300:
                m = found[0]
                snip = t[max(0, m.start() - 90): m.end() + 90].replace("\n", " ")
                hits.append({"vol": v, "page": i, "count": len(found), "snippet": snip})
    return {"q": q, "hits": hits, "total": total}


CORR_FIELDS = ("subject", "brief", "related_assets", "ocr")


def _snip(c: Correspondence, rx: re.Pattern) -> str:
    for f in CORR_FIELDS:
        t = getattr(c, f) or ""
        m = rx.search(t)
        if m:
            return t[max(0, m.start() - 90): m.end() + 120].replace("\n", " ")
    return ""


def _corr(c: Correspondence, why: str = "", snippet: str = "") -> dict:
    return {"kind": c.mode, "id": c.id, "date": c.corr_date.isoformat() if c.corr_date else None,
            "ref_no": c.ref_no, "subject": c.subject, "why": why, "snippet": snippet,
            "link": c.link if c.link and re.match(r"^https?://", c.link) else None}


@router.get("/issue/{iid}/trail")
def issue_trail(iid: str, db: Session = Depends(get_db), user=Depends(current_user)):
    """Linked letters/MoMs and job cards for the issue, then every other letter that matches its keywords."""
    _ensure()
    iss = _issue(db, iid)
    links = list(db.scalars(select(IssueLink).where(IssueLink.issue_id == iid).order_by(IssueLink.id)))
    mine = lambda ln: {"link_id": ln.id, "link_by": ln.by, "link_user": ln.user}
    lk = [x for x in links if x.kind == "letter"]
    rows = {c.id: c for c in db.scalars(select(Correspondence).where(Correspondence.id.in_([x.ref_id for x in lk] or [0])))}
    trail = [dict(_corr(rows[x.ref_id], x.why), **mine(x)) for x in lk if x.ref_id in rows]
    trail += [dict(kind="job card", jc=x.jc, date=x.date, subject=x.subject, why=x.why, **mine(x))
              for x in links if x.kind == "jobcard"]
    m = _rx(iss)
    auto = []
    if m:
        rx = re.compile(m.replace(r"\y", r"\b"), re.I)
        q = (select(Correspondence)
             .where(or_(*(getattr(Correspondence, f).op("~*")(m) for f in CORR_FIELDS)))
             .where(Correspondence.id.not_in(list(rows) or [0]))
             .order_by(Correspondence.corr_date.desc().nulls_last()).limit(60))
        auto = [_corr(c, snippet=_snip(c, rx)) for c in db.scalars(q)]
    fl = {x.ref_id: x for x in links if x.kind == "log"}
    return {"trail": sorted(trail, key=lambda x: x["date"] or ""), "auto": auto,
            "failures": _failures(db, user, iss, m, fl)}


_PFX = re.compile(r"^\[[^\]]+\]\s*")


def _log_q(db: Session, user, *conds):
    """Green Line logbook failures, job cards and rectifications (not retracted), with asset + station."""
    line = db.scalar(select(Location.id).where(Location.name == LINE))
    q = (select(LogEntry, Asset.code, Asset.name, Location.name)
         .outerjoin(Asset, LogEntry.asset_id == Asset.id).outerjoin(Location, Asset.location_id == Location.id)
         .where(LogEntry.type.in_(LOG_KINDS), LogEntry.retracted.isnot(True), LogEntry.line_id == line, *conds))
    scope = scope_location_ids(db, user)
    if scope is not None:
        q = q.where(or_(Asset.location_id.in_(scope), and_(LogEntry.asset_id.is_(None), LogEntry.line_id.in_(scope))))
    return q


def _log(e: LogEntry, code, name, loc) -> dict:
    return {"id": e.id, "kind": LOG_LABEL.get(e.type, e.type.value), "date": e.log_date.isoformat() if e.log_date else None,
            "asset": code or e.category or "—", "asset_name": name, "location": e.station or loc or "",
            "fault": e.fault_type or "", "description": _PFX.sub("", e.text or ""), "work_done": e.action_taken,
            "closed": e.ended_at.date().isoformat() if e.ended_at else None, "rectifies": e.rectifies_id}


def _failures(db: Session, user, iss: TenderIssue, m: str | None, fl: dict) -> list[dict]:
    """The issue's equipment history from the Green Line logbook — failures, job cards and
    rectifications whose asset code or text matches — plus entries linked by hand."""
    conds = [LogEntry.id.in_(list(fl) or [0])]
    if m:
        conds += [Asset.code.op("~*")(iss.asset_pattern or m),
                  *(c.op("~*")(m) for c in (LogEntry.text, LogEntry.fault_type, LogEntry.action_taken))]
    q = _log_q(db, user, or_(*conds)).order_by(LogEntry.at.desc()).limit(200)
    out = []
    for e, code, name, loc in db.execute(q):
        ln = fl.get(e.id)
        out.append({**_log(e, code, name, loc),
                    "key": bool(ln and ln.key), "linked": bool(ln), "why": ln.why if ln else "",
                    **({"link_id": ln.id, "link_user": ln.user} if ln else {})})
    return out


@router.get("/letters")
def search_letters(q: str, db: Session = Depends(get_db), user=Depends(current_user)):
    """Reader search across letters, emails and MoMs (subject, brief, assets, OCR text)."""
    q = q.strip()
    if len(q) < 3:
        return []
    like = f"%{q}%"
    rx = re.compile(re.escape(q).replace(r"\ ", r"\s+"), re.I)
    rows = db.scalars(select(Correspondence)
                      .where(or_(*(getattr(Correspondence, f).ilike(like) for f in CORR_FIELDS)))
                      .order_by(Correspondence.corr_date.desc().nulls_last()).limit(40))
    return [_corr(c, snippet=_snip(c, rx)) for c in rows]


@router.get("/failures")
def search_failures(q: str, db: Session = Depends(get_db), user=Depends(current_user)):
    """Logbook search for linking to an issue: #id, asset code/name, fault, entry text."""
    q = q.strip()
    if len(q) < 2:
        return []
    like = f"%{q}%"
    cond = [Asset.code.ilike(like), Asset.name.ilike(like), LogEntry.fault_type.ilike(like), LogEntry.text.ilike(like),
            LogEntry.station.ilike(like)]
    if q.lstrip("#").isdigit():
        cond.append(LogEntry.id == int(q.lstrip("#")))
    sq = _log_q(db, user, or_(*cond)).order_by(LogEntry.at.desc()).limit(30)
    return [dict(_log(e, code, name, loc), description=_PFX.sub("", e.text or "")[:200]) for e, code, name, loc in db.execute(sq)]


class NoteIn(BaseModel):
    c: str = Field(default="c1", pattern=r"^c[1-9]$")
    vol: str = Field(pattern=r"^V[1-9]$")
    page: int = Field(ge=1, le=5000)
    kind: str = Field(default="note", pattern=r"^(note|important|bookmark)$")
    title: str = Field(default="", max_length=120)
    text: str = Field(default="", max_length=2000)
    issue_id: str | None = Field(default=None, max_length=40)
    tags: list[str] = Field(default=[], max_length=20)
    assets: list[str] = Field(default=[], max_length=50)
    status: str = Field(default="", pattern=r"^(|pending|verified)$")
    system: str = Field(default="", max_length=80)


class NotePatch(BaseModel):
    kind: str | None = Field(default=None, pattern=r"^(note|important|bookmark)$")
    title: str | None = Field(default=None, max_length=120)
    text: str | None = Field(default=None, max_length=2000)
    issue_id: str | None = Field(default=None, max_length=40)   # "" clears the link
    system: str | None = Field(default=None, max_length=80)
    status: str | None = Field(default=None, pattern=r"^(|pending|verified)$")
    tags: list[str] | None = Field(default=None, max_length=20)
    assets: list[str] | None = Field(default=None, max_length=50)


def _csv(xs: list[str], upper: bool = False) -> str:
    out = []
    for x in xs:
        x = x.strip()[:60]
        x = x.upper() if upper else x
        if x and x not in out:
            out.append(x)
    return ",".join(out)


def _split(s: str | None) -> list[str]:
    return [x for x in (s or "").split(",") if x]


def _mark(n: TenderMark, user) -> dict:
    return {"id": n.id, "c": n.contract or "c1", "vol": n.vol, "page": n.page, "kind": n.kind, "title": n.title, "text": n.text,
            "issue_id": n.issue_id, "tags": _split(n.tags), "assets": _split(n.assets), "status": n.status or "", "system": n.system or "", "by": n.by, "user": n.user, "mine": n.user == user.username,
            "at": n.at.isoformat(timespec="minutes")}


@router.get("/notes")
def list_notes(db: Session = Depends(get_db), user=Depends(current_user)):
    _ensure()
    return [_mark(n, user) for n in db.scalars(select(TenderMark).order_by(TenderMark.id))]


@router.post("/notes")
def add_note(body: NoteIn, db: Session = Depends(get_db), user=Depends(current_writer)):
    _ensure()
    _vol(body.vol, body.c)
    if body.issue_id:
        _issue(db, body.issue_id)
    b = body.model_dump()
    b["contract"] = b.pop("c")
    n = TenderMark(**dict(b, title=body.title.strip(), text=body.text.strip(),
                          tags=_csv(body.tags), assets=_csv(body.assets, upper=True), system=body.system.strip()), **_who(user))
    db.add(n)
    db.commit()
    return _mark(n, user)


@router.get("/note-assets")
def note_assets(db: Session = Depends(get_db), user=Depends(current_user)):
    """Slim code/name/system list for the note form's System → Asset dropdowns (same scope as the register)."""
    q = select(Asset.code, Asset.name, Asset.system).order_by(Asset.system, Asset.code)
    scope = scope_location_ids(db, user)
    if scope is not None:
        q = q.where(Asset.location_id.in_(scope))
    if getattr(user, "depot", None):
        q = q.where(Asset.depot == user.depot)
    return [{"code": c, "name": nm, "system": s or ""} for c, nm, s in db.execute(q)]


@router.patch("/notes/{nid}")
def patch_note(nid: int, body: NotePatch, db: Session = Depends(get_db), user=Depends(current_writer)):
    _ensure()
    n = db.get(TenderMark, nid)
    if not n:
        raise HTTPException(404, "no such note")
    # ticking status is shared checklist work; editing the note itself stays with its author
    if any(v is not None for v in (body.kind, body.title, body.text, body.issue_id, body.system, body.tags, body.assets)):
        _own(n, user, "a note")
    if body.issue_id:
        _issue(db, body.issue_id)
    if body.issue_id is not None:
        n.issue_id = body.issue_id or None
    if body.kind is not None:
        n.kind = body.kind
    if body.title is not None:
        n.title = body.title.strip()
    if body.text is not None:
        n.text = body.text.strip()
    if body.status is not None:
        n.status = body.status
    if body.system is not None:
        n.system = body.system.strip()
    if body.tags is not None:
        n.tags = _csv(body.tags)
    if body.assets is not None:
        n.assets = _csv(body.assets, upper=True)
    db.commit()
    return _mark(n, user)


@router.delete("/notes/{nid}")
def delete_note(nid: int, db: Session = Depends(get_db), user=Depends(current_writer)):
    _ensure()
    n = db.get(TenderMark, nid)
    if not n:
        raise HTTPException(404, "no such note")
    _own(n, user, "a note")
    db.delete(n)
    db.commit()
    return {"ok": True}
