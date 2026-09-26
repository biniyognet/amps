# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Unit tests for the pure computation engines (no framework required)."""
from datetime import date, timedelta

from app.engine import (
    build_schedule, compute_coverage, next_due, overdue_days, priority_score,
    summarize_schedule,
)


def test_schedule_rolls_next_due_by_interval():
    today = date(2026, 7, 23)
    rows = build_schedule({"Yearly"}, {"Yearly": date(2025, 12, 3)}, today)
    r = rows[0]
    assert r["frequency"] == "Yearly"
    assert r["next_due"] == date(2026, 12, 3)
    assert r["state"] == "ok" and r["via"] is None


def test_schedule_comprehensive_service_fulfils_shorter_cycles():
    # a Yearly on 2025-12-03 also counts as that period's Quarterly
    today = date(2026, 7, 23)
    done = {"Quarterly": date(2022, 11, 13), "Yearly": date(2025, 12, 3)}
    rows = {r["frequency"]: r for r in build_schedule({"Quarterly", "Yearly"}, done, today)}
    # quarterly's effective last-done rolls up to the yearly, not the 2022 quarterly
    assert rows["Quarterly"]["last_done"] == date(2025, 12, 3)
    assert rows["Quarterly"]["via"] == "Yearly"
    assert rows["Quarterly"]["next_due"] == date(2026, 3, 4)  # +91d, overdue but not by years
    assert rows["Quarterly"]["state"] == "overdue"


def test_schedule_planned_but_never_done_is_never():
    rows = build_schedule({"Monthly"}, {}, date(2026, 7, 23))
    assert rows[0]["state"] == "never" and rows[0]["next_due"] is None


def test_recent_yearly_keeps_monthly_on_schedule():
    # the roll-up means a fresh Yearly also satisfies the Monthly cycle
    today = date(2026, 7, 23)
    rows = {r["frequency"]: r for r in
            build_schedule({"Monthly", "Yearly"}, {"Yearly": date(2026, 7, 1)}, today)}
    assert rows["Monthly"]["via"] == "Yearly"
    assert rows["Monthly"]["state"] == "due_soon"  # next monthly 2026-07-31, not overdue


def test_summarize_counts_never_as_overdue():
    # a planned cycle with nothing to fulfil it is overdue
    s = summarize_schedule(build_schedule({"Yearly"}, {}, date(2026, 7, 23)))
    assert s["state"] == "overdue" and s["overdue_count"] == 1


def test_next_due_never_done_is_today():
    assert next_due("monthly", None) == date.today()


def test_next_due_rolls_by_frequency():
    last = date(2026, 1, 1)
    assert next_due("weekly", last) == date(2026, 1, 8)
    assert next_due("quarterly", last) == last + timedelta(days=91)


def test_overdue_days():
    today = date(2026, 7, 10)
    assert overdue_days(date(2026, 7, 6), today) == 4
    assert overdue_days(date(2026, 7, 12), today) == 0  # not yet due


def test_priority_criticality_beats_date():
    # critical asset 2 days overdue outranks tolerable asset 5 days overdue
    assert priority_score("A", 2) > priority_score("C", 5)
    # within the same criticality, more overdue = higher
    assert priority_score("B", 5) > priority_score("B", 1)


def test_coverage_balanced_pattern_has_no_men_gaps():
    rows = {
        "S1": ["M", "E", "N", "R", "G", "M", "E"],
        "S2": ["E", "N", "R", "M", "E", "N", "G"],
        "S3": ["N", "M", "E", "N", "M", "R", "N"],
        "T1": ["G", "G", "M", "E", "N", "E", "M"],
    }
    per_day, _ = compute_coverage(rows, ["N"])
    for _, counts, _, window_staff in per_day:
        assert counts["M"] >= 1 and counts["E"] >= 1 and counts["N"] >= 1
        assert window_staff >= 1  # night window always staffed


def test_coverage_flags_all_general_pattern():
    rows = {f"P{i}": ["G"] * 6 + ["R"] for i in range(8)}
    per_day, uncovered = compute_coverage(rows, ["N"])
    # M/E/N empty all 7 days + Sunday G empty (everyone resting) = 22
    assert uncovered == 22
    _, _, sunday_uncovered, _ = per_day[6]
    assert sunday_uncovered == ["M", "E", "N", "G"]  # Sunday fully dark


def test_recent_lapse_on_monthly_is_records_awaited_grace():
    # agency records reach the depot up to a month late: a Monthly+ cycle that
    # lapsed ≤30 days ago is 'grace' (neutral), not overdue; day 31 is overdue
    today = date(2026, 9, 26)
    due_30_ago = today - timedelta(days=30 + 91)   # Quarterly due exactly 30d ago
    due_31_ago = today - timedelta(days=31 + 91)
    assert build_schedule({"Quarterly"}, {"Quarterly": due_30_ago}, today)[0]["state"] == "grace"
    assert build_schedule({"Quarterly"}, {"Quarterly": due_31_ago}, today)[0]["state"] == "overdue"


def test_weekly_gets_no_grace():
    today = date(2026, 9, 26)
    rows = build_schedule({"Weekly"}, {"Weekly": today - timedelta(days=8)}, today)
    assert rows[0]["state"] == "overdue"


def test_summarize_grace_is_neither_overdue_nor_ok():
    today = date(2026, 9, 26)
    s = summarize_schedule(build_schedule({"Monthly"}, {"Monthly": today - timedelta(days=40)}, today))
    assert s["state"] == "grace" and s["grace_count"] == 1 and s["overdue_count"] == 0
    # a genuinely lapsed cycle still dominates
    s = summarize_schedule(build_schedule({"Monthly", "Quarterly"},
                                          {"Monthly": today - timedelta(days=40),
                                           "Quarterly": today - timedelta(days=200)}, today))
    assert s["state"] == "overdue"
