# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Synthetic ESTATE seed — four fictional plant sites for the public demo.

ALL DATA HERE IS FICTIONAL. Site, area, agency, make and person names are invented;
no real organization's assets, locations or records appear in this file.

Four industries on one AMPS: a rail transit line, a power substation, a water works and a
factory. Deterministic (fixed RNG seed) and relative to today, so the demo always
looks current: ~2,000 assets, 18 months of maintenance history, breakdowns with
their rectifications, job cards to outside agencies, staff and a duty roster. Each
site has its own health profile so the landing board shows a realistic mix.

Run:  python seed_network.py   (uses DATABASE_URL, or the local SQLite fallback)
Idempotent: does nothing when the first site already exists.
"""
import random
from datetime import date, datetime, time, timedelta

from sqlalchemy import select

from app.db import SessionLocal, init_db
from app.models import (
    Agency, AgencyScope, Asset, AssetClass, AssetStatus, Criticality, Location, LocationKind,
    LogEntry, LogEntryType, PMPlan, PMPlanned, RosterEntry, RosterPattern, ShiftCode,
    User, UserRole,
)

RNG = random.Random(1115)
TODAY = date.today()
HISTORY_DAYS = 548  # ~18 months

# name, depot code, commissioned year, health profile
#   exemplary — nearly everything on schedule
#   lagging   — a steady share of cycles missed
#   cluster   — fine overall, two stations badly overdue
#   new       — recently opened, many assets awaiting their first service
# site, unit code, opened, health profile, industry. Each site's last area is its
# hub (workshop / control building / MCC / utility block) and gets the hub counts.
LINES = [
    ("Metro Traction & Depot",         "MTD", 2004, "exemplary", "transit"),
    ("Eastern Grid 132 kV Substation", "EGS", 2011, "lagging",   "power"),
    ("City Water Treatment Plant",     "CWT", 2016, "cluster",   "water"),
    ("Bengal Steel & Rolling Mill",    "BSR", 2024, "new",       "factory"),
]

STATIONS = {
    "Metro Traction & Depot": ["Central", "Harbour Gate", "Northfield", "Mill Road", "Civic Centre",
                               "Old Town", "University", "Lakeview", "Market Square", "Depot Workshop"],
    "Eastern Grid 132 kV Substation": ["HV Yard North", "HV Yard South", "MV Switchyard",
                                       "Transformer Bay A", "Transformer Bay B", "Feeder Bay East",
                                       "Feeder Bay West", "Capacitor Yard", "Cable Gallery", "Control Building"],
    "City Water Treatment Plant": ["Intake Pump House", "Raw Water Main", "Clariflocculator 1",
                                   "Clariflocculator 2", "Rapid Sand Filters", "Chlorination House",
                                   "Clear Water Reservoir", "Booster Station", "Sludge Handling", "Admin & MCC"],
    "Bengal Steel & Rolling Mill": ["Melt Shop", "Ladle Furnace", "Continuous Caster",
                                    "Reheating Furnace", "Roughing Mill", "Finishing Mill",
                                    "Cooling Bed", "Coil Yard", "Roll Shop", "Utility Block"],
}

# per industry: class, code prefix, system, criticality, codal life (yrs),
# per-area count (area / hub), PM cycles, makes (all invented)
CLASSES = {
    "transit": [
        ("Traction Transformer", "TTR", "Traction / PS", "A", 25, (1, 1), ["Monthly", "Yearly"], ["Voltara", "Ferrum Elec"]),
        ("Auxiliary Transformer", "ATR", "Traction / PS", "A", 25, (2, 2), ["Quarterly", "Yearly"], ["Voltara", "Ferrum Elec"]),
        ("Rectifier", "REC", "Traction / PS", "A", 20, (1, 1), ["Monthly", "Yearly"], ["Ampex Drives"]),
        ("HSCB Panel", "HSC", "Traction / PS", "A", 20, (4, 4), ["Monthly", "Half-Yearly"], ["Kestrel Switchgear"]),
        ("33kV VCB Panel", "VCB", "Traction / PS", "A", 25, (3, 4), ["Quarterly", "Yearly", "5-Yearly"], ["Kestrel Switchgear"]),
        ("RTU", "RTU", "SCADA", "B", 12, (1, 2), ["Quarterly"], ["Linewise Controls"]),
        ("LT Panel", "LTP", "Electrical", "B", 20, (6, 8), ["Quarterly", "Yearly"], ["Brightline Power", "Ferrum Elec"]),
        ("UPS", "UPS", "Electrical", "A", 10, (2, 3), ["Monthly", "Yearly"], ["Steadycell"]),
        ("Battery Bank", "BAT", "Electrical", "B", 6, (2, 3), ["Monthly"], ["Steadycell"]),
        ("DG Set", "DGS", "Utilities", "A", 20, (1, 1), ["Monthly", "Half-Yearly", "Yearly"], ["Ironbark Gensets"]),
        ("Escalator", "ESC", "Lift & Escalator", "A", 25, (8, 0), ["Monthly", "Half-Yearly"], ["Ascendo", "Liftway"]),
        ("Lift", "LFT", "Lift & Escalator", "A", 25, (3, 1), ["Monthly", "Yearly"], ["Ascendo", "Liftway"]),
        ("Tunnel Ventilation Fan", "TVF", "HVAC", "A", 25, (2, 0), ["Quarterly", "Yearly"], ["Aerodyne Fans"]),
        ("AHU", "AHU", "HVAC", "B", 15, (6, 2), ["Monthly", "Quarterly"], ["Coolpath"]),
        ("Pump Set", "PMP", "Pumping", "B", 15, (5, 4), ["Quarterly"], ["Hydroflow"]),
        ("Fire Alarm Panel", "FAP", "Fire", "A", 15, (1, 1), ["Monthly", "Yearly"], ["Sentinel Safety"]),
        ("EOT Crane", "CRN", "Material Handling", "B", 25, (0, 4), ["Quarterly", "Yearly"], ["Hoistline"]),
        ("Pit Wheel Lathe", "PWL", "Production", "B", 20, (0, 1), ["Monthly", "Yearly"], ["Tornalis"]),
        ("Air Compressor", "CMP", "Utilities", "B", 15, (0, 3), ["Monthly"], ["Ironbark Gensets"]),
    ],
    "power": [
        ("Power Transformer", "PTR", "HV Switchyard", "A", 35, (2, 0), ["Monthly", "Yearly", "5-Yearly"], ["Voltara", "Ferrum Elec"]),
        ("132kV Circuit Breaker", "CB1", "HV Switchyard", "A", 25, (3, 0), ["Quarterly", "Yearly"], ["Kestrel Switchgear"]),
        ("33kV VCB Panel", "VCB", "HV Switchyard", "A", 25, (5, 2), ["Quarterly", "Yearly"], ["Kestrel Switchgear"]),
        ("Isolator", "ISO", "HV Switchyard", "B", 25, (10, 0), ["Half-Yearly", "Yearly"], ["Kestrel Switchgear"]),
        ("CT / PT Set", "CTP", "HV Switchyard", "B", 25, (8, 0), ["Yearly"], ["Ferrum Elec"]),
        ("Lightning Arrester", "LA", "HV Switchyard", "B", 20, (6, 0), ["Yearly"], ["Ferrum Elec"]),
        ("Capacitor Bank", "CAP", "HV Switchyard", "B", 15, (2, 0), ["Quarterly"], ["Brightline Power"]),
        ("Earth Pit", "EP", "HV Switchyard", "C", 30, (6, 2), ["Yearly"], ["Brightline Power"]),
        ("Relay Panel", "RLY", "Protection", "A", 15, (4, 4), ["Half-Yearly", "Yearly"], ["Linewise Controls"]),
        ("Battery Bank", "BAT", "Electrical", "A", 6, (1, 2), ["Monthly"], ["Steadycell"]),
        ("Battery Charger", "BCH", "Electrical", "A", 12, (1, 2), ["Monthly"], ["Steadycell"]),
        ("RTU", "RTU", "SCADA", "B", 12, (1, 2), ["Quarterly"], ["Linewise Controls"]),
        ("LT Panel", "LTP", "Electrical", "B", 20, (2, 3), ["Quarterly", "Yearly"], ["Brightline Power"]),
        ("DG Set", "DGS", "Utilities", "A", 20, (0, 1), ["Monthly", "Yearly"], ["Ironbark Gensets"]),
        ("Fire Alarm Panel", "FAP", "Fire", "A", 15, (1, 1), ["Monthly", "Yearly"], ["Sentinel Safety"]),
    ],
    "water": [
        ("Raw Water Pump", "RWP", "Pumping", "A", 20, (4, 0), ["Monthly", "Yearly"], ["Hydroflow", "Aquaserv"]),
        ("Clear Water Pump", "CWP", "Pumping", "A", 20, (4, 0), ["Monthly", "Yearly"], ["Hydroflow", "Aquaserv"]),
        ("Pump Motor", "MTR", "Electrical", "A", 20, (6, 2), ["Quarterly", "Yearly"], ["Ferrum Elec"]),
        ("VFD", "VFD", "Electrical", "B", 12, (3, 1), ["Half-Yearly"], ["Ampex Drives"]),
        ("Valve Actuator", "VAC", "Treatment", "B", 15, (12, 2), ["Quarterly"], ["Aquaserv"]),
        ("Flow Meter", "FLM", "Instrumentation", "B", 12, (3, 1), ["Half-Yearly"], ["Linewise Controls"]),
        ("Level Sensor", "LVL", "Instrumentation", "C", 10, (4, 0), ["Half-Yearly"], ["Linewise Controls"]),
        ("Dosing Pump", "DOS", "Treatment", "A", 12, (3, 0), ["Monthly"], ["Aquaserv"]),
        ("Chlorinator", "CHL", "Treatment", "A", 15, (1, 0), ["Monthly", "Yearly"], ["Aquaserv"]),
        ("Clarifier Drive", "CLD", "Treatment", "A", 20, (1, 0), ["Quarterly", "Yearly"], ["Hydroflow"]),
        ("Backwash Blower", "BWB", "Treatment", "B", 20, (2, 0), ["Quarterly"], ["Aerodyne Fans"]),
        ("Air Compressor", "CMP", "Utilities", "B", 15, (1, 1), ["Monthly"], ["Ironbark Gensets"]),
        ("HT Panel", "HTP", "Electrical", "A", 25, (1, 2), ["Quarterly", "Yearly"], ["Kestrel Switchgear"]),
        ("MCC Panel", "MCC", "Electrical", "A", 20, (3, 4), ["Quarterly", "Yearly"], ["Brightline Power"]),
        ("PLC Panel", "PLC", "Instrumentation", "A", 12, (1, 2), ["Half-Yearly"], ["Linewise Controls"]),
        ("Distribution Transformer", "DTR", "Electrical", "A", 25, (1, 2), ["Yearly"], ["Voltara"]),
        ("DG Set", "DGS", "Utilities", "A", 20, (0, 2), ["Monthly", "Yearly"], ["Ironbark Gensets"]),
    ],
    "factory": [
        ("Rolling Mill Stand", "RMS", "Production", "A", 20, (3, 0), ["Monthly", "Yearly"], ["Pressforge"]),
        ("Hydraulic Power Pack", "HPP", "Production", "A", 15, (8, 0), ["Monthly", "Half-Yearly"], ["Tornalis"]),
        ("Pinch Roll Unit", "PRU", "Production", "A", 12, (2, 0), ["Quarterly"], ["Kinetra Robotics"]),
        ("Conveyor", "CNV", "Material Handling", "B", 15, (4, 1), ["Monthly"], ["Beltway Systems"]),
        ("Gearbox", "GBX", "Production", "B", 15, (4, 0), ["Quarterly"], ["Pressforge"]),
        ("Drive Motor", "MTR", "Electrical", "B", 20, (12, 2), ["Quarterly", "Yearly"], ["Ferrum Elec"]),
        ("Overhead Crane", "CRN", "Material Handling", "B", 25, (2, 1), ["Quarterly", "Yearly"], ["Hoistline"]),
        ("Exhaust Fan", "EXF", "HVAC", "C", 15, (4, 1), ["Quarterly"], ["Aerodyne Fans"]),
        ("LT Panel", "LTP", "Electrical", "B", 20, (3, 2), ["Quarterly", "Yearly"], ["Brightline Power"]),
        ("MCC Panel", "MCC", "Electrical", "A", 20, (2, 2), ["Quarterly", "Yearly"], ["Brightline Power"]),
        ("Air Compressor", "CMP", "Utilities", "A", 15, (0, 3), ["Monthly"], ["Ironbark Gensets"]),
        ("Boiler", "BLR", "Utilities", "A", 25, (0, 2), ["Monthly", "Yearly"], ["Thermacore"]),
        ("Cooling Tower", "CTW", "Utilities", "B", 20, (0, 2), ["Quarterly"], ["Coolpath"]),
        ("Chiller", "CHR", "HVAC", "A", 20, (0, 1), ["Monthly", "Half-Yearly"], ["Coolpath"]),
        ("HT Panel", "HTP", "Electrical", "A", 25, (0, 2), ["Quarterly", "Yearly"], ["Kestrel Switchgear"]),
        ("Distribution Transformer", "DTR", "Electrical", "A", 25, (0, 2), ["Yearly"], ["Voltara"]),
        ("Fire Hydrant Pump", "FHP", "Fire", "A", 15, (0, 2), ["Monthly"], ["Hydroflow"]),
        ("Fire Alarm Panel", "FAP", "Fire", "A", 15, (1, 1), ["Monthly", "Yearly"], ["Sentinel Safety"]),
        ("DG Set", "DGS", "Utilities", "A", 20, (0, 2), ["Monthly", "Yearly"], ["Ironbark Gensets"]),
        ("UPS", "UPS", "Electrical", "B", 10, (1, 1), ["Monthly"], ["Steadycell"]),
    ],
}

SPOTS = {
    "transit": ["TSS room", "ASS room", "Concourse", "Platform level", "Plant room",
                "Entry A", "Entry B", "Tunnel end", "Roof", "Basement"],
    "power": ["Bay 1", "Bay 2", "Bay 3", "Bay 4", "Gantry", "Plinth", "Panel room", "Outdoor"],
    "water": ["Ground floor", "Pump floor", "Gallery", "Walkway", "Panel room", "Outdoor", "Roof"],
    "factory": ["Bay 1", "Bay 2", "Bay 3", "Mezzanine", "Pit", "Panel room", "Outdoor", "Roof"],
}
FIRST = ["R.", "S.", "K.", "P.", "D.", "A.", "M.", "T.", "V.", "N."]
LAST = ["Mehta", "Iyer", "Nair", "Rao", "Joshi", "Kapoor", "Menon", "Pillai",
        "Shetty", "Varma", "Kulkarni", "Desai", "Reddy", "Bhatt", "Chopra"]
AGENCIES = ["Voltara Service", "Kestrel Field Team", "Ascendo Care", "Coolpath Services",
            "Hydroflow Contracts", "Tornalis Support", "Ironbark Service"]
# who maintains what, per unit: each site's two outside agencies take a few
# systems on AMC; every system not listed stays with the section's own staff.
AGENCY_SCOPE = {
    "MTD": {"Voltara Service": ["Traction / PS"], "Kestrel Field Team": ["Lift & Escalator", "HVAC"]},
    "EGS": {"Ascendo Care": ["HV Switchyard"], "Coolpath Services": ["Protection", "SCADA"]},
    "CWT": {"Hydroflow Contracts": ["Pumping", "Treatment"], "Tornalis Support": ["Instrumentation"]},
    "BSR": {"Ironbark Service": ["Utilities"], "Voltara Service": ["Production"]},
}
IN_HOUSE = "In-house (section)"

FAULTS = {
    "Traction / PS": ["HSCB tripped on overcurrent", "DC earth fault", "Rectifier diode alarm",
                      "Transformer winding temperature high", "VCB failed to close"],
    "HV Switchyard": ["Breaker SF6 pressure low", "Transformer Buchholz alarm", "Isolator not fully closed",
                      "Transformer oil temperature high", "Capacitor unit bulged"],
    "Protection": ["Relay self-check failure", "Trip circuit unhealthy", "Distance relay maloperation"],
    "SCADA": ["RTU communication lost", "Status mismatch at control room"],
    "Electrical": ["Feeder tripped on earth fault", "UPS on bypass", "Battery cell low voltage",
                   "Motor insulation low", "VFD overcurrent fault", "Panel hot spot found on thermography"],
    "Utilities": ["DG failed to start", "Compressor overheating", "Boiler low water trip",
                  "Cooling tower fan tripped"],
    "Lift & Escalator": ["Escalator stopped — step sag switch", "Handrail speed fault",
                         "Lift door sensor fault", "Lift stuck between floors"],
    "HVAC": ["Fan vibration high", "AHU belt snapped", "Chiller high-pressure trip"],
    "Pumping": ["Pump not starting", "Mechanical seal leak", "Pump cavitation noise", "Low discharge pressure"],
    "Treatment": ["Dosing pump air-locked", "Valve actuator torque trip", "Chlorine leak alarm", "Clarifier drive overload"],
    "Instrumentation": ["Flow meter reading erratic", "Level sensor stuck", "PLC I/O card fault"],
    "Fire": ["Fire panel loop fault", "Hydrant pump pressure low"],
    "Production": ["Hydraulic power pack oil leak", "Mill stand roll bearing overheat", "Pinch roll gap fault",
                   "Gearbox oil leak", "Lathe tailstock seized"],
    "Material Handling": ["Crane long-travel brake fault", "Conveyor belt misalignment", "Conveyor motor tripped"],
}
ACTIONS = ["Reset after inspection; parameters normal.", "Faulty relay replaced; tested OK.",
           "Contactor replaced; trial run OK.", "Loose termination tightened; monitored for one hour.",
           "Sensor cleaned and re-aligned; normalised.", "Fuse replaced; load restored.",
           "Belt replaced; vibration within limits.", "Card replaced by OEM; system restored.",
           "Seal replaced; no leak on trial.", "Bearing replaced; running smoothly."]

CYCLE_DAYS = {"Weekly": 7, "Monthly": 30, "Quarterly": 91, "Half-Yearly": 182,
              "Yearly": 365, "5-Yearly": 1825}


def _at(d: date, hour: int) -> datetime:
    return datetime.combine(d, time(hour % 24, RNG.randint(0, 59)))


def _abbr(area: str) -> str:
    """Short area code for asset tags: 'Feeder Bay East' -> 'FBE', 'Central' -> 'CEN'."""
    words = area.replace("&", " ").split()
    return (words[0][:3] if len(words) == 1 else "".join(w[0] for w in words)[:3]).upper()


def _person() -> str:
    return f"{RNG.choice(FIRST)} {RNG.choice(LAST)}"


def _skip_prob(profile: str, station_idx: int, days_ago: int) -> float:
    """Chance a scheduled service was missed — tunes each site's health."""
    if profile == "exemplary":
        return 0.01 if days_ago > 45 else 0.03
    if profile == "lagging":
        return 0.10 if days_ago > 120 else 0.45
    if profile == "cluster":
        if station_idx in (3, 4) and days_ago < 150:
            return 0.92
        return 0.03 if days_ago > 45 else 0.08
    return 0.03 if days_ago > 45 else 0.06   # new


