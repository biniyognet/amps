# Deck points — collected while building (compile + trim before submit)

Slide order follows the eval weights: product 30% · Google AI 20% · architecture 20% · UX 10% · new 5%.

| Slide | Point | Proof in the repo |
|---|---|---|
| Google AI | Two AI layers: L1 every click (RAG + rules + Gemini Flash-Lite + voice + OCR), L2 learns (BigQuery cleansing → BQML) | `#/ai`, `bigquery/` |
| Google AI | BQML failure-risk model: trained on the past, scored on the future (time split, class weights, no look-ahead) | `bigquery/risk_model.sql` |
| Google AI | Data quality first: real estate data cleansed and reshaped for BigQuery (typed, partitioned, `_quality.json` report) | cleanse export |
| Architecture | pgvector on Postgres today, AlloyDB at scale: same SQL, `pg_dump` move, no app change | `deploy/gcp/` |
| Architecture | Speed by design: gzip + Redis read-through cache on hot reads (risk 1.55 s → ms on a hit) + version-bump invalidation | `backend/app/cache.py` |
| Architecture | Split servers: api serves users, worker runs slow jobs off a Redis queue | `backend/app/worker.py`, `jobs.py` |
| Architecture | Event-driven: every write and every sensor breach is an event; screens update live over a websocket, no polling. Growth path in-process → Redis → Pub/Sub/Kafka | `app/events.py`, `/api/ws` |
| Product / new | ampsTalk: sensors, PLC gateways and meters talk to AMPS directly (HTTP or Pub/Sub push); an out-of-band reading files the failure itself | `backend/app/api/talk.py` |
| Hosting | Hybrid: on-prem Kubernetes home at a fixed cost + Google for AI, data and edge + Cloud Run scale-to-zero burst/DR; moves to GKE/AlloyDB with no code change | NOTES §8b |
| Economy | Flash-Lite for every click, BQ scans in MB, Cloud Run $0 idle; the whole build ran inside a $5 budget | NOTES §5 |
| Proof | In daily use at Kolkata Metro (decision B, 20 Nov) | — |
