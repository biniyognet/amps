#!/usr/bin/env bash
# Rehearse the laptop -> AlloyDB migration on one box, no Google Cloud involved:
#   source = postgres:16 (what the laptop runs), seeded with Demo Industries + fake embeddings
#   target = pgvector/pgvector:pg16 (stand-in for AlloyDB, which ships pgvector)
# Both are throwaway containers on random ports, removed on exit. Needs docker + python3
# with backend/requirements.txt importable.
set -euo pipefail
cd "$(dirname "$0")/../../.."
PY=${PY:-python3}
SRC=amps-mig-src-$$ DST=amps-mig-dst-$$
trap 'docker rm -f $SRC $DST >/dev/null 2>&1 || true' EXIT

docker run -d --name $SRC -e POSTGRES_DB=amps -e POSTGRES_USER=amps -e POSTGRES_PASSWORD=t \
    -p 127.0.0.1::5432 postgres:16 >/dev/null
docker run -d --name $DST -e POSTGRES_DB=amps -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=t \
    -p 127.0.0.1::5432 pgvector/pgvector:pg16 >/dev/null
port() { docker port "$1" 5432/tcp | head -1 | cut -d: -f2; }
for c in $SRC $DST; do
    until docker exec $c pg_isready -q -U postgres -d amps 2>/dev/null || docker exec $c pg_isready -q -d amps; do sleep 1; done
done
sleep 2
S="postgresql://amps:t@127.0.0.1:$(port $SRC)/amps"
D="postgresql://postgres:t@127.0.0.1:$(port $DST)/amps"

echo "== seed source (network seed + fake 768-d embeddings)"
(cd backend && DATABASE_URL="postgresql+psycopg2://${S#postgresql://}" AMPS_SEED=network $PY seed.py >/dev/null)
DATABASE_URL="postgresql+psycopg2://${S#postgresql://}" $PY - <<'EOF'
import hashlib, math, os, sys
from array import array
sys.path.insert(0, "backend")
from app.db import SessionLocal
from app.models import FailureEmbedding, LogEntry, LogEntryType
with SessionLocal() as db:
    rows = db.query(LogEntry).filter(LogEntry.type == LogEntryType.FAILURE).all()
    for e in rows:
        v = [0.0] * 768
        for w in f"{e.fault_type} {e.category} {e.text}".lower().split():
            v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 768] += 1
        n = math.sqrt(sum(x * x for x in v)) or 1
        db.add(FailureEmbedding(entry_id=e.id, model="test-hash", text_sha="x" * 64, dim=768,
                                vector=array("f", [x / n for x in v]).tobytes()))
    db.commit()
    print(f"   {len(rows)} failure embeddings")
EOF

echo "== migrate"
$PY deploy/gcp/alloydb/migrate.py --source "$S" --target "$D"
echo "== re-run refuses a non-empty target"
if $PY deploy/gcp/alloydb/migrate.py --source "$S" --target "$D" >/dev/null 2>&1; then
    echo "FAIL: second run did not refuse"; exit 1; fi
echo "== --force re-run"
$PY deploy/gcp/alloydb/migrate.py --source "$S" --target "$D" --force | tail -3
echo "== trigger keeps a new app write in sync"
docker exec $DST psql -qtA -U postgres -d amps -c "
  UPDATE failure_embeddings SET vector = vector WHERE entry_id = (SELECT min(entry_id) FROM failure_embeddings);
  SELECT CASE WHEN count(*) = count(embedding) THEN 'sync ok' ELSE 'sync FAIL' END FROM failure_embeddings;"
