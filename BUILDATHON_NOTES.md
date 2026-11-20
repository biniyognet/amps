# AMPS × Startup Buildathon India 2026 — Notes & Checklist

> Kolkata · 20–21 Nov 2026 · submission closes **21 Nov, 09:00** · branch `buildathon`
> Goal: integrate Google AI + data features into AMPS and make it as powerful as we can.
> Audited 20 Nov (freya) against `buildathon` 5b40544 and every pushed lane branch. Laptop: JARVIS rebuilt :8081 at 512e0b1, 20 Nov 12:00 (data kept, no `down -v`): app 200, `/api/risk` 200.
> Refreshed 21 Nov 00:45 (JARVIS): Cloud Run dropped everywhere, F1 = EmbeddingGemma on-prem, deck v12 + PDF re-export, submit checklist.

## 0. Where we are — 21 Nov 02:40 IST (submission closes 09:00)
| Item | Status | Next |
|---|---|---|
| Prototype amps-demo.binihost.com | ✅ live: app 200, `/api/risk` 200, 5/5 pods Running (api, worker, frontend, db, redis) | keep up until evaluation ends · no rolls after 08:00 |
| Google Slides submission deck | ✅ updated 01:06: EmbeddingGemma + Gemma 3 4B, prototype link, judge login · backup kept · ✅ **Team Name: AMPS** (02:35, same files.update path, PDF refreshed) | Arup reviewing now; his edits go straight onto the Google file · ⬜ **video link** after the PPT is final |
| Deck PDF | ✅ `deck/AMPS_pitch_deck.pdf` (claude.ai v12, 11 pages) · ✅ Drive "Idea Submission.pdf" refreshed from the Google deck | Arup picks which one to upload (the Google deck is the Hack2skill template) |
| AI features on the judges' stack | ✅ 6 live: Snap & Report, Ask AMPS, AI PM plan, MCP server, Similar failures (EmbeddingGemma), Risk badge · 2 "coming" (Fault fields, Estate agent) | none before submit |
| BigQuery | ✅ data loaded (sandbox) · ⚠️ BQML model eval degenerate · F2 + data agent wait on billing | after submit, only if billing comes back |
| Demo video (optional) | ⬜ not made | **NEXT after the PPT is final** (Arup 02:30): ≤3 min, public Drive/YouTube link, then fill the deck's video line |
| Google AI end-to-end (02:40, as Judge on amps-demo) | ✅ Ask AMPS EN 3.3 s + Bengali 2.0 s (Gemini 3.5 Flash-Lite function calling, no fallback) · Snap with photo 2.4 s (vision true: read the panel in the photo) · AI PM plan via Ask 3.1 s (draft, nothing saved) · Similar failures 0.4 s (EmbeddingGemma, top hit 0.78 same seal leak) · Risk 985 assets · MCP tools/list OK | ✅ 02:55 added to the Google deck as slide 7 "AI Test Report" (9/9 pass), on top of Nilanjan's 02:43 slide-1 note; companion PDF refreshed (9 pages). Re-run at 08:00 before close. Deck rule: one slide per upload (co-edited). 03:05 slide 1 team line: "2 co-founders — Arup Biswas (The Builder) & Nilanjan Chakraborty (The Dreamer)", replacing Nilanjan's tag note |
| Demo backup for venue Wi-Fi | ⬜ | laptop :8081 stack is the offline fallback |
| **Hack2skill submit** | ⬜ | **Arup on the dashboard before 09:00**: prototype link + deck/PDF (+ video if any) |
| After judging | GPU free → ragnar resumes user_docs embed · nomic delete last | — |


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
- [x] Turn AI on for the laptop stack: `AMPS_GEMINI_API_KEY=…` in `deploy/.env` (git-ignored), backend recreated — done 20 Nov 14:06 (Arup put the key, JARVIS recreated the backend). Key tested from inside the backend: AI Studio endpoint 200, model `gemini-3.5-flash-lite` (compose.demo passes provider `gemini`)
- [x] Nilanjan synced — 20 Nov 09:15 email: `git clone -b buildathon https://github.com/biniyognet/amps.git amps-buildathon`, pull loop every 2 min, same compose command, push to his own branch `nilanjan` (never `buildathon`)
- [x] Laptop pulls `buildathon` every 2 min (scheduled task `amps-sync`)
- [ ] Codelab 2 (**do this one**, ~30 min = F4): https://codelabs.developers.google.com/data-agents-in-agy-and-bq
- [ ] Codelab 1 (optional skim, F5 covers it): https://codelabs.developers.google.com/getting-started-with-antigravity-skills

