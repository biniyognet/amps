#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# Restore a demo_db_backup.sh dump into the demo/stage AMPS database. Takes a fresh safety
# backup first, then replaces the DB contents (pg_restore --clean) and restarts the backend.
#
#   scripts/demo_db_restore.sh ~/amps-backups/amps-buildathon-amps-<stamp>.dump --yes
set -euo pipefail
DUMP=${1:?usage: demo_db_restore.sh <file.dump> --yes}
[ "${2:-}" = "--yes" ] || { echo "replaces the DB contents: add --yes" >&2; exit 2; }
[ -s "$DUMP" ] || { echo "no such dump: $DUMP" >&2; exit 1; }
PROJECT=${AMPS_PROJECT:-amps-buildathon}
DB=${AMPS_DB:-amps}
HERE=$(cd "$(dirname "$0")" && pwd)
echo "safety backup: $("$HERE/demo_db_backup.sh")"
docker compose -p "$PROJECT" exec -T db pg_restore -U amps -d "$DB" --clean --if-exists \
  --no-owner --single-transaction < "$DUMP"
docker compose -p "$PROJECT" restart backend >/dev/null 2>&1 || true
echo "restored $DUMP into $PROJECT/$DB:"
docker compose -p "$PROJECT" exec -T db psql -U amps -d "$DB" -Atc \
  "SELECT 'assets='||count(*) FROM assets UNION ALL SELECT 'log_entries='||count(*) FROM log_entries"
