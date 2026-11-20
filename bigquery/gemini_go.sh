#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Turn on Gemini in BigQuery + the Vertex AI provider, the minute billing is on.
#
#   bigquery/gemini_go.sh --dry   # read-only: what is ready, what blocks; creates NOTHING
#   bigquery/gemini_go.sh         # do it (refuses while billing is off)
#
# What the real run does, in order (each step is safe to re-run):
#   1. the --dry checks; stops unless billing is on
#   2. enables aiplatform + bigqueryconnection APIs
#   3. creates CLOUD_RESOURCE connection $BQ_CONN if missing, grants its service
#      account roles/aiplatform.user
#   4. remote model amps_demo.gemini          (remote_model.sql)
#   5. failure_fields    via AI.GENERATE      (failure_fields.sql, caller's credentials)
#      failure_fields_ml via ML.GENERATE_TEXT (failure_fields_ml.sql, the remote model)
#   6. asset_risk view + load.sh --check read-back
#   7. scripts/vertex_check.py --live (2 tiny calls) and the deploy/.env lines for the app
# Needs the gcloud SDK (gcloud, bq) signed in as an account that owns the project.
# Fictional Demo Industries seed data only.
set -uo pipefail
P=${BQ_PROJECT:-gen-lang-client-0618042629}
DS=${BQ_DATASET:-amps_demo}
LOC=${BQ_LOCATION:-us-central1}
CONN=${BQ_CONN:-amps_vertex}
MODEL=${BQ_GEMINI_MODEL:-gemini-3.5-flash-lite}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1
bq="bq --project_id=$P --location=$LOC"
fail=0
row() { printf '%-4s %-26s %s\n' "$1" "$2" "$3"; }
ok() { row ok "$1" "$2"; }
no() { row "--" "$1" "$2"; fail=1; }
sql() { sed -e "s/amps_demo\./$DS./g" -e "s/@CONN@/$P.$LOC.$CONN/g" -e "s/@MODEL@/$MODEL/g" "$HERE/$1"; }

echo "== Gemini in BigQuery + Vertex AI — project $P, dataset $DS ($LOC), model $MODEL"
command -v gcloud >/dev/null && command -v bq >/dev/null || { no "gcloud SDK" "gcloud / bq not on PATH"; exit 1; }
acct=$(gcloud config get-value account 2>/dev/null)
[ -n "$acct" ] && ok "signed in" "$acct" || no "signed in" "run: gcloud auth login"
billing=$(gcloud billing projects describe "$P" --format='value(billingEnabled)' 2>/dev/null)
[ "$billing" = "True" ] && ok "billing" "on ($(gcloud billing projects describe "$P" --format='value(billingAccountName)' 2>/dev/null))" \
  || no "billing" "OFF — link a billing account to $P (console ▸ Billing), then re-run"
apis=$(gcloud services list --enabled --project "$P" --format='value(config.name)' 2>/dev/null)
for a in bigquery.googleapis.com aiplatform.googleapis.com bigqueryconnection.googleapis.com; do
  grep -qx "$a" <<<"$apis" && ok "api" "$a" || row ".." "api" "$a — the real run enables it"
done
n=$($bq query --use_legacy_sql=false --format=csv "SELECT COUNT(*) FROM $DS.failures" 2>/dev/null | tail -1)
[[ "$n" =~ ^[0-9]+$ ]] && ok "dataset" "$DS.failures = $n rows" || no "dataset" "$DS.failures missing — run bigquery/load.sh bq_out first"
if $bq show --connection "$P.$LOC.$CONN" >/dev/null 2>&1; then ok "connection" "$LOC.$CONN"
else row ".." "connection" "$LOC.$CONN — the real run creates it"; fi
# dry-run = BigQuery parses + plans the SQL, runs nothing, bills nothing
for s in failure_fields asset_risk; do
  if err=$(sql $s.sql | $bq query --use_legacy_sql=false --dry_run 2>&1); then ok "sql dry-run" "$s.sql"
  else row "!!" "sql dry-run" "$s.sql: $(tr '\n' ' ' <<<"$err" | cut -c1-160)"; fi
