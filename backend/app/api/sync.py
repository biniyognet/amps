# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Sheet-sync status — when each line was last pulled from its coordination
sheets, what came in, and which source rows were HELD (and why), so a line's
coordinator can fix their own sheet without asking.

The puller (outside AMPS) PUTs one snapshot per run; it is kept as a JSON file
on the media disk, no table. Reads: counts are public (the dashboard is a
walk-up surface); the held-row list itself needs a session.
"""
import json
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import is_anonymous, optional_user, require_admin

router = APIRouter()
PATH = os.path.join(os.environ.get("AMPS_MEDIA_DIR", "/app/media"), "sync_status.json")


class HeldRow(BaseModel):
    source: str
    date: str = ""
    code: str = ""
    why: str
    detail: str = ""


class LineSync(BaseModel):
    imported: int = 0
    pending: int = 0          # planned but not imported (dry-run / Auto=FALSE)
    held: list[HeldRow] = []
    sources: int = 0
    errors: int = 0


class SyncIn(BaseModel):
    at: datetime
    applied: bool = True
    lines: dict[str, LineSync]


def _load():
    try:
        with open(PATH) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


@router.put("/status")
def put_status(body: SyncIn, admin=Depends(require_admin)):
    tmp = PATH + ".part"
    with open(tmp, "w") as f:
        json.dump(body.model_dump(mode="json"), f, ensure_ascii=False)
    os.replace(tmp, PATH)
    return {"ok": True, "lines": len(body.lines)}


@router.get("/status")
def get_status(line: str | None = None, user=Depends(optional_user)):
    d = _load()
    if not d:
        raise HTTPException(404, "no sync recorded yet")
    anon = is_anonymous(user)
    out = {}
    for name, s in d["lines"].items():
        if line and name != line:
            continue
        held = s.get("held", [])
        out[name] = {"imported": s.get("imported", 0), "pending": s.get("pending", 0), "held_count": len(held),
                     "sources": s.get("sources", 0), "errors": s.get("errors", 0),
                     **({} if anon else {"held": held})}
    return {"at": d["at"], "applied": d.get("applied", True), "lines": out}
