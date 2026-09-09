# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""AMPS API — v0.3: DB-backed, audited, history-preserving, with a digital shift logbook."""
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (assets, auth, checksheets, correspondence, failures,
                     logbook, maintenance, qr, roster)
from app.db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    auth.ensure_admin()
    yield


app = FastAPI(
    title="AMPS — Asset Maintenance & Preventive Scheduling",
    description="Open-source maintenance management for electrical & industrial assets.",
    version="0.3.0",
    contact={"name": "Arup Biswas"},
    license_info={"name": "MIT"},
    lifespan=lifespan,
)

# Browsers block cross-origin API calls without this. Same-origin deploys are
# unaffected; split-host deploys (frontend and API on different hostnames, as
# the public demo runs) set AMPS_CORS_ORIGINS to a comma-separated allow-list.
# Default "*" is fine while the API is an unauthenticated read/demo surface —
# revisit when auth lands.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("AMPS_CORS_ORIGINS", "*").split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Access model (AMPS_AUTH=1): READS are open — the QR-scan / walk-up surface
# shows every line's asset lists view-only. WRITES require a session and are
# scoped to the user's line; each endpoint enforces this via current_user.
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(assets.router, prefix="/api/assets", tags=["assets"])
app.include_router(assets.lines_router, prefix="/api/lines", tags=["assets"])
app.include_router(maintenance.router, prefix="/api/maintenance", tags=["maintenance"])
app.include_router(qr.router, prefix="/api/qr", tags=["qr"])
app.include_router(roster.router, prefix="/api/roster", tags=["roster"])
app.include_router(logbook.router, prefix="/api/logbook", tags=["logbook"])
app.include_router(failures.router, prefix="/api/failures", tags=["failures"])
app.include_router(checksheets.router, prefix="/api/checksheets", tags=["checksheets"])
app.include_router(correspondence.router, prefix="/api/correspondence", tags=["correspondence"])


@app.get("/")
def root():
    return {"app": "AMPS", "version": "0.3.0", "status": "db-backed"}


@app.get("/health")
def health():
    """Liveness probe for hosting."""
    return {"status": "ok"}
