# Mentor input — 20 Nov (Google mentor)

> Notes from the 1st mentor round, as one picture plus what AMPS has today. Contact details are kept off the repo.

## The picture: two AI layers on Google Cloud

| | **AI layer 1 — every click** | **AI layer 2 — learns over time** |
|---|---|---|
| Job | Help the person on the floor right now | Predict and explain failures across the estate |
| Techniques | RAG · deterministic rules · small model · voice to text · OCR | Data cleansing · random forest / XGBoost · neural nets / deep learning · ML pipelines |
| Speed / cost | Fast and cheap: rules where rules are enough, the smallest Gemini model only where reading or language is needed | Batch, slower, matures as the log book grows |
| Google | Gemini Flash-Lite (Vertex AI), Gemma for self-host economy, Speech-to-Text (Chirp) | BigQuery, BigQuery ML, ML pipelines |
| In AMPS | Snap & Report · Ask AMPS · Similar past failures · PM plan · Risk badge | Failure risk next 30 days (BigQuery ML boosted tree) · Fault fields · Estate agent |

**Feature → technique**
- **Snap & Report:** OCR / vision + voice + Flash-Lite.
- **Ask AMPS:** RAG over our own records + Flash-Lite function calling.
- **Similar past failures:** RAG (Gemini embeddings).
- **PM plan:** a deterministic scheduler; Gemini only explains it.
- **Risk badge:** a deterministic rule score today; the BigQuery ML model next.

## Around the layers
- **Architecture:** app server + a separate data-processing worker; queue grows Postgres → Redis → Kafka as scale needs.
- **Hosting:** GCP (Cloud Run); Postgres + vectors on AlloyDB (pgvector).
- **UX:** fewer clicks (QR → photo → one-tap draft); voice in Indian languages.
- **Pitch:** pilot operator acceptance (real-world scale, real users) · product potential · business · funding.

## Status vs the advice

| Point | Today | Next |
|---|---|---|
| Layer 1 | Live: Snap, Ask AMPS, Similar failures, PM plan, Risk badge | Gemma as a self-host fallback (slide) |
| Voice | Browser speech (bn-IN / en-IN) in Snap | Google Speech-to-Text (Chirp) |
| Layer 2 | First BigQuery ML boosted-tree model trained in `amps_demo` | Fix the training window and labels, then show the evaluation |
| Architecture | App + worker on one Postgres | Slide: Postgres → Redis → Kafka |
| GCP hosting | Cloud Run + AlloyDB kit in `deploy/gcp/` | Run when billing is on |
| Acceptance | Demo Industries demo dataset at real-world scale | Pitch line: pilot operator acceptance |
