# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""ampsTalk — field devices talk to AMPS directly (buildathon).

A sensor, relay, PLC gateway or energy meter is registered once against an
asset and gets its own token. It then posts readings to /api/talk/telemetry,
either straight (HTTP from the device or an edge gateway) or through Google
Cloud Pub/Sub as a push subscription — the endpoint accepts Pub/Sub's push
envelope as is, so a fleet of devices on MQTT/IoT gateways fans in through one
topic without any change here.

Every reading is stored (`iot_readings`, exported to BigQuery partitioned by
day). A reading outside the device's band files a FAILURE on the asset through
the same log-book path a technician uses — unless that asset already has one
open, in which case the reading is only marked as a breach. The failure says
which device, which metric, the value and the band, so the crew knows it was
the machine that spoke. The token is shown once at registration and stored
only as a sha256; it is never logged.
"""
import base64
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import cache, events
from app.api.assets import visible_asset
from app.api.auth import optional_user, require_admin
from app.api.logbook import LogEntryIn, _add_one, _latest_open_failure
from app.db import audit, get_db
from app.models import IoTDevice, IoTReading, UserRole

router = APIRouter()

MAX_READINGS = 500        # per call — a gateway batches, a single sensor sends one
IST = timedelta(hours=5, minutes=30)


def _sha(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _ist(ts: datetime | None) -> datetime:
    """Readings are stored as naive IST, like every other time in the book."""
    if ts is None:
        return datetime.utcnow() + IST
    if ts.tzinfo is not None:
        return ts.astimezone(timezone.utc).replace(tzinfo=None) + IST
    return ts


def _bands(dev: IoTDevice) -> dict:
    try:
        b = json.loads(dev.thresholds or "{}")
        return b if isinstance(b, dict) else {}
    except ValueError:
        return {}


def _breach(bands: dict, metric: str, value: float) -> tuple[str, float] | None:
    band = bands.get(metric) or {}
    if band.get("max") is not None and value > float(band["max"]):
        return "max", float(band["max"])
    if band.get("min") is not None and value < float(band["min"]):
        return "min", float(band["min"])
    return None


def _device_user(dev: IoTDevice) -> SimpleNamespace:
    """The device files as itself — the audit trail and the entry's author both
    read ampsTalk:<code>, never a person."""
    return SimpleNamespace(id=None, username=f"ampsTalk:{dev.code}", full_name=f"ampsTalk · {dev.name}",
                           role=UserRole.TECHNICIAN, line_id=dev.line_id, line=None,
                           depot=dev.asset.depot if dev.asset else None)


# ---- registration (admin) --------------------------------------------------

class DeviceIn(BaseModel):
    code: str = Field(min_length=2, max_length=80)
    name: str = Field(min_length=2, max_length=160)
    asset_code: str
    kind: str = "sensor"
    thresholds: dict[str, dict[str, float]] = {}


class DeviceOut(BaseModel):
    id: int
    code: str
    name: str
    kind: str
    asset_code: str
    thresholds: dict
    active: bool
    last_seen: datetime | None
    token: str | None = None          # only on registration / rotation


def _out(dev: IoTDevice, token: str | None = None) -> DeviceOut:
    return DeviceOut(id=dev.id, code=dev.code, name=dev.name, kind=dev.kind,
                     asset_code=dev.asset.code, thresholds=_bands(dev), active=dev.active,
                     last_seen=dev.last_seen, token=token)


@router.post("/devices", response_model=DeviceOut, status_code=201)
def register_device(body: DeviceIn, db: Session = Depends(get_db), admin=Depends(require_admin)):
    if db.scalar(select(IoTDevice).where(IoTDevice.code == body.code.strip())):
        raise HTTPException(409, "a device with this code exists")
    asset = visible_asset(db, body.asset_code, admin)
    token = "amt_" + secrets.token_urlsafe(24)
    dev = IoTDevice(code=body.code.strip(), name=body.name.strip(), kind=body.kind.strip()[:40] or "sensor",
                    asset_id=asset.id, line_id=asset.line_id, token_sha=_sha(token),
                    thresholds=json.dumps(body.thresholds), created_by=admin.username)
    db.add(dev)
    db.flush()
    audit(db, "iot_device", dev.id, "register", detail=f"asset={asset.code} kind={dev.kind}",
          actor=admin.username)
    db.commit()
    db.refresh(dev)
    return _out(dev, token)


@router.post("/devices/{code}/rotate", response_model=DeviceOut)
def rotate_token(code: str, db: Session = Depends(get_db), admin=Depends(require_admin)):
    dev = db.scalar(select(IoTDevice).where(IoTDevice.code == code))
    if dev is None:
        raise HTTPException(404, "device not found")
    token = "amt_" + secrets.token_urlsafe(24)
    dev.token_sha = _sha(token)
    audit(db, "iot_device", dev.id, "rotate", actor=admin.username)
    db.commit()
    return _out(dev, token)


@router.get("/devices", response_model=list[DeviceOut])
def list_devices(db: Session = Depends(get_db), user=Depends(optional_user)):
    return [_out(d) for d in db.scalars(select(IoTDevice).order_by(IoTDevice.code))]


# ---- telemetry (device token) ----------------------------------------------

class ReadingIn(BaseModel):
    metric: str = Field(min_length=1, max_length=40)
    value: float
    unit: str | None = Field(default=None, max_length=16)
    ts: datetime | None = None


class TelemetryIn(BaseModel):
    device: str
    readings: list[ReadingIn] = Field(min_length=1)


class TelemetryOut(BaseModel):
    device: str
    accepted: int
    breaches: int
    failure_id: int | None = None
    failure_existing: bool = False


def _unwrap(raw: dict) -> tuple[dict, str | None]:
    """A direct body, or Google Pub/Sub's push envelope
    {"message": {"data": base64(json), "attributes": {"token": ...}}}."""
    msg = raw.get("message") if isinstance(raw, dict) else None
    if isinstance(msg, dict) and "data" in msg:
        try:
            body = json.loads(base64.b64decode(msg["data"]))
        except (ValueError, TypeError):
            raise HTTPException(400, "Pub/Sub message data is not base64 JSON")
        return body, (msg.get("attributes") or {}).get("token")
    return raw, None


@router.post("/telemetry", response_model=TelemetryOut)
async def telemetry(request: Request, db: Session = Depends(get_db),
                    authorization: str | None = Header(default=None),
                    x_amps_device_token: str | None = Header(default=None)):
    try:
        raw = await request.json()
    except ValueError:
        raise HTTPException(400, "body is not JSON")
    body, attr_token = _unwrap(raw)
    try:
        data = TelemetryIn.model_validate(body)
    except ValueError as e:
        raise HTTPException(422, str(e)[:400])
    if len(data.readings) > MAX_READINGS:
        raise HTTPException(413, f"at most {MAX_READINGS} readings per call")
    token = x_amps_device_token or attr_token
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    dev = db.scalar(select(IoTDevice).where(IoTDevice.code == data.device))
    # same answer for unknown device and wrong token — no probing for codes
    if dev is None or not token or not secrets.compare_digest(dev.token_sha, _sha(token)):
        raise HTTPException(401, "unknown device or bad token")
    if not dev.active:
        raise HTTPException(403, "device is switched off in AMPS")

    bands = _bands(dev)
    rows, first_breach = [], None
    for r in data.readings:
        hit = _breach(bands, r.metric, r.value)
        row = IoTReading(device_id=dev.id, asset_id=dev.asset_id, metric=r.metric.strip(),
                         value=r.value, unit=(r.unit or "").strip() or None, ts=_ist(r.ts),
                         breach=hit[0] if hit else None)
        db.add(row)
        rows.append(row)
        if hit and first_breach is None:
            first_breach = (row, hit)
    dev.last_seen = datetime.utcnow() + IST
    db.flush()

    failure_id, existing = None, False
    if first_breach:
        row, (side, limit) = first_breach
        user = _device_user(dev)
        open_f = _latest_open_failure(db, dev.asset_id, user)
        if open_f is not None:
            failure_id, existing = open_f.id, True
        else:
            word = "above" if side == "max" else "below"
            unit = f" {row.unit}" if row.unit else ""
            text = (f"ampsTalk: {dev.name} ({dev.code}) reported {row.metric} = {row.value:g}{unit}, "
                    f"{word} the {side} limit {limit:g}{unit} at {row.ts:%H:%M}. "
                    f"Filed automatically by the device; crew to inspect and confirm.")
            entry, _ = _add_one(db, LogEntryIn(
                type="failure", log_date=row.ts.date(), time=row.ts.strftime("%H:%M"), shift="G",
                asset_code=dev.asset.code, text=text,
                fault_type=f"{row.metric} {'high' if side == 'max' else 'low'} (sensor)",
                entered_by=user.full_name), user)
            failure_id = entry.id
            audit(db, "log_entry", entry.id, "ampstalk",
                  detail=f"device={dev.code} {row.metric}={row.value:g} {side}={limit:g}",
                  actor=user.username)
        for r in rows:
            if r.breach:
                r.entry_id = failure_id
    db.commit()
    events.publish("talk.reading", {"device": dev.code, "asset_code": dev.asset.code, "accepted": len(rows),
                                    "breaches": sum(1 for r in rows if r.breach)})
    if failure_id and not existing:
        cache.bump()
        events.publish("failure.raised", {"asset_code": dev.asset.code, "failure_id": failure_id,
                                          "text": f"{first_breach[0].metric} {first_breach[1][0]} limit (ampsTalk)"})
    return TelemetryOut(device=dev.code, accepted=len(rows), breaches=sum(1 for r in rows if r.breach),
                        failure_id=failure_id, failure_existing=existing)


# ---- reads ------------------------------------------------------------------

@router.get("/readings")
def readings(device: str | None = None, asset_code: str | None = None, limit: int = 100,
             db: Session = Depends(get_db), user=Depends(optional_user)):
    """Newest first. Open to the QR viewer like the asset page itself."""
    q = select(IoTReading).join(IoTDevice)
    if device:
        q = q.where(IoTDevice.code == device)
    if asset_code:
        q = q.where(IoTReading.asset_id == visible_asset(db, asset_code, user).id)
    q = q.order_by(IoTReading.ts.desc(), IoTReading.id.desc()).limit(max(1, min(limit, 1000)))
    return [{"id": r.id, "device": r.device.code, "metric": r.metric, "value": r.value,
             "unit": r.unit, "ts": r.ts, "breach": r.breach, "failure_id": r.entry_id}
            for r in db.scalars(q)]