### Build (order: F4 → F1 → F2 → F6; each ships with its screen)
- [x] F3 AMPS MCP server — 6 read-only tools over MCP — done 20 Nov (`backend/app/mcp_server.py`; local stdio + https://amps-api.binihost.com/mcp, pod `amps-mcp`; Cloud Run dropped 20 Nov, see §5)
- [x] F5 AMPS Agent Skill — `.agents/skills/amps-guardrails/SKILL.md` — done 20 Nov
- [x] AI demo stories seeded — 85fd3d5 `backend/seed_network.py` `STORIES`: 10 failures on 5 assets (Pump Motor 1 repeat seal leak past codal life, HSCB Panel 1 trips, PTR 1 oil-temp trend, বাংলা + हिन्दी + shorthand remarks); 178 failures on a fresh DB
- [x] **AI hub** `#/ai` + ✦ AI nav link — 8 cards: **6 live** (Snap & Report, Ask AMPS, AI PM plan, MCP server, Similar past failures, Risk badge), **2 coming** (Fault fields, Estate agent; both wait for billing). Lane detail in §7
- [~] F4 Estate analytics agent — data ✅ in BigQuery `amps_demo`, reloaded from the laptop DB with the stories (assets 1,874 · log_entries 14,416 · `asset_risk` view 1,874; sandbox, tables expire in 59 days) · agent config + 6 verified questions ✅ in `bigquery/agent/` · creating the agent (Codelab 2 steps 6–11) is **HELD until billing is on** · pitch fallback ✅ `bigquery/agent/pitch.sh`
- [x] F1 Similar past failures — **EmbeddingGemma on-prem** (Ollama on our k3s GPU, 768-dim) + pgvector in the app's own Postgres, live on the judges' stack; 17/18 vs nomic 8/18 (Bengali 5/5 vs 0/5) · UI: "Similar past failures" panel on the failure card · AlloyDB pgvector = the scale-up path (step 9)
- [ ] F2 Structured fault fields — AI.EXTRACT on free-text remarks · UI: component / symptom / cause / action chips
- [x] F6 Failure-risk score per asset · UI: red/amber/green badge on the asset list (merged; live after the laptop rebuild)

### Submit (Hack2skill guide email, 20 Nov)
> Window: opens **20 Nov 23:00**, closes **21 Nov 09:00**, no extension. One submission per team, on the participant dashboard.
> 21 Nov agenda: mentor evaluation 10:00–13:00 · showcase 14:00–17:30 · results 18:00.
- [x] Working prototype link — **amps-demo.binihost.com** (ns `amps-judges`, one-click judge login); stays live until evaluation ends
- [ ] **Hack2skill submission deck = Google Slides** https://docs.google.com/presentation/d/1IQdBwCr11AwtRYKYjVSp0SHhAV7PH9IL_AjGdiS8mv0/edit (owner arupbiswas1994; SA jarvis-drive can edit). JARVIS edits it directly and keeps it in sync with the claude.ai Slides deck. Edited copy `deck/AMPS_submission_deck.pptx` (EmbeddingGemma + Gemma 3 4B, prototype link, judge login) sent on TG 21 Nov. Google file UPDATED in place 21 Nov 01:06 IST (Drive files.update of the edited pptx onto the same ID, same path as 20 Nov 21:14), and companion Drive PDF refreshed. Team Name AMPS filled 21 Nov 02:35. Still blank: video link
- [x] Pitch deck PDF < 10 MB — `deck/AMPS_pitch_deck.pdf` re-exported 21 Nov 00:40 from Slides v12: 11 slides, 1920×1080, 0.48 MB · Arup uploads it on the dashboard
- [ ] Demo video (optional) ≤ 3 min, public Google Drive or YouTube link
- [ ] Demo runs end to end (with a pre-loaded backup table, in case the venue Wi-Fi is slow)
- [x] Pitch deck v12 (claude.ai Slides): placeholders filled — team Arup Biswas · Nilanjan Chakraborty, demo URL amps-demo.binihost.com, [contact] removed · Cloud Run cards out (scale path = GKE Autopilot)
- [ ] Submit on Hack2skill between 20 Nov 23:00 and 21 Nov 09:00

## 1b. Evaluation parameters & weightage (Hack2skill AI Evaluation slide, 20 Nov 11:06)
| Parameter | Weight | What AMPS shows for it |
|---|---|---|
| Functional Product & Implementation | 30% | Live app end to end: Snap & Report, Ask AMPS, log book, job cards, printables |
| Technical Architecture & Engineering Quality | 20% | FastAPI + Postgres + React, tests, three hosting paths (§8) |
| Google AI Integration & Implementation Depth | 20% | Gemini multimodal + function calling + JSON schema · Gemma on-prem (EmbeddingGemma search + Gemma 3 4B fallback) · BigQuery + data agent · AlloyDB / GKE Autopilot = scale path |
| Problem-Solution Alignment | 15% | Floor technician: QR → photo → draft → failure report / job card |
| UX, Usability & Accessibility | 10% | Phone-first one column, 500px floor, voice remarks |
| Innovation & Differentiation | 5% | AI drafts, human confirms; asset history in the prompt |
| **Total** | **100%** | |

The slide also asks for a **problem statement** (the challenge we solve) and **rubric criteria** (what earns a high or low score).
Priority for the build: working product first (30%), then Google AI depth and architecture (20% each).

## 1c. Mentor input (20 Nov, Google mentor)
Full notes → `mentor_inputs.md` (the old mentors-advise file is deleted; one picture, two layers). Mental model: **AI layer 1 = every click** (RAG + deterministic + small model + voice + OCR: Snap, Ask AMPS, Similar failures, PM plan = deterministic scheduler with Gemini explaining, Risk badge) · **AI layer 2 = learns over time** (data cleansing, boosted trees / random forest, neural nets, ML pipelines in BigQuery ML). The AI page (`#/ai`, `aihub.jsx`) now opens with the two layers, each with its techniques, feature → technique rows and an economy line; every card carries an L1 / L2 tag. Gemini key on the laptop verified 20 Nov (AI Studio endpoint, 200). BigQuery ML `failure_risk_model` trained 20 Nov 14:01; first evaluation is degenerate (no positives in the eval split), so the labels and window are next.

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
| AI calls | Gemini over REST `generateContent` (Ask AMPS, Snap & Report, Auto-plan); `gemini-3.5-flash-lite` on the buildathon stack, amps.binihost.com still pins `gemini-2.5-flash` in its k8s manifest · Gemma on-prem via Ollama: EmbeddingGemma (search) + Gemma 3 4B (fallback) | + embeddings, **AI.EXTRACT** on remarks, risk scoring | Extends the same Gemini key |
| Agent access | Ask AMPS = 6 read-only tools inside the app | **F3 MCP server** exposes the same 6 tools to any agent (Antigravity, Claude, Gemini CLI) | Wrapper, no logic change |
| Guardrails | Code-level (read-only tools, human submits) | **F5 SKILL.md**: rules an agent must follow on AMPS data | New doc file |
| Analytics | Dashboard counts/charts | **F4** logbook/failures → BigQuery + Conversational Analytics (ask in English) | New export job + Google console |
| Hosting | binihost k3s + Ensign | Same, plus Google and local Postgres kept ready as alternate production hosts (§8) | Additional hosts, kept ready |
| Data | Live data stays on the production box | Demo runs on the **Demo Industries** demo dataset | No change |

### What each feature needs (to choose what to build)
| F | Feature | Needs | Effort | Demo wow |
|---|---|---|---|---|
| F1 | Similar past failures | pgvector + EmbeddingGemma (on-prem) | M | High |
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
| 20 Nov (Arup) | Operator details live outside git: `AMPS_ORG`, `AMPS_ORDER_REF`, `AMPS_ORDER_EXTRACT`, `AMPS_ORG_ALIASES` build args, set only in the office's untracked `deploy/compose.local.yaml`. Unset = the neutral "In production" block and the org from `AMPS_ORG` (default Demo Industries) on checksheet titles | The pilot is never named in the repo |
| 20 Nov (Arup) | This file is **the tracker**: every buildathon change updates it in the same branch | One place to see the state |
| 20 Nov (mentor → Arup) | **Refocus on two AI layers.** Layer 1 = every click: RAG + deterministic rules + small Gemini (Flash-Lite) + voice + OCR. Layer 2 = learns over time: data cleansing + boosted trees / random forest / neural nets in BigQuery ML pipelines. PM plan stays a deterministic scheduler; Gemini only explains it | Jury sees efficiency and economy per layer; cheap and explainable now, predictive as data grows |
| 20 Nov | AI page `#/ai` opens with the two layers (techniques, feature → technique, economy line), L1 / L2 tag on every card (0d57849) | The jury reads the mental model in one screen |
| 20 Nov | Deck and pitch use the same two-layer picture; the data is called the "Demo Industries demo dataset" | One story across app, deck and video |
| 20 Nov (Arup) | Old 23-slide pitch PDF `frontend/public/pitch/AMPS_pitch_deck.pdf` dropped and its "PDF ↓" link removed from the Brief page: it named the pilot source. Replacement = the new two-layer deck as a PDF on the Hack2skill template, once Arup approves it. Git history keeps the old file; any history scrub is Arup's call | The source is never named in what judges see |
| 20 Nov (Arup) | Source word out of what people see: the shortcuts-menu pilot link now comes from build env `AMPS_PILOT_URL` (unset = no link, so the submitted build shows none); README bio says "rail". Left on purpose: the line-colour key and the ribbon CSS class name, code identifiers that never render as text | Nothing a judge sees names the source; no behaviour change |
| 20 Nov (Arup) | Source word nowhere, images included: Brief-page slide deck hidden (`SHOW_DECK = false`) and the 8 slides that named it (03, 04, 05, 09, 12, 15, 18, 23) removed from `public/pitch/`; the other 15 stay (OCR clean, 01 is the og:image). Snap & Report clip and poster removed and the hero runs without them (`SNAP_CLIP = false`) until the demo film is reshot. Colour key and ribbon class renamed to `line` / `.line-ribbon`. Also fixes dc04086, whose `PILOT_URL` line split the `ORG_ALIASES` chain and blanked the page | 0 hits in tree, dist and OCR; the new two-layer deck slides go in after Arup approves it |
| 20 Nov (Arup) | Drop AlloyDB from the build; **pgvector on Postgres now, AlloyDB at scale** (same SQL, `pg_dump` → AlloyDB, no app change) | Startup economy: ₹0 extra today; a hassle-free migration path when load needs it |
| 20 Nov | **Speed = architecture.** GZip (min 1 KB) + read-through cache on the 7 hot GETs (`app/cache.py`, Redis when `AMPS_REDIS_URL`, else in-process; key = data version + caller + path; any 2xx write bumps the version) + event bus (`app/events.py`, Redis pub/sub `amps:events`) + live websocket `/api/ws` + worker split (`app/worker.py`, Redis list `amps:jobs`) | Before (laptop, in-container): risk 1.55 s · open-failures 1.1–1.3 s · failure-stats 0.8 s · assets 0.75–1.2 s / 2.7 MB · schedule 0.77 s / 1.5 MB, no gzip. Mentor asked for split servers + websockets + event-driven. Growth path: in-process → Redis → Pub/Sub/Kafka, same `publish()` |
| 20 Nov (Arup ask → JARVIS rec.) | **Hosting = hybrid.** Home = on-prem k3s / Kubernetes (binihost): app, Postgres+pgvector, Redis, worker, fixed cost. Google = the AI + data + edge layer: Gemini / Vertex, BigQuery + BQML, Pub/Sub for ampsTalk, Cloud Run as scale-to-zero burst + DR mirror of the same images. Scale path: pgvector → AlloyDB, k3s → GKE Autopilot. See §8 | Cheapest steady state (on-prem ≈ ₹0 marginal), pay-per-use only where Google is best, no lock-in (same containers everywhere). The mentor already liked on-prem k8s. Prototype link for judges = Arup's pick (amps.binihost.com gets no roll today) |
| 20 Nov (Arup, final) | **Architecture final: binihost runs everything, Google is the brain.** Frontend on binihost Ensign (CDN); api ×N, worker ×N, Redis, Postgres+pgvector (CNPG HA) on the binihost 3-node k3s. Google credits only for Gemini (Vertex AI) on every click and BigQuery + BQML for learning: the binihost worker loads cleansed rows nightly (free load jobs, day partitions), BQML trains weekly and scores nightly, and the worker pulls `risk_scores` back into Postgres → cache bump → `risk.updated` over the websocket. **Cloud Run dropped** (it only duplicated the 3 nodes). Supersedes the Cloud Run lines in §8b | Fixed cost for compute; credits spent where Google is unique; no lock-in |
| 20 Nov | **"How it's built" section on the AI page** (`aihub.jsx` `Arch()`): binihost zone (CDN · api ×N · Redis bus · worker ×N · Postgres+pgvector) ⇄ Google zone (Gemini on Vertex · BigQuery+BQML), plus three live proof tiles: websocket on/off, read-cache hit/miss + ms on `/api/lines` (`X-AMPS-Cache`), learning layer. Checked headless at 1600 px and 500 px | Judges see the architecture inside the product, with live proof, not only on a slide |
| 20 Nov (Arup) | **Decisions:** judges' link = amps-demo.binihost.com · Arup links billing for the Google credits for the evaluation only (review after) · after the event, AI runs on each **client's own** Google credits as the client needs · this architecture is the one to test, build and run. Deck architecture slide redrawn to it; Cloud Run removed from the PDF then (8 pages, 0.55 MB), but the Slides cards still said Cloud Run until v12 (21 Nov) | One story everywhere: product, slide, page |
| 20 Nov | **Frontend live + lazy.** One shared websocket (`src/live.jsx`, backoff 1→30 s, Live dot in the header, toast "⚡ New failure on <asset>"); `write` / `failure.raised` / `talk.reading` events → debounced re-read through the cached GETs; assets list cached across the 4 screens (stale-while-revalidate); Roster, Guide, Letters, Planner and AI Hub load on demand (`React.lazy`) | Main bundle 355 → 336 kB (gzip 110.9 → 104.9 kB); 92 kB moved to on-demand chunks. Screens update without polling. No layout change |
| 20 Nov | Laptop end to end: rebuilt with redis + worker (DB kept). Read cache 360 ms → 9 ms on a hit. Fix: worker BRPOP had the shared 1 s Redis socket timeout, so every 5 s poll timed out; worker now has its own client (timeout poll + 5 s) | `backend/app/worker.py` |
| 20 Nov | Gemini on the laptop key: works, but 3.x models reject `thinkingBudget: 0` (400) — Snap + auto-plan would have failed. New `ai.thinking_off()` sends `thinkingLevel: minimal` on 3.x. `_post` retries 503/429 twice (shared tier returned 503s at peak; latency 2–15 s, 3.5-flash-lite ~9 s). `bq.export` job failed (scripts/ not in image) → Dockerfile copies `scripts/*.py` to /scripts | `api/ai.py`, `snap.py`, `autoplan.py`, `backend.Dockerfile` |
| 20 Nov | `bq.export` next failed on `/schemas/bigquery/*.json` (cleanse schemas) → image also copies `schemas/bigquery/`. Laptop worker overlay now points at `amps_data` like the api | `backend.Dockerfile` |
| 20 Nov | **Judges' link live: amps-demo.binihost.com** = full stack on binihost k3s, ns `amps-judges` (frontend + api + worker + Redis + Postgres/pgvector), same images as the laptop e2e (`oc11202158-e2e`). Demo Industries network seed, login on, admin password generated (bvault `amps-judges/`). DNS-only A record, Let's Encrypt cert. Verified: bundle `CvJ7anaO`, ws 101, worker alive (redis mode), Ask AMPS 18 s. Embedding reindex got Gemini 429 → needs billing on the key's project (resolved: switched to EmbeddingGemma on-prem, see the Hybrid AI row). amps.binihost.com untouched | `deploy/k8s/judges/stack.yaml` |
| 20 Nov | **One-click judge login**: `AMPS_DEMO_USER=judge` adds a "One-click demo login · Judge (demo)" button on the sign-in page. Account = whole-department SUPERVISOR (writes, Snap, plans; no user admin / sync / device keys), random never-shown password, no credentials in the bundle. Off unless the env is set. Images `oc11202210-demo` | `api/auth.py`, `main.py`, `App.jsx` LoginForm, `api.js`, `tests/test_demo_login.py`, judges `stack.yaml` |
| 20 Nov | **Failures empty for all-sites users — fixed**: the Failures tab sent anyone without a home site (admin, judge) to the FIRST site's board (City Traction & Depot, 0 open) → "No open failures". Now `/failures` shows every site's failures (178 total, 7 open) for line-less users; coordinators still go to their own line. Frontend `oc11202235-failall` | `App.jsx` FailuresRedirect, judges `stack.yaml` |
| 20 Nov | **Failures board never opens empty**: a site with 0 open (City Traction & Depot, Bengal Steel) still opened on the remembered Open tab → "No open failures". The board now lands on the first tab with rows (open → acknowledged → job card → resolved). Frontend `oc11202245-failtab` | `App.jsx` LiveFailures, judges `stack.yaml` |
| 20 Nov | **First load = All sites dashboard**: the picked site was kept in localStorage, so a returning browser reopened on one site. Now it is kept per tab (sessionStorage), so every fresh visit opens on the all-sites KPI view (1,865 assets, 81% PM compliance, failures/month). Frontend `oc11202256-allsites` | `App.jsx` lastSite/keepSite, judges `stack.yaml` |
| 20 Nov | **Hybrid AI: Gemma on-prem**. "Seen before" now embeds with **EmbeddingGemma** on our own Ollama/GPU (`AMPS_EMBED_PROVIDER=ollama`, 768-dim, document prompt, no key, no quota, remarks stay in the cluster). All 178 failures re-embedded in 26 s and ranked by pgvector; the panel says `✦ embeddinggemma · on-prem`. Ask AMPS falls back to **Gemma 3 4B** on-prem (`AMPS_AI_FALLBACK_*`, 0.9 s answer) when Gemini errors or hits quota. Gemini stays the primary brain. Backend `oc11202307-gemma` | `similar.py` `_embed_ollama`, `similar.jsx`, `test_similar.py`, judges `stack.yaml` |
| 20 Nov | **Ask AMPS shows which model answered**: `/api/ai/ask` now returns `provider` (`gemini` · `gemma-onprem`) + `fallback` beside `model`; each answer carries a chip "Gemini 3.5 Flash-Lite · cloud" or "Gemma 3 4B · on-prem (fallback)" when Gemini fails and the Ollama fallback (`AMPS_AI_FALLBACK_URL/MODEL`) answers. Tests mock both paths + no-fallback 502 (3/3, base 2 RED) | `api/ai.py`, `ask.jsx`, `tests/test_ai_fallback.py` |
| 20 Nov (Arup) | **Hybrid AI in the pitch.** Pitch page (`brief.jsx`) gets §3 Hybrid AI: Gemini 3.5 Flash-Lite in the cloud (reasoning, vision, function calls) + Gemma 3 4B on-prem via Ollama on our k3s GPU (free fallback on Gemini error/quota) + EmbeddingGemma on-prem (768-dim similar-failures search, 100+ languages incl. Bengali; replaces nomic). Tagline: *Our Kubernetes runs the plant. Google is the brain. Gemma keeps it running on-prem.* Compare-table AI row, AI FAQ and the hidden deck's slide-6 title updated; sections renumbered §1–§9. Deck PDF rendered headless from `#/guide` → `deck/AMPS_pitch_deck.pdf` (5 pages, 0.3 MB; not served by the app) | Judges read one AI story: Google is the brain, Gemma keeps it on when the cloud can't |
| 20 Nov (Arup) | **Gemma in the pitch deck (Slides artifact v8).** Slide 4 title "Six AI features, live: Gemini in the cloud, Gemma on-prem"; Ask AMPS row adds "Gemma 3 4B fallback", Similar past failures row → "EmbeddingGemma, on-prem", hybrid line in the footnote. Slide 5 card "Gemini embeddings + pgvector" → "Gemma on-prem: EmbeddingGemma + Gemma 3 4B". Slide 6 adds a "Gemma on our k3s · search + fallback" box; footer says Gemma answers on-prem when Gemini is down. Merged onto the live deck, nothing else changed | Deck tells the same hybrid story as the Pitch page |
| 20 Nov (Arup) | **EmbeddingGemma vs nomic, measured (deck v10).** 18 fault questions over the 178 demo failures, top hit scored, both models on the i5 GPU Ollama: **EmbeddingGemma 17/18 vs nomic 8/18** — English 4/4 vs 4/4 · Bengali 5/5 vs 0/5 · Hindi 4/4 vs 1/4 · shorthand 4/5 vs 3/5 (only miss: "brg temp hi, mtr" → transformer oil temp). Slide 5 Gemma card now carries the score; speaker note says how it was measured. | Slides artifact v10 · eval script in JARVIS scratchpad |
| 21 Nov 00:45 (Arup "fix all") | **Deck v12 + PDF + notes refresh.** Slides: cover team line (Arup Biswas · Nilanjan Chakraborty; Gemini, Gemma, BigQuery, AlloyDB), Google card 6 → "Antigravity + Agent Skill" (own k3s), hosting slide amps-demo.binihost.com + GKE Autopilot, close card "GKE when it grows", "Try it: amps-demo.binihost.com", demo note → EmbeddingGemma. PDF re-rendered headless from the Slides content: 11 pages 1920×1080, 0.48 MB → `deck/AMPS_pitch_deck.pdf` (replaces the 5-page `#/guide` print). Notes: Cloud Run lines marked dropped, F1 → EmbeddingGemma, submit checklist ticked | Slides artifact v12 · `deck/AMPS_pitch_deck.pdf` |
| 21 Nov 01:30 (Arup) | **Google Slides submission deck is the one to edit.** Link saved: https://docs.google.com/presentation/d/1IQdBwCr11AwtRYKYjVSp0SHhAV7PH9IL_AjGdiS8mv0/edit. Exported, then 7 text fixes: gemini-embedding-001 → EmbeddingGemma · Gemma 3 4B; similar failures on-prem 17/18 vs nomic 8 (Bengali 5/5 vs 0/5); Gemma fallback; [prototype link] → amps-demo.binihost.com; [demo login] → one-click Judge login. Saved as `deck/AMPS_submission_deck.pptx`, sent on TG. Then pushed onto the same Google file (Drive files.update), 8 slides verified, companion PDF refreshed. The Slides API is not needed | Keep iterating on the Google file |

## 6. Open items (21 Nov 00:45; current view = §0)
| Item | Owner | Next |
|---|---|---|
| Laptop AI stories | JARVIS | ✅ done e658bd6: `seed_network.py --stories` added 10 stories, data kept (no `down -v`, ever) |
| Gemini key in laptop `deploy/.env` | Arup (the key) · JARVIS (re-run compose) | ✅ done 20 Nov 14:06, key tested (AI Studio 200) |
| Prototype link for the submission | Arup | ✅ amps-demo.binihost.com (ns `amps-judges`) |
| BigQuery ML `failure_risk_model` (layer 2) | JARVIS | trained 14:01; eval degenerate (no positives in the eval split) → fix the label window, retrain, record metrics here |
| Deck PDF | JARVIS | ✅ `deck/AMPS_pitch_deck.pdf` from Slides v12, 11 pages, 0.48 MB · Arup uploads it on the dashboard |
| BigQuery `amps_demo` reload | JARVIS | ✅ reloaded from the laptop DB: assets 1,874 · log_entries 14,416 · asset_risk view 1,874. Project is a BigQuery **sandbox**, so tables expire after 59 days |
| BigQuery F2 `failure_fields` (AI.GENERATE) + data agent (Codelab 2 steps 6–11) | Arup | needs billing on the project · the event billing account auto-closed (credit expired), Arup is sorting it with the mentors · meanwhile the pitch uses `bigquery/agent/pitch.sh` (JARVIS runs it on the laptop) |
| Hosting paths ready (§8) | crew | local PG ✅ · binihost ✅ · BigQuery ✅ data (sandbox) · AlloyDB = step 9 (merged fa1a6f6, not run on GCP) · Cloud SQL = not started · Cloud Run = dropped (§5, 20 Nov final) |
| AI hub steps 2–6 | crew | see §7 |
| Backend default model in `backend/app/api/ai.py` and the amps.binihost.com k8s manifest still say `gemini-2.5-flash` | build | judges' stack already runs `gemini-3.5-flash-lite` via env (`stack.yaml`); change the code default after the event |
| Pitch deck + demo video, Hack2skill submit | Arup + Nilanjan | deck ✅ v12, placeholders filled, PDF ✅ · video optional · **submit on the dashboard before 21 Nov 09:00** (prototype link + PDF) |

## 7. Crew lanes (20 Nov 09:30 — freya leads, merges into `buildathon`)

Each seat pushes `<seat>/<topic>` to biniyognet/amps; freya reviews, merges, wires the hub card, ticks here. JARVIS rebuilds the laptop (:8081) after each merge.

| Step | Seat | Branch | Hub card | State |
|------|------|--------|----------|-------|
| 1 AI hub `#/ai` + ✦ AI nav | freya | (on buildathon, 119c576) | all 8 | ✅ merged · on :8081 |
| 2 Ask chips + Snap strip | builder-1 | `builder-1/ask-chips-snap-history` | Ask, Snap | ✅ merged b73057e · on :8081 |
| 3 F6 risk badge | builder-2 | `b2/f6-risk-badge` (`/api/risk` + register dot, filter, sort) | Risk badge | ✅ merged 63ad28a · on :8081 at 3558798 · card **live** (opens the register on red + amber, riskiest first) |
| 4 BigQuery reload + F2 failure_fields + F6 asset_risk | floki | `floki/bq-f2-f6`, `floki/bq-ignore`, `floki/bq-sandbox` (59-day expiry) | Fault fields, Risk badge (data) | ✅ merged · data reloaded + asset_risk built; `failure_fields` needs billing (Arup) · Fault fields stays coming |
| 5 F1 similar failures | master-builder | `master-builder/f1-similar` | Similar past failures | ✅ merged 3e61abc · on :8081 · card **live** (opens Pump Motor 1); EmbeddingGemma on-prem since 20 Nov (Gemini 429 on reindex) |
| 6 F4 data agent | builder-1 | `builder-1/f4-data-agent` | Estate agent | ✅ merged 94263a8 · paste-ready config + 6 verified questions in `bigquery/agent/` (`load.sh --agent` reads them back) · JARVIS creates the agent in the BigQuery console on the laptop · card flips once the agent answers; pitch Q1 red risk + why, Q3 failures by site and month, Q4 open failures by station · fallback ✅ bbb3bb3: `bigquery/agent/pitch.sh` runs Q1/Q3/Q4 in the sandbox → `pitch_out/pitch.html` (3 screenshot cards, SQL under each; git-ignored) while the agent is held |
| 7 Pilot data import script (prep only, no run) | builder-2 | `b2/pilot-import` (renamed 20 Nov, same a87bd79) | — | 🟡 import script with `--target-db/--create-db`, its test, demo DB backup/restore pair · **not merged**: file names inside the branch still carry the source name, builder-2 renames them first (Arup rule 11-20) |
| 8 Gemini in BigQuery + Vertex, ready for billing | master-builder | `master-builder/vertex-bq` | Fault fields | ✅ merged 0551552 · billing day = `bigquery/gemini_go.sh --dry`, then `bigquery/gemini_go.sh` (refuses while billing is off); app: `AMPS_AI_PROVIDER=vertex` + `AMPS_VERTEX_PROJECT` in `deploy/.env`, add `-f deploy/compose.vertex.yaml` · not yet run against GCP · Fault fields flips after `failure_fields` runs |
| 9 AlloyDB | minion | `minion/gcp-host` | Similar (scale-up path) | ✅ merged fa1a6f6 20 Nov (freya, af3c888 dropped the hard-coded line name so the app default applies): `deploy/gcp/` = AlloyDB migrate script + pgvector SQL + local test, `gcp.sh`, Cloud Run frontend image, README. Local rehearsal green (178 embeddings, SQL = Python top-5, re-run refused, sync trigger ok) · 85 tests pass · billing-gated, nothing run against GCP |
| 10 Cloud Run | ragnar | — | MCP (URL) | ⛔ dropped 20 Nov (architecture final, §5): binihost runs everything; MCP stays on amps-api |
| 11 Demo wording sweep (Demo Industries demo dataset) | builder-1, master-builder | `builder-1/demo-wording`, `master-builder/demo-wording` | — | ✅ merged 2e87e43 (frontend + docs, `operator-logo.svg`) · 205f3ae `deploy/compose.local.yaml` out of git + ignored (a pull deletes the local copy, so back it up first) · 8c5b273 backend prose; checksheet titles headed by `AMPS_ORG`, new seeds only · 20 Nov (Arup go): site renamed City Traction & Depot (minion b1a9c46, merged 0782a93) · operator name, office order and checksheet title org now come from build env, not git (6b9511e, 696e681) · branches renamed `b2/pilot-import`, `office/pilot-prod` · identifiers, hostname, README bio left as they are |

Merge rule: build passes in Docker, no secrets in the diff, frontend-only lanes never touch amps.binihost.com / amps-api. A "coming" card flips to live only after its branch is merged AND it works on :8081.

## 8. Hosting — three paths kept ready (Arup, 20 Nov)

AMPS must be able to run in production on any of these, so each client can get the cheapest host that works. All three use the same code; the database is picked by `DATABASE_URL` (`backend/app/db.py`).

Admin login (Arup, 20 Nov): a simple admin key is fine for the prototype on **local and the laptop only**. Any public URL (binihost) uses a generated password kept in Secret Manager, never the simple one.

| Path | What runs where | State | Next |
|---|---|---|---|
| Local Postgres | `deploy/compose.yaml` (Postgres 16 + API + frontend) on the client's own box or the laptop | ✅ the laptop stack :8081 | — |
| binihost | k3s + Ensign (`deploy/k8s/`), amps.binihost.com · amps-api · amps-mcp | ✅ live (production) | no buildathon roll |
| binihost (judges) | ns `amps-judges`: amps-demo.binihost.com, frontend + api + worker + Redis + Postgres/pgvector + Gemma via Ollama (`deploy/k8s/judges/stack.yaml`) | ✅ live | prototype link for the evaluation |
| Google | **Cloud SQL** (Postgres) or **AlloyDB** for the app DB, **BigQuery** for analytics, **Gemini / Vertex** for AI, **GKE Autopilot** when an estate outgrows k3s | BigQuery ✅ `amps_demo` (sandbox, 59-day expiry) · AlloyDB = step 9 (`deploy/gcp/`, merged fa1a6f6, not run on GCP) · Cloud Run dropped · Cloud SQL not started | all billing-gated: a `DATABASE_URL` to Cloud SQL/AlloyDB + Alembic, the same images on GKE |

Rule: nothing is tied to one host. A feature that only works on one of them says so here.

### 8b. Decision — hybrid (20 Nov evening)

| Layer | Where | Cost model | Scale step |
|---|---|---|---|
| App (api, worker, frontend) | on-prem k3s (binihost) | fixed, already paid | more nodes → GKE Autopilot, same images |
| App DB + vectors | Postgres 16 + pgvector on k3s | fixed | AlloyDB (pgvector-compatible, `pg_dump` move) |
| Cache + queue + events | Redis on k3s | fixed | Memorystore; events → Pub/Sub |
| AI | Gemini (AI Studio now, Vertex on billing) | per call, Flash-Lite | Vertex quotas, same code (`AMPS_AI_PROVIDER`) |
| Analytics + ML | BigQuery + BQML (sandbox now) | per scan, MB-sized | partitioned tables, scheduled export |
| IoT (ampsTalk) | HTTP direct, or Pub/Sub push to `/api/talk/telemetry` | per message | Pub/Sub fan-in, no app change |
| Burst / DR | ~~Cloud Run mirror~~ dropped (§5, 20 Nov final) | — | GKE Autopilot, same images |

Pitch line: *runs on a client's own Kubernetes for a fixed cost, uses Google only where Google is best, and moves to fully managed Google with no code change.*
