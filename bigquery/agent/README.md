# F4 — AMPS Estate Agent (BigQuery data agent)

A managers' agent over the whole Demo Industries estate: ask in English, get SQL, a table
or a chart. Built in **BigQuery → Agents** (Conversational Analytics), the same steps as the
codelab *data-agents-in-agy-and-bq*. Fictional seed data only; plain SQL only (no `AI.*`),
so it runs on the BigQuery sandbox.

## Agent config (paste into BigQuery → Agents → Create agent)

| Field | Value |
|---|---|
| Name | `AMPS Estate Agent` |
| Description | Answers maintenance questions over the Demo Industries estate: failures, downtime (MTTR), open work, asset risk and preventive maintenance, by site, station, asset class or month. |
| Knowledge sources | `gen-lang-client-0618042629.amps_demo` → `failures` · `log_entries` · `assets` · `asset_risk` (view) |
| Field descriptions | Customize each source → **Accept** the generated descriptions, then fix these: `line` = site · `station` = area inside a site · `state` (failures) = rectified / job_card / acknowledged / open · `downtime_hours` = hours to fix, NULL until rectified · `type` (log_entries) = maintenance / failure / rectification / job_card / acknowledgement · `band` (asset_risk) = red / amber / green · `why` = up to 3 reasons |
| Instructions | Paste [`GEMINI.md`](../../GEMINI.md) from "The estate" down (tables, meanings, how to answer) |
| Verified queries | The six pairs in [`questions.sql`](questions.sql): question = the `-- Qn` line, SQL = the statement under it |

Then **Save → Publish**. In Antigravity, the Google Cloud Data Agent Kit extension opens
the same agent.

## The six questions

Reference answers from a fresh seed with the stories (`seed_network.py` + `--stories`,
178 failures), checked locally. The laptop DB grows, so its numbers can be higher. To read
the live answers back: `bigquery/load.sh --agent`.

| # | Question | Shows as | Reference answer |
|---|---|---|---|
| Q1 ★ | Which assets are at red risk, and why? | table | 3 red: Pump Motor 1 CWT-AM-MTR-01 (score 15: 4 failures in 12 months · past codal life 23 of 20 years · same fault 3 times), Relay Panel 4 EGS-FBW-RLY-04 (11), HSCB Panel 1 MTD-CEN-HSC-01 (11) |
| Q2 | Which 5 assets failed most in the last 12 months? | bar chart | Pump Motor 1 = 4, Relay Panel 4 = 3, then Power Transformer 1, Isolator 5, Fire Alarm Panel 1 = 2 each |
| Q3 ★ | Failures by site and month | stacked bar / line | 178 failures, Jun 2025 → Nov 2026, four sites |
| Q4 ★ | How many failures are still open, by station? | table | 19 open across 15 stations; Booster Station, Cable Gallery, Feeder Bay East, HV Yard North = 2 each |
| Q5 | Which asset class takes longest to fix (MTTR)? | bar chart | Exhaust Fan 138 h, RTU 129 h, Raw Water Pump 95 h (1 not fixed, left out) |
| Q6 | Per site: preventive maintenance done vs failures in the last 90 days | table | Eastern Grid 8 PM per failure (253 / 31) vs City Traction & Depot 154 (1,078 / 7): the grid gets the least PM per failure |

★ = the three pitch questions for the AI hub card.

## Pitch fallback (no agent yet, e.g. billing off)

The same three ★ answers, from the same verified SQL, in the BigQuery sandbox. No agent,
no Gemini, read only.

```bash
bigquery/agent/pitch.sh            # runs Q1, Q3, Q4 → pitch_out/q*.json + pitch_out/pitch.html
```

| Step | Ask (say it) | Show |
|---|---|---|
| 1 | "Which assets are at red risk, and why?" | `pitch.html` card 1: 3 red, Pump Motor 1 on top with its reasons (matches the F6 red badge) |
| 2 | "Failures by site and month" | card 2: stacked bars per month, one colour per site (178 failures, Jun 2025 → Nov 2026) |
| 3 | "How many failures are still open, by station?" | card 3: 19 open across 15 stations, split not seen / acknowledged / job card |

Each card has "SQL (the verified query the agent uses)" to open, so the judges see that
the answer is SQL over the estate. Live in the console instead: paste the `-- Q1`/`Q3`/`Q4`
blocks from `questions.sql` into BigQuery Studio and screenshot the results.
`PITCH_RENDER_ONLY=1 bigquery/agent/pitch.sh pitch_out` re-draws the page from the saved
JSON without querying again.

## What to show judges

1. Ask Q1: the agent answers from the `asset_risk` view and quotes the reasons; it matches
   the red badge on the AMPS asset list (F6).
2. Ask Q3: the same question as the dashboard chart, answered as a chart from SQL the agent wrote.
3. Ask a new question it was not given (e.g. "Which night-shift failures took longest to fix?")
   to show it writes SQL, not canned answers.
