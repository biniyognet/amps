# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""BigQuery export: cleanse rules, schema checks, and a full export that every
table passes against schemas/bigquery/ (the files load.sh hands to bq --schema)."""
import json
import sys
from datetime import date, datetime
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import bq_cleanse as bc  # noqa: E402

TODAY = date(2026, 11, 20)


def _failure(**kw):
    row = {"id": 1, "asset_id": 7, "asset_code": "TX-01", "asset_name": "Transformer", "asset_class": "Transformer",
           "station": "Esplanade", "line": "Green", "station_text": None, "system": "HT", "category": None,
           "started_at": datetime(2026, 11, 3, 10, 15), "log_date": date(2026, 11, 3), "shift": "M",
           "recovered_at": "2026-11-03 12:45:00", "downtime_hours": 2.5, "state": "rectified",
           "fault_type": " Overheating ", "description": "OTI  92 °C,\t fan off", "action_taken": "fan replaced",
           "via_job_card": False}
    row.update(kw)
    return row


def test_text_and_lang():
    assert bc.clean_text("  a  b \r\n\r\n\r\n c\x07 ") == "a b\nc"
    assert bc.clean_text("   ") is None
    assert bc.clean_text("é") == "é"            # NFC
    assert bc.lang_of("পাখা বন্ধ") == "bn"
    assert bc.lang_of("पंखा बंद") == "hi"
    assert bc.lang_of("fan off, পাখা বন্ধ") == "mixed"
    assert bc.lang_of("92 / 104") == "none"


def test_failure_typed_tagged_flagged():
    rows, st = bc.cleanse("failures", [
        _failure(),
        _failure(id=2),                                           # same content → duplicate
        _failure(id=3, asset_code=None, log_date="2027-01-02", description="ok",
                 started_at="2027-01-02 09:00:00", recovered_at="2027-01-02 08:00:00"),
    ], today=TODAY)
    a, b = rows
    assert a["started_at"] == "2026-11-03 10:15:00" and a["event_date"] == "2026-11-03"
    assert a["fault_type"] == "Overheating" and a["description"] == "OTI 92 °C, fan off"
    assert a["shift"] == "M" and a["lang"] == "en" and a["dq_flags"] == []
    assert set(b["dq_flags"]) == {"future_date", "end_before_start", "no_asset", "short_text"}
    assert st["duplicates_dropped"] == 1 and st["rows_flagged"] == 1 and st["flags"]["no_asset"] == 1


def test_schema_mismatch_fails_loud():
    with pytest.raises(ValueError, match="not in schemas"):
        bc.cleanse("failures", [_failure(surprise=1)], today=TODAY)
    with pytest.raises(ValueError, match="is not FLOAT"):
        bc.cleanse("failures", [_failure(downtime_hours="two")], today=TODAY)
    with pytest.raises(ValueError, match="REQUIRED state"):
        bc.cleanse("failures", [_failure(state=" ")], today=TODAY)


def test_bigquery_schema_files_are_valid():
    types = {"STRING", "INTEGER", "FLOAT", "BOOLEAN", "DATE", "DATETIME"}
    for p in (ROOT / "schemas" / "bigquery").glob("*.json"):
        cols = json.loads(p.read_text())
        names = [c["name"] for c in cols]
        assert len(names) == len(set(names)), p.name
        assert all(c["type"] in types and c["mode"] in {"NULLABLE", "REQUIRED", "REPEATED"} for c in cols), p.name
        if "event_date" in names:
            assert p.stem in bc.EVENT_COL, p.name


def test_snap_draft_schema_file_matches_code():
    from app.api.snap import SCHEMA
    assert json.loads((ROOT / "schemas" / "ai" / "snap_draft.json").read_text()) == SCHEMA


def test_full_export_passes_every_schema(tmp_path, monkeypatch):
    from app.db import SessionLocal, init_db
    from app.models import (Asset, AssetClass, IoTDevice, IoTReading, Location, LocationKind,
                            LogEntry, LogEntryType)
    init_db()
    with SessionLocal() as db:
        site = Location(name="BQ Test Line", kind=LocationKind.SITE)
        cls = AssetClass(name="BQ Test Pump")
        db.add_all([site, cls]); db.flush()
        asset = Asset(code="BQ-P1", name="Pump 1", asset_class_id=cls.id, location_id=site.id)
        db.add(asset); db.flush()
        f = LogEntry(type=LogEntryType.FAILURE, log_date=date(2026, 11, 2), at=datetime(2026, 11, 2, 8, 0),
                     asset_id=asset.id, text="পাম্প  ট্রিপ, seal leak")
        dev = IoTDevice(code="BQ-T1", name="Seal temp", asset_id=asset.id, token_sha="0" * 64)
        db.add_all([f, dev]); db.flush()
        db.add(IoTReading(device_id=dev.id, asset_id=asset.id, metric="temp_c", value=91.0, unit="°C",
                          ts=datetime(2026, 11, 2, 7, 59), breach="max", entry_id=f.id))
        db.commit()

    import bq_export
    monkeypatch.setattr(sys, "argv", ["bq_export.py", "--out", str(tmp_path)])
    bq_export.main()

    q = json.loads((tmp_path / "_quality.json").read_text())
    assert set(q["tables"]) == {p.stem for p in (ROOT / "schemas" / "bigquery").glob("*.json")}
    fails = [json.loads(l) for l in (tmp_path / "failures.json").read_text().splitlines()]
    mine = next(r for r in fails if r["asset_code"] == "BQ-P1")
    assert mine["lang"] == "mixed" and mine["description"] == "পাম্প ট্রিপ, seal leak"
    assert mine["event_date"] == "2026-11-02" and mine["started_at"] == "2026-11-02 08:00:00"
    iot = [json.loads(l) for l in (tmp_path / "iot_readings.json").read_text().splitlines()]
    assert iot[-1]["device_code"] == "BQ-T1" and iot[-1]["failure_id"] == mine["id"]
