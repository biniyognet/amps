# ⚡ AMPS — Asset Maintenance & Preventive Scheduling

[![CI](https://github.com/arupbiswas1994-byte/amps/actions/workflows/ci.yml/badge.svg)](https://github.com/arupbiswas1994-byte/amps/actions/workflows/ci.yml)

**An open-source maintenance management suite for electrical and industrial assets** — asset registers, QR-based identification, preventive-maintenance scheduling and work-order tracking, built for multi-site, multi-user field environments.

> Born from years of hands-on electrical maintenance practice — EOT crane maintenance in heavy industry, and traction-power / power-supply asset management in rail systems — AMPS encodes the record-keeping and planning discipline that field maintenance actually needs, and that spreadsheets cannot deliver at organizational scale.

**Author:** Arup Biswas · Electrical Engineer (industrial & rail maintenance) · License: [MIT](LICENSE)

---

## Why AMPS exists

Maintenance departments everywhere run on scattered spreadsheets: one file per site, no single source of truth, no concurrency, no audit trail, no reliable roll-up reporting. Every transfer of personnel breaks the system; every audit is a scramble.

AMPS replaces that with a **single centralized system**:

| Problem with spreadsheets | AMPS answer |
|---|---|
| One file per site/line, endless reconciliation | One database, hierarchical locations (Site → Section → Station → Bay) |
| No idea which asset is which in the field | **QR tag on every asset** — scan to open its record & history |
| Maintenance schedules tracked by memory | **Preventive-maintenance engine** — due/overdue tracking, escalation |
| Anyone can silently edit anything | Role-based access + full audit trail |
| No management visibility | Dashboards: compliance %, overdue items, per-site roll-ups |

## Feature roadmap

- [x] Domain model: locations, asset classes, assets, PM schedules, work orders, roster patterns *(v0.2)*
- [x] REST API skeleton (FastAPI) with QR-code generation per asset
- [x] Database layer — PostgreSQL, with SQLite fallback so the demo runs out of the box *(v0.2)*
- [x] Preventive-maintenance due-date engine: due/overdue list, complete-and-roll-forward *(v0.2; calendar view pending)*
- [x] **Audit trail** — append-only log of every mutation, written in the same transaction *(v0.2.1)*
- [x] **PM completion → work order**: every completed task becomes a history record (who, what, findings); `GET /api/assets/{code}/history` = the asset's history card *(v0.2.1)*
- [x] **A/B/C criticality + priority-ranked due list** — triage by criticality × overdue, not date alone *(v0.2.1; full hierarchy tree pending)*
- [x] Unit-tested pure engines + CI (GitHub Actions) *(v0.2.1)*
- [x] **Digital shift logbook** — append-only entries (operation / observation / defect / handover), correction-by-new-entry discipline, per-asset log history *(v0.3)*
- [x] Duty-roster ↔ maintenance linkage: weekly shift patterns, live coverage analysis (uncovered-slot detection, maintenance-window staffing), and shift work packages — due PMs bundled per window with the rostered crew *(v0.2)*
- [ ] Work-order lifecycle (open → assigned → done → verified)
- [ ] React front-end: asset browser, scan-to-view, PM dashboard
- [ ] Role-based auth (admin / supervisor / technician / viewer)
- [ ] Reports: compliance, downtime, asset history export
- [ ] Mobile-friendly field mode (scan, update, photo attach)
- [ ] Asset hierarchy & criticality: site → system → equipment tree with A/B/C criticality classes, so PM effort concentrates where failure hurts most
- [ ] Failure-code taxonomy: every breakdown classified once against a standard code set — analysable forever (root-cause trends, repeat-failure detection)
- [ ] Reliability analytics: MTBF / MTTR per asset class, availability % with planned-vs-unplanned outage separation
- [ ] Statutory / mandatory-test compliance alarms: overdue inspections (e.g. protection relays, earthing, batteries) flagged automatically — zero-miss, audit-ready register
- [ ] Maintenance-window work packages: due PMs auto-bundled per available window (night blocks, shutdowns), printable as a shift-ready package
- [ ] High-availability deployment profile: multi-node cluster (N hot + cold standby) with automated backups and restore drills
- [ ] AI maintenance assistant (LangChain): natural-language queries over the asset base — "which assets are overdue?", "what did we find last time on TRF-0001?"

## Architecture

```
 ┌────────────┐     REST/JSON      ┌──────────────┐      SQL       ┌────────────┐
 │  React UI  │  ◄──────────────►  │ FastAPI      │ ◄────────────► │ PostgreSQL │
 │  (Vite)    │                    │ Python 3.11+ │                │            │
 └────────────┘                    └──────────────┘                └────────────┘
       ▲                                  │
       │  QR scan (any phone camera)      │ qrcode generation per asset
       └──────────────────────────────────┘
```

- **Backend:** Python / FastAPI / SQLAlchemy / Alembic
- **Database:** PostgreSQL
- **Frontend:** React (Vite)
- **Deployment:** Docker Compose (single server + static IP is enough for a whole organization)

## Data model (v0.1)

```
Location (self-referencing tree: Site → Section → Station → Bay)
  └── Asset (code, class, make/model, commissioning date, status, QR)
        ├── PMSchedule (task, frequency, last_done, next_due)
        └── WorkOrder (type, status, assigned_to, findings, closed_at)
AssetClass (e.g. Transformer, HT Panel, LT Panel, PLC, Motor, Crane Hoist)
User (role: admin / supervisor / technician / viewer)
```

All sample data in this repository is **synthetic** — generic industrial asset examples for demonstration only.

## Quickstart (development)

**Zero-config demo (SQLite — no database server needed):**
```bash
cd backend && pip install -r requirements.txt
python seed.py                   # creates amps.db + synthetic demo data
uvicorn app.main:app --reload    # API on :8000, docs at /docs
```

**Full stack (PostgreSQL + UI):**
```bash
docker compose up -d db          # PostgreSQL
export DATABASE_URL=postgresql+psycopg2://amps:amps@localhost/amps
cd backend && python seed.py && uvicorn app.main:app --reload
cd ../frontend && npm install && npm run dev   # UI on :5173
```

**Try the roster ↔ maintenance features** (after seeding, on `/docs`):
- `GET /api/maintenance/due` — live due/overdue PM list (demo data includes overdue items)
- `POST /api/maintenance/complete/{id}` — done today, due date rolls forward
- `POST /api/roster/coverage` — analyse any weekly pattern: per-day headcounts, **uncovered shift-slots**, maintenance-window staffing
- `GET /api/roster/work-package?for_date=...&shift=N` — due PMs bundled for a shift window with the rostered crew
- `POST /api/logbook` / `GET /api/logbook?log_date=...` — the digital shift logbook; `?asset_code=` shows everything ever logged against one asset

## Philosophy

1. **The register is the truth.** If it isn't in the system, it didn't happen.
2. **Field-first.** A technician with a phone and a QR sticker is the primary user, not the office PC.
3. **Boring technology, dependable records.** Postgres + Python + React — maintainable for a decade.
4. **Generic core, configured instances.** AMPS ships with no organization-specific data; every deployment is a configuration, not a fork.

## Contributors & hosting

AMPS is authored and maintained by **Arup Biswas**. The **binidev team** (an open-source contributor group) contributes to the project and operates the public demo hosting (k3s). Design contributions: Nilanjan (binidev). Contributions via fork + pull request are welcome — all sample deployments must use synthetic data only.

## License

MIT © 2026 Arup Biswas — see [LICENSE](LICENSE). Attribution required on all copies.
