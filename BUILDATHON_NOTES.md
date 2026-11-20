# AMPS × Startup Buildathon India 2026 — Notes & Checklist

> Kolkata · 20–21 Nov 2026 · submission closes **21 Nov, 09:00** · branch `buildathon`
> Goal: integrate Google AI + data features into AMPS and make it as powerful as we can.
> Audited 20 Nov (freya) against `buildathon` 5b40544 and every pushed lane branch. Laptop: JARVIS rebuilt :8081 at 512e0b1, 20 Nov 12:00 (data kept, no `down -v`): app 200, `/api/risk` 200.

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
- [x] Run the demo-look stack (same build + data as amps.binihost.com): `docker compose -f deploy/compose.yaml -f deploy/compose.demo.yaml up -d --build` → http://localhost:8081 (admin / admin). One stack only, project `amps-buildathon` (set in compose.demo.yaml), checked on the laptop 20 Nov 09:35: `docker compose ls` shows only `amps-buildathon` (3 containers, volumes `amps-buildathon_pgdata`/`_media`); no `amps-demo` containers or volumes left. Re-run the same command after a pull; never `down -v` (it wipes the demo data BigQuery needs).
- [x] Laptop DB: **keep and grow it, never wipe** (BigQuery wants volume). Add the 85fd3d5 AI demo stories on top: `docker exec amps-buildathon-backend-1 python seed_network.py --stories` (additive, re-run safe). JARVIS runs laptop steps itself over Tailscale ssh (`arupb@100.77.190.74`, PowerShell by full path); seats ask JARVIS, not Arup. `down -v` is never on the path. Done 20 Nov (e658bd6): 10 stories added, data kept
- [ ] Turn AI on for the laptop stack: put `AMPS_GEMINI_API_KEY=…` in `deploy/.env` (git-ignored), re-run the command. Until then `/api/ai/status` = off and Snap / Ask / auto-plan do not draw (compose.demo now passes provider `gemini` + model `gemini-3.5-flash-lite`)
- [x] Nilanjan synced — 20 Nov 09:15 email: `git clone -b buildathon https://github.com/biniyognet/amps.git amps-buildathon`, pull loop every 2 min, same compose command, push to his own branch `nilanjan` (never `buildathon`)
- [x] Laptop pulls `buildathon` every 2 min (scheduled task `amps-sync`)
- [ ] Codelab 2 (**do this one**, ~30 min = F4): https://codelabs.developers.google.com/data-agents-in-agy-and-bq
- [ ] Codelab 1 (optional skim, F5 covers it): https://codelabs.developers.google.com/getting-started-with-antigravity-skills

