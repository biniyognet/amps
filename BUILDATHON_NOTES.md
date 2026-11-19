# AMPS × Startup Buildathon India 2026 — Notes & Checklist

> Kolkata · 20–21 Nov 2026 · submission closes **21 Nov, 09:00** · branch `buildathon`
> Goal: integrate Google AI + data features into AMPS and make it as powerful as we can.

## 1. Checklist

### Setup (MSI laptop)
- [x] Free disk space on C: (target ≥ 25 GB) — done 20 Nov, ~161 GB free
- [x] Claim Google Cloud credits → https://g.dev/credits/startup-buildathon-india-2026 — done 20 Nov, billing account "GDP Event Credit" (`01111C-2C89C3-9C75C9`) Active
- [x] Link project `gen-lang-client-0618042629` to "GDP Event Credit" — done 20 Nov, verified (moved off the personal ₹500 account)
- [x] Antigravity IDE: open **this** folder `C:\Arups_Wokspace\amps-buildathon` (not the parent — workspace skills load from its `.agents/skills`)
- [x] Extension **Google Cloud Data Agent Kit** — done 20 Nov; services: BigQuery, Conversational Analytics, AlloyDB, Cloud Storage; notebook execution off. Laptop only (the server builds with `bq`/`gcloud`)
- [x] gcloud CLI — done 20 Nov: SDK 594, signed in as arupbiswas1994 (user + ADC), project `gen-lang-client-0618042629`, 9 APIs enabled (BigQuery, BQ Storage, Cloud Run, Artifact Registry, Cloud Build, Storage, AlloyDB, Vertex AI, Gemini Data Analytics)
- [x] Gemini key — done 20 Nov, project above at Tier 1; audit: `gemini-3.5-flash-lite` 8/8 0.85 s (default), `gemini-3.5-flash` 0.7–1.8 s, `gemini-pro-latest` 3/3 3.4 s; 2.5 models closed to new keys
- [x] Start Docker Desktop (needed to run AMPS locally)
- [ ] Codelab 2 (**do this one**, ~30 min = F4): https://codelabs.developers.google.com/data-agents-in-agy-and-bq
- [ ] Codelab 1 (optional skim, F5 covers it): https://codelabs.developers.google.com/getting-started-with-antigravity-skills

