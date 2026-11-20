#!/usr/bin/env bash
# AMPS buildathon on Google Cloud: AlloyDB (Postgres + vector) + Cloud Run (api, web, seed job).
# Fictional Demo Industries seed only. Nothing on binihost (amps.binihost.com, k3s) is touched.
#
#   deploy/gcp/gcp.sh <step>      run from the repository root, after `gcloud auth login`
#
# Steps, in order (each is safe to re-run):
#   apis      enable the Google APIs (billed project: GDP Event Credit)
#   network   own VPC + subnet + private services access for AlloyDB
#   alloydb   AlloyDB cluster + primary instance; DB password and DATABASE_URL into Secret Manager
#   image     Artifact Registry repo; build + push backend and frontend images
#   seed      Cloud Run job: create tables + Demo Industries network seed (empty DB only)
#   deploy    Cloud Run services amps-api (VPC egress to AlloyDB) and amps-web (SPA + /api proxy)
#   check     health, index, AI status, MCP tool count through the public web URL
#   all       apis → check
#   down      delete everything this script created (rollback)
#
# Secrets are never printed: they go from a generator straight into Secret Manager.
set -euo pipefail

P=${GCP_PROJECT:-gen-lang-client-0618042629}
R=${GCP_REGION:-asia-south1}
NET=amps-vpc; SUB=amps-sub; SUB_RANGE=10.20.0.0/24; PSA=amps-psa
CLUSTER=amps; INSTANCE=amps-primary; CPU=${ALLOYDB_CPU:-2}
TRIAL=${ALLOYDB_TRIAL:-0}            # 1 = AlloyDB free-trial cluster (one per project)
AR=$R-docker.pkg.dev/$P/amps
TAG=${TAG:-$(git rev-parse --short HEAD)}
API=amps-api; WEB=amps-web; JOB=amps-seed
ORG="Demo Industries Group"; LINE="Metro Traction & Depot"
MODEL=${AMPS_GEMINI_MODEL:-gemini-3.5-flash-lite}
g() { gcloud --project="$P" --quiet "$@"; }
secret_put() {  # name; value on stdin. Creates the secret or adds a version.
  if g secrets describe "$1" >/dev/null 2>&1; then g secrets versions add "$1" --data-file=- >/dev/null
  else g secrets create "$1" --replication-policy=automatic --data-file=- >/dev/null; fi
}
has_secret() { g secrets describe "$1" >/dev/null 2>&1; }
vpc_flags=(--network="$NET" --subnet="$SUB" --vpc-egress=private-ranges-only)

step_apis() {
  g services enable run.googleapis.com artifactregistry.googleapis.com alloydb.googleapis.com \
    servicenetworking.googleapis.com compute.googleapis.com secretmanager.googleapis.com
}

step_network() {
  g compute networks describe "$NET" >/dev/null 2>&1 || g compute networks create "$NET" --subnet-mode=custom
  g compute networks subnets describe "$SUB" --region="$R" >/dev/null 2>&1 ||
    g compute networks subnets create "$SUB" --network="$NET" --region="$R" --range="$SUB_RANGE"
  g compute addresses describe "$PSA" --global >/dev/null 2>&1 ||
    g compute addresses create "$PSA" --global --purpose=VPC_PEERING --prefix-length=20 --network="$NET"
  g services vpc-peerings connect --service=servicenetworking.googleapis.com --ranges="$PSA" --network="$NET" ||
    g services vpc-peerings update --service=servicenetworking.googleapis.com --ranges="$PSA" --network="$NET" --force
}

step_alloydb() {
  if ! has_secret amps-db-pass; then
    python3 -c 'import secrets;print(secrets.token_urlsafe(24),end="")' | secret_put amps-db-pass
  fi
  if ! g alloydb clusters describe "$CLUSTER" --region="$R" >/dev/null 2>&1; then
    local sub=(); if [ "$TRIAL" = 1 ]; then sub=(--subscription-type=TRIAL); fi
    # password via a short-lived env var, never echoed
    PGPW=$(g secrets versions access latest --secret=amps-db-pass)
    g alloydb clusters create "$CLUSTER" --region="$R" --network="$NET" --password="$PGPW" "${sub[@]}"
    unset PGPW
  fi
  g alloydb instances describe "$INSTANCE" --cluster="$CLUSTER" --region="$R" >/dev/null 2>&1 ||
    g alloydb instances create "$INSTANCE" --cluster="$CLUSTER" --region="$R" \
      --instance-type=PRIMARY --cpu-count="$CPU"
  local ip; ip=$(g alloydb instances describe "$INSTANCE" --cluster="$CLUSTER" --region="$R" --format='value(ipAddress)')
  # DATABASE_URL = postgres superuser on the default db (demo only); built inside python, never echoed
  g secrets versions access latest --secret=amps-db-pass |
    IP="$ip" python3 -c 'import os,sys,urllib.parse as u;print(f"postgresql+psycopg2://postgres:{u.quote(sys.stdin.read(),safe="")}@{os.environ["IP"]}:5432/postgres",end="")' |
    secret_put amps-db-url
  # Gemini key: from deploy/.env if present (git-ignored), else leave AI off
  if ! has_secret amps-gemini-key && [ -f deploy/.env ] && grep -q '^AMPS_GEMINI_API_KEY=.' deploy/.env; then
    grep '^AMPS_GEMINI_API_KEY=' deploy/.env | head -1 | cut -d= -f2- | tr -d '\r\n"' | secret_put amps-gemini-key
  fi
  # an admin password for the hosted copy (not admin/admin: Cloud Run is public)
  has_secret amps-admin-pass ||
    python3 -c 'import secrets;print(secrets.token_urlsafe(12),end="")' | secret_put amps-admin-pass
  # Cloud Run's runtime service account reads the secrets
  local sa; sa="$(g projects describe "$P" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
  for s in amps-db-url amps-admin-pass amps-gemini-key; do
    if has_secret "$s"; then g secrets add-iam-policy-binding "$s" --member="serviceAccount:$sa" \
      --role=roles/secretmanager.secretAccessor >/dev/null; fi
  done
  echo "alloydb ok: $CLUSTER/$INSTANCE private IP $ip"
}

