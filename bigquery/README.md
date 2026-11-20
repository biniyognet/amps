# BigQuery — F2 fault fields + F6 risk badge

Dataset `amps_demo` (project `gen-lang-client-0618042629`), fictional Demo Industries seed only.

| File | Builds | Google product |
|---|---|---|
| `failure_fields.sql` | table `failure_fields`: each failure remark (English, हिन्दी, বাংলা, shorthand) → component · symptom · reading · cause · action · language | Gemini in SQL: `AI.GENERATE(…, output_schema => …)`, `gemini-3.5-flash-lite` |
| `asset_risk.sql` | view `asset_risk`: red / amber / green per asset + up to 3 reasons (`why`) | BigQuery SQL view |
| `check.sql` | row counts, bands, sample rows | — |
| `agent/` | F4 estate agent: config to paste + 6 verified questions (`load.sh --agent` reads them back) | BigQuery data agent (Conversational Analytics) |
| `load.sh` | reloads the 6 tables from `scripts/bq_export.py` output, then runs the three files above | `bq` CLI |

```bash
DATABASE_URL=... python scripts/bq_export.py --out bq_out   # from a freshly seeded stack (178 failures)
bigquery/load.sh bq_out
bigquery/load.sh --check   # read-back only (counts, bands, samples): paste this output
```

Sandbox (no billing): `load.sh` sets a 59-day default table + partition expiry on the dataset (the sandbox needs one under 60 days); `BQ_EXPIRY_S=0` skips it on a billed project. The Gemini call in `failure_fields.sql` goes to Vertex AI, which may still need billing on the project.

Expected on the 20 Nov seed: failures 178 · failure_fields 178 · asset_risk 1,874 (red 3, amber 41, green 1,830).
Pump Motor 1 (CWT-AM-MTR-01) is the top red: past codal life, 4 failures in 12 months, the same seal fault 3 times, open now.
Power Transformer 1 (EGS-CG-PTR-01) is amber: 2 failures in 12 months (oil temperature, then Buchholz).

What to show judges: `SELECT remark, component, symptom, reading, cause, action FROM amps_demo.failure_fields WHERE language != 'en'`, so that free text in three languages becomes columns you can count. Then `SELECT * FROM amps_demo.asset_risk WHERE band = 'red'`, so that red means old, failing again and PM late, with the reasons listed.
