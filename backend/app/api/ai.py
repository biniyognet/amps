# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Ask your assets — plain-language questions answered from the live register.

The model never sees the database. It gets a handful of READ-ONLY tools
(sites, asset search, overdue PM, failure summary, asset history) and calls
them by name; every answer is built from what those tools return, scoped to
the caller's line exactly like the rest of the read API.

Providers (AMPS_AI_PROVIDER):
  gemini  — Google Gemini API, key in AMPS_GEMINI_API_KEY (AI Studio key).
  vertex  — the same Gemini models on Vertex AI, billed to a GCP project:
            AMPS_VERTEX_PROJECT (+ AMPS_VERTEX_LOCATION, default global),
            Google credentials instead of a key (see app.api.vertex).
  openai  — any OpenAI-compatible endpoint (Ollama, llama.cpp, vLLM): set
            AMPS_AI_BASE_URL (e.g. http://localhost:11434/v1) and AMPS_AI_MODEL.
            This is how Gemma runs on-premise, with no data leaving the site.
Unset = the feature is off and /api/ai/status says so.
AMPS_AI_FALLBACK_URL / AMPS_AI_FALLBACK_MODEL: an OpenAI-compatible endpoint
tried when Gemini errors or hits its quota.

Standard library only (urllib) — no new dependency.
"""
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict, deque
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api import vertex
from app.api.auth import current_writer, optional_user, scope_location_ids
from app.api.maintenance import schedule_all
from app.db import audit, get_db
from app.engine import SCHEDULE_FREQ
from app.models import (Asset, AssetClass, AssetStatus, Criticality, Location,
                        LocationKind, LogEntry, LogEntryType, PMPlan)

router = APIRouter()

PROVIDER = os.environ.get("AMPS_AI_PROVIDER", "").strip().lower()
GEMINI_KEY = os.environ.get("AMPS_GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.environ.get("AMPS_GEMINI_MODEL", "gemini-2.5-flash")
BASE_URL = os.environ.get("AMPS_AI_BASE_URL", "").rstrip("/")
MODEL = os.environ.get("AMPS_AI_MODEL", "")
FALLBACK_URL = os.environ.get("AMPS_AI_FALLBACK_URL", "").rstrip("/")
FALLBACK_MODEL = os.environ.get("AMPS_AI_FALLBACK_MODEL", "")
PER_MIN = int(os.environ.get("AMPS_AI_PER_MINUTE", "6"))      # per client IP
PER_DAY = int(os.environ.get("AMPS_AI_PER_DAY", "400"))       # whole deployment
TIMEOUT = int(os.environ.get("AMPS_AI_TIMEOUT", "60"))
MAX_STEPS = 5   # tool-call rounds before we stop and answer with what we have
ROW_CAP = 25    # rows any one tool returns — keeps prompts small and cheap


def gemini_on() -> bool:
    """A Gemini model answers: through an AI Studio key (gemini) or Vertex AI (vertex)."""
    return (PROVIDER == "gemini" and bool(GEMINI_KEY)) or (PROVIDER == "vertex" and vertex.configured())


def _enabled() -> bool:
    return gemini_on() or (PROVIDER == "openai" and bool(BASE_URL and MODEL))


def _model() -> str:
    return GEMINI_MODEL if PROVIDER in ("gemini", "vertex") else MODEL


# ---- rate limit (in-process; one replica is plenty for this) ----------------

_hits: dict[str, deque] = defaultdict(deque)
_day = {"date": None, "n": 0}


def _throttle(ip: str):
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= PER_MIN:
        raise HTTPException(429, "Too many questions — try again in a minute.")
    today = date.today()
    if _day["date"] != today:
        _day.update(date=today, n=0)
    if _day["n"] >= PER_DAY:
        raise HTTPException(429, "Today's question allowance is used up — back tomorrow.")
    q.append(now)
    _day["n"] += 1


# ---- tools (read-only, line-scoped) ----------------------------------------

def _site_of(a: Asset) -> str | None:
    return a.location.parent.name if a.location and a.location.parent else None


def _scoped_assets(db, user):
    q = select(Asset).where(Asset.status != AssetStatus.DECOMMISSIONED)
    scope = scope_location_ids(db, user)
    if scope is not None:
        q = q.where(Asset.location_id.in_(scope))
    return q


def _site_filter(q, db, site: str | None):
    if not site:
        return q
    sites = db.scalars(select(Location).where(Location.kind == LocationKind.SITE,
                                              Location.name.ilike(f"%{site}%"))).all()
    ids = {c.id for s in sites for c in s.children} | {s.id for s in sites}
    return q.where(Asset.location_id.in_(ids or {-1}))


def _class_filter(q, asset_class: str | None):
    if not asset_class:
        return q
    return q.join(AssetClass, Asset.asset_class_id == AssetClass.id).where(
        AssetClass.name.ilike(f"%{asset_class}%"))


def t_list_sites(db, user):
    scope = scope_location_ids(db, user)
    out = []
    for s in db.scalars(select(Location).where(Location.kind == LocationKind.SITE)
                        .order_by(Location.id)).all():
        ids = {c.id for c in s.children}
        if scope is not None and not (ids & scope):
            continue
        n = db.scalar(select(func.count(Asset.id)).where(Asset.location_id.in_(ids or {-1}))) or 0
        out.append({"site": s.name, "locations": len(ids), "assets": n})
    return {"sites": out}


def t_search_assets(db, user, site=None, asset_class=None, text=None,
                    criticality=None, past_design_life=False):
    q = _class_filter(_site_filter(_scoped_assets(db, user), db, site), asset_class)
    if text:
        q = q.where(or_(Asset.code.ilike(f"%{text}%"), Asset.name.ilike(f"%{text}%"),
                        Asset.make_model.ilike(f"%{text}%")))
    if criticality:
        q = q.where(Asset.criticality == criticality.upper()[:1])
    rows = db.scalars(q.order_by(Asset.code)).all()
    today = date.today()
    if past_design_life:
        rows = [a for a in rows if a.commissioned_on and a.codal_life_years and
                (today - a.commissioned_on).days / 365.25 > a.codal_life_years]
    by_class = _ranked(Counter(a.asset_class.name for a in rows))
    return {
        "total": len(rows),
        "by_site": _ranked(Counter(_site_of(a) for a in rows)),
        "by_class": by_class,
        "assets": [{
            "code": a.code, "name": a.name, "class": a.asset_class.name,
            "site": _site_of(a), "location": a.location.name if a.location else None,
            "criticality": a.criticality.value, "status": a.status.value,
            "make": a.make_model,
            "age_years": round((today - a.commissioned_on).days / 365.25, 1) if a.commissioned_on else None,
            "design_life_years": a.codal_life_years,
        } for a in rows[:ROW_CAP]],
        "truncated": len(rows) > ROW_CAP,
    }


def t_overdue_pm(db, user, site=None, asset_class=None):
    sched = [s for s in schedule_all(db=db, user=user)
             if s.state in ("overdue", "long_overdue")]
    if site:
        sched = [s for s in sched if s.line and site.lower() in s.line.lower()]
    codes = {(s.asset_code, s.line) for s in sched}
    meta = {}
    if codes:
        for a in db.scalars(select(Asset).where(Asset.code.in_({c for c, _ in codes}))).all():
            meta[(a.code, _site_of(a))] = a
    rows = []
    for s in sched:
        a = meta.get((s.asset_code, s.line))
        if asset_class and (not a or asset_class.lower() not in a.asset_class.name.lower()):
            continue
        lapsed = [f for f, st in s.cycles.items() if st in ("overdue", "never")]
        since = min((s.cycle_due[f] for f in lapsed if s.cycle_due.get(f)), default=None)
        rows.append({
            "code": s.asset_code, "site": s.line,
            "class": a.asset_class.name if a else None,
            "criticality": a.criticality.value if a else None,
            "overdue_cycles": lapsed,
            "never_done": s.never_done,
            "overdue_since": str(since) if since else None,
            "days_overdue": (date.today() - since).days if since else None,
            "last_done": str(s.last_done) if s.last_done else None,
        })
    rows.sort(key=lambda r: ({"A": 0, "B": 1, "C": 2}.get(r["criticality"] or "C", 3),
                             -(r["days_overdue"] or 0)))
    return {
        "total_overdue_assets": len(rows),
        "by_site": _ranked(Counter(r["site"] for r in rows)),
        "by_class": _ranked(Counter(r["class"] for r in rows)),
        "worst_first": rows[:ROW_CAP],
    }


def _failures(db, user, site, asset_class, days):
    since = date.today() - timedelta(days=days)
    q = (select(LogEntry).where(LogEntry.type == LogEntryType.FAILURE,
                                LogEntry.log_date >= since,
                                or_(LogEntry.retracted.is_(None), LogEntry.retracted.is_(False))))
    rows = db.scalars(q).all()
    scope = scope_location_ids(db, user)
    out = []
    for f in rows:
        a = f.asset
        if scope is not None and (not a or a.location_id not in scope):
            continue
        if site and not (a and _site_of(a) and site.lower() in _site_of(a).lower()):
            continue
        if asset_class and not (a and asset_class.lower() in a.asset_class.name.lower()):
            continue
        out.append(f)
    return out


def _ranked(counter, n=10):
    """Counts as a list sorted high→low, so even a small model reads the top right."""
    return [{"name": k, "count": v} for k, v in counter.most_common(n)]


def t_failure_summary(db, user, site=None, asset_class=None, days=365):
    days = max(1, min(int(days or 365), 3 * 365))
    rows = _failures(db, user, site, asset_class, days)
    ids = [f.id for f in rows]
    fixed = {}
    if ids:
        for r in db.scalars(select(LogEntry).where(LogEntry.type == LogEntryType.RECTIFICATION,
                                                   LogEntry.rectifies_id.in_(ids))).all():
            fixed[r.rectifies_id] = r.ended_at or r.at
    hrs = [(fixed[f.id] - f.at).total_seconds() / 3600 for f in rows if f.id in fixed]
    open_ = [f for f in rows if f.id not in fixed]
    key = lambda f: (f.asset.code, _site_of(f.asset))
    repeat = Counter(key(f) for f in rows if f.asset)
    cls = {key(f): f.asset.asset_class.name for f in rows if f.asset}
    return {
        "window_days": days,
        "failures": len(rows),
        "restored": len(hrs),
        "still_open": len(open_),
        "downtime_hours": round(sum(hrs), 1),
        "mttr_hours": round(sum(hrs) / len(hrs), 1) if hrs else None,
        "by_site": _ranked(Counter(_site_of(f.asset) for f in rows if f.asset)),
        "by_class": _ranked(Counter(f.asset.asset_class.name for f in rows if f.asset)),
        "by_fault_type": _ranked(Counter(f.fault_type for f in rows if f.fault_type), 8),
        "per_month": dict(sorted(Counter(f.log_date.strftime("%Y-%m") for f in rows).items())),
        "repeat_offenders": [{"code": c, "site": st, "class": cls.get((c, st)), "failures": n}
                             for (c, st), n in repeat.most_common(10) if n > 1],
        "open_now": [{"code": f.asset.code if f.asset else None, "site": _site_of(f.asset) if f.asset else None,
                      "fault": f.fault_type, "since": str(f.log_date)} for f in open_[:10]],
    }


def t_asset_history(db, user, code, site=None):
    q = _site_filter(_scoped_assets(db, user), db, site).where(Asset.code.ilike(code))
    a = db.scalars(q).first()
    if not a:
        return {"error": f"no asset with code {code}"}
    entries = db.scalars(select(LogEntry).where(LogEntry.asset_id == a.id)
                         .order_by(LogEntry.log_date.desc(), LogEntry.id.desc()).limit(ROW_CAP)).all()
    return {
        "asset": {"code": a.code, "name": a.name, "class": a.asset_class.name, "site": _site_of(a),
                  "location": a.location.name if a.location else None, "make": a.make_model,
                  "commissioned": str(a.commissioned_on) if a.commissioned_on else None,
                  "design_life_years": a.codal_life_years, "criticality": a.criticality.value,
                  "status": a.status.value},
        "recent_log": [{"date": str(e.log_date), "type": e.type.value, "cycle": e.subtype,
                        "fault": e.fault_type, "text": (e.text or "")[:200],
                        "action": (e.action_taken or "")[:200] or None} for e in entries],
    }


# ---- maintenance-plan drafting (proposes; a person approves) ----------------
#
# The draft is rule-based on the records, so every change carries a reason a
# supervisor can check: an asset that keeps failing, a vital asset that broke
# down, or an ageing one (past design life) that failed or is vital, gets the
# next shorter cycle; a tolerable asset with a clean year has its shortest cycle
# extended one step; an asset with no plan gets its class's usual plan. Nothing
# is written here — the draft is held for two hours
# and only POST /plan/{id}/apply, by a signed-in writer, saves it.

LADDER = sorted(SCHEDULE_FREQ, key=SCHEDULE_FREQ.get)   # Weekly … 5-Yearly
_drafts: dict[str, dict] = {}
DRAFT_TTL = 2 * 3600
ACTIVE = (AssetStatus.IN_SERVICE, AssetStatus.UNDER_MAINTENANCE)


def _order(freqs):
    return sorted(freqs, key=SCHEDULE_FREQ.get)


def t_draft_pm_plan(db, user, site=None, asset_class=None):
    note = None
    q = _class_filter(_site_filter(_scoped_assets(db, user), db, site), asset_class)
    assets = [a for a in db.scalars(q).all() if a.status in ACTIVE]
    if not assets and asset_class:   # an invented class name shouldn't sink the whole draft
        note = f"no asset class matches '{asset_class}' - drafted for every class instead"
        asset_class = None
        q = _site_filter(_scoped_assets(db, user), db, site)
        assets = [a for a in db.scalars(q).all() if a.status in ACTIVE]
    if not assets:
        return {"error": "no in-service assets match that site / class"}
    ids = [a.id for a in assets]
    current = defaultdict(set)
    for p in db.scalars(select(PMPlan).where(PMPlan.asset_id.in_(ids))).all():
        if p.frequency in SCHEDULE_FREQ:
            current[p.asset_id].add(p.frequency)
    logged = defaultdict(set)   # assets without a plan run on what their log shows
    for aid, sub in db.execute(select(LogEntry.asset_id, LogEntry.subtype).distinct().where(
            LogEntry.asset_id.in_(ids), LogEntry.type == LogEntryType.MAINTENANCE,
            LogEntry.subtype.in_(LADDER))).all():
        logged[aid].add(sub)
    fails = Counter(f.asset_id for f in _failures(db, user, site, asset_class, 365))
    today = date.today()

    by_cls = defaultdict(list)
    for a in assets:
        by_cls[a.asset_class.name].append(a)
    standard = {}
    for c, rows in by_cls.items():
        sets = Counter(tuple(_order(current[a.id] or logged[a.id])) for a in rows
                       if current[a.id] or logged[a.id])
        standard[c] = set(sets.most_common(1)[0][0]) if sets else set()

    changes, cls_stats = [], []
    for c, rows in sorted(by_cls.items()):
        n_changed = 0
        for a in rows:
            before = current[a.id] or logged[a.id]
            after, why = set(before), []
            if not before and standard[c]:
                after = set(standard[c])
                why.append(f"no plan yet - {c} standard")
            if not after:
                continue
            age = (today - a.commissioned_on).days / 365.25 if a.commissioned_on else None
            past_life = bool(age and a.codal_life_years and age > a.codal_life_years)
            shortest = _order(after)[0]
            step = LADDER.index(shortest)
            nf = fails[a.id]
            vital = a.criticality == Criticality.A
            if nf >= 2 or (nf and (vital or past_life)) or (vital and past_life):
                if step > LADDER.index("Monthly"):
                    after.add(LADDER[step - 1])
                    why.append(f"failed {nf} times in 12 months" if nf >= 2 else
                               "vital asset, broke down this year" if nf and vital else
                               f"past design life ({age:.0f} of {a.codal_life_years} yrs) and failed"
                               if nf else
                               f"vital and past design life ({age:.0f} of {a.codal_life_years} yrs)")
            elif (a.criticality == Criticality.C and nf == 0 and not past_life
                  and shortest in ("Monthly", "Quarterly") and step + 1 < len(LADDER)):
                after.discard(shortest)
                after.add(LADDER[step + 1])
                why.append(f"tolerable, no breakdowns in 12 months - {shortest} extended to {LADDER[step + 1]}")
            if after != before:
                n_changed += 1
                changes.append({"asset_id": a.id, "code": a.code, "site": _site_of(a), "class": c,
                                "criticality": a.criticality.value,
                                "before": _order(before), "after": _order(after),
                                "reason": "; ".join(why)})
        cls_stats.append({"class": c, "assets": len(rows),
                          "failures_12m": sum(fails[a.id] for a in rows),
                          "standard_plan": _order(standard[c]), "changed": n_changed})

    def visits(sets):   # a longer cycle's visit covers the shorter ones that fall due with it
        return round(sum(365 / SCHEDULE_FREQ[_order(x)[0]] for x in sets if x))
    plan_before = [current[a.id] or logged[a.id] for a in assets]
    chg = {r["asset_id"]: set(r["after"]) for r in changes}
    plan_after = [chg.get(a.id, current[a.id] or logged[a.id]) for a in assets]

    now = time.time()
    for k in [k for k, v in _drafts.items() if now - v["at"] > DRAFT_TTL]:
        _drafts.pop(k, None)
    did = secrets.token_hex(4)
    scope = " · ".join(x for x in (site, asset_class) if x) or "all sites"
    _drafts[did] = {"at": now, "scope": scope, "changes": changes}
    kind = Counter("fill" if not r["before"] else
                   "tighten" if SCHEDULE_FREQ[r["after"][0]] < SCHEDULE_FREQ[r["before"][0]] else
                   "relax" for r in changes)
    return {
        "draft_id": did, "scope": scope, "status": "DRAFT - nothing saved; needs approval",
        **({"note": note} if note else {}),
        "assets_reviewed": len(assets), "assets_changed": len(changes),
        "tightened": kind["tighten"], "relaxed": kind["relax"],
        "assets_given_a_first_plan": kind["fill"],
        "pm_visits_per_year_before": visits(plan_before),
        "pm_visits_per_year_after": visits(plan_after),
        "by_class": sorted(cls_stats, key=lambda r: -r["changed"])[:12],
        "changes": [{k: v for k, v in r.items() if k != "asset_id"} for r in changes[:ROW_CAP]],
        "truncated": len(changes) > ROW_CAP,
    }


S, I, B = {"type": "string"}, {"type": "integer"}, {"type": "boolean"}
_site = {"type": "string", "description": "site / line name, partial match, e.g. 'Eastern Grid'"}
_cls = {"type": "string", "description": "asset class, partial match, e.g. 'transformer', 'isolator'"}

TOOLS = {
    "list_sites": (t_list_sites, "List every site (line, substation, plant) with its asset count.", {}, []),
    "search_assets": (t_search_assets, "Find assets by site, class, code/name/make text, criticality "
                      "(A vital, B important, C tolerable) or past their design life. Returns a total, "
                      "a per-class count and up to 25 rows.",
                      {"site": _site, "asset_class": _cls, "text": S,
                       "criticality": {"type": "string", "enum": ["A", "B", "C"]},
                       "past_design_life": B}, []),
    "overdue_pm": (t_overdue_pm, "Assets whose preventive maintenance is overdue, worst first "
                   "(vital assets and longest overdue first), with counts by site and class.",
                   {"site": _site, "asset_class": _cls}, []),
    "failure_summary": (t_failure_summary, "Breakdowns in the last N days (default 365): count, restored, still "
                        "open, downtime, MTTR, ranked by site / class / fault type, per month, "
                        "repeat offenders (assets that failed more than once) and open failures.",
                        {"site": _site, "asset_class": _cls,
                         "days": {"type": "integer", "description": "look-back window, default 365"}}, []),
    "asset_history": (t_asset_history, "One asset's details and its recent logbook entries, by asset code.",
                      {"code": {"type": "string", "description": "asset code as printed on the QR tag"},
                       "site": _site}, ["code"]),
    "draft_pm_plan": (t_draft_pm_plan, "DRAFT a preventive-maintenance plan (which cycles each asset "
                      "needs) for a site and/or asset class, from failure history, criticality and design "
                      "life. Proposes changes with a reason each; saves NOTHING - a supervisor approves "
                      "the draft on screen. Use when asked to make, generate or improve a maintenance "
                      "schedule or plan.",
                      {"site": _site, "asset_class": _cls}, []),
}

SYSTEM = (
    "You are AMPS Assistant, inside AMPS, an asset maintenance system. Answer the maintenance "
    "team's question using ONLY data returned by the tools — never invent assets, numbers or dates. "
    "Unless the user names a time period, leave optional tool arguments out. "
    "Lists in tool results are already ranked highest first. "
    "Call tools as needed (several if useful), then answer briefly: lead with the direct answer, then at "
    "most 6 short bullet lines. Quote asset codes exactly so they can be looked up. If the tools return "
    "nothing relevant, say so plainly. Reply in the language the question was asked in "
    "(English, Hindi or Bengali). "
    "When you draft a maintenance plan, summarise it (assets changed, tightened / relaxed, PM visits "
    "per year before and after, the main reasons) and say it is a draft awaiting approval below. "
    "Today is {today}."
)


def _run_tool(name, args, db, user):
    fn = TOOLS.get(name, (None,))[0]
    if not fn:
        return {"error": f"unknown tool {name}"}
    allowed = TOOLS[name][2]
    # small models pass "*" / "all" to mean "no filter" — treat those as absent
    clean = {k: v for k, v in (args or {}).items() if k in allowed and not
             (v is None or (isinstance(v, str) and v.strip().lower() in ("", "*", "all", "any", "none")))}
    try:
        return fn(db, user, **clean)
    except Exception as e:  # a bad argument must not 500 the whole answer
        return {"error": f"{type(e).__name__}: {e}"}


def _post(url, body, headers, retries=2):
    """POST JSON. A 503/429 (model overloaded / rate-limited, routine on the
    shared Gemini tier at peak) is retried twice with a short backoff before it
    surfaces — one busy second shouldn't fail a technician's click."""
    data = json.dumps(body).encode()
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data,
                                     headers={"Content-Type": "application/json", **headers})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503) or attempt == retries:
                raise
            time.sleep(1.5 * (attempt + 1))


def thinking_off(model: str | None = None) -> dict:
    """thinkingConfig for the cheapest/fastest reasoning. Gemini 3.x rejects
    thinkingBudget=0 (400 INVALID_ARGUMENT) and takes thinkingLevel instead;
    2.5 keeps the budget form."""
    m = (model or GEMINI_MODEL).split("/")[-1]
    if re.match(r"gemini-[3-9]", m):
        return {"thinkingLevel": "minimal"}
    return {"thinkingBudget": 0}


def gemini_target(model: str, method: str = "generateContent") -> tuple[str, dict]:
    """(url, auth headers) for one Gemini call on the configured transport. The
    request body is the same on both: Vertex AI takes the Gemini API's JSON."""
    if PROVIDER == "vertex":
        return vertex.model_url(model, method), vertex.headers()
    return (f"https://generativelanguage.googleapis.com/v1beta/models/{model}:{method}",
            {"x-goog-api-key": GEMINI_KEY})


def gemini_generate(body: dict, model: str | None = None) -> dict:
    url, headers = gemini_target(model or GEMINI_MODEL)
    return _post(url, body, headers)


# ---- provider loops ---------------------------------------------------------

def _gemini(question, history, db, user, trace):
    decls = [{"name": n, "description": d,
              **({"parameters": {"type": "object", "properties": p, "required": r}} if p else {})}
             for n, (_, d, p, r) in TOOLS.items()]
    contents = [{"role": "model" if h.role == "assistant" else "user", "parts": [{"text": h.text}]}
                for h in history[-6:]]
    contents.append({"role": "user", "parts": [{"text": question}]})
    for _ in range(MAX_STEPS):
        resp = gemini_generate({
            "systemInstruction": {"parts": [{"text": SYSTEM.format(today=date.today())}]},
            "contents": contents,
            "tools": [{"functionDeclarations": decls}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1024},
        })
        parts = (resp.get("candidates") or [{}])[0].get("content", {}).get("parts") or []
        calls = [p["functionCall"] for p in parts if "functionCall" in p]
        if not calls:
            return "".join(p.get("text", "") for p in parts).strip()
        contents.append({"role": "model", "parts": parts})
        results = []
        for c in calls:
            trace.append({"tool": c["name"], "args": c.get("args") or {}})
            out = _run_tool(c["name"], c.get("args"), db, user)
            if isinstance(out, dict) and out.get("draft_id"):
                trace[-1]["draft"] = out["draft_id"]
            results.append({"functionResponse": {"name": c["name"], "response": {"result": out}}})
        contents.append({"role": "user", "parts": results})
    return ""


def _openai(base, model, question, history, db, user, trace):
    tools = [{"type": "function", "function": {
        "name": n, "description": d,
        "parameters": {"type": "object", "properties": p, "required": r}}}
        for n, (_, d, p, r) in TOOLS.items()]
    msgs = [{"role": "system", "content": SYSTEM.format(today=date.today())}]
    msgs += [{"role": h.role, "content": h.text} for h in history[-6:]]
    msgs.append({"role": "user", "content": question})
    headers = {}
    if os.environ.get("AMPS_AI_API_KEY"):
        headers["Authorization"] = f"Bearer {os.environ['AMPS_AI_API_KEY']}"
    for _ in range(MAX_STEPS):
        resp = _post(f"{base}/chat/completions",
                     {"model": model, "messages": msgs, "tools": tools, "temperature": 0.2}, headers)
        m = resp["choices"][0]["message"]
        calls = m.get("tool_calls") or []
        if not calls:
            return (m.get("content") or "").strip()
        msgs.append({"role": "assistant", "content": m.get("content") or "", "tool_calls": calls})
        for c in calls:
            name = c["function"]["name"]
            raw = c["function"].get("arguments") or "{}"
            args = json.loads(raw) if isinstance(raw, str) else raw
            trace.append({"tool": name, "args": args})
            out = _run_tool(name, args, db, user)
            if isinstance(out, dict) and out.get("draft_id"):
                trace[-1]["draft"] = out["draft_id"]
            msgs.append({"role": "tool", "tool_call_id": c.get("id", name), "name": name,
                         "content": json.dumps(out, default=str)})
    return ""


# ---- endpoints --------------------------------------------------------------

class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    text: str = Field(max_length=2000)


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    history: list[Turn] = []


class AskOut(BaseModel):
    answer: str
    tools: list[dict]   # each lookup the model made: {tool, args} — shown under the answer
    model: str
    plan: dict | None = None   # a maintenance-plan draft awaiting approval, if one was made


@router.get("/status")
def status():
    model = _model()
    return {"enabled": _enabled(), "provider": PROVIDER or None, "model": model if _enabled() else None}


@router.post("/ask", response_model=AskOut)
def ask(body: AskIn, request: Request, db: Session = Depends(get_db), user=Depends(optional_user)):
    if not _enabled():
        raise HTTPException(503, "AI assistant is not configured on this deployment.")
    ip = (request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for", "")
          .split(",")[0].strip() or (request.client.host if request.client else "?"))
    _throttle(ip)
    trace: list[dict] = []
    model = _model()
    try:
        if gemini_on():
            answer = _gemini(body.question, body.history, db, user, trace)
        else:
            answer = _openai(BASE_URL, MODEL, body.question, body.history, db, user, trace)
    except (urllib.error.URLError, TimeoutError, KeyError, ValueError) as e:
        if not (FALLBACK_URL and FALLBACK_MODEL):
            code = getattr(e, "code", None)
            raise HTTPException(429 if code == 429 else 502,
                                "The AI service is busy — please try again shortly.")
        trace.clear()
        model = FALLBACK_MODEL
        try:
            answer = _openai(FALLBACK_URL, FALLBACK_MODEL, body.question, body.history, db, user, trace)
        except Exception:
            raise HTTPException(502, "The AI service is busy — please try again shortly.")
    if not answer:
        answer = "I couldn't put an answer together from the records — try asking more specifically."
    plan = None
    did = next((t["draft"] for t in reversed(trace) if t.get("draft")), None)
    if did:
        d = _drafts.get(did)
        if d:
            plan = {"id": did, "scope": d["scope"], "count": len(d["changes"]),
                    "changes": [{k: v for k, v in r.items() if k != "asset_id"}
                                for r in d["changes"][:60]]}
    return AskOut(answer=answer, tools=trace, model=model, plan=plan)


@router.post("/plan/{draft_id}/apply")
def apply_plan(draft_id: str, db: Session = Depends(get_db), user=Depends(current_writer)):
    """Save an approved draft. Each asset is re-checked: outside the approver's
    line, or its plan changed since the draft was made, and it is skipped."""
    d = _drafts.get(draft_id)
    if not d or time.time() - d["at"] > DRAFT_TTL:
        raise HTTPException(404, "This draft has expired — ask for a fresh one.")
    scope = scope_location_ids(db, user)
    applied, skipped = 0, 0
    for r in d["changes"]:
        a = db.get(Asset, r["asset_id"])
        if not a or (scope is not None and a.location_id not in scope):
            skipped += 1
            continue
        rows = db.scalars(select(PMPlan).where(PMPlan.asset_id == a.id)).all()
        now = {p.frequency for p in rows}
        if now and now != set(r["before"]):
            skipped += 1
            continue
        after = set(r["after"])
        for p in rows:
            if p.frequency not in after:
                db.delete(p)
        for f in after - now:
            db.add(PMPlan(asset_id=a.id, frequency=f))
        audit(db, "asset", a.id, "pm_plan",
              detail=f"AI draft {draft_id} approved: {', '.join(r['before']) or 'none'} -> "
                     f"{', '.join(r['after'])} ({r['reason']})", actor=user.username)
        applied += 1
    db.commit()
    _drafts.pop(draft_id, None)
    return {"applied": applied, "skipped": skipped}
