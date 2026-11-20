#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
"""Cleanse + shape AMPS rows for BigQuery, against the explicit schemas in
schemas/bigquery/<table>.json (no --autodetect guessing).

Per row:
  * text   — Unicode NFC, control characters dropped, runs of spaces/tabs
             collapsed, blank lines squeezed, trimmed; "" becomes NULL
  * enums  — trimmed, kept exactly as the app stores them (criticality "A",
             shift "M", frequency "Monthly") so the SQL literals keep matching
  * dates  — DATE "YYYY-MM-DD", DATETIME "YYYY-MM-DD HH:MM:SS" (IST wall clock,
             what the crew wrote; BigQuery DATETIME has no zone, so nothing shifts)
  * lang   — bn / hi / en / mixed / none, from the script of the free text, so
             Bengali and Hindi remarks are countable before Gemini reads them
  * event_date — the partition column (DATE) on time-series tables
  * dq_flags   — REPEATED STRING: what looked wrong, kept, never silently fixed
Per table: exact duplicates dropped (same content, lower id kept) and counted.

Rows are then checked against the schema: an unknown column, a missing
REQUIRED value or a value of the wrong type stops the export — a load that
fails in BigQuery after the bytes are billed is the expensive way to find out.

quality_report() returns the _quality.json body: rows in/out, duplicates,
flag counts, null rates per column, language mix.
"""
import json
import os
import re
import unicodedata
from collections import Counter
from datetime import date, datetime

SCHEMA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "schemas", "bigquery")

_WS = re.compile(r"[ \t  -​　]+")
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_BLANKS = re.compile(r"\n\s*\n+")
_BN = re.compile(r"[ঀ-৿]")
_HI = re.compile(r"[ऀ-ॿ]")
_LATIN = re.compile(r"[A-Za-z]")

# the column whose language is tagged, per table
LANG_COL = {"failures": "description", "log_entries": "text"}
# the column event_date is cut from, per table
EVENT_COL = {"failures": "log_date", "log_entries": "log_date", "iot_readings": "ts",
             "work_orders": "opened_at"}


def load_schema(table: str) -> list[dict]:
    with open(os.path.join(SCHEMA_DIR, f"{table}.json"), encoding="utf-8") as fh:
        return json.load(fh)


def clean_text(v):
    if v is None:
        return None
    s = unicodedata.normalize("NFC", str(v)).replace("\r\n", "\n").replace("\r", "\n")
    s = _CTRL.sub("", s)
    s = "\n".join(_WS.sub(" ", line).strip() for line in s.split("\n"))
    s = _BLANKS.sub("\n", s).strip()
    return s or None


def lang_of(text) -> str:
    if not text:
        return "none"
    found = [k for k, rx in (("bn", _BN), ("hi", _HI), ("en", _LATIN)) if rx.search(text)]
    if not found:
        return "none"
    return found[0] if len(found) == 1 else "mixed"


def _as_date(v):
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return date.fromisoformat(str(v)[:10]).isoformat()


def _as_datetime(v):
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.replace(tzinfo=None).isoformat(sep=" ", timespec="seconds")
    if isinstance(v, date):
        return f"{v.isoformat()} 00:00:00"
    return datetime.fromisoformat(str(v)).replace(tzinfo=None).isoformat(sep=" ", timespec="seconds")


def _coerce(field: dict, v):
    t = field["type"]
    if field.get("mode") == "REPEATED":
        return [] if v is None else list(v)
    if v is None:
        return None
    if t == "STRING":
        return clean_text(v)
    if t == "INTEGER":
        return int(v)
    if t == "FLOAT":
        return float(v)
    if t == "BOOLEAN":
        return bool(v)
    if t == "DATE":
        return _as_date(v)
    if t == "DATETIME":
        return _as_datetime(v)
    raise ValueError(f"unsupported type {t}")


