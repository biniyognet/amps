# AMPS on Google Cloud (buildathon)

The full AMPS stack on Google Cloud, seeded with fictional Demo Industries data. The binihost copy (amps.binihost.com, k3s) is not touched.

**Startup first, scale later.** AMPS runs on plain Postgres 16 + pgvector today (laptop, binihost, or any managed Postgres), so a young maintenance team pays for compute it uses and nothing else. When the estate outgrows it, the same database moves to AlloyDB with one script and no app change.

| Piece | Startup (default, `AMPS_GCP_DB=postgres`) | Scale (`AMPS_GCP_DB=alloydb`) |
|---|---|---|
| Database | **Postgres 16 + pgvector** you already run (`pgvector/pgvector:pg16`); URL into Secret Manager via `dburl` | **AlloyDB for PostgreSQL** (cluster `amps`, 2 vCPU), private IP on VPC `amps-vpc` |
| "Seen before" search | pgvector HNSW cosine index, ranked in SQL (`backend/app/sql/pgvector.sql`, applied by `init_db`) | the same SQL; ScaNN index available |
| API + MCP | **Cloud Run** `amps-api`, scales to zero, `/mcp` on | same, with Direct VPC egress |
| Web | **Cloud Run** `amps-web` (SPA in nginx, proxies `/api` `/mcp` `/docs` `/health`) | same |
| Seed | **Cloud Run job** `amps-seed` (empty DB only) | same |
| Images · Secrets | **Artifact Registry** · **Secret Manager** (`amps-db-url`, `amps-admin-pass`, `amps-gemini-key`; never printed) | + `amps-db-pass` |
| AI | **Gemini API** (`gemini-3.5-flash-lite`) | same, or Vertex AI |
| Analytics | **BigQuery** `amps_demo`: cleansed NDJSON, explicit schemas, partitioned + clustered, BQML risk model (`bigquery/load.sh`) | same |

## Run

```bash
gcloud auth login            # once, as the account that owns the project (on a headless box: --no-browser)
gcloud config set project gen-lang-client-0618042629
bvault get amps/GCP_DB_URL | deploy/gcp/gcp.sh dburl   # startup: point Cloud Run at your Postgres + pgvector
deploy/gcp/gcp.sh all        # apis dburl image seed deploy check   (AMPS_GCP_DB=alloydb: apis network alloydb image seed deploy check)
```

Each step is safe to re-run. Overrides go in the environment: `AMPS_GCP_DB` (postgres | alloydb), `GCP_PROJECT`, `GCP_REGION` (asia-south1), `ALLOYDB_CPU` (2), `ALLOYDB_TRIAL=1` (AlloyDB free-trial cluster), `TAG`.

The startup path takes about 5 minutes (image build + Cloud Run). The AlloyDB path adds 10–15 minutes for the cluster and primary.

Admin login for the hosted copy: user `admin`, with the password stored in Secret Manager (it is never admin/admin, because the URL is public). To read it on your own terminal:
`gcloud secrets versions access latest --secret=amps-admin-pass`

## Scale up: Postgres + pgvector → AlloyDB, hassle free

Same Postgres wire protocol, same SQL, same `pgvector.sql`. Copy the data across and the app keeps running unchanged:
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
| vector | `backend/app/sql/pgvector.sql` (the file `init_db` already applies at startup): `embedding vector(768)` column, a trigger that mirrors the app's float32 bytes into it, backfill, HNSW cosine index, `amps_similar_failures(entry_id, k)` |
| verify | Row counts per table; every 768-d embedding indexed; SQL top-5 equals the app's Python dot-product top-5 |

A non-empty target is refused unless `--force` (it TRUNCATEs the target first). The app needs no change: it keeps writing the bytes and the trigger keeps the vector column in step.

Rehearse with no Google Cloud at all: `deploy/gcp/alloydb/test_local.sh` (postgres:16 source + pgvector/pgvector:pg16 target in throwaway containers).

## Cost (budget: $5 event credit + ₹5,000)

| Item | Rough cost |
|---|---|
| Postgres + pgvector (startup) | $0 on Google Cloud: the DB runs where the team already runs it |
| Cloud Run ×2 + job | Scales to zero; pennies for a demo |
| Artifact Registry, Secret Manager | Cents |
| BigQuery | Loads are free; every query has a `maximum_bytes_billed` cap (`load.sh` `MAXB`); BQML training on this size is pennies |
| AlloyDB primary, 2 vCPU / 16 GB (scale only) | ≈ $0.33/h (≈ $8/day): **not run during the buildathon**. `ALLOYDB_TRIAL=1` makes it free for 30 days when the time comes |

Tear it down after judging: `deploy/gcp/gcp.sh down`

## What to show judges

1. The `amps-web` run.app URL: the same AMPS UI, now on Cloud Run, on Postgres + pgvector.
2. "Seen before" on any failure: the response says `engine: pgvector` (ranked in SQL by the HNSW index).
3. The scale story: `alloydb/test_local.sh` proves the copy to AlloyDB-compatible Postgres keeps the same top-5.
4. Cloud console ▸ Cloud Run: `amps-api` / `amps-web` scale from zero; `amps-seed` is the one-shot seed job.
5. `<web>/mcp`: the AMPS MCP tools, which an agent such as Gemini CLI can call against the hosted data.
6. BigQuery `amps_demo`: cleansed tables + `_quality.json`, failure fields, asset risk, and the BQML `failure_risk_model`.

## Rollback

`deploy/gcp/gcp.sh down` deletes the services, the job, the registry and the secrets; with `AMPS_GCP_DB=alloydb` also the cluster, the peering and the VPC. Nothing outside this project changes.
