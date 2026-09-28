# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Database layer — PostgreSQL in production, SQLite fallback for instant demo.

Set DATABASE_URL (e.g. postgresql+psycopg2://user:pass@host/amps); without it
the app runs on a local SQLite file so the demo works out of the box.
"""
import os
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./amps.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False)


def init_db():
    Base.metadata.create_all(engine)
    _migrate(engine)
    _seed_checksheets(engine)


def _seed_checksheets(engine):
    """Publish the 17 HT checksheet formats as v1 on an empty library, so the
    Printables list is populated out of the box; ICs edit them thereafter."""
    import json as _json
    import re as _re

    from sqlalchemy import select

    from app.checksheet_seed import HT_CHECKSHEET_SEED
    from app.models import (ChecksheetFormat, ChecksheetStatus, Location,
                            LocationKind)

    with SessionLocal() as db:
        if db.query(ChecksheetFormat).first():
            return
        # the HT formats belong to Green Line — scope them so they never leak to
        # other lines' coordinators (checksheets are line-specific)
        green = db.scalar(select(Location).where(
            Location.kind == LocationKind.SITE, Location.name == "Green Line"))
        line_id = green.id if green else None
        now = datetime.utcnow()
        for f in HT_CHECKSHEET_SEED:
            slug = _re.sub(r"[^a-z0-9]+", "-", f["label"].lower()).strip("-")[:80]
            db.add(ChecksheetFormat(
                slug=slug, grp=f.get("grp", "HT"), label=f["label"][:120],
                title=f.get("title", f["label"])[:240],
                items_json=_json.dumps(f["items"], ensure_ascii=False),
                version=1, status=ChecksheetStatus.PUBLISHED, line_id=line_id,
                created_by="system", approved_by="system", approved_at=now))
        db.commit()


def _migrate(engine):
    """Additive micro-migrations for databases created before a column existed.
    create_all() only creates missing tables, never missing columns."""
    from sqlalchemy import inspect, text

    wanted = {
        "assets": {"system": "VARCHAR(80)", "description": "TEXT", "remarks": "TEXT",
                   "codal_life_years": "INTEGER", "depot": "VARCHAR(40)",
                   "line_id": "INTEGER", "location_detail": "VARCHAR(200)"},
        "users": {"password_hash": "VARCHAR(200)", "line_id": "INTEGER",
                  "depot": "VARCHAR(40)"},
        "log_entries": {"line_id": "INTEGER", "subtype": "VARCHAR(40)", "category": "VARCHAR(80)",
                        "ended_at": "TIMESTAMP", "fault_type": "VARCHAR(120)",
                        "rectifies_id": "INTEGER", "attended_by": "VARCHAR(200)",
                        "system": "VARCHAR(80)", "consumables": "TEXT",
                        "via_job_card": "BOOLEAN", "checksheet": "TEXT",
                        "retracted": "BOOLEAN", "station": "VARCHAR(160)", "action_taken": "TEXT"},
        "attachments": {"url": "VARCHAR(600)"},
        "checksheet_formats": {"frequencies_json": "TEXT", "asset_code": "VARCHAR(120)",
                               "system": "VARCHAR(80)", "slots_json": "TEXT"},
    }
    # widen columns that real-world data outgrew (no-op where already wide;
    # SQLite ignores VARCHAR lengths so this only matters on Postgres).
    # Committed in its own transaction BEFORE any inspection — the inspector
    # opens a second connection, which would block on the ALTER's lock.
    if engine.dialect.name == "postgresql":
        widen = {("assets", "code"): "VARCHAR(120)"}
        with engine.begin() as conn:
            for (table, col), ddl in widen.items():
                conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN {col} TYPE {ddl}"))
        # the 2026-07 logbook taxonomy: native enum needs the new labels
        # (each in its own autocommitting statement; IF NOT EXISTS = rerun-safe)
        for val in ("MAINTENANCE", "FAILURE", "RECTIFICATION", "ACKNOWLEDGEMENT",
                    "JOB_CARD", "GENERAL"):
            with engine.begin() as conn:
                conn.execute(text(
                    f"ALTER TYPE logentrytype ADD VALUE IF NOT EXISTS '{val}'"))
        # SPARE — a spare unit held in reserve, not in active service (the sheets
        # mark these 'spare'); added so their import doesn't fail on the status.
        for val in ("IN_SERVICE", "UNDER_MAINTENANCE", "OUT_OF_SERVICE",
                    "DECOMMISSIONED", "SPARE"):
            with engine.begin() as conn:
                conn.execute(text(
                    f"ALTER TYPE assetstatus ADD VALUE IF NOT EXISTS '{val}'"))
        # INCHARGE (IC) — approves checksheet formats. Rename the earlier OFFICER
        # label to INCHARGE where present (keeps existing rows valid), then ensure
        # the value exists on fresh databases.
        with engine.begin() as conn:
            conn.execute(text(
                "DO $$ BEGIN"
                "  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid"
                "             WHERE t.typname='userrole' AND e.enumlabel='OFFICER')"
                "  AND NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid"
                "             WHERE t.typname='userrole' AND e.enumlabel='INCHARGE') THEN"
                "    ALTER TYPE userrole RENAME VALUE 'OFFICER' TO 'INCHARGE';"
                "  END IF;"
                "END $$;"))
        for val in ("ADMIN", "INCHARGE", "SUPERVISOR", "TECHNICIAN", "VIEWER"):
            with engine.begin() as conn:
                conn.execute(text(
                    f"ALTER TYPE userrole ADD VALUE IF NOT EXISTS '{val}'"))

    insp = inspect(engine)
    with engine.begin() as conn:
        for table, columns in wanted.items():
            have = {c["name"] for c in insp.get_columns(table)}
            for col, ddl in columns.items():
                if col not in have:
                    # quote — some column names (e.g. "group") are reserved words
                    conn.execute(text(f'ALTER TABLE {table} ADD COLUMN "{col}" {ddl}'))

    # The logbook only ever carried its primary key, so every filtered read was
    # a sequential scan of the whole book — fine at a hundred rows, not at the
    # tens of thousands a few years of real history produce. These cover the
    # queries the app actually issues: the date-ordered window, one asset's
    # history, the type/class filters and the rectification lookup.
    indexes = {
        "ix_log_entries_date": "log_entries (log_date DESC, at DESC, id DESC)",
        "ix_log_entries_asset": "log_entries (asset_id)",
        "ix_log_entries_type": "log_entries (type)",
        "ix_log_entries_rectifies": "log_entries (rectifies_id)",
        "ix_log_entries_line": "log_entries (line_id)",
        "ix_log_entries_category": "log_entries (category)",
    }
    with engine.begin() as conn:
        for name, defn in indexes.items():
            conn.execute(text(f"CREATE INDEX IF NOT EXISTS {name} ON {defn}"))

    # Asset codes are unique PER LINE, not globally — different lines/depots reuse
    # the same code series. Migrate the old global unique index to a composite one.
    with engine.begin() as conn:
        # backfill the denormalised line_id from each asset's station -> parent site
        conn.execute(text(
            "UPDATE assets SET line_id = ("
            "  SELECT loc.parent_id FROM locations loc WHERE loc.id = assets.location_id"
            ") WHERE line_id IS NULL"))
        # drop the old GLOBAL unique index on code, if it still exists
        conn.execute(text("DROP INDEX IF EXISTS ix_assets_code"))
        # a plain (non-unique) index on code for lookups
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_assets_code ON assets (code)"))
        # Uniqueness is PER LOCATION, not per line. A depot spans several
        # substations (RSS/TSS/ASS) and the metro reuses generic equipment codes
        # (BAT CH-1, ACDB-1, DCDB-1 …) at EACH substation — physically distinct
        # assets that share a code. So the natural key is (location_id, code):
        # the same code may repeat across stations/depots/lines, never within one
        # location. Migrate the old per-line index to the per-location one.
        conn.execute(text("DROP INDEX IF EXISTS ux_assets_code_line"))
        try:
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_assets_code_location "
                "ON assets (location_id, code)"))
        except Exception:
            pass  # existing (location,code) duplicates: leave to a data cleanup


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def audit(db, entity, entity_id, action, detail=None, actor="system"):
    """Append an audit-trail row inside the caller's transaction
    (committed/rolled back together with the change it records)."""
    from app.models import AuditLog

    db.add(AuditLog(entity=entity, entity_id=entity_id, action=action,
                    detail=detail, actor=actor))
