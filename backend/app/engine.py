# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""AMPS pure computation engines — framework-free and unit-testable.

Everything here is plain Python (no FastAPI/SQLAlchemy imports) so the
core logic can be tested and reused anywhere: API, CLI, batch jobs.
"""
from datetime import date, timedelta

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DUTY_SHIFTS = ["M", "E", "N", "G"]  # R (rest) is never a coverage slot

FREQUENCY_DAYS = {
    "weekly": 7,
    "monthly": 30,
    "quarterly": 91,
    "half_yearly": 182,
    "yearly": 365,
}


# ---------------- preventive-maintenance engine ----------------

def next_due(frequency, last_done):
    """Next due date for a PM task: last_done + frequency interval.
    If never done, it is due immediately (today)."""
    if last_done is None:
        return date.today()
    return last_done + timedelta(days=FREQUENCY_DAYS[frequency])


def overdue_days(due, today=None):
    """Days overdue (0 if not yet due)."""
    today = today or date.today()
    return max(0, (today - due).days)


CRITICALITY_WEIGHT = {"A": 3, "B": 2, "C": 1}


def priority_score(criticality, overdue):
    """Maintenance triage is criticality x overdue, not date order alone:
    an overdue check on a critical asset outranks a very-overdue check on a
    tolerable one. Score = weight x (1 + days overdue)."""
    return CRITICALITY_WEIGHT.get(criticality, 2) * (1 + overdue)


# ---------------- maintenance-schedule engine ----------------

# Display label → interval in days, shortest first. A longer interval is the
# more comprehensive service, and it *covers* every shorter cycle under it.
SCHEDULE_FREQ = {
    "Weekly": 7, "Monthly": 30, "Quarterly": 91, "Half-Yearly": 182, "Yearly": 365, "5-Yearly": 1825,
}
DUE_SOON_DAYS = 30   # a next-due within this window is "due soon", not yet overdue


def build_schedule(freqs, done, today=None):
    """Per-frequency schedule for one asset.

    freqs: the frequencies to report — the asset's plan, or (as a fallback) the
        frequencies present in its log.
    done: {frequency: last-done date} for every frequency that has one (log or
        seed), used for the roll-up even when a frequency isn't itself reported.

    A comprehensive service fulfils the shorter cycles under it, so a frequency's
    effective last-done is the most recent maintenance at that frequency OR any
    longer-interval one. A reported frequency that was never done is 'never'.
    Returns rows sorted shortest-cycle first.
    """
    today = today or date.today()
    rows = []
    for f in sorted(freqs, key=lambda x: SCHEDULE_FREQ[x]):
        days = SCHEDULE_FREQ[f]
        src = None   # frequency whose date fulfils this one (same or longer, most recent)
        for g, gdate in done.items():
            if SCHEDULE_FREQ[g] >= days and (src is None or gdate > done[src]):
                src = g
        if src is None:
            rows.append({"frequency": f, "last_done": None, "via": None,
                         "next_due": None, "days_left": None, "state": "never"})
            continue
        due = done[src] + timedelta(days=days)
        left = (due - today).days
        state = "overdue" if left < 0 else "due_soon" if left <= DUE_SOON_DAYS else "ok"
        rows.append({"frequency": f, "last_done": done[src], "via": src if src != f else None,
                     "next_due": due, "days_left": left, "state": state})
    return rows


# The 5-Yearly (and any longer) is a LONG-cycle overhaul. Most assets have never
# had one — the section/system is only a few years old — so a lapsed 5-yearly is
# a backlog item, not a live breakdown risk like a missed monthly/quarterly. It
# is reported SEPARATELY so the headline "overdue" reflects the routine cycles
# the PCEE actually acts on, not thousands of pending 5-yearly overhauls.
LONG_CYCLE_DAYS = SCHEDULE_FREQ["5-Yearly"]   # 1825


def summarize_schedule(rows):
    """One-line health for the register: the soonest next PM, the worst state,
    and the overdue counts — split into routine (short-cycle) overdue and the
    long-cycle (5-Yearly) overdue/never-started backlog."""
    if not rows:
        return None
    def _is_long(r):
        return SCHEDULE_FREQ.get(r["frequency"], 0) >= LONG_CYCLE_DAYS
    outstanding = [r for r in rows if r["state"] in ("overdue", "never")]
    overdue = [r for r in outstanding if not _is_long(r)]       # routine overdue (the headline)
    long_overdue = [r for r in outstanding if _is_long(r)]      # 5-Yearly overdue / never started
    due_soon = [r for r in rows if r["state"] == "due_soon"]
    dated = [r for r in rows if r["next_due"] is not None]
    nxt = min(dated, key=lambda r: r["next_due"]) if dated else None
    # routine overdue dominates; then due-soon; then long-cycle backlog; then ok
    state = ("overdue" if overdue else "due_soon" if due_soon
             else "long_overdue" if long_overdue else "ok")
    # "never done": the asset is routine-overdue AND no routine cycle was ever
    # performed — a fresh asset with no maintenance history at all, distinct from
    # one that lapsed after being done. Must look at EVERY routine row, not just
    # the outstanding ones: a pump with Quarterly recorded but Yearly still blank
    # has a routine PM on record (Quarterly='ok'), so it is NOT awaiting its first
    # service — it is merely overdue on the Yearly. Checking only `overdue` (which
    # excludes the done 'ok' rows) wrongly flagged every such pump as never-done.
    routine = [r for r in rows if not _is_long(r)]
    never_done = bool(overdue) and all(r["state"] == "never" for r in routine)
    return {
        "next_frequency": nxt["frequency"] if nxt else (
            overdue[0]["frequency"] if overdue else long_overdue[0]["frequency"] if long_overdue else None),
        "next_due": nxt["next_due"] if nxt else None,
        "days_left": nxt["days_left"] if nxt else None,
        "state": state,
        "never_done": never_done,
        "overdue_count": len(overdue),
        "long_overdue_count": len(long_overdue),
    }


# ---------------- roster coverage engine ----------------

def compute_coverage(rows, window_shifts):
    """Coverage analysis of a weekly duty pattern.

    rows: {person: [7 shift codes, Monday first]}
    window_shifts: shift codes counted as the maintenance window.
    Returns (per_day, total_uncovered); per_day items are
    (day_name, counts, uncovered, window_staff).
    The number that should be zero in any defensible roster is
    total_uncovered: day x shift cells where no one is on duty.
    """
    per_day = []
    total_uncovered = 0
    for d in range(7):
        counts = {s: 0 for s in DUTY_SHIFTS}
        for shifts in rows.values():
            if d < len(shifts) and shifts[d] in counts:
                counts[shifts[d]] += 1
        uncovered = [s for s, n in counts.items() if n == 0]
        total_uncovered += len(uncovered)
        window_staff = sum(counts.get(s, 0) for s in window_shifts)
        per_day.append((WEEKDAYS[d], counts, uncovered, window_staff))
    return per_day, total_uncovered
