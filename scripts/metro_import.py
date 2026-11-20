#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
"""Copy a read-only export of a production AMPS DB into the buildathon schema.

    # dry run (default): row counts + mapping issues, writes nothing
    python scripts/metro_import.py --src sqlite:////path/outside/git/metro_export.db
    # apply into an EMPTY buildathon DB, only with Arup's go
    python scripts/metro_import.py --src ... --dst postgresql+psycopg2://... --apply --arup-go
    # same Postgres server, separate database (stage `amps` untouched), created if missing
    python scripts/metro_import.py --src ... --dst postgresql+psycopg2://amps:amps@localhost/amps \
        --target-db amps_metro --create-db --apply --arup-go

Writes into the stage database itself (`amps`) are refused: load into amps_metro, then
'metro go' points the backend at amps_metro and 'metro private' leaves stage as it is.
Either way the demo DB is never overwritten (scripts/demo_db_backup.sh before any change).

The source is an export copy (pg_dump restored somewhere, or a SQLite file), never the
production box itself. It is opened read-only. Its schema may be older than buildathon
(main has no agencies, Asset.agency_id, embeddings ...), so both sides are reflected and
only the columns they share are copied; buildathon-only columns keep their defaults.

Copied, ids kept, parents first: locations (site > section > station > bay), asset
classes, agencies (when the source has them), assets, log entries (maintenance,
failures, rectifications, acknowledgements, job cards ...) and the legacy failures table.
Never copied: users, passwords, audit trail, attachments, correspondence, embeddings,
PM and work orders. FK values that point at a row not copied become NULL, or the row is
skipped when the column is NOT NULL; both are counted in the report.

Nothing is written to disk. Keep export files outside the repo (metro_export*/ is ignored).
"""
import argparse
import os
import sys
from collections import Counter