### Build (order: F4 → F1 → F2 → F6; each ships with its screen)
- [x] F3 AMPS MCP server — 6 read-only tools over MCP — done 20 Nov (`backend/app/mcp_server.py`; local stdio + https://amps-api.binihost.com/mcp, pod `amps-mcp`; Cloud Run next)
- [x] F5 AMPS Agent Skill — `.agents/skills/amps-guardrails/SKILL.md` — done 20 Nov
- [ ] F4 Estate analytics agent — logbook/failures → BigQuery + Conversational Analytics · UI: "Estate insights" tab (question → chart)
- [ ] F1 Similar past failures — AlloyDB pgvector + `gemini-embedding-001` on remarks + logbook · UI: "Similar past failures" panel on the failure card
- [ ] F2 Structured fault fields — AI.EXTRACT on free-text remarks · UI: component / symptom / cause / action chips
- [ ] F6 Failure-risk score per asset · UI: red/amber/green badge on the asset list

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

### Q1. AMPS is already production-grade on binihost. What is `buildathon` for?
**It is not a rebuild or a migration.** `buildathon` is a branch of the same repo that adds a **Google AI + data layer on top of AMPS as it is now**.
- Production (amps.binihost.com, the Metro box) stays as it is. Nothing moves off binihost.
- Every new feature is **additive**: new endpoints, new tables or columns, new screens. If one breaks, the rest of AMPS still works.
- What the judges score is **how well Google tech is used** (Gemini, AlloyDB/pgvector, BigQuery, MCP, Agent Skills, Cloud Run), not how complete the CMMS is. We already have the complete CMMS, and that is our advantage.
- After the event, the features that prove useful are merged into the main AMPS line. The rest stays on the branch.

**Rule of thumb:** binihost = the product. buildathon = the product + a visible AI brain, demoed for one weekend.

### Side by side — AMPS now vs AMPS buildathon

| Layer | AMPS now (binihost) | AMPS buildathon (adds) | Kind of change |
|---|---|---|---|
| Frontend | React + Vite SPA, Ensign site 70 (amps.binihost.com) | New panels: "Similar past failures", risk badge on assets, analytics chat | Additive UI |
| API | FastAPI + SQLAlchemy 2 + Alembic, k3s `amps-demo` | New routes: `/ai/similar`, `/ai/extract`, `/ai/risk`, MCP server | Additive endpoints |
| Database | Postgres 16 (pod), nightly reset 03:00 | + `vector` extension and an embeddings column (in the same Postgres, or an **AlloyDB Express** copy for the demo) | Additive schema (Alembic migration) |
| AI calls | Gemini 2.5 Flash over REST `generateContent` (Ask AMPS, Snap & Report, Auto-plan) | + embeddings, **AI.EXTRACT** on remarks, risk scoring | Extends the same Gemini key |
| Agent access | Ask AMPS = 6 read-only tools inside the app | **F3 MCP server** exposes the same 6 tools to any agent (Antigravity, Claude, Gemini CLI) | Wrapper, no logic change |
| Guardrails | Code-level (read-only tools, human submits) | **F5 SKILL.md**: rules an agent must follow on AMPS data | New doc file |
| Analytics | Dashboard counts/charts | **F4** logbook/failures → BigQuery + Conversational Analytics (ask in English) | New export job + Google console |
| Hosting | binihost k3s + Ensign | Same. **Cloud Run** copy only if we want a "deployed on Google" line | Optional mirror |
| Data | Metro data stays on the Metro box | Demo uses **Demo Industries** seed data only, never Metro data | No change |

### What each feature needs (to choose what to build)
| F | Feature | Needs | Effort | Demo wow |
|---|---|---|---|---|
| F1 | Similar past failures | pgvector + Gemini embeddings | M | High |
| F2 | Fault fields from remarks | Gemini (AI.EXTRACT-style prompt) | S | Medium |
| F3 | AMPS MCP server | Python MCP SDK, the 6 existing tools | S | High (agent-native) |
| F4 | BigQuery analytics agent | BigQuery dataset + export | M–L | Medium |
| F5 | AMPS SKILL.md | One markdown file | XS | Low alone, strong with F3 |
| F6 | Failure-risk score | F1/F2 output + a simple formula | M | High on the dashboard |

## 4b. Keyword brief (one line each)
| Keyword | What it is | Where it fits in AMPS |
|---|---|---|
| Gemini | Google's LLM family (2.5 Flash is fast and cheap) | Already powers Ask AMPS / Snap |
| Embedding | Text turned into a list of numbers; similar meaning = nearby numbers | Turn each failure remark into a vector |
| pgvector (`vector`) | Postgres extension that stores vectors and finds nearest ones | F1 "find failures like this one" |
| ScaNN | Google's fast nearest-neighbour index (AlloyDB) | Speeds up F1 at scale; not needed for demo size |
| AlloyDB / Express | Google's managed Postgres; Express = free-tier, scales to zero | Optional demo DB showing Google data stack |
| `google_ml_integration` | AlloyDB extension: call Gemini from SQL | Lets SQL do embeddings / AI.EXTRACT |
| AI.EXTRACT / AI.IF | SQL functions: pull fields out of text / filter by English condition | F2 structured fault fields |
| BigQuery | Google's data warehouse for big analytics | F4 estate-wide analytics |
| Conversational Analytics | BigQuery agent: English question → SQL → chart | F4 "which station fails most in monsoon?" |
| MCP (Model Context Protocol) | Standard plug for agents to call tools/data | F3: any agent can query AMPS safely |
| Agent Skill (SKILL.md) | Markdown rules/know-how an agent loads only when relevant | F5 AMPS data guardrails |
| Data Agent Kit (DAK) | Google's pack of MCP servers + skills for its databases | Connects Antigravity to AlloyDB/BigQuery fast |
| Antigravity / `agy` | Google's agent-first IDE / its CLI | Where we build during the event |
| AI Studio | Web playground to try prompts and get a Gemini key | Prompt testing |
| Cloud Run | Run a container on Google, get a URL, scales to zero | Optional Google-hosted copy |
| Function calling | LLM picks one of our tools and fills its arguments | How Ask AMPS works today |
| RAG | Retrieve relevant records first, then let the LLM answer from them | F1 + Ask AMPS together |
| Progressive disclosure | Load detail only when needed (skills) | Keeps the agent prompt small |

| # | Question | Answer / pattern |
|---|---|---|
| 1 | Why buildathon if AMPS is production-grade? | Branch = AI layer on top, additive, demo on seed data; prod untouched (Q1) |
| 2 | | |

## 5. Decisions log
| Time | Decision | Why |
|---|---|---|
| 20 Nov | No `agy` / Gemini CLI; Antigravity IDE on the laptop, the main build runs on the server cluster and pushes to `buildathon` | One sync point (GitHub); the IDE is for fine tuning and the demo |
| 20 Nov | MCP hosted at `amps-api.binihost.com/mcp` (`AMPS_MCP_HTTP=1`, optional `AMPS_MCP_TOKEN`) + local stdio `python -m app.mcp_server` | Judges can connect; stdio is the offline backup |
| 20 Nov | MCP SDK 2.x (`mcp>=2.3,<3`), imported only when `AMPS_MCP_HTTP=1` | Core API runs without the new dependency |
| 20 Nov | Google-first: wire every referenced product (Gemini, BigQuery, AlloyDB/pgvector, Cloud Run, DAK) in the time limit; binihost stays the parallel/backup host | Buildathon = Google ecosystem; learn by comparison |
| 20 Nov | Gemini key = Arup's own AI Studio account, project linked to the GDP Event Credit billing; audit with `scripts/gemini_audit.py` | Free-tier keys hit 429 in a live demo |
