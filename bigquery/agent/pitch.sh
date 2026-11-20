#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# F4 pitch fallback: the three pitch questions (Q1 red risk, Q3 failures by site and
# month, Q4 open failures by station) answered from the same verified SQL as the agent
# (agent/questions.sql), in the BigQuery sandbox, with no data agent needed.
#
#   bigquery/agent/pitch.sh              # writes pitch_out/: q1/q3/q4 .sql + .json + pitch.html
#   bigquery/agent/pitch.sh my_dir       # another output folder
#   PITCH_RENDER_ONLY=1 bigquery/agent/pitch.sh pitch_out   # re-render saved .json, no bq
#
# Then open pitch_out/pitch.html (one screen per question, screenshot-ready).
# Needs the gcloud SDK (bq) and python3. Plain SQL only, read only. Fictional seed data.
set -euo pipefail
P=${BQ_PROJECT:-gen-lang-client-0618042629}
DS=${BQ_DATASET:-amps_demo}
OUT=${1:-pitch_out}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"

for n in 1 3 4; do
  # the "-- Qn" block from questions.sql, as is (title line kept for the page)
  awk -v q="Q$n" '/^-- Q[0-9]/ { on = ($2 == q) } on' "$HERE/questions.sql" |
    sed "s/amps_demo\./$DS./g" > "$OUT/q$n.sql"
  [ -s "$OUT/q$n.sql" ] || { echo "Q$n not found in questions.sql" >&2; exit 1; }
  [ "${PITCH_RENDER_ONLY:-0}" = 1 ] && continue
  sql=$(grep -v '^--' "$OUT/q$n.sql" | sed 's/;[[:space:]]*$//')
  echo "== $(head -1 "$OUT/q$n.sql" | sed 's/^-- //')"
  bq --project_id="$P" query --use_legacy_sql=false --format=json --max_rows=1000 "$sql" > "$OUT/q$n.json"
done

python3 "$HERE/pitch_render.py" "$OUT"
