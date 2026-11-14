# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Drawings & manuals — the PS drawing register, tagged to assets.

Signed-in only. The register is a curated JSON file (app/data/drawings.json),
built from the PS/CPD Drive folder "DRAWING & MANNUAL" and mirrored in the
Green Line drawing sheet (S N 28 onward). Each entry carries its AMPS system,
class, station, stage (As Built / Final / with comments …) and the ids of the
assets it covers, so an asset page lists its own drawings. The files themselves
sit on the media volume (drawings/<drive id>.<ext>) and are served with range
requests, so the pdf.js viewer opens a large drawing set on the pages in view.
A file not on the volume yet is fetched from Drive on first open and kept
(read-only service account, app/gdrive.py), so a new upload needs no copy step.
"""
import json
import os
import re
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import gdrive
from app.api.auth import current_user
from app.db import get_db
from app.models import Asset, Location

router = APIRouter()

DATA = Path(__file__).resolve().parent.parent / "data" / "drawings.json"
FILES = Path(os.environ.get("AMPS_MEDIA_DIR", "/app/media")) / "drawings"
DID = re.compile(r"^[A-Za-z0-9_-]{10,80}$")
MIME = {"pdf": "application/pdf", "xls": "application/vnd.ms-excel",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "mp4": "video/mp4", "rar": "application/vnd.rar", "7z": "application/x-7z-compressed"}


@lru_cache(maxsize=1)
def _register() -> tuple[dict, dict, dict[int, list[str]]]:
    reg = json.loads(DATA.read_text())
    by_id = {d["id"]: d for d in reg["drawings"]}
    by_asset: dict[int, list[str]] = {}
    for d in reg["drawings"]:
        for aid in d["asset_ids"]:
            by_asset.setdefault(aid, []).append(d["id"])
    return reg, by_id, by_asset


def _row(d: dict) -> dict:
    """List shape: everything but the (long) asset id list."""
    r = {k: v for k, v in d.items() if k != "asset_ids"}
    r["assets"] = len(d["asset_ids"])
    r["on_server"] = (FILES / f"{d['id']}.{d['ext']}").exists()
    r["fetchable"] = r["on_server"] or gdrive.can_pull(_rel(d))
    return r


def _get(did: str) -> dict:
    if not DID.match(did):
        raise HTTPException(404, "no such drawing")
    d = _register()[1].get(did)
    if not d:
        raise HTTPException(404, "no such drawing")
    return d


@router.get("")
def list_drawings(user=Depends(current_user)):
    reg = _register()[0]
    return {"line": reg["line"], "source": reg["source"], "built": reg["built"],
            "drawings": [_row(d) for d in reg["drawings"]]}


@router.get("/for-asset")
def for_asset(code: str, location: str = "", db: Session = Depends(get_db), user=Depends(current_user)):
    """Drawings tagged to one asset — the asset page's Drawings card. Codes repeat
    across lines, so the station pins it; latest (As Built) sets first."""
    q = select(Asset.id).where(Asset.code == code.strip())
    if location:
        q = q.join(Location, Asset.location_id == Location.id).where(Location.name == location)
    ids = [i for (i,) in db.execute(q)]
    _, by_id, by_asset = _register()
    seen, out = set(), []
    for aid in ids:
        for did in by_asset.get(aid, []):
            if did not in seen:
                seen.add(did)
                out.append(_row(by_id[did]))
    out.sort(key=lambda r: (r["kind"] != "drawing", r["superseded"], not r["latest"], r["cls"], r["title"]))
    return out


@router.get("/{did}")
def drawing(did: str, db: Session = Depends(get_db), user=Depends(current_user)):
    """One drawing with the assets it covers (code, name, station)."""
    d = _get(did)
    rows = db.execute(
        select(Asset.id, Asset.code, Asset.name, Location.name)
        .join(Location, Asset.location_id == Location.id)
        .where(Asset.id.in_(d["asset_ids"])).order_by(Location.name, Asset.code)).all() if d["asset_ids"] else []
    r = _row(d)
    r["linked"] = [{"id": i, "code": c, "name": n, "location": loc} for i, c, n, loc in rows]
    # other issues of the same set (same class + station) — e.g. the As Built beside its review copies
    reg = _register()[0]["drawings"]
    r["siblings"] = [{"id": x["id"], "title": x["title"], "stage": x["stage"], "date": x["date"], "latest": x["latest"]}
                     for x in reg if x["id"] != did and x["kind"] == d["kind"] and x["cls"] == d["cls"]
                     and x["location"] == d["location"] and d["location"] != "ALL"]
    return r


def _rel(d: dict) -> str:
    return f"drawings/{d['id']}.{d['ext']}"


@router.post("/{did}/fetch")
def fetch(did: str, user=Depends(current_user)):
    """Bring the file onto the server from Drive (the viewer polls this before
    opening): {state: ready|fetching|failed|unknown, got, size, error}."""
    return gdrive.pull(_rel(_get(did)), wait=20)


@router.get("/{did}/file")
def drawing_file(did: str, user=Depends(current_user)):
    d = _get(did)
    st = gdrive.pull(_rel(d), wait=50)
    if st["state"] == "fetching":
        raise HTTPException(503, f"fetching from Drive ({st['got'] >> 20} of {(st['size'] or 0) >> 20} MB), try again shortly")
    if st["state"] != "ready":
        raise HTTPException(404, f"file not on the server — {st.get('error', '')}")
    f = FILES / f"{d['id']}.{d['ext']}"
    inline = d["ext"] in ("pdf", "mp4")
    return FileResponse(f, media_type=MIME.get(d["ext"], "application/octet-stream"),
                        filename=None if inline else d["file"],
                        headers={"Cache-Control": "private, max-age=86400"})
