#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# Back up the demo/stage AMPS database (compose project amps-buildathon) to a custom-format
# pg_dump OUTSIDE the repo. Read-only on the DB. Prints the file it wrote.
#
#   scripts/demo_db_backup.sh                 # → ~/amps-backups/amps-buildathon-amps-<stamp>.dump
#   AMPS_PROJECT=amps AMPS_DB=amps scripts/demo_db_backup.sh
set -euo pipefail
PROJECT=${AMPS_PROJECT:-amps-buildathon}
DB=${AMPS_DB:-amps}
DIR=${AMPS_BACKUP_DIR:-$HOME/amps-backups}
mkdir -p "$DIR"
if git -C "$DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "refusing: $DIR is inside a git work tree" >&2; exit 2
fi
OUT="$DIR/$PROJECT-$DB-$(date +%Y%m%d-%H%M%S).dump"
docker compose -p "$PROJECT" exec -T db pg_dump -U amps -d "$DB" -Fc > "$OUT.part"
[ -s "$OUT.part" ] || { rm -f "$OUT.part"; echo "empty dump" >&2; exit 1; }
mv "$OUT.part" "$OUT"
# sanity: the archive lists the assets table
docker compose -p "$PROJECT" exec -T db pg_restore -l < "$OUT" | grep -q "TABLE DATA public assets" \
  || { echo "dump has no assets table data: $OUT" >&2; exit 1; }
echo "$OUT"
