# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Synthetic demo data for AMPS — v0.2 seeds a live database.

ALL DATA HERE IS FICTIONAL — generic industrial examples for demonstration.
No real organization's assets, locations or records appear in this repository.

Run:  python seed.py   (uses DATABASE_URL, or the local SQLite fallback)
"""
from datetime import date, timedelta

from sqlalchemy import select

from app.db import SessionLocal, init_db
from app.models import (
    Asset, AssetClass, Criticality, Location, LocationKind, LogEntry,
    LogEntryType, PMFrequency, PMSchedule, RosterEntry, RosterPattern,
    ShiftCode, User, UserRole,
)

DEMO_LOCATIONS = [
    ("Demo Plant", LocationKind.SITE, None),
    ("Substation-1", LocationKind.STATION, "Demo Plant"),
    ("Workshop Bay-A", LocationKind.BAY, "Demo Plant"),
]

DEMO_ASSET_CLASSES = [
    "Transformer", "HT Panel", "LT Panel", "PLC", "Motor", "Crane Hoist",
]

DEMO_ASSETS = [
    # (code, name, class, location, criticality)
    ("TRF-0001", "33kV/415V Distribution Transformer", "Transformer", "Substation-1", Criticality.A),
    ("HTP-0001", "33kV Incomer Panel", "HT Panel", "Substation-1", Criticality.B),
    ("PLC-0001", "Bay Automation PLC", "PLC", "Workshop Bay-A", Criticality.B),
    ("CRN-0001", "10T EOT Crane Hoist", "Crane Hoist", "Workshop Bay-A", Criticality.A),
]

# (asset, task, frequency, days since last done — mix of ok/due/overdue)
DEMO_PM = [
    ("TRF-0001", "Oil BDV test", PMFrequency.HALF_YEARLY, 200),
    ("HTP-0001", "Contact resistance check", PMFrequency.YEARLY, 100),
    ("PLC-0001", "Battery & backup verification", PMFrequency.QUARTERLY, 95),
    ("CRN-0001", "Brake & limit-switch inspection", PMFrequency.MONTHLY, 10),
]

DEMO_USERS = [
    ("demo.super1", "Demo Supervisor One", UserRole.SUPERVISOR),
    ("demo.super2", "Demo Supervisor Two", UserRole.SUPERVISOR),
    ("demo.super3", "Demo Supervisor Three", UserRole.SUPERVISOR),
    ("demo.tech1", "Demo Technician One", UserRole.TECHNICIAN),
]

# balanced weekly pattern: M/E/N covered every day among the supervisors
DEMO_ROSTER = {
    "demo.super1": ["M", "E", "N", "R", "G", "M", "E"],
    "demo.super2": ["E", "N", "R", "M", "E", "N", "G"],
    "demo.super3": ["N", "M", "E", "N", "M", "R", "N"],
    "demo.tech1":  ["G", "G", "M", "E", "N", "E", "M"],
}


def seed():
    init_db()
    db = SessionLocal()
    try:
        if db.scalar(select(Asset)):
            print("Database already seeded — nothing to do.")
            return
        locs = {}
        for name, kind, parent in DEMO_LOCATIONS:
            locs[name] = Location(name=name, kind=kind, parent=locs.get(parent))
            db.add(locs[name])
        classes = {n: AssetClass(name=n) for n in DEMO_ASSET_CLASSES}
        db.add_all(classes.values())
        assets = {}
        for code, name, cls, loc, crit in DEMO_ASSETS:
            assets[code] = Asset(code=code, name=name, criticality=crit,
                                 asset_class=classes[cls], location=locs[loc])
            db.add(assets[code])
        for code, task, freq, ago in DEMO_PM:
            last = date.today() - timedelta(days=ago)
            db.add(PMSchedule(asset=assets[code], task=task, frequency=freq,
                              last_done=last))
        users = {}
        for uname, full, role in DEMO_USERS:
            users[uname] = User(username=uname, full_name=full, role=role)
            db.add(users[uname])
        pattern = RosterPattern(
            name="Demo balanced baseline",
            description="Synthetic weekly pattern: M/E/N covered every day.",
            maintenance_window_shifts="N",
            is_active=True,
        )
        db.add(pattern)
        for uname, week in DEMO_ROSTER.items():
            for weekday, code in enumerate(week):
                if code != "R":
                    db.add(RosterEntry(pattern=pattern, user=users[uname],
                                       weekday=weekday, shift=ShiftCode(code)))
        db.add(LogEntry(log_date=date.today(), shift=ShiftCode.MORNING,
                         type=LogEntryType.OPERATION, asset=assets["TRF-0001"],
                         entered_by="demo.super1",
                         text="Transformer taken on load after scheduled inspection; all parameters normal."))
        db.add(LogEntry(log_date=date.today(), shift=ShiftCode.MORNING,
                         type=LogEntryType.DEFECT, asset=assets["CRN-0001"],
                         entered_by="demo.tech1",
                         text="Hoist limit switch sluggish on upper limit; to be attended in next PM."))
        db.add(LogEntry(log_date=date.today(), shift=ShiftCode.MORNING,
                         type=LogEntryType.HANDOVER, entered_by="demo.super1",
                         text="Shift normal. One defect logged on CRN-0001; no pending isolations."))
        db.commit()
        print(f"Seeded {len(DEMO_ASSETS)} assets, {len(DEMO_PM)} PM schedules, "
              f"{len(DEMO_USERS)} users, 1 active roster pattern, 3 demo log entries.")
    finally:
        db.close()


if __name__ == "__main__":
    import os
    if os.environ.get("AMPS_SEED") == "network":
        from seed_network import seed as seed_network
        seed_network()
    else:
        seed()