def seed():
    init_db()
    db = SessionLocal()
    try:
        if db.scalar(select(Location).where(Location.kind == LocationKind.SITE,
                                            Location.name == LINES[0][0])):
            print("Network already seeded — nothing to do.")
            return

        classes = {}
        for c in (c for cl in CLASSES.values() for c in cl):
            if c[0] in classes:
                continue
            classes[c[0]] = db.scalar(select(AssetClass).where(AssetClass.name == c[0])) \
                or AssetClass(name=c[0])
            db.add(classes[c[0]])

        # ---- people --------------------------------------------------------
        users: list[User] = []
        sites: dict[str, Location] = {}
        for name, depot, *_ in LINES:
            sites[name] = Location(name=name, kind=LocationKind.SITE)
            db.add(sites[name])
        db.flush()
        used = set()

        def mk_user(role, line=None):
            while True:
                full = _person()
                uname = full.replace(". ", ".").lower()
                if uname not in used:
                    used.add(uname)
                    break
            u = User(username=uname, full_name=full, role=role,
                     line_id=sites[line].id if line else None)
            db.add(u)
            users.append(u)
            return u

        crews: dict[str, list[str]] = {}
        for name, *_ in LINES:
            mk_user(UserRole.INCHARGE, name)
            sups = [mk_user(UserRole.SUPERVISOR, name) for _ in range(2)]
            techs = [mk_user(UserRole.TECHNICIAN, name) for _ in range(2)]
            crews[name] = [u.full_name for u in sups + techs]
        mk_user(UserRole.VIEWER)

        # ---- stations + assets --------------------------------------------
        n_assets = n_logs = 0
        all_assets: list[tuple[Asset, str, int]] = []  # asset, line, station idx
        logs: list[LogEntry] = []
        plans: list[tuple] = []
        for line, depot, year, profile, sector in LINES:
            site = sites[line]
            for si, stn in enumerate(STATIONS[line]):
                is_depot = si == len(STATIONS[line]) - 1   # the hub area
                loc = Location(name=stn, kind=LocationKind.STATION, parent=site)
                db.add(loc)
                for (cname, pfx, system, crit, life, per, cycles, makes) in CLASSES[sector]:
                    count = per[1] if is_depot else per[0]
                    for k in range(count):
                        n_assets += 1
                        # older sites: some original equipment past its codal life
                        comm_year = year + (RNG.randint(0, 3) if RNG.random() < 0.8 else RNG.randint(4, 12))
                        comm_year = min(comm_year, TODAY.year)
                        comm = date(comm_year, RNG.randint(1, 12), RNG.randint(1, 28))
                        if comm > TODAY:
                            comm = TODAY - timedelta(days=RNG.randint(60, 300))
                        code = f"{depot}-{_abbr(stn)}-{pfx}-{k + 1:02d}"
                        status = AssetStatus.IN_SERVICE
                        r = RNG.random()
                        if r < 0.006:
                            status = AssetStatus.UNDER_MAINTENANCE
                        elif r < 0.012:
                            status = AssetStatus.SPARE
                        a = Asset(
                            code=code, name=f"{cname} {k + 1}",
                            asset_class=classes[cname], location=loc, line_id=site.id,
                            make_model=f"{RNG.choice(makes)} {pfx}-{RNG.randint(100, 990)}",
                            system=system, commissioned_on=comm, status=status,
                            criticality=Criticality(crit if RNG.random() > 0.15 else "B"),
                            codal_life_years=life, depot=depot,
                            location_detail=RNG.choice(SPOTS[sector]),
                        )
                        db.add(a)
                        all_assets.append((a, line, si))
                        start = max(comm, TODAY - timedelta(days=HISTORY_DAYS))
                        step = CYCLE_DAYS[cycles[0]]
                        # when each cycle was last done; equipment older than the
                        # history window carries a baseline so long cycles start mid-way
                        last = {}
                        for f in cycles:
                            if comm < start:
                                last[f] = start - timedelta(days=RNG.randint(0, max(CYCLE_DAYS[f] - step, 1)))
                                plans.append((a, f, last[f]))
                            else:
                                last[f] = comm
                                plans.append((a, f, None))
                        # newly opened site: a share never yet serviced
                        if profile == "new" and RNG.random() < 0.18:
                            continue
                        d = start + timedelta(days=RNG.randint(0, step - 1))
                        while d <= TODAY:
                            ago = (TODAY - d).days
                            if RNG.random() >= _skip_prob(profile, si, ago):
                                # label with the longest cycle that has come round;
                                # a longer cycle fulfils every shorter one
                                label = cycles[0]
                                for f in cycles[1:]:
                                    if (d - last[f]).days >= CYCLE_DAYS[f] - step // 2:
                                        label = f
                                for f in cycles:
                                    if CYCLE_DAYS[f] <= CYCLE_DAYS[label]:
                                        last[f] = d
                                shift = RNG.choice([ShiftCode.NIGHT, ShiftCode.NIGHT, ShiftCode.GENERAL])
                                logs.append(LogEntry(
                                    at=_at(d, 1 if shift == ShiftCode.NIGHT else 11),
                                    log_date=d, shift=shift, type=LogEntryType.MAINTENANCE,
                                    subtype=label, system=system, station=stn, asset=a,
                                    line_id=site.id, category=cname,
                                    text=f"{label} maintenance of {code} carried out as per checksheet.",
                                    entered_by=RNG.choice(crews[line]),
                                    attended_by=", ".join(RNG.sample(crews[line], 2)),
                                ))
                            # crews work slightly ahead of the due date
                            d += timedelta(days=step - RNG.randint(0, max(2, step // 15)))
        db.flush()
        db.add_all(PMPlan(asset_id=a.id, frequency=f, last_done_seed=b) for a, f, b in plans)
        db.add_all(logs)
        n_logs = len(logs)
        db.flush()

        # ---- breakdowns, rectifications, job cards -------------------------
        weight = {"exemplary": 0.6, "lagging": 1.8, "cluster": 1.2, "new": 0.8}
        prof = {l[0]: l[3] for l in LINES}
        pool = [t for t in all_assets if t[0].status == AssetStatus.IN_SERVICE]
        n_fail = n_jc = 0
        target, recent = 150, 18   # the last `recent` are still outstanding
        while n_fail < target + recent:
            a, line, si = RNG.choice(pool)
            if RNG.random() > weight[prof[line]] / 1.8:
                continue
            n_fail += 1
            tail = n_fail > target
            ago = RNG.randint(0, 25) if tail else int(RNG.triangular(26, HISTORY_DAYS, 40))
            d = TODAY - timedelta(days=ago)
            start = _at(d, RNG.randint(5, 23))
            fault = RNG.choice(FAULTS[a.system])
            stn = a.location.name
            f = LogEntry(at=start, log_date=d, shift=ShiftCode.GENERAL, type=LogEntryType.FAILURE,
                         system=a.system, category=a.asset_class.name, fault_type=fault,
                         station=stn, asset=a, line_id=a.line_id,
                         text=f"{fault} on {a.code} at {stn}.",
                         entered_by=RNG.choice(crews[line]))
            db.add(f)
            db.flush()
            # the most recent few stay outstanding: open / acknowledged / job card
            outstanding = tail
            needs_jc = (n_fail - target) % 3 == 0 if tail else RNG.random() < 0.26
            jc_at = start + timedelta(hours=RNG.uniform(1, 6))
            if needs_jc:
                n_jc += 1
                agency = RNG.choice(AGENCIES)
                db.add(LogEntry(at=jc_at, log_date=jc_at.date(), shift=ShiftCode.GENERAL,
                                type=LogEntryType.JOB_CARD, rectifies_id=f.id, asset=a,
                                line_id=a.line_id, system=a.system, station=stn,
                                fault_type=fault, attended_by=agency,
                                entered_by=RNG.choice(crews[line]),
                                text=f"Job card issued to {agency}: {fault.lower()}."))
            if outstanding:
                if not needs_jc and n_fail % 2 == 0:
                    db.add(LogEntry(at=start + timedelta(hours=1), log_date=d,
                                    type=LogEntryType.ACKNOWLEDGEMENT, rectifies_id=f.id,
                                    asset=a, line_id=a.line_id, station=stn,
                                    entered_by=RNG.choice(crews[line]),
                                    text="Noted; spares demand raised."))
                continue
            hours = min(RNG.lognormvariate(1.1, 0.9), 96.0)
            if needs_jc:
                hours += RNG.uniform(24, 24 * 12)
            end = start + timedelta(hours=hours)
            if end.date() > TODAY:
                end = datetime.combine(TODAY, time(6, 0))
            via_jc = needs_jc and RNG.random() < 0.8
            db.add(LogEntry(at=end, log_date=end.date(), shift=ShiftCode.GENERAL,
                            type=LogEntryType.RECTIFICATION, rectifies_id=f.id, asset=a,
                            line_id=a.line_id, system=a.system, station=stn,
                            action_taken=RNG.choice(ACTIONS), via_job_card=via_jc or None,
                            attended_by=", ".join(RNG.sample(crews[line], 2)),
                            entered_by=RNG.choice(crews[line]),
                            text=RNG.choice(ACTIONS)))

        # ---- duty roster ----------------------------------------------------
        if not db.scalar(select(RosterPattern).where(RosterPattern.name == "Network baseline")):
            pat = RosterPattern(name="Network baseline", is_active=True,
                                description="Synthetic weekly pattern: M/E/N covered every day.",
                                maintenance_window_shifts="N")
            db.add(pat)
            codes = ["M", "E", "N", "R", "G", "M", "E"]
            for i, u in enumerate(x for x in users if x.role in (UserRole.SUPERVISOR, UserRole.TECHNICIAN)):
                for wd in range(7):
                    c = codes[(wd + i * 2) % 7]
                    if c != "R":
                        db.add(RosterEntry(pattern=pat, user=u, weekday=wd, shift=ShiftCode(c)))

        # ---- agency register (who maintains what) ---------------------------
        # A year's AMC for most; Coolpath's runs out within the warning window and
        # Tornalis's ends before next month's schedule, so the board shows both.
        ends = {"Coolpath Services": TODAY + timedelta(days=20),
                "Tornalis Support": TODAY + timedelta(days=10)}
        reg = {IN_HOUSE: Agency(name=IN_HOUSE, kind="in_house",
                                note="Section staff on the duty roster")}
        for depot, covers in AGENCY_SCOPE.items():
            for name, systems in covers.items():
                if name not in reg:
                    to = ends.get(name, TODAY + timedelta(days=165))
                    reg[name] = Agency(name=name, kind="amc",
                                       contract_no=f"LOA/{depot}/AMC/{to.year - 1}-{to:%y}/{len(reg):02d}",
                                       valid_from=to - timedelta(days=364), valid_to=to,
                                       aliases=f"M/s {name.split()[0]}, {name.split()[0]} AMC")
                for system in systems:
                    reg[name].scopes.append(AgencyScope(system=system, depot=depot))
        db.add_all(reg.values())
        db.flush()
        print(f"Agencies: {len(reg)} in the register.")

        # ---- planned maintenance (the Planner timeline) ---------------------
        # Last month → next month, in-house and the site's two AMC agencies: on-time and late
        # completions, rescheduled jobs, overdue ones, today's and upcoming. Own RNG
        # so the history above stays byte-identical.
        prng = random.Random(1118)
        lo = (TODAY.replace(day=1) - timedelta(days=1)).replace(day=1)
        hi = (TODAY.replace(day=28) + timedelta(days=36)).replace(day=1) - timedelta(days=1)
        late_p = {"exemplary": 0.12, "lagging": 0.45, "cluster": 0.25, "new": 0.3}
        miss_p = {"exemplary": 0.03, "lagging": 0.2, "cluster": 0.1, "new": 0.15}
        n_pm = 0
        for li, (line, depot, _y, profile, _s) in enumerate(LINES):
            agencies = [AGENCIES[(2 * li) % len(AGENCIES)], AGENCIES[(2 * li + 1) % len(AGENCIES)]]
            pool = [t for t in all_assets if t[1] == line]
            for k, (a, _l, si) in enumerate(prng.sample(pool, min(28, len(pool)))):
                stn = STATIONS[line][si]
                prng.choice(agencies)  # keeps the draw sequence of earlier seeds
                agency = next((n for n, sy in AGENCY_SCOPE[depot].items() if a.system in sy), None)
                # one agency's own sheet spells its name its own way
                listed = f"M/s {agency.split()[0]}" if agency == "Voltara Service" and depot == "BSR" else agency
                cycle = prng.choice(["Monthly", "Monthly", "Quarterly", "Half-Yearly"])
                d = lo + timedelta(days=prng.randint(0, 27))
                if k < 2:  # a couple due today on every site
                    d = TODAY - timedelta(days=CYCLE_DAYS[cycle] * ((TODAY - lo).days // CYCLE_DAYS[cycle]))
                while d <= hi:
                    p = PMPlanned(asset_id=a.id, line_id=a.line_id, planned_date=d, cycle=cycle,
                                  task=f"{cycle} PM of {a.code} as per checksheet",
                                  contractor=listed, source=f"{depot}/PM/{d:%b-%Y}".upper(),
                                  created_by="seed")
                    r = prng.random()
                    if d > TODAY:
                        if r < 0.15:  # agency asked for a later date
                            p.original_date = d - timedelta(days=prng.randint(2, 7))
                            p.status, p.note = "rescheduled", "Shutdown window moved by the agency"
                    elif d == TODAY:
                        pass
                    elif r < miss_p[profile]:
                        pass  # overdue: still open
                    else:
                        if r < miss_p[profile] + 0.1:
                            p.original_date = d - timedelta(days=prng.randint(3, 10))
                            p.note = "Rescheduled: access permit not issued"
                        late = prng.random() < late_p[profile]
                        done = d + timedelta(days=prng.randint(1, 9) if late else 0)
                        done = min(done, TODAY)
                        e = LogEntry(at=_at(done, 1), log_date=done, shift=ShiftCode.NIGHT,
                                     type=LogEntryType.MAINTENANCE, subtype=cycle, system=a.system,
                                     station=stn, asset=a, line_id=a.line_id,
                                     category=a.asset_class.name,
                                     text=f"{cycle} maintenance of {a.code} carried out by {agency or 'section staff'}.",
                                     entered_by=prng.choice(crews[line]),
                                     attended_by=agency or "Section staff")
                        db.add(e)
                        db.flush()
                        p.status, p.done_on, p.log_entry_id, p.closed_by = "done", done, e.id, "seed"
                    db.add(p)
                    n_pm += 1
                    d += timedelta(days=CYCLE_DAYS[cycle])
        db.flush()

        # ---- the AMC agencies' shared schedules -----------------------------
        # Each agency sends the section its fortnight's plan. Most due work is on
        # it; about one job in ten is missing, which auto-plan reports as a gap.
        from app.api.autoplan import _candidates
        from app.api.agencies import Resolver
        who, srng, n_sh = Resolver(db), random.Random(1119), 0
        viewer = User(username="seed", full_name="seed", role=UserRole.ADMIN)
        for j in _candidates(db, viewer, TODAY + timedelta(days=13), None, None, who):
            if j["agency_kind"] == "in_house" or j["plan"] or srng.random() < 0.1:
                continue
            d = TODAY + timedelta(days=srng.randint(1, 13))
            db.add(PMPlanned(asset_id=j["asset_id"], line_id=db.get(Asset, j["asset_id"]).line_id, planned_date=d,
                             cycle=j["cycle"], task=f"{j['cycle']} PM of {j['asset_code']} as per checksheet",
                             contractor=j["contractor"], source=f"AMC/{j['contractor']}/{d:%b-%Y}".upper(),
                             created_by="seed"))
            n_sh += 1
            n_pm += 1
        print(f"Planned maintenance: {n_pm} jobs ({n_sh} from the agencies' own schedules).")

        n_story = _stories(db, crews)
        print(f"AI demo stories: {n_story} failures with full remarks.")

        db.commit()
        print(f"Seeded {len(LINES)} sites, {sum(len(s) for s in STATIONS.values())} areas, "
              f"{n_assets} assets, {n_logs} maintenance entries, {n_fail} failures "
              f"({n_jc} job cards), {len(users)} users.")
    finally:
        db.close()


# ---- AI demo stories ------------------------------------------------------
# A few assets with a history worth showing a judge: repeat faults written the way
# a fitter writes them (similar past failures, fault-field extraction), an old
# critical asset that keeps failing (risk badge), and notes in हिन्दी / বাংলা.
# (asset code, days ago, hours down or None = still open, fault, remark, action)
STORIES = [
    # repeat offender: past codal life, same seal fault three times, open again today
    ("CWT-{0}-MTR-01", 214, 30.5, "Mechanical seal leak",
     "Raw water pump motor 1 tripped on overload at 06:40. Water spraying from the drive-end seal, "
     "bearing housing hot to touch (78 °C on IR gun). Pump isolated, standby pump 2 taken in service.",
     "DE mechanical seal and DE bearing 6312 replaced. Alignment checked, 0.05 mm. Trial run 2 h OK."),
    ("CWT-{0}-MTR-01", 131, 41.0, "Mechanical seal leak",
     "Seal leaking again on pump motor 1, drip rate ~1 litre/min, vibration 7.1 mm/s on DE (limit 4.5). "
     "Suspect misalignment after last seal job.",
     "Seal replaced again; soft foot found under NDE, shimmed. Laser alignment done. Vibration 2.8 mm/s."),
    ("CWT-{0}-MTR-01", 58, 52.0, "Bearing overheating",
     "पंप मोटर 1 का DE बेयरिंग गरम, आवाज़ आ रही है। सील से हल्का रिसाव भी। मोटर बंद किया।",
     "Bearing and seal replaced; impeller wear ring worn, ordered. Recommend motor rewind check."),
    ("CWT-{0}-MTR-01", 2, None, "Mechanical seal leak",
     "Pump motor 1 seal leak for the 4th time this year, water on the terminal box. Insulation 0.8 MΩ "
     "(was 50 MΩ). Kept isolated, standby running alone, no redundancy now.", None),
    # the Snap demo panel: two earlier trips, so the history panel is not empty
    ("MTD-CEN-HSC-01", 96, 3.2, "HSCB tripped on overcurrent",
     "HSCB 1 tripped on overcurrent during evening peak, 18:12. Relay showed I>> 4.2 kA. "
     "No fault found on feeder walk. Reclosed after section clear from TPC.",
     "Relay settings checked against the protection chart; trip coil tested. Reclosed, load normal."),
    ("MTD-CEN-HSC-01", 33, 6.5, "HSCB tripped on overcurrent",
     "HSCB 1 tripped again on overcurrent, arc chute shows burn marks, smell of burning near panel.",
     "Arc chute and main contacts replaced by Voltara Service; contact resistance 38 µΩ. Tested OK."),
    # old critical transformer, rising trend
    ("EGS-{1}-PTR-01", 160, 70.0, "Transformer oil temperature high",
     "PTR 1 OTI 92 °C, WTI 104 °C at 14:00 on 41 °C ambient. Two cooler fans not running.",
     "Cooler fan motors 2 and 3 replaced, fan contactor replaced. OTI 71 °C on full load."),
    ("EGS-{1}-PTR-01", 45, 120.0, "Transformer Buchholz alarm",
     "Buchholz alarm on PTR 1 at 02:15, gas collected in relay. DGA sample sent, acetylene 6 ppm.",
     "Gas was air from a loose breather joint; joint resealed, oil filtered. DGA retest normal."),
    # multilingual and messy, for fault-field extraction
    ("MTD-{2}-ESC-01", 12, 9.0, "Escalator stopped — step sag switch",
     "এসকেলেটর ১ সকাল ৭:৪০ এ বন্ধ, স্টেপ স্যাগ সুইচ অপারেট করেছে। একটা স্টেপ রোলার ভাঙা।",
     "Step roller replaced, step chain tension adjusted. Run tested both directions."),
    ("BSR-{3}-GBX-01", 20, 14.0, "Gearbox oil leak",
     "gear box oil leaking from output shaft seal, oil level below min, noise high. mill stopped 2 hrs",
     "Output shaft oil seal replaced, oil topped up (ISO VG 320). Noise normal."),
]


def _stories(db, crews) -> int:
    """Adds STORIES on top of the generated history (own RNG, so that stays identical)."""
    srng = random.Random(1120)
    assets = list(db.scalars(select(Asset)))
    n = 0
    for pat, ago, hours, fault, remark, action in STORIES:
        head, _, tail = pat.partition("-{")   # "CWT-{0}-MTR-01": first CWT-*-MTR-01 by code
        tail = tail.partition("}")[2]
        a = next((x for x in sorted(assets, key=lambda x: x.code)
                  if (x.code == pat if not tail else
                      x.code.startswith(head + "-") and x.code.endswith(tail))), None)
        if not a:
            continue
        if a.code.endswith("MTR-01") and a.codal_life_years:   # the repeat offender is past its life
            a.commissioned_on = TODAY.replace(year=TODAY.year - a.codal_life_years - 3)
        if a.code.endswith("PTR-01"):   # the grid's main transformer is vital (risk badge amber)
            a.criticality = Criticality.A
        line = next(l for l in crews if db.get(Location, a.line_id).name == l)
        d = TODAY - timedelta(days=ago)
        start = _at(d, srng.randint(6, 20))
        f = LogEntry(at=start, log_date=d, shift=ShiftCode.GENERAL, type=LogEntryType.FAILURE,
                     system=a.system, category=a.asset_class.name, fault_type=fault,
                     station=a.location.name, asset=a, line_id=a.line_id, text=remark,
                     entered_by=srng.choice(crews[line]))
        db.add(f)
        db.flush()
        n += 1
        if hours is None:
            continue
        end = start + timedelta(hours=hours)
        db.add(LogEntry(at=end, log_date=end.date(), shift=ShiftCode.GENERAL,
                        type=LogEntryType.RECTIFICATION, rectifies_id=f.id, asset=a,
                        line_id=a.line_id, system=a.system, station=a.location.name,
                        action_taken=action, text=action,
                        attended_by=", ".join(srng.sample(crews[line], 2)),
                        entered_by=srng.choice(crews[line])))
    return n


def add_stories():
    """Adds the AI demo stories to an already-seeded DB, keeping every other row.
    Safe to re-run: does nothing once the first story is in."""
    init_db()
    db = SessionLocal()
    try:
        if db.scalar(select(LogEntry).where(LogEntry.text == STORIES[0][4])):
            print("AI demo stories already in — nothing to do.")
            return
        crews: dict[str, list[str]] = {}
        for name, *_ in LINES:
            site = db.scalar(select(Location).where(Location.kind == LocationKind.SITE,
                                                    Location.name == name))
            if site:
                crews[name] = list(db.scalars(select(User.full_name).where(
                    User.line_id == site.id,
                    User.role.in_([UserRole.SUPERVISOR, UserRole.TECHNICIAN]))))
        n = _stories(db, crews)
        db.commit()
        print(f"AI demo stories: {n} failures added, existing data kept.")
    finally:
        db.close()


if __name__ == "__main__":
    import sys
    add_stories() if "--stories" in sys.argv else seed()
