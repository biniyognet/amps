# AMPS on Google Cloud (buildathon)

The full AMPS stack on Google Cloud, seeded with fictional Demo Industries data. The binihost copy (amps.binihost.com, k3s) is not touched.

| Piece | Google Cloud product | Notes |
|---|---|---|
| Database | **AlloyDB for PostgreSQL** (cluster `amps`, primary `amps-primary`, 2 vCPU) | Private IP only, via private services access on VPC `amps-vpc` |
| API + MCP | **Cloud Run** service `amps-api` | FastAPI image; Direct VPC egress to AlloyDB; `/mcp` on (`AMPS_MCP_HTTP=1`) |
| Web | **Cloud Run** service `amps-web` | Vite SPA in nginx; `/api`, `/mcp`, `/docs`, `/health` proxied to amps-api |
| Seed | **Cloud Run job** `amps-seed` | `python seed.py`, `AMPS_SEED=network`; it seeds an empty DB only, so it is safe to re-run |
| Images | **Artifact Registry** `asia-south1-docker.pkg.dev/<project>/amps` | Cloud Run cannot pull from ghcr |
| Secrets | **Secret Manager** | `amps-db-pass`, `amps-db-url`, `amps-admin-pass`, `amps-gemini-key` (generated or read from file, never printed) |
| AI | **Gemini API** (`gemini-3.5-flash-lite`) | Key from `deploy/.env` → secret; without it the AI features stay off |
| Analytics | **BigQuery** dataset `amps_demo` | floki's `bigquery/load.sh` (F2/F6), run separately |

## Run

```bash
gcloud auth login            # once, as the account that owns the project (on a headless box: --no-browser)
gcloud config set project gen-lang-client-0618042629
deploy/gcp/gcp.sh all        # or one step at a time: apis network alloydb image seed deploy check
```

Each step is safe to re-run. Overrides go in the environment: `GCP_PROJECT`, `GCP_REGION` (asia-south1), `ALLOYDB_CPU` (2), `ALLOYDB_TRIAL=1` (AlloyDB free-trial cluster), `TAG`.

Allow about 20 minutes on the first run. Most of it is AlloyDB: the cluster plus the primary take about 10–15 minutes.

Admin login for the hosted copy: user `admin`, with the password stored in Secret Manager (it is never admin/admin, because the URL is public). To read it on your own terminal:
`gcloud secrets versions access latest --secret=amps-admin-pass`

## Move the laptop data into AlloyDB (pgvector)

To host the laptop's grown data instead of a fresh seed, copy it across, then add pgvector:

```bash
python3 deploy/gcp/alloydb/migrate.py \
    --source postgresql://amps:amps_dev_only@<laptop>:5432/amps \
    --target postgresql://postgres:<pass>@<alloydb-ip>:5432/amps
```

| Step | What it does |
|---|---|
| schema | The app's own tables on the target (`create_all` + its column migrations) |
| copy | Every table, parents first, `COPY` source → target, `failure_embeddings` included; the source is read only |
| seq | Serial sequences moved past the copied ids |
| vector | `pgvector.sql`: `embedding vector(768)` column, a trigger that mirrors the app's float32 bytes into it, backfill, HNSW cosine index, `amps_similar_failures(entry_id, k)` |
| verify | Row counts per table; every 768-d embedding indexed; SQL top-5 equals the app's Python dot-product top-5 |

A non-empty target is refused unless `--force` (it TRUNCATEs the target first). The app needs no change: it keeps writing the bytes and the trigger keeps the vector column in step.

Rehearse with no Google Cloud at all: `deploy/gcp/alloydb/test_local.sh` (postgres:16 source + pgvector/pgvector:pg16 target in throwaway containers).

## Cost (billed to the GDP Event Credit)

| Item | Rough cost |
|---|---|
| AlloyDB primary, 2 vCPU / 16 GB | ≈ $0.33/h, runs 24/7. **This is the main cost.** `ALLOYDB_TRIAL=1` makes it free for 30 days. |
| Cloud Run ×2 + job | Scales to zero; pennies for a demo |
| Artifact Registry, Secret Manager, BigQuery | Under $1 for the event |

Tear it down after judging: `deploy/gcp/gcp.sh down`

## What to show judges

1. The `amps-web` run.app URL: the same AMPS UI, now on Cloud Run with data in AlloyDB.
2. Cloud console ▸ AlloyDB ▸ `amps`: the Postgres that holds 1,800+ Demo Industries assets and their failure history.
3. Cloud console ▸ Cloud Run: `amps-api` / `amps-web` scale from zero; `amps-seed` is the one-shot seed job.
4. `<web>/mcp`: the AMPS MCP tools, which an agent such as Gemini CLI can call against the hosted data.
5. BigQuery `amps_demo`: failure fields and asset risk (floki's F2/F6 SQL).

## Rollback

`deploy/gcp/gcp.sh down` deletes the services, the job, the AlloyDB cluster, the registry, the secrets, the peering, and the VPC, in that order. Nothing outside this project changes.
