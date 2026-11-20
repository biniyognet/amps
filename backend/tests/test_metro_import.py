# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Metro import prep: an older-schema export maps into buildathon; dry run writes nothing."""
import importlib.util
import os
import sqlite3

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

import seed_network
from app.models import Asset, Base, LogEntry, Location

_spec = importlib.util.spec_from_file_location(
    "metro_import", os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "metro_import.py"))
mi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mi)

OLD_SCHEMA = """
CREATE TABLE locations (id INTEGER PRIMARY KEY, name TEXT, kind TEXT, parent_id INTEGER);
CREATE TABLE asset_classes (id INTEGER PRIMARY KEY, name TEXT, description TEXT);
CREATE TABLE assets (id INTEGER PRIMARY KEY, code TEXT, name TEXT, asset_class_id INTEGER,
  location_id INTEGER, line_id INTEGER, status TEXT, criticality TEXT, legacy_tag TEXT);
CREATE TABLE log_entries (id INTEGER PRIMARY KEY, at TEXT, type TEXT, text TEXT, entered_by TEXT,
  asset_id INTEGER, rectifies_id INTEGER, corrects_id INTEGER, retracted INTEGER, line_id INTEGER);
CREATE TABLE failures (id INTEGER PRIMARY KEY, asset_id INTEGER, started_at TEXT, description TEXT,
  work_order_id INTEGER);
CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT);
INSERT INTO locations VALUES (1,'Line X','SITE',NULL),(2,'Sec','SECTION',1),(3,'Stn','STATION',2);
INSERT INTO asset_classes VALUES (1,'Pump',NULL);
INSERT INTO assets VALUES (1,'P-1','Pump 1',1,3,1,'IN_SERVICE','A','t'),
  (2,'P-2','Pump 2',1,99,1,'IN_SERVICE','B',NULL);
INSERT INTO log_entries VALUES (1,'2026-01-01 10:00','FAILURE','tripped','u',1,NULL,NULL,0,1),
  (2,'2026-01-01 12:00','JOB_CARD','reset','u',1,1,NULL,0,1),
  (3,'2026-01-02 09:00','RECTIFICATION','fixed','u',1,1,NULL,0,1),
  (4,'2026-01-02 09:30','GENERAL','note','u',7,NULL,NULL,0,1);
INSERT INTO failures VALUES (1,1,'2026-01-01 10:00','old',5);
INSERT INTO users VALUES (1,'arup','x');
"""


@pytest.fixture
def old_src(tmp_path):
    p = tmp_path / "export.db"
    con = sqlite3.connect(p)
    con.executescript(OLD_SCHEMA)
    con.close()
    return f"sqlite:///{p}"


def test_dry_run_counts_and_mapping(old_src, capsys):
    rep = mi.main(["--src", old_src])
    assert rep["counts"] == {"locations": 3, "asset_classes": 1, "assets": 1,
                             "log_entries": 4, "failures": 1}
    assert rep["skipped"]["assets.location_id"] == 1            # station 99 is not in the export
    assert rep["nulled"]["log_entries.asset_id"] == 1           # asset 7 unknown -> NULL, row kept
    assert rep["nulled"]["failures.work_order_id"] == 1         # work orders are never copied
    assert rep["dropped_cols"]["assets"] == ["legacy_tag"]
    assert "agency_id" in rep["defaulted_cols"]["assets"]
    assert rep["breakdown"]["log_entries.type"]["JOB_CARD"] == 1
    out = capsys.readouterr().out
    assert "dry run, nothing written" in out and "users" not in out


def test_source_opened_read_only(old_src):
    with pytest.raises(Exception):
        with mi._src_engine(old_src).begin() as c:
            c.exec_driver_sql("DELETE FROM users")


def test_apply_needs_go_and_refuses_laptop(old_src, tmp_path):
    with pytest.raises(SystemExit, match="arup-go"):
        mi.main(["--src", old_src, "--dst", f"sqlite:///{tmp_path}/d.db", "--apply"])
    with pytest.raises(SystemExit, match="stage DB"):
        mi.main(["--src", old_src, "--dst", "postgresql://amps:amps@localhost/amps", "--apply", "--arup-go"])
    with pytest.raises(SystemExit, match="BigQuery"):
        mi.main(["--src", old_src, "--dst", "bigquery://proj/amps_demo", "--apply", "--arup-go"])


def test_target_db_swaps_only_the_database():
    u = mi.target_url("postgresql+psycopg2://amps:amps@localhost:5432/amps", "amps_metro")
    assert (u.database, u.host, u.port, u.username) == ("amps_metro", "localhost", 5432, "amps")
    assert mi.target_url("postgresql://h/amps", None).database == "amps"


def test_demo_round_trip(tmp_path, monkeypatch):
    src_url, dst_url = f"sqlite:///{tmp_path}/src.db", f"sqlite:///{tmp_path}/dst.db"
    src = create_engine(src_url)
    monkeypatch.setattr(seed_network, "init_db", lambda: Base.metadata.create_all(src))
    monkeypatch.setattr(seed_network, "SessionLocal", sessionmaker(bind=src))
    seed_network.seed()
    dst = create_engine(dst_url)
    Base.metadata.create_all(dst)

    rep = mi.main(["--src", src_url, "--dst", dst_url, "--apply", "--arup-go"])
    assert not rep["skipped"]
    with sessionmaker(bind=src)() as a, sessionmaker(bind=dst)() as b:
        for m in (Location, Asset, LogEntry):
            assert a.scalar(select(func.count()).select_from(m)) == b.scalar(select(func.count()).select_from(m))
        assert b.scalar(select(func.count()).select_from(LogEntry).where(LogEntry.rectifies_id.is_not(None))) == \
            a.scalar(select(func.count()).select_from(LogEntry).where(LogEntry.rectifies_id.is_not(None)))
    with pytest.raises(SystemExit, match="not empty"):
        mi.main(["--src", src_url, "--dst", dst_url, "--apply", "--arup-go"])