def _flags(table: str, r: dict, today: date) -> list[str]:
    f = []
    d = r.get("event_date") or r.get("log_date")
    if d:
        d = date.fromisoformat(d)
        if d > today:
            f.append("future_date")
        if d.year < 2000:
            f.append("date_before_2000")
    start = r.get("started_at") or r.get("at")
    end = r.get("recovered_at") or r.get("ended_at")
    if start and end and end < start:
        f.append("end_before_start")
    if table in ("failures", "log_entries") and not r.get("asset_code"):
        f.append("no_asset")
    lc = LANG_COL.get(table)
    if lc and len(r.get(lc) or "") < 8:
        f.append("short_text")
    if table == "failures":
        if r.get("downtime_hours") is not None and r["downtime_hours"] < 0:
            f.append("negative_downtime")
        if r.get("state") == "rectified" and not r.get("action_taken"):
            f.append("fix_not_described")
    if table == "assets":
        for col, flag in (("asset_class", "no_class"), ("station", "no_station"),
                          ("commissioned_on", "no_commissioned_date"),
                          ("codal_life_years", "no_codal_life")):
            if r.get(col) in (None, ""):
                f.append(flag)
    return f


def cleanse(table: str, rows: list[dict], today: date | None = None) -> tuple[list[dict], dict]:
    """Rows shaped to the table's schema, plus this table's quality stats."""
    today = today or date.today()
    schema = load_schema(table)
    names = {fl["name"] for fl in schema}
    out, seen, dups = [], {}, 0
    for raw in sorted(rows, key=lambda r: (r.get("id") is None, r.get("id") or 0)):
        extra = set(raw) - names
        if extra:
            raise ValueError(f"{table}: columns not in schemas/bigquery/{table}.json: {sorted(extra)}")
        r = {}
        for fl in schema:
            n = fl["name"]
            if n in ("event_date", "lang", "dq_flags"):
                continue
            try:
                r[n] = _coerce(fl, raw.get(n))
            except (TypeError, ValueError) as e:
                raise ValueError(f"{table} id={raw.get('id')}: {n}={raw.get(n)!r} is not {fl['type']}: {e}")
        if "event_date" in names:
            r["event_date"] = _as_date(r.get(EVENT_COL[table]))
        if "lang" in names:
            r["lang"] = lang_of(r.get(LANG_COL[table]))
        if "dq_flags" in names:
            r["dq_flags"] = _flags(table, r, today)
        for fl in schema:
            if fl.get("mode") == "REQUIRED" and r.get(fl["name"]) is None:
                raise ValueError(f"{table} id={raw.get('id')}: REQUIRED {fl['name']} is empty")
        key = json.dumps({k: v for k, v in r.items() if k != "id"}, sort_keys=True, ensure_ascii=False)
        if key in seen:
            dups += 1
            continue
        seen[key] = r.get("id")
        out.append(r)
    return out, _stats(table, schema, len(rows), out, dups)


def _stats(table, schema, rows_in, out, dups) -> dict:
    n = len(out) or 1
    flags = Counter(f for r in out for f in r.get("dq_flags", []))
    nulls = {fl["name"]: round(sum(1 for r in out if r.get(fl["name"]) in (None, [])) / n, 3)
             for fl in schema if fl.get("mode") != "REQUIRED"}
    st = {"rows_in": rows_in, "rows_out": len(out), "duplicates_dropped": dups,
          "rows_flagged": sum(1 for r in out if r.get("dq_flags")), "flags": dict(flags.most_common()),
          "null_rate": {k: v for k, v in nulls.items() if v > 0}}
    if out and "lang" in out[0]:
        st["lang"] = dict(Counter(r["lang"] for r in out).most_common())
    return st


def quality_report(stats: dict[str, dict], source: str) -> dict:
    return {"generated_at": datetime.now().isoformat(timespec="seconds"), "source": source,
            "tables": stats,
            "totals": {"rows_out": sum(s["rows_out"] for s in stats.values()),
                       "duplicates_dropped": sum(s["duplicates_dropped"] for s in stats.values()),
                       "rows_flagged": sum(s["rows_flagged"] for s in stats.values())}}
