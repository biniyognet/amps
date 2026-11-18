# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Snap & Report — the one-tap failure / job-card path from the shop floor.

Scan the asset's QR → photo + a remark → Gemini reads the photo AND the asset's
own history and drafts fault type, severity, likely cause and action → the
person edits, ticks Failure report and/or Job card (+ the agency) → linked log
entries are filed through the ordinary log-book path with the photo attached.

The AI only drafts; nothing is written until a signed-in writer submits. The
draft and the photo are held in-process for 15 minutes between the two calls
(one replica — same as the PM-plan drafts in api/ai.py)."""
import base64
import hashlib
import json
import os
import time
import urllib.error
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import ai
from app.api.assets import visible_asset
from app.api.auth import current_writer
from app.api.logbook import (ATTACH_MAX_BYTES, LogEntryIn, _add_one,
                             _latest_open_failure, _store_attachment)
from app.db import audit, get_db
from app.models import LogEntry, LogEntryType

router = APIRouter()

PHOTO_MIME = ("image/jpeg", "image/png", "image/webp")
HOLD_TTL = 15 * 60
HOLD_MAX = 64
SEVERITIES = ("low", "med", "high", "critical")
# Safety-gear check, read from the same photo in the same call (no extra quota).
GEAR = ("helmet", "vest", "lockout_tag")
GEAR_STATES = ("present", "missing", "unclear")
DEFAULT_AGENCIES = [a.strip() for a in os.environ.get("AMPS_AGENCIES", "").split(",") if a.strip()]
# The fallback model can read the photo (e.g. Gemma 3 on the local Ollama).
FALLBACK_VISION = os.environ.get("AMPS_AI_FALLBACK_VISION", "") == "1"

# photo_token -> (bytes, mime, filename, held_at)
_held: dict[str, tuple[bytes, str, str, float]] = {}


def _hold(data: bytes, mime: str, name: str) -> str:
    now = time.time()
    for k in [k for k, v in _held.items() if now - v[3] > HOLD_TTL]:
        _held.pop(k, None)
    while len(_held) >= HOLD_MAX:   # oldest out
        _held.pop(min(_held, key=lambda k: _held[k][3]))
    token = hashlib.sha256(data).hexdigest()
    _held[token] = (data, mime, name, now)
    return token


def _ist_now() -> datetime:
    return datetime.utcnow() + timedelta(hours=5, minutes=30)


def _client_ip(request: Request) -> str:
    return (request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for", "")
            .split(",")[0].strip() or (request.client.host if request.client else "?"))


# ---- agencies ---------------------------------------------------------------

@router.get("/agencies", response_model=list[str])
def agencies(db: Session = Depends(get_db), user=Depends(current_writer)):
    """Who a job card can be issued to: every crew/firm already named on a job
    card in the caller's scope, plus the deployment's AMPS_AGENCIES defaults."""
    q = select(LogEntry.attended_by).where(LogEntry.type == LogEntryType.JOB_CARD,
                                           LogEntry.attended_by.isnot(None)).distinct()
    if user.line_id is not None:
        q = q.where((LogEntry.line_id == user.line_id) | (LogEntry.line_id.is_(None)))
    names = {n.strip() for n in db.scalars(q) if n and n.strip()} | set(DEFAULT_AGENCIES)
    return sorted(names, key=str.lower)


# ---- analyse (drafts only, writes nothing) ----------------------------------

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "fault_type": {"type": "STRING", "description": "short fault class, e.g. 'Overheating', 'Oil leak'"},
        "severity": {"type": "STRING", "enum": list(SEVERITIES)},
        "likely_cause": {"type": "STRING"},
        "suggested_action": {"type": "STRING"},
        "safety_note": {"type": "STRING"},
        "confidence": {"type": "NUMBER", "description": "0..1"},
        "recommend": {"type": "OBJECT", "properties": {
            "failure": {"type": "BOOLEAN"}, "job_card": {"type": "BOOLEAN"}},
            "required": ["failure", "job_card"]},
        "summary": {"type": "STRING", "description": "one-line report title"},
        "safety_flags": {"type": "OBJECT", "description": "PPE / isolation seen in the photo", "properties": {
            **{k: {"type": "STRING", "enum": list(GEAR_STATES)} for k in GEAR},
            "note": {"type": "STRING"}},
            "required": [*GEAR, "note"]},
    },
    "required": ["fault_type", "severity", "likely_cause", "suggested_action",
                 "safety_note", "confidence", "recommend", "summary", "safety_flags"],
}

PROMPT = (
    "You are a maintenance engineer's assistant in AMPS, an asset-maintenance system for "
    "electrical and industrial plant. A technician on site photographed an asset and wrote "
    "a remark. Using the photo (if any), the remark and the asset's own record and recent "
    "log below, draft a fault report. Be specific and practical; do not invent readings "
    "you cannot see. Severity: critical = safety risk or service loss now; high = likely "
    "breakdown soon; med = needs planned attention; low = cosmetic / monitor. Recommend a "
    "failure report when the asset is faulty, and a job card when outside or specialist "
    "work (OEM, contractor, another department) is needed. If the photo does not show a "
    "fault, say so and lower the confidence. safety_flags: for the helmet and hi-vis vest "
    "on any person in the photo, and a lockout/tag on the isolation point, answer present, "
    "missing or unclear; unclear when it is not in view or there is no photo. note = one "
    "short line on what you saw.\n\n"
    "Technician's remark: {remarks}\n\nAsset record and recent log (JSON):\n{history}"
)


def _clean(d: dict) -> dict:
    rec = d.get("recommend") or {}
    sev = str(d.get("severity", "med")).lower()
    try:
        conf = max(0.0, min(1.0, float(d.get("confidence", 0.5))))
    except (TypeError, ValueError):
        conf = 0.5
    s = lambda k, n=600: (str(d.get(k) or "").strip())[:n]
    return {
        "fault_type": s("fault_type", 80), "severity": sev if sev in SEVERITIES else "med",
        "likely_cause": s("likely_cause"), "suggested_action": s("suggested_action"),
        "safety_note": s("safety_note"), "confidence": round(conf, 2),
        "recommend": {"failure": bool(rec.get("failure", True)), "job_card": bool(rec.get("job_card", False))},
        "summary": s("summary", 160),
        "safety_flags": _clean_flags(d.get("safety_flags")),
    }


def _clean_flags(f) -> dict:
    """Anything the model leaves out or garbles reads as unclear, never as present."""
    f = f if isinstance(f, dict) else {}
    out = {}
    for k in GEAR:
        v = str(f.get(k) or "").strip().lower()
        out[k] = v if v in GEAR_STATES else "unclear"
    out["note"] = str(f.get("note") or "").strip()[:200]
    return out


def _gemini_draft(prompt: str, photo: tuple[bytes, str] | None) -> dict:
    parts = [{"text": prompt}]
    if photo:
        parts.insert(0, {"inline_data": {"mime_type": photo[1],
                                         "data": base64.b64encode(photo[0]).decode()}})
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{ai.GEMINI_MODEL}:generateContent"
    resp = ai._post(url, {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1024,
                             "responseMimeType": "application/json", "responseSchema": SCHEMA,
                             "thinkingConfig": {"thinkingBudget": 0}},
    }, {"x-goog-api-key": ai.GEMINI_KEY})
    out = (resp.get("candidates") or [{}])[0].get("content", {}).get("parts") or []
    return json.loads("".join(p.get("text", "") for p in out))


def _openai_draft(base: str, model: str, prompt: str,
                  photo: tuple[bytes, str] | None = None) -> dict:
    """Draft through an OpenAI-compatible endpoint — the local Ollama fallback
    when Gemini is down. Sends the photo only when one is given (a vision model)."""
    headers = {}
    if os.environ.get("AMPS_AI_API_KEY"):
        headers["Authorization"] = f"Bearer {os.environ['AMPS_AI_API_KEY']}"
    keys = ", ".join(SCHEMA["properties"])
    if photo:
        url = f"data:{photo[1]};base64,{base64.b64encode(photo[0]).decode()}"
        user_msg = [{"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": url}}]
    else:
        user_msg = prompt + "\n\n(No photo is available to you — work from the remark and the history.)"
    resp = ai._post(f"{base}/chat/completions", {
        "model": model, "temperature": 0.2, "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": f"Reply with one JSON object with keys: {keys}. "
                      "recommend = {failure: bool, job_card: bool}. severity one of low|med|high|critical. "
                      "safety_flags = {helmet, vest, lockout_tag: present|missing|unclear, note: string}."},
                     {"role": "user", "content": user_msg}],
    }, headers)
    return json.loads(resp["choices"][0]["message"]["content"])


@router.post("/analyze")
async def analyze(request: Request, asset_code: str = Form(...), remarks: str = Form(""),
                  photo: UploadFile | None = None,
                  db: Session = Depends(get_db), user=Depends(current_writer)):
    asset = visible_asset(db, asset_code, user)
    remarks = remarks.strip()[:1000]
    held = None
    if photo is not None and photo.filename:
        if photo.content_type not in PHOTO_MIME:
            raise HTTPException(422, "photo must be JPEG, PNG or WebP")
        data = await photo.read()
        if len(data) > ATTACH_MAX_BYTES:
            raise HTTPException(413, "photo too large — retake at a lower resolution")
        if data:
            held = (data, photo.content_type, photo.filename)
    if not held and len(remarks) < 3:
        raise HTTPException(422, "add a photo or a remark")
    token = _hold(*held) if held else None
    # No AI, over the allowance, or the service down: still 200 with the photo
    # held, draft=None — the screen turns into a manual report, nothing is lost.
    manual = lambda why: {"draft": None, "photo_token": token, "model": None, "vision": False, "note": why}
    if not ai._enabled():
        return manual("AI is not configured on this deployment — fill the report by hand.")
    try:
        ai._throttle(_client_ip(request))
    except HTTPException as e:
        return manual(e.detail)

    history = ai.t_asset_history(db, user, asset.code)
    prompt = PROMPT.format(remarks=remarks or "(none — see photo)",
                           history=json.dumps(history, default=str)[:6000])
    vision, model = bool(held), ai.GEMINI_MODEL if ai.PROVIDER == "gemini" else ai.MODEL
    try:
        if ai.PROVIDER == "gemini":
            raw = _gemini_draft(prompt, held[:2] if held else None)
        else:
            raw, vision = _openai_draft(ai.BASE_URL, ai.MODEL, prompt), False
    except (urllib.error.URLError, TimeoutError, KeyError, ValueError, IndexError):
        try:
            if not (ai.FALLBACK_URL and ai.FALLBACK_MODEL):
                raise ValueError("no fallback")
            fb_photo = held[:2] if held and FALLBACK_VISION else None
            raw = _openai_draft(ai.FALLBACK_URL, ai.FALLBACK_MODEL, prompt, fb_photo)
            vision, model = bool(fb_photo), ai.FALLBACK_MODEL
        except Exception:
            return manual("The AI service is busy — try again, or fill the report by hand.")
    return {"draft": _clean(raw), "photo_token": token, "model": model, "vision": vision, "note": None}


# ---- submit (the only write) ------------------------------------------------

class Draft(BaseModel):
    fault_type: str = Field("", max_length=80)
    severity: str = "med"
    likely_cause: str = Field("", max_length=600)
    suggested_action: str = Field("", max_length=600)
    safety_note: str = Field("", max_length=600)
    confidence: float | None = None
    summary: str = Field("", max_length=160)
    safety_flags: dict | None = None


class SubmitIn(BaseModel):
    asset_code: str
    remarks: str = Field("", max_length=1000)
    draft: Draft = Draft()
    make_failure: bool = True
    make_job_card: bool = False
    agency: str | None = Field(None, max_length=120)
    photo_token: str | None = None
    ai_model: str | None = Field(None, max_length=60)   # set only when the draft came from AI


class SubmitOut(BaseModel):
    failure_id: int | None
    job_card_id: int | None
    failure_existing: bool = False   # the job card joined a failure already open on the asset
    photo_attached: bool = False


def _narrative(body: SubmitIn, username: str) -> str:
    d = body.draft
    lines = [d.summary.strip() or body.remarks.strip() or "Fault reported"]
    if body.remarks.strip() and body.remarks.strip() != lines[0]:
        lines.append(f"Site remark: {body.remarks.strip()}")
    if d.likely_cause.strip():
        lines.append(f"Likely cause: {d.likely_cause.strip()}")
    if d.safety_note.strip():
        lines.append(f"Safety: {d.safety_note.strip()}")
    flags = _clean_flags(d.safety_flags)
    missing = [k.replace("_", "/") for k in GEAR if flags[k] == "missing"]
    if missing:
        lines.append(f"Safety gear missing: {', '.join(missing)}" + (f" ({flags['note']})" if flags["note"] else ""))
    lines.append(f"Severity: {d.severity if d.severity in SEVERITIES else 'med'}")
    if body.ai_model:
        conf = f", confidence {d.confidence:.2f}" if d.confidence is not None else ""
        lines.append(f"AI-drafted ({body.ai_model}{conf}), confirmed by {username}")
    return "\n".join(lines)


@router.post("/submit", response_model=SubmitOut, status_code=201)
def submit(body: SubmitIn, db: Session = Depends(get_db), user=Depends(current_writer)):
    if not (body.make_failure or body.make_job_card):
        raise HTTPException(422, "tick Failure report and/or Job card")
    agency = (body.agency or "").strip() or None
    if body.make_job_card and not agency:
        raise HTTPException(422, "pick the agency the job card is issued to")
    asset = visible_asset(db, body.asset_code, user)
    photo = None
    if body.photo_token:
        photo = _held.get(body.photo_token)
        if photo is None:
            raise HTTPException(410, "the photo expired — take it again")

    now = _ist_now()
    base = dict(log_date=now.date(), time=now.strftime("%H:%M"), shift="G", asset_code=asset.code,
                text=_narrative(body, user.username), fault_type=body.draft.fault_type.strip() or None,
                action_taken=body.draft.suggested_action.strip() or None)
    existing = False
    if body.make_job_card:
        # A job card is always tracked against a failure: _add_one joins the
        # asset's open one or raises it — so "both ticked" is this same path.
        open_before = _latest_open_failure(db, asset.id, user)
        card, _ = _add_one(db, LogEntryIn(type="job_card", attended_by=agency, **base), user)
        failure_id, card_id = card.rectifies_id, card.id
        existing = open_before is not None and open_before.id == failure_id
    else:
        fail, _ = _add_one(db, LogEntryIn(type="failure", **base), user)
        failure_id, card_id = fail.id, None

    # the photo goes on what this submit created (not on an older open failure)
    targets = [i for i in (None if existing else failure_id, card_id) if i]
    if photo:
        data, mime, name, _ = photo
        for eid in targets:
            _store_attachment(db, eid, data, mime, name or "snap.jpg", user, commit=False)
    audit(db, "log_entry", card_id or failure_id, "snap",
          detail=(f"asset={asset.code} failure={failure_id}{' (existing)' if existing else ''} "
                  f"job_card={card_id} agency={agency} ai={body.ai_model or '-'} "
                  f"photo={'yes' if photo else 'no'}"), actor=user.username)
    db.commit()
    if body.photo_token:
        _held.pop(body.photo_token, None)
    return SubmitOut(failure_id=failure_id, job_card_id=card_id,
                     failure_existing=existing, photo_attached=bool(photo and targets))
