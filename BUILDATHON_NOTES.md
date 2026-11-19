# AMPS × Startup Buildathon India 2026 — Notes & Checklist

> Kolkata · 20–21 Nov 2026 · submission closes **21 Nov, 09:00** · branch `buildathon`
> Goal: integrate Google AI + data features into AMPS and make it as powerful as we can.

## 1. Checklist

### Setup (MSI laptop)
- [x] Free disk space on C: (target ≥ 25 GB) — done 20 Nov, ~161 GB free
- [ ] Claim Google Cloud credits → https://g.dev/credits/startup-buildathon-india-2026
- [ ] Antigravity IDE: open this folder (`C:\Arups_Wokspace\amps`)
- [ ] Install extension **Google Cloud Data Agent Kit** (Extensions → search) 
      CLI: `agy plugin install https://github.com/GoogleCloudPlatform/data-agent-kit-plugin`
- [ ] Install gcloud CLI + `gcloud auth login`
- [ ] Start Docker Desktop (needed to run AMPS locally)
- [ ] Codelab 1: https://codelabs.developers.google.com/getting-started-with-antigravity-skills
- [ ] Codelab 2: https://codelabs.developers.google.com/data-agents-in-agy-and-bq

### Build (pick after discussion)
- [ ] F1 Similar past failures — pgvector/ScaNN embeddings on failure remarks + logbook
- [ ] F2 Structured fault fields — AI.EXTRACT on free-text remarks (component, symptom, cause, action)
- [ ] F3 AMPS MCP server — expose Ask AMPS's 6 read-only tools over MCP
- [ ] F4 Estate analytics agent — logbook/failures → BigQuery + Conversational Analytics
- [ ] F5 AMPS Agent Skill — `.agents/skills/amps-db-guardrails/SKILL.md`
- [ ] F6 Failure-risk score per asset

### Submit
- [ ] Demo runs end to end (with a pre-loaded backup table, in case the venue Wi-Fi is slow)
- [ ] Pitch deck + demo video/link
- [ ] Submit on Hack2skill before 21 Nov 09:00

## 2. Session notes — Abirami Sukumaran (Cloud Databases & AI, Google)
Deck: https://goo.gle/data-ai-biz · "Data & AI for Businesses"

| Keyword | One line |
|---|---|
| Chat → Think & Reason → Execute | Three stages of AI: answer questions, compare data, act across systems |
| AI Studio / Antigravity IDE / `agy` CLI | Quick prototype / agent-first IDE / terminal version |
| Agent Skills (SKILL.md) | Open standard: reusable instructions that load only when needed (progressive disclosure) |
| Data Agent Kit (DAK) | MCP servers + Google skills for BigQuery, AlloyDB, Spanner, Cloud SQL, GCS, Bigtable, Spark |
| MCP | Standard way for an AI agent to call tools and databases |
| AlloyDB Express | PostgreSQL 18 in < 2 s; scales to zero after 15 min idle; 50 free compute units a month |
| pgvector + ScaNN | Meaning-based (vector) search inside Postgres |
| AI.EXTRACT() / AI.IF() | Gemini called from SQL: pull fields out of text / filter by a plain-English condition |
| `google_ml_integration`, `vector` | Postgres extensions that enable the above |
| BigQuery + Conversational Analytics | Warehouse for big data; a data agent turns English into SQL |
| Cloud Run | Deploy a container and get a public URL |
| Stitch MCP, Nano Banana | UI design / diagram generation inside Antigravity |

Her codelab flow: **Provision** (AlloyDB Express) → **Enrich in SQL** (embeddings + AI.EXTRACT) → **Build + Skills** (Antigravity + DAK + SKILL.md) → **Deploy** (Cloud Run).

## 3. What AMPS already has (baseline)
- **Ask AMPS** — Gemini function-calling over 6 read-only tools (sites, assets, overdue PM, failure summary, asset history, draft PM plan)
- **Snap & Report** — Gemini vision on a fault photo → draft fault/severity/cause/action; a human submits
- **Auto-plan** — PM plan drafts
- Stack: FastAPI + SQLAlchemy 2 + Alembic · Postgres or SQLite · React (Vite) frontend

## 4. Confusions to clear (mental model)
> Write the question, then the answer we agree on.

| # | Question | Answer / pattern |
|---|---|---|
| 1 | | |

## 5. Decisions log
| Time | Decision | Why |
|---|---|---|
| | | |
