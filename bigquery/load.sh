#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Reload BigQuery amps_demo from a scripts/bq_export.py dump (already cleansed and
# typed against schemas/bigquery/), then build F2 failure_fields (Gemini via
# AI.GENERATE), F6 asset_risk (view) and F7 risk_model (BQML), then read back.
#
#   gcloud auth login            # once, an account with BigQuery on the project
#   bigquery/load.sh bq_out      # bq_out = folder written by scripts/bq_export.py
#   bigquery/load.sh --dry-run bq_out   # print every bq command, run nothing
#   bigquery/load.sh --check     # read-back only (counts, bands, samples), no reload
#   bigquery/load.sh --agent     # F4 agent's six questions (agent/questions.sql), no reload
#
# Cost guard (startup budget): loads are free; every query carries
# --maximum_bytes_billed (BQ_MAX_BYTES, default 1 GB) so a bad join fails instead
# of billing. BQ_AI=0 skips the Gemini step (178 flash-lite calls, well under $0.01);
# BQ_ML=0 skips the BQML model. Needs the gcloud SDK (bq).
set -euo pipefail
DRY=""
if [ "${1:-}" = "--dry-run" ]; then DRY=echo; shift; fi
P=${BQ_PROJECT:-gen-lang-client-0673220135}
DS=${BQ_DATASET:-amps_demo}
# BigQuery sandbox (no billing) refuses tables without an expiry under 60 days:
# default 59 days on the dataset. BQ_EXPIRY_S=0 keeps tables forever (billed project).
EXP=${BQ_EXPIRY_S:-5097600}
OUT=${1:-bq_out}
HERE=$(cd "$(dirname "$0")" && pwd)
SCHEMAS="$HERE/../schemas/bigquery"
MAXB=${BQ_MAX_BYTES:-1000000000}
bq="$DRY bq --project_id=$P"
q="$bq query --use_legacy_sql=false --maximum_bytes_billed=$MAXB"
# time-series tables are partitioned by day; the rest clustered on what the agent filters by
declare -A PART=([failures]=1 [log_entries]=1 [iot_readings]=1 [work_orders]=1)
declare -A CLUS=([failures]=station,asset_class [log_entries]=type,station [iot_readings]=asset_code,metric
                 [work_orders]=status,station [assets]=line,asset_class [pm_schedules]=station)

READ="$HERE/check.sql"
[ "$OUT" = "--agent" ] && READ="$HERE/agent/questions.sql"
if [ "$OUT" != "--check" ] && [ "$OUT" != "--agent" ]; then
[ -f "$OUT/_quality.json" ] || { echo "no $OUT/_quality.json: export with scripts/bq_export.py first" >&2; exit 1; }
$bq show "$DS" >/dev/null 2>&1 || $bq mk --location us-central1 --dataset "$DS"
if [ "$EXP" != 0 ]; then
  $bq update --default_table_expiration "$EXP" --default_partition_expiration "$EXP" "$DS"
fi
for f in "$OUT"/[!_]*.json; do
  t=$(basename "$f" .json)
  [ -f "$SCHEMAS/$t.json" ] || { echo "no schema for $t" >&2; exit 1; }
  opts=()
  [ -n "${PART[$t]:-}" ] && opts+=(--time_partitioning_type=DAY --time_partitioning_field=event_date)
  [ -n "${CLUS[$t]:-}" ] && opts+=(--clustering_fields="${CLUS[$t]}")
  # --replace keeps no old partitioning: drop first so a spec change always lands
  $bq rm -f -t "$DS.$t" >/dev/null 2>&1 || true
  $bq load --source_format=NEWLINE_DELIMITED_JSON --schema="$SCHEMAS/$t.json" "${opts[@]}" "$DS.$t" "$f"
done
steps=(asset_risk)
[ "${BQ_AI:-1}" != 0 ] && steps=(failure_fields "${steps[@]}")
[ "${BQ_ML:-1}" != 0 ] && steps+=(risk_model)
for s in "${steps[@]}"; do
  if [ -n "$DRY" ]; then echo "${q#echo } < $s.sql"; else sed "s/amps_demo\./$DS./g" "$HERE/$s.sql" | $q; fi
done
fi
[ -n "$DRY" ] && exit 0
# check.sql (or questions.sql) holds several SELECTs: run them one by one so each prints its table
grep -v '^--' "$READ" | sed "s/amps_demo\./$DS./g" |
  while IFS= read -r -d ';' q; do
    [ -n "${q//[[:space:]]/}" ] && $bq query --use_legacy_sql=false --maximum_bytes_billed="$MAXB" --format=pretty "$q"
  done