sys.path[:0] = [os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")]

from sqlalchemy import MetaData, create_engine, func, inspect, select, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from app.models import Base  # noqa: E402

TABLES = ["locations", "asset_classes", "agencies", "assets", "log_entries", "failures"]
OPTIONAL = {"agencies"}
SELF_REFS = {"locations": ["parent_id"], "log_entries": ["corrects_id", "rectifies_id"]}
BLOCKED_DST = ("bigquery",)
STAGE_DBS = {"amps"}          # the demo/stage database on the laptop Postgres


def _src_engine(url):
    """Open the export read-only, whatever the dialect."""
    if url.startswith("sqlite:///") and url != "sqlite://":
        path = url[len("sqlite:///"):]
        return create_engine("sqlite://", creator=lambda: __import__("sqlite3").connect(
            f"file:{path}?mode=ro", uri=True))
    if url.startswith("postgresql"):
        return create_engine(url, connect_args={"options": "-c default_transaction_read_only=on"})
    return create_engine(url)


def _target_cols(name):
    return {c.name: c for c in Base.metadata.tables[name].columns}


def plan(src):
    """Read the source, map rows to the target, return (rows per table, report)."""
    meta = MetaData()
    meta.reflect(src, only=lambda n, _m: n in TABLES)
    rep = {"counts": {}, "skipped": Counter(), "nulled": Counter(), "dropped_cols": {},
           "defaulted_cols": {}, "missing": [], "breakdown": {}}
    rows, kept = {}, {}
    with src.connect() as c:
        for name in TABLES:
            if name not in meta.tables:
                if name not in OPTIONAL:
                    rep["missing"].append(name)
                rows[name], kept[name] = [], set()
                continue
            st, tcols = meta.tables[name], _target_cols(name)
            shared = [k for k in st.columns.keys() if k in tcols]
            rep["dropped_cols"][name] = sorted(set(st.columns.keys()) - set(tcols))
            rep["defaulted_cols"][name] = sorted(set(tcols) - set(st.columns.keys()))
            fks = {fk.parent.name: fk.column.table.name
                   for fk in Base.metadata.tables[name].foreign_keys if fk.parent.name in shared}
            out = []
            src_rows = [dict(r._mapping) for r in c.execute(select(*[st.c[k] for k in shared])
                                                             .order_by(st.c.id))]
            own = {r["id"] for r in src_rows}
            for r in src_rows:
                ok = True
                for col, ref in fks.items():
                    v = r.get(col)
                    pool = own if ref == name else kept.get(ref, set())
                    if v is None or v in pool:
                        continue
                    if tcols[col].nullable:
                        r[col] = None
                        rep["nulled"][f"{name}.{col}"] += 1
                    else:
                        ok = False
                        rep["skipped"][f"{name}.{col}"] += 1
                        break
                if ok:
                    out.append(r)
            rows[name], kept[name] = out, {r["id"] for r in out}
            rep["counts"][name] = len(out)
    rep["breakdown"]["locations.kind"] = dict(Counter(str(r.get("kind")) for r in rows["locations"]))
    rep["breakdown"]["log_entries.type"] = dict(Counter(str(r.get("type")) for r in rows["log_entries"]))
    rep["breakdown"]["assets.status"] = dict(Counter(str(r.get("status")) for r in rows["assets"]))
    dup = Counter((r.get("code"), r.get("line_id")) for r in rows["assets"])
    rep["dup_asset_code_line"] = sum(1 for n in dup.values() if n > 1)
    return rows, rep


def target_url(dst, target_db):
    """--dst with its database swapped for --target-db (same server and login)."""
    url = make_url(dst)
    return url.set(database=target_db) if target_db else url


def ensure_db(url, create):
    """Create the target database (Postgres) and the AMPS schema in it when missing."""
    if url.get_backend_name() == "postgresql":
        admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
        with admin.connect() as c:
            exists = c.execute(text("SELECT 1 FROM pg_database WHERE datname = :n"),
                               {"n": url.database}).scalar()
            if not exists:
                if not create:
                    raise SystemExit(f"database {url.database} does not exist (add --create-db)")
                c.execute(text(f'CREATE DATABASE "{url.database}"'))
        admin.dispose()
    eng = create_engine(url)
    if "assets" not in inspect(eng).get_table_names():
        Base.metadata.create_all(eng)
    return eng


def apply(dst, rows):
    """Insert into an empty buildathon DB in one transaction; self-refs patched after."""
    meta = MetaData()
    meta.reflect(dst, only=lambda n, _m: n in TABLES)
    with dst.begin() as c:
        for name in TABLES:
            if name in meta.tables and c.execute(select(func.count()).select_from(meta.tables[name])).scalar():
                raise SystemExit(f"refusing: {name} in --dst is not empty")
        for name in TABLES:
            if not rows[name]:
                continue
            t, later = meta.tables[name], SELF_REFS.get(name, [])
            c.execute(t.insert(), [{k: (None if k in later else v) for k, v in r.items()}
                                   for r in rows[name]])
            for r in rows[name]:
                patch = {k: r[k] for k in later if r.get(k) is not None}
                if patch:
                    c.execute(t.update().where(t.c.id == r["id"]).values(**patch))
            if dst.dialect.name == "postgresql":
                c.execute(text(f"SELECT setval(pg_get_serial_sequence('{name}', 'id'), "
                               f"(SELECT COALESCE(MAX(id), 1) FROM {name}))"))


def show(rep):
    print("table           rows")
    for name in TABLES:
        if name in rep["counts"]:
            print(f"  {name:<14}{rep['counts'][name]:>6}")
    for k, v in rep["breakdown"].items():
        print(f"  {k}: " + ", ".join(f"{a}={b}" for a, b in sorted(v.items())))
    lt = rep["breakdown"]["log_entries.type"]
    print(f"  failures (log) {lt.get('failure', 0) + lt.get('FAILURE', 0)} · "
          f"job cards {lt.get('job_card', 0) + lt.get('JOB_CARD', 0)}")
    for label in ("missing", "dup_asset_code_line"):
        if rep[label]:
            print(f"  {label}: {rep[label]}")
    for label in ("skipped", "nulled"):
        for k, n in rep[label].items():
            print(f"  {label} {k}: {n}")
    for label in ("dropped_cols", "defaulted_cols"):
        for k, v in rep[label].items():
            if v:
                print(f"  {label} {k}: {', '.join(v)}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", required=True, help="SQLAlchemy URL of the read-only export copy")
    ap.add_argument("--dst", help="buildathon DB URL (only with --apply)")
    ap.add_argument("--target-db", help="database name on the --dst server, e.g. amps_metro")
    ap.add_argument("--create-db", action="store_true", help="create --target-db when missing")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--arup-go", action="store_true", help="Arup confirmed this import")
    a = ap.parse_args(argv)
    if a.src == a.dst:
        raise SystemExit("refusing: --src and --dst are the same")
    rows, rep = plan(_src_engine(a.src))
    show(rep)
    if rep["missing"]:
        raise SystemExit(f"source lacks {rep['missing']}, not an AMPS export")
    if not a.apply:
        print("dry run, nothing written")
        return rep
    if not (a.dst and a.arup_go):
        raise SystemExit("--apply needs --dst and --arup-go")
    if any(b in a.dst.lower() for b in BLOCKED_DST):
        raise SystemExit("refusing: --dst looks like BigQuery")
    url = target_url(a.dst, a.target_db)
    if url.database in STAGE_DBS:
        raise SystemExit(f"refusing: {url.database} is the stage DB, use --target-db amps_metro")
    apply(ensure_db(url, a.create_db), rows)
    print(f"applied into {url.database}")
    return rep


if __name__ == "__main__":
    main()