done
row ".." "sql (after step 4)" "remote_model.sql, failure_fields_ml.sql need the connection/model first"
if command -v python3 >/dev/null; then
  AMPS_AI_PROVIDER=vertex AMPS_VERTEX_PROJECT=$P AMPS_GEMINI_MODEL=$MODEL python3 "$ROOT/scripts/vertex_check.py" | sed 's/^/     vertex: /'
  [ "${PIPESTATUS[0]}" = 0 ] && ok "vertex adapter" "dry check passed" || no "vertex adapter" "see the lines above"
else row ".." "vertex adapter" "python3 not on PATH — skipped"; fi

if [ $DRY = 1 ]; then
  [ $fail = 0 ] && echo "== DRY: READY — run bigquery/gemini_go.sh" || echo "== DRY: NOT READY — fix the -- rows, then re-run --dry"
  exit $fail
fi
[ $fail = 0 ] || { echo "== stopped: fix the -- rows first (nothing was created)"; exit 1; }

set -e
echo "== 2 APIs"; gcloud services enable aiplatform.googleapis.com bigqueryconnection.googleapis.com --project "$P"
echo "== 3 connection"
$bq show --connection "$P.$LOC.$CONN" >/dev/null 2>&1 || $bq mk --connection --connection_type=CLOUD_RESOURCE "$CONN"
sa=$($bq show --format=json --connection "$P.$LOC.$CONN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["cloudResource"]["serviceAccountId"])')
gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$sa" --role=roles/aiplatform.user --condition=None --quiet >/dev/null
echo "   $sa → roles/aiplatform.user"
echo "== 4 remote model $DS.gemini"
for i in 1 2 3 4 5 6; do   # a fresh IAM grant takes a minute or two to reach Vertex AI
  sql remote_model.sql | $bq query --use_legacy_sql=false && break
  [ $i = 6 ] && exit 1; echo "   waiting for the IAM grant ($i/6)…"; sleep 30
done
echo "== 5 failure_fields (AI.GENERATE) + failure_fields_ml (ML.GENERATE_TEXT)"
sql failure_fields.sql | $bq query --use_legacy_sql=false
sql failure_fields_ml.sql | $bq query --use_legacy_sql=false
$bq query --use_legacy_sql=false --format=pretty \
  "SELECT 'AI.GENERATE' AS path, COUNT(*) AS n, COUNTIF(ai_status = '') AS ok FROM $DS.failure_fields
   UNION ALL SELECT 'ML.GENERATE_TEXT', COUNT(*), COUNTIF(ai_status = '') FROM $DS.failure_fields_ml"
echo "== 6 asset_risk + read-back"
sql asset_risk.sql | $bq query --use_legacy_sql=false
BQ_PROJECT=$P BQ_DATASET=$DS "$HERE/load.sh" --check
echo "== 7 Vertex AI provider (live, 2 tiny calls)"
AMPS_AI_PROVIDER=vertex AMPS_VERTEX_PROJECT=$P AMPS_GEMINI_MODEL=$MODEL python3 "$ROOT/scripts/vertex_check.py" --live ||
  echo "   (BigQuery steps above are done; fix the line above, then re-run scripts/vertex_check.py --live)"
cat <<EOT
== DONE. Switch the app to Vertex AI — deploy/.env:
     AMPS_AI_PROVIDER=vertex
     AMPS_VERTEX_PROJECT=$P
   then: docker compose -f deploy/compose.yaml -f deploy/compose.demo.yaml -f deploy/compose.vertex.yaml up -d
   (back to the AI Studio key: AMPS_AI_PROVIDER=gemini, drop the vertex overlay)
EOT
