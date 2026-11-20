#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
"""Export AMPS estate data to newline-delimited JSON for BigQuery (buildathon F4).

    DATABASE_URL=... python scripts/bq_export.py --out bq_out
    bigquery/load.sh bq_out          # explicit schemas, partitioned + clustered

Every table goes through scripts/bq_cleanse.py against schemas/bigquery/<table>.json
(typed DATE/DATETIME, text normalised, lang + dq_flags + event_date added, exact
duplicates dropped); bq_out/_quality.json reports what it found.

Tables are flattened for a data agent (names, not ids, wherever a person would ask
by name): assets carry their class, station and line; failures and logbook rows
carry the asset and station; failures carry state and downtime
hours derived exactly as the app does. Users, passwords,
audit trail, attachments and correspondence are never exported.
"""
import argparse
import json
import os
import sys
from datetime import date, datetime
from enum import Enum

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, "..", "backend"), HERE, os.getcwd()]

from sqlalchemy import select  # noqa: E402

from app.api.logbook import (_ack_map, _down_hours, _drop_superseded,  # noqa: E402
                             _jobcard_map, _recovery_map)
from app.db import SessionLocal  # noqa: E402
from app.models import (Asset, AssetClass, IoTDevice, IoTReading, Location, LogEntry,  # noqa: E402
                        LogEntryType, PMPlan, PMSchedule, WorkOrder)
from bq_cleanse import cleanse, quality_report  # noqa: E402


def val(v):
    if isinstance(v, Enum):
        return v.value
    if isinstance(v, datetime):
        return v.isoformat(sep=" ", timespec="seconds")
    if isinstance(v, date):
        return v.isoformat()
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="bq_out")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    db = SessionLocal()
    loc = {l.id: l for l in db.scalars(select(Location))}
    cls = {c.id: c.name for c in db.scalars(select(AssetClass))}
    assets = {x.id: x for x in db.scalars(select(Asset))}
    dev = {d.id: d for d in db.scalars(select(IoTDevice))}

    def name(i):
        return loc[i].name if i in loc else None

    def asset_cols(i):
        x = assets.get(i)
        if not x:
            return {"asset_code": None, "asset_name": None, "asset_class": None, "station": None, "line": None}
        return {"asset_code": x.code, "asset_name": x.name, "asset_class": cls.get(x.asset_class_id),
                "station": name(x.location_id), "line": name(x.line_id)}

    # Failures are logbook rows (type=failure); recovery, ack and job card are later rows
    # pointing back via rectifies_id. Same helpers as the app, so MTTR matches the UI.
    heads = _drop_superseded(db, list(db.scalars(select(LogEntry).where(
        LogEntry.type == LogEntryType.FAILURE, LogEntry.retracted.is_not(True)))))
    rec, ack, jc = _recovery_map(db, heads), _ack_map(db, heads), _jobcard_map(db, heads)

    def state(e):
        return ("rectified" if e.id in rec else "job_card" if e.id in jc
                else "acknowledged" if e.id in ack else "open")

    tables = {
        "locations": [{"id": l.id, "name": l.name, "kind": val(l.kind), "parent_id": l.parent_id,
                       "parent_name": name(l.parent_id)} for l in loc.values()],
        "asset_classes": [{"id": i, "name": n} for i, n in cls.items()],
        "assets": [{"id": x.id, **asset_cols(x.id), "system": x.system, "make_model": x.make_model,
                    "depot": x.depot, "location_detail": x.location_detail, "status": val(x.status),
                    "criticality": val(x.criticality), "commissioned_on": val(x.commissioned_on),
                    "codal_life_years": x.codal_life_years} for x in assets.values()],
        "failures": [{"id": e.id, "asset_id": e.asset_id, **asset_cols(e.asset_id),
                      "station_text": e.station, "system": e.system, "category": e.category,
                      "started_at": val(e.at), "log_date": val(e.log_date), "shift": val(e.shift),
                      "recovered_at": val(e.ended_at or (rec[e.id].at if e.id in rec else None)),
                      "downtime_hours": _down_hours(e, rec[e.id].at if e.id in rec else None),
                      "state": state(e), "fault_type": e.fault_type, "description": e.text,
                      "action_taken": rec[e.id].action_taken if e.id in rec else None,
                      "via_job_card": bool(rec[e.id].via_job_card) if e.id in rec else e.id in jc}
                     for e in heads],
        "log_entries": [{"id": e.id, "at": val(e.at), "log_date": val(e.log_date), "shift": val(e.shift),
                         "type": val(e.type), "subtype": e.subtype, "system": e.system,
                         "category": e.category, "asset_id": e.asset_id, **asset_cols(e.asset_id),
                         "station_text": e.station, "fault_type": e.fault_type, "ended_at": val(e.ended_at),
                         "text": e.text, "action_taken": e.action_taken, "consumables": e.consumables,
                         "rectifies_id": e.rectifies_id, "via_job_card": e.via_job_card}
                        for e in db.scalars(select(LogEntry).where(LogEntry.retracted.is_not(True)))],
        "work_orders": [{"id": w.id, "asset_id": w.asset_id, **asset_cols(w.asset_id), "type": val(w.type),
                         "status": val(w.status), "title": w.title, "findings": w.findings,
                         "opened_at": val(w.opened_at), "closed_at": val(w.closed_at)}
                        for w in db.scalars(select(WorkOrder))],
        "pm_schedules": [{"id": p.id, "asset_id": p.asset_id, **asset_cols(p.asset_id), "task": p.task,
                          "frequency": val(p.frequency), "last_done": val(p.last_done),
                          "next_due": val(p.next_due),
                          "is_overdue": bool(p.next_due and p.next_due < date.today())}
                         for p in db.scalars(select(PMSchedule))],
        "pm_plans": [{"id": p.id, "asset_id": p.asset_id, **asset_cols(p.asset_id), "frequency": p.frequency,
                      "last_done_seed": val(p.last_done_seed)} for p in db.scalars(select(PMPlan))],
        "iot_readings": [{"id": r.id, "device_code": dev[r.device_id].code, "device_name": dev[r.device_id].name,
                          "device_kind": dev[r.device_id].kind, **asset_cols(r.asset_id), "asset_id": r.asset_id,
                          "metric": r.metric, "value": r.value, "unit": r.unit, "ts": val(r.ts),
                          "breach": r.breach, "failure_id": r.entry_id}
                         for r in db.scalars(select(IoTReading))],
    }
    db.close()
    stats = {}
    for t, rows in tables.items():
        rows, stats[t] = cleanse(t, rows)
        # an empty file still loads against an explicit schema: the table exists, empty
        with open(os.path.join(a.out, f"{t}.json"), "w") as fh:
            for r in rows:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        st = stats[t]
        print(f"{t:14} {st['rows_out']:6} rows  dup -{st['duplicates_dropped']}  flagged {st['rows_flagged']}")
    with open(os.path.join(a.out, "_quality.json"), "w") as fh:
        json.dump(quality_report(stats, os.environ.get("AMPS_SOURCE", "amps")), fh, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