step_image() {
  g artifacts repositories describe amps --location="$R" >/dev/null 2>&1 ||
    g artifacts repositories create amps --repository-format=docker --location="$R"
  gcloud auth configure-docker "$R-docker.pkg.dev" -q >/dev/null
  docker build -f deploy/docker/backend.Dockerfile -t "$AR/amps-backend:$TAG" .
  docker build -f deploy/gcp/frontend.cloudrun.Dockerfile --build-arg AMPS_ORG="$ORG" -t "$AR/amps-frontend:$TAG" .
  docker push "$AR/amps-backend:$TAG"; docker push "$AR/amps-frontend:$TAG"
}

api_env="^|^AMPS_AUTH=1|AMPS_SEED=network|AMPS_ORG=$ORG|AMPS_STANDARD_LINE=$LINE|AMPS_AI_PROVIDER=gemini|AMPS_GEMINI_MODEL=$MODEL"
api_secrets() {
  local s="DATABASE_URL=amps-db-url:latest,AMPS_ADMIN_PASSWORD=amps-admin-pass:latest"
  if has_secret amps-gemini-key; then s="$s,AMPS_GEMINI_API_KEY=amps-gemini-key:latest"; fi
  echo "$s"
}

step_seed() {
  g run jobs deploy "$JOB" --region="$R" --image="$AR/amps-backend:$TAG" --command=python --args=seed.py \
    --set-env-vars="$api_env" --set-secrets="$(api_secrets)" "${vpc_flags[@]}" \
    --memory=1Gi --cpu=1 --task-timeout=900 --max-retries=0
  g run jobs execute "$JOB" --region="$R" --wait
}

step_deploy() {
  g run deploy "$API" --region="$R" --image="$AR/amps-backend:$TAG" --port=8000 --allow-unauthenticated \
    --set-env-vars="$api_env|AMPS_MCP_HTTP=1" --set-secrets="$(api_secrets)" "${vpc_flags[@]}" \
    --min-instances=0 --max-instances=2 --memory=1Gi --cpu=1 --cpu-boost --timeout=120
  local url host; url=$(g run services describe "$API" --region="$R" --format='value(status.url)'); host=${url#https://}
  g run deploy "$WEB" --region="$R" --image="$AR/amps-frontend:$TAG" --allow-unauthenticated \
    --set-env-vars="BACKEND_URL=$url,BACKEND_HOST=$host" \
    --min-instances=0 --max-instances=2 --memory=256Mi --cpu=1
  echo "web: $(g run services describe "$WEB" --region="$R" --format='value(status.url)')"
}

step_check() {
  local web; web=$(g run services describe "$WEB" --region="$R" --format='value(status.url)')
  echo "web  $web"
  echo "health     $(curl -s -o /dev/null -w '%{http_code}' "$web/health")"
  echo "index      $(curl -s -o /dev/null -w '%{http_code}' "$web/")"
  echo "ai status  $(curl -s "$web/api/ai/status" | head -c 200)"
  echo "mcp tools  $(curl -s -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$web/mcp" | grep -o '"name":"[a-z_]*"' | wc -l)"
}

step_down() {
  g run services delete "$WEB" --region="$R" || true
  g run services delete "$API" --region="$R" || true
  g run jobs delete "$JOB" --region="$R" || true
  g alloydb clusters delete "$CLUSTER" --region="$R" --force || true
  g artifacts repositories delete amps --location="$R" || true
  for s in amps-db-url amps-db-pass amps-admin-pass amps-gemini-key; do g secrets delete "$s" || true; done
  g services vpc-peerings delete --service=servicenetworking.googleapis.com --network="$NET" || true
  g compute addresses delete "$PSA" --global || true
  g compute networks subnets delete "$SUB" --region="$R" || true
  g compute networks delete "$NET" || true
}

case "${1:-}" in
  apis|network|alloydb|image|seed|deploy|check|down) "step_$1" ;;
  all) for s in apis network alloydb image seed deploy check; do echo "== $s"; "step_$s"; done ;;
  *) sed -n '2,19p' "$0"; exit 2 ;;
esac
