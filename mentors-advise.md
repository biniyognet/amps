# Mentor input — 20 Nov (Google mentor, Risav)

> Contact details kept off the repo. Notes as given, then how AMPS answers each point.

## Inputs
- **AI layer 1:** RAG + deterministic + smaller model + voice to text + OCR
- **AI layer 2:** predictive models (random forest, XGBoost, neural nets / deep learning, data cleansing; long-running)
- **Architecture:** app server + heavy data-processing server; queue Postgres → Redis → Kafka as scale needs
- **Regional showcase blockers / demand:** UX (fewer clicks) · voice to text in Indian languages (Sarvam or similar)

## Google products
- Host on GCP
- GCP database for Postgres + vector (AlloyDB / pgvector)
- AI layer 1: Vertex AI → Gemini Flash; Gemma for self-hosting and economy
- AI layer 2: BigQuery, ML pipeline, data analysis, long-running ML research

## Suggestions
- Showcase pilot operator acceptance (real-world data, real users)
- Product potential · funding · business · pitch

## How AMPS answers it (JARVIS audit)
| Mentor point | AMPS today | Gap / next | Rubric weight |
|---|---|---|---|
| Layer 1: deterministic | Ask AMPS = Gemini function calling over our own SQL tools | — | Google AI 20% |
| Layer 1: RAG | Similar past failures = Gemini embeddings on remarks + log book | AlloyDB pgvector = scale-up (step 9, billing-gated) | Google AI 20% |
| Layer 1: OCR | Snap & Report: Gemini reads the photo | Name plate / meter reading as a Snap example | Product 30% |
| Layer 1: voice | Snap 🎤 (browser speech, bn-IN / en-IN) | Google-first: Speech-to-Text (Chirp) for Indic; Sarvam = option | UX 10% |
| Layer 1: smaller model | Gemini Flash-Lite | Gemma = self-host / economy fallback (slide, not build) | Arch 20% |
| Layer 2: predictive | BigQuery `amps_demo` + `asset_risk` view | **BigQuery ML boosted tree (XGBoost family)**: "fails in next 30 days" per asset, trained in SQL inside BigQuery, no separate ML server | Google AI 20% |
| Architecture + queue | App server + worker on one Postgres | Slide: Postgres queue → Redis → Kafka by scale | Arch 20% |
| Fewer clicks | QR → photo → one tap draft | Show the click count on a slide | UX 10% |
| Host on GCP | Cloud Run + AlloyDB kit in `deploy/gcp/` | Run when billing is on | Arch 20% |
| Acceptance | Demo Industries demo dataset at real-world scale | Pitch line: pilot operator acceptance, never named | Fit 15% |
