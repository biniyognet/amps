#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Reload BigQuery amps_demo from a scripts/bq_export.py dump, then build
# F2 failure_fields (Gemini via AI.GENERATE) and F6 asset_risk (view), then read back.
#
#   gcloud auth login        # once, an account with BigQuery on the project
#   bigquery/load.sh bq_out  # bq_out = folder written by scripts/bq_export.py
#   bigquery/load.sh --check # read-back only (counts, bands, samples), no reload
#   bigquery/load.sh --agent # F4 agent's six questions (agent/questions.sql), no reload
#
# Needs the gcloud SDK (bq). Fictional Demo Industries seed data only.
set -euo pipefail
P=${BQ_PROJECT:-gen-lang-client-0618042629}
DS=${BQ_DATASET:-amps_demo}
# BigQuery sandbox (no billing) refuses tables without an expiry under 60 days:
# default 59 days on the dataset. BQ_EXPIRY_S=0 keeps tables forever (billed project).
EXP=${BQ_EXPIRY_S:-5097600}
OUT=${1:-bq_out}
HERE=$(cd "$(dirname "$0")" && pwd)
bq="bq --project_id=$P"

READ="$HERE/check.sql"
[ "$OUT" = "--agent" ] && READ="$HERE/agent/questions.sql"
if [ "$OUT" != "--check" ] && [ "$OUT" != "--agent" ]; then
$bq show "$DS" >/dev/null 2>&1 || $bq mk --location us-central1 --dataset "$DS"
if [ "$EXP" != 0 ]; then
  $bq update --default_table_expiration "$EXP" --default_partition_expiration "$EXP" "$DS"
fi
for f in "$OUT"/*.json; do
  $bq load --replace --autodetect --source_format=NEWLINE_DELIMITED_JSON "$DS.$(basename "$f" .json)" "$f"
done
for s in failure_fields asset_risk; do
  sed "s/amps_demo\./$DS./g" "$HERE/$s.sql" | $bq query --use_legacy_sql=false
done
fi
# check.sql (or questions.sql) holds several SELECTs: run them one by one so each prints its table
grep -v '^--' "$READ" | sed "s/amps_demo\./$DS./g" |
  while IFS= read -r -d ';' q; do
    [ -n "${q//[[:space:]]/}" ] && $bq query --use_legacy_sql=false --format=pretty "$q"
  done