### Build (order: F4 → F1 → F2 → F6; each ships with its screen)
- [x] F3 AMPS MCP server — 6 read-only tools over MCP — done 20 Nov (`backend/app/mcp_server.py`; local stdio + https://amps-api.binihost.com/mcp, pod `amps-mcp`; Cloud Run next)
- [x] F5 AMPS Agent Skill — `.agents/skills/amps-guardrails/SKILL.md` — done 20 Nov
- [x] AI demo stories seeded — 85fd3d5 `backend/seed_network.py` `STORIES`: 10 failures on 5 assets (Pump Motor 1 repeat seal leak past codal life, HSCB Panel 1 trips, PTR 1 oil-temp trend, বাংলা + हिन्दी + shorthand remarks); 178 failures on a fresh DB
- [x] **AI hub** `#/ai` + ✦ AI nav link — 8 cards: **6 live** (Snap & Report, Ask AMPS, AI PM plan, MCP server, Similar past failures, Risk badge), **2 coming** (Fault fields, Estate agent; both wait for billing). Lane detail in §7
- [~] F4 Estate analytics agent — data ✅ in BigQuery `amps_demo`, reloaded from the laptop DB with the stories (assets 1,874 · log_entries 14,416 · `asset_risk` view 1,874; sandbox, tables expire in 59 days) · agent config + 6 verified questions ✅ in `bigquery/agent/` · creating the agent (Codelab 2 steps 6–11) is **HELD until billing is on** · pitch fallback ✅ `bigquery/agent/pitch.sh`
- [x] F1 Similar past failures — `gemini-embedding-001` on remarks + logbook, in the app's own Postgres; keyword match until the Gemini key is set · UI: "Similar past failures" panel on the failure card · AlloyDB pgvector = the scale-up path (step 9)
- [ ] F2 Structured fault fields — AI.EXTRACT on free-text remarks · UI: component / symptom / cause / action chips
- [x] F6 Failure-risk score per asset · UI: red/amber/green badge on the asset list (merged; live after the laptop rebuild)

### Submit
- [ ] Demo runs end to end (with a pre-loaded backup table, in case the venue Wi-Fi is slow)
- [ ] Pitch deck + demo video/link
- [ ] Submit on Hack2skill before 21 Nov 09:00

## 1b. Evaluation parameters & weightage (Hack2skill AI Evaluation slide, 20 Nov 11:06)
| Parameter | Weight | What AMPS shows for it |
|---|---|---|
| Functional Product & Implementation | 30% | Live app end to end: Snap & Report, Ask AMPS, log book, job cards, printables |
| Technical Architecture & Engineering Quality | 20% | FastAPI + Postgres + React, tests, three hosting paths (§8) |
| Google AI Integration & Implementation Depth | 20% | Gemini multimodal + function calling + JSON schema, BigQuery data agent, AlloyDB, Cloud Run |
| Problem-Solution Alignment | 15% | Floor technician: QR → photo → draft → failure report / job card |
| UX, Usability & Accessibility | 10% | Phone-first one column, 500px floor, voice remarks |
| Innovation & Differentiation | 5% | AI drafts, human confirms; asset history in the prompt |
| **Total** | **100%** | |

The slide also asks for a **problem statement** (the challenge we solve) and **rubric criteria** (what earns a high or low score).
Priority for the build: working product first (30%), then Google AI depth and architecture (20% each).

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
- Production (amps.binihost.com) stays as it is. Nothing moves off binihost.
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
| AI calls | Gemini over REST `generateContent` (Ask AMPS, Snap & Report, Auto-plan); `gemini-3.5-flash-lite` on the buildathon stack, amps.binihost.com still pins `gemini-2.5-flash` in its k8s manifest | + embeddings, **AI.EXTRACT** on remarks, risk scoring | Extends the same Gemini key |
| Agent access | Ask AMPS = 6 read-only tools inside the app | **F3 MCP server** exposes the same 6 tools to any agent (Antigravity, Claude, Gemini CLI) | Wrapper, no logic change |
| Guardrails | Code-level (read-only tools, human submits) | **F5 SKILL.md**: rules an agent must follow on AMPS data | New doc file |
| Analytics | Dashboard counts/charts | **F4** logbook/failures → BigQuery + Conversational Analytics (ask in English) | New export job + Google console |
| Hosting | binihost k3s + Ensign | Same, plus Google and local Postgres kept ready as alternate production hosts (§8) | Additional hosts, kept ready |
| Data | Live data stays on the production box | Demo runs on the **Demo Industries** demo dataset | No change |

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
| Gemini | Google's LLM family (`gemini-3.5-flash-lite` = our default: fastest, 0.85 s in the audit) | Already powers Ask AMPS / Snap |
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

## 5. Decisions log
| Time | Decision | Why |
|---|---|---|
| 20 Nov | No `agy` / Gemini CLI; Antigravity IDE on the laptop, the main build runs on the server cluster and pushes to `buildathon` | One sync point (GitHub); the IDE is for fine tuning and the demo |
| 20 Nov | MCP hosted at `amps-api.binihost.com/mcp` (`AMPS_MCP_HTTP=1`, optional `AMPS_MCP_TOKEN`) + local stdio `python -m app.mcp_server` | Judges can connect; stdio is the offline backup |
| 20 Nov | MCP SDK 2.x (`mcp>=2.3,<3`), imported only when `AMPS_MCP_HTTP=1` | Core API runs without the new dependency |
| 20 Nov | Google-first: wire every referenced product (Gemini, BigQuery, AlloyDB/pgvector, Cloud Run, DAK) in the time limit; binihost stays the parallel/backup host | Buildathon = Google ecosystem; learn by comparison |
| 20 Nov | Gemini key = Arup's own AI Studio account, project linked to the GDP Event Credit billing; audit with `scripts/gemini_audit.py` | Free-tier keys hit 429 in a live demo |
| 20 Nov | One laptop stack, compose project `amps-buildathon` on :8081 (was `amps-demo`, which made a second stack) | One set of volumes; the same command always reuses it |
| 20 Nov | Buildathon model = `gemini-3.5-flash-lite`, set by compose.demo (`AMPS_GEMINI_MODEL`); key only in git-ignored `deploy/.env` | 2.5 models are closed to new keys; key never in git |
| 20 Nov | AI hub `#/ai`: one page, 8 cards, each opens a seeded example in 1–2 clicks and names its Google product | Judges find every AI feature without a tour |
| 20 Nov | F4 agent creation HELD: the event billing account auto-closed (credit expired); nothing is created in GCP until Arup says billing is on. Fallback = `bigquery/agent/pitch.sh` (Q1/Q3/Q4 from the same verified SQL, sandbox, read only) | The pitch still shows the three answers without the agent |
| 20 Nov (Arup) | Keep **three hosting paths ready** as alternate economic production hosting: local Postgres, Google (AlloyDB / BigQuery / Cloud SQL), binihost. See §8 | No lock-in; pick the cheapest host that works per client |
| 20 Nov (Arup) | This file is **the tracker**: every buildathon change updates it in the same branch | One place to see the state |

## 6. Open items (20 Nov evening)
| Item | Owner | Next |
|---|---|---|
| Laptop AI stories | JARVIS | ✅ done e658bd6: `seed_network.py --stories` added 10 stories, data kept (no `down -v`, ever) |
| Gemini key in laptop `deploy/.env` | Arup (the key) · JARVIS (re-run compose) | not there yet; then `/api/ai/status` = enabled |
| BigQuery `amps_demo` reload | JARVIS | ✅ reloaded from the laptop DB: assets 1,874 · log_entries 14,416 · asset_risk view 1,874. Project is a BigQuery **sandbox**, so tables expire after 59 days |
| BigQuery F2 `failure_fields` (AI.GENERATE) + data agent (Codelab 2 steps 6–11) | Arup | needs billing on the project · the event billing account auto-closed (credit expired), Arup is sorting it with the mentors · meanwhile the pitch uses `bigquery/agent/pitch.sh` (JARVIS runs it on the laptop) |
| Hosting paths ready (§8) | crew | local PG ✅ · binihost ✅ · BigQuery ✅ data (sandbox) · AlloyDB = step 9 (reviewed, one fix before merge) · Cloud SQL = not started · Cloud Run = step 10 |
| AI hub steps 2–6 | crew | see §7 |
| Backend default model in `backend/app/api/ai.py` and the k8s manifest still say `gemini-2.5-flash` | build | change with the next amps-api roll (not part of the buildathon frontend work) |
| Pitch deck + demo video, Hack2skill submit | Arup + Nilanjan | before 21 Nov 09:00 |

## 7. Crew lanes (20 Nov 09:30 — freya leads, merges into `buildathon`)

Each seat pushes `<seat>/<topic>` to biniyognet/amps; freya reviews, merges, wires the hub card, ticks here. JARVIS rebuilds the laptop (:8081) after each merge.

| Step | Seat | Branch | Hub card | State |
|------|------|--------|----------|-------|
| 1 AI hub `#/ai` + ✦ AI nav | freya | (on buildathon, 119c576) | all 8 | ✅ merged · on :8081 |
| 2 Ask chips + Snap strip | builder-1 | `builder-1/ask-chips-snap-history` | Ask, Snap | ✅ merged b73057e · on :8081 |
| 3 F6 risk badge | builder-2 | `b2/f6-risk-badge` (`/api/risk` + register dot, filter, sort) | Risk badge | ✅ merged 63ad28a · on :8081 at 3558798 · card **live** (opens the register on red + amber, riskiest first) |
| 4 BigQuery reload + F2 failure_fields + F6 asset_risk | floki | `floki/bq-f2-f6`, `floki/bq-ignore`, `floki/bq-sandbox` (59-day expiry) | Fault fields, Risk badge (data) | ✅ merged · data reloaded + asset_risk built; `failure_fields` needs billing (Arup) · Fault fields stays coming |
| 5 F1 similar failures | master-builder | `master-builder/f1-similar` | Similar past failures | ✅ merged 3e61abc · on :8081 · card **live** (opens Pump Motor 1); keyword match until the Gemini key is set |
| 6 F4 data agent | builder-1 | `builder-1/f4-data-agent` | Estate agent | ✅ merged 94263a8 · paste-ready config + 6 verified questions in `bigquery/agent/` (`load.sh --agent` reads them back) · JARVIS creates the agent in the BigQuery console on the laptop · card flips once the agent answers; pitch Q1 red risk + why, Q3 failures by site and month, Q4 open failures by station · fallback ✅ bbb3bb3: `bigquery/agent/pitch.sh` runs Q1/Q3/Q4 in the sandbox → `pitch_out/pitch.html` (3 screenshot cards, SQL under each; git-ignored) while the agent is held |
| 7 Pilot data import script (prep only, no run) | builder-2 | builder-2's import branch | — | 🟡 pushed a87bd79: import script with `--target-db/--create-db`, its test, demo DB backup/restore pair · **not merged**: the branch and file names still carry the source name, so they must be renamed first (Arup rule 11-20) |
| 8 Gemini in BigQuery + Vertex, ready for billing | master-builder | `master-builder/vertex-bq` | Fault fields | ✅ merged 0551552 · billing day = `bigquery/gemini_go.sh --dry`, then `bigquery/gemini_go.sh` (refuses while billing is off); app: `AMPS_AI_PROVIDER=vertex` + `AMPS_VERTEX_PROJECT` in `deploy/.env`, add `-f deploy/compose.vertex.yaml` · not yet run against GCP · Fault fields flips after `failure_fields` runs |
| 9 AlloyDB | minion | `minion/gcp-host` | Similar (scale-up path) | 🟡 612c2ec reviewed 20 Nov (freya): `deploy/gcp/` = AlloyDB migrate script + pgvector SQL + local test, `gcp.sh`, Cloud Run frontend image, README. Local rehearsal green (178 embeddings, SQL = Python top-5, re-run refused, sync trigger ok). **One fix before merge:** `gcp.sh` L29 sets a line name; drop it so the app default applies · billing-gated, nothing run against GCP |
| 10 Cloud Run (billing-gated) | ragnar | `ragnar/<topic>` | MCP (URL) | ⏳ no branch yet · minion's `gcp-host` already has Cloud Run pieces, so check for overlap before building |
| 11 Demo wording sweep (Demo Industries demo dataset) | builder-1, master-builder | `builder-1/demo-wording`, `master-builder/demo-wording` | — | ✅ merged 2e87e43 (frontend + docs, `operator-logo.svg`) · 205f3ae `deploy/compose.local.yaml` out of git + ignored (a pull deletes the local copy, so back it up first) · 8c5b273 backend prose; checksheet titles headed by `AMPS_ORG`, new seeds only · branch names, README bio, seed line name wait for Arup |

Merge rule: build passes in Docker, no secrets in the diff, frontend-only lanes never touch amps.binihost.com / amps-api. A "coming" card flips to live only after its branch is merged AND it works on :8081.

## 8. Hosting — three paths kept ready (Arup, 20 Nov)

AMPS must be able to run in production on any of these, so each client can get the cheapest host that works. All three use the same code; the database is picked by `DATABASE_URL` (`backend/app/db.py`).

| Path | What runs where | State | Next |
|---|---|---|---|
| Local Postgres | `deploy/compose.yaml` (Postgres 16 + API + frontend) on the client's own box or the laptop | ✅ the laptop stack :8081 | — |
| binihost | k3s + Ensign (`deploy/k8s/`), amps.binihost.com · amps-api · amps-mcp | ✅ live (production) | no buildathon roll |
| Google | **Cloud SQL** (Postgres) or **AlloyDB** for the app DB, **BigQuery** for analytics, **Cloud Run** for the API/MCP | BigQuery ✅ `amps_demo` (sandbox, 59-day expiry) · AlloyDB = step 9 (`deploy/gcp/`, reviewed, one fix before merge) · Cloud Run = step 10 · Cloud SQL not started | all billing-gated: a `DATABASE_URL` to Cloud SQL/AlloyDB + Alembic, the same image on Cloud Run |

Rule: nothing is tied to one host. A feature that only works on one of them says so here.
