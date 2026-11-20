# BigQuery — F2 fault fields + F6 risk badge + F7 learned risk

Dataset `amps_demo` (project `gen-lang-client-0673220135`, override with `BQ_PROJECT`), Demo Industries demo dataset (exported by `scripts/bq_export.py`; users, passwords, audit trail, attachments and correspondence are never exported).

| File | Builds | Google product |
|---|---|---|
| `failure_fields.sql` | table `failure_fields`: each failure remark (English, हिन्दी, বাংলা, shorthand) → component · symptom · reading · cause · action · language | Gemini in SQL: `AI.GENERATE(…, output_schema => …)`, `gemini-3.5-flash-lite` |
| `asset_risk.sql` | view `asset_risk`: red / amber / green per asset + up to 3 reasons (`why`) | BigQuery SQL view |
| `risk_model.sql` | table `risk_snapshots` (asset × month, no look-ahead) → model `failure_risk_model` (P(fail in 30 days)) → view `asset_risk_ml` | BigQuery ML `LOGISTIC_REG`, time-ordered eval split |
| `check.sql` | row counts, bands, sample rows | — |
| `remote_model.sql` | remote model `gemini` on the Vertex AI connection `amps_vertex` | BigQuery ML remote model → Vertex AI |
| `failure_fields_ml.sql` | table `failure_fields_ml`: the same columns as `failure_fields`, through the remote model | `ML.GENERATE_TEXT` + `JSON_VALUE` |
| `gemini_go.sh` | the billing-day switch: connection + IAM, remote model, both F2 tables, F6, read-back, Vertex AI live check | `gcloud` + `bq` |
| `agent/` | F4 estate agent: config to paste + 6 verified questions (`load.sh --agent` reads them back) · `agent/pitch.sh` = Q1/Q3/Q4 fallback page, no agent needed | BigQuery data agent (Conversational Analytics) |
| `load.sh` | loads the 9 tables from `scripts/bq_export.py` output with the explicit schemas in `../schemas/bigquery/` (time-series tables partitioned by `event_date`, clustered), then runs F2 / F6 / F7 | `bq` CLI |

```bash
DATABASE_URL=... python scripts/bq_export.py --out bq_out   # from a freshly seeded stack (178 failures)
bigquery/load.sh --dry-run bq_out   # print every bq command first
bigquery/load.sh bq_out
bigquery/load.sh --check   # read-back only (counts, bands, samples): paste this output
```

## Data quality before BigQuery

`scripts/bq_export.py` runs every row through `scripts/bq_cleanse.py` against `schemas/bigquery/<table>.json` (no `--autodetect`):
text NFC + whitespace cleaned, enums trimmed but kept as stored (`'A'`, `'Monthly'`, shift `M`), DATE / DATETIME typed (IST wall clock),
`event_date` partition column, `lang` (bn / hi / en / mixed) on free text, `dq_flags` (future date, end before start, no asset,
short text, past-codal fields missing …: flagged, never silently fixed), exact duplicates dropped. A column or type the schema
doesn't know stops the export before anything is billed. `bq_out/_quality.json` is the report (rows in/out, duplicates, flags,
null rates, language mix; contract `schemas/contracts/quality_report.json`). Structured AI outputs live in `schemas/ai/`
(Snap draft, failure fields) and the ampsTalk device body in `schemas/contracts/iot_telemetry.json`.

## Cost guard

Loads are free. Every query carries `--maximum_bytes_billed` (`BQ_MAX_BYTES`, default 1 GB), so a bad join fails instead of billing;
partitioning + clustering keep scans to the days asked for. `BQ_AI=0` skips the Gemini step, `BQ_ML=0` the model.
Model quality: `SELECT * FROM ML.EVALUATE(MODEL amps_demo.failure_risk_model)` and `ML.GLOBAL_EXPLAIN(...)` for the feature weights.

Sandbox (no billing): `load.sh` sets a 59-day default table + partition expiry on the dataset (the sandbox needs one under 60 days); `BQ_EXPIRY_S=0` skips it on a billed project. The Gemini call in `failure_fields.sql` goes to Vertex AI, which may still need billing on the project.

Expected on the 20 Nov seed: failures 178 · failure_fields 178 · asset_risk 1,874 (red 3, amber 41, green 1,830).
Pump Motor 1 (CWT-AM-MTR-01) is the top red: past codal life, 4 failures in 12 months, the same seal fault 3 times, open now.
Power Transformer 1 (EGS-CG-PTR-01) is amber: 2 failures in 12 months (oil temperature, then Buchholz).

What to show judges: `SELECT remark, component, symptom, reading, cause, action FROM amps_demo.failure_fields WHERE language != 'en'`, so that free text in three languages becomes columns you can count. Then `SELECT * FROM amps_demo.asset_risk WHERE band = 'red'`, so that red means old, failing again and PM late, with the reasons listed.

## The day billing goes on — one command

```bash
bigquery/gemini_go.sh --dry   # read-only: signed in, billing, APIs, dataset, SQL dry-run, Vertex adapter. Creates nothing.
bigquery/gemini_go.sh         # refuses while billing is off; then enables the 2 APIs, creates connection amps_vertex,
                              # grants its service account roles/aiplatform.user, builds model gemini,
                              # failure_fields (AI.GENERATE) + failure_fields_ml (ML.GENERATE_TEXT), asset_risk,
                              # read-back, and 2 tiny live calls through the app's Vertex AI provider
```

Every step is safe to re-run. Env overrides: `BQ_PROJECT`, `BQ_DATASET`, `BQ_LOCATION` (us-central1), `BQ_CONN`, `BQ_GEMINI_MODEL`.

The app on Vertex AI (same Gemini models, billed to the project, Google credentials instead of the AI Studio key):
`AMPS_AI_PROVIDER=vertex` + `AMPS_VERTEX_PROJECT` in `deploy/.env`, then add `-f deploy/compose.vertex.yaml`
(mounts your `gcloud auth application-default login` credentials read-only). `scripts/vertex_check.py` is its dry check.
Ask AMPS, Snap & Report, auto-plan and Seen before all switch together; `AMPS_AI_PROVIDER=gemini` switches back.
