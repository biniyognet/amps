# AMPS backend — FastAPI + uvicorn
# Build from the repository root:
#   docker build -f deploy/docker/backend.Dockerfile -t <registry>/amps-backend:<tag> .
#
# Demo mode: set AMPS_SEED_ON_START=1 to seed the database (synthetic data)
# at container start — intended for the zero-config SQLite fallback only.
# Production (DATABASE_URL → Postgres) seeds via the one-off Job in
# deploy/k8s/ instead, never on boot.
FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
# exporters the worker's bq.export job loads by path (app/jobs.py → /scripts)
COPY scripts/*.py /scripts/

EXPOSE 8000
CMD ["sh", "-c", "if [ \"$AMPS_SEED_ON_START\" = \"1\" ]; then python seed.py; fi; exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
