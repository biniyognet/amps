#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
"""Backfill failure embeddings for "Seen before" (buildathon F1).

    AMPS_AI_PROVIDER=gemini AMPS_GEMINI_API_KEY=... DATABASE_URL=... python scripts/embed_failures.py

Embeds every current failure entry that has no vector yet, or whose text or
model changed since, with gemini-embedding-001 (batches of 100). Safe to re-run:
a second run embeds nothing. The asset page also embeds lazily, so this is only
a pre-warm so the first view is instant. The API key is never printed.
"""
import argparse
import os
import sys

sys.path[:0] = [os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"), os.getcwd()]

from sqlalchemy import func, select  # noqa: E402

from app.api import similar  # noqa: E402
from app.api.auth import _OPEN_USER  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
from app.models import FailureEmbedding  # noqa: E402


def backfill(db) -> dict:
    heads = similar.failure_heads(db, _OPEN_USER)
    before = db.scalar(select(func.count()).select_from(FailureEmbedding))
    similar.ensure_vectors(db, heads)
    after = db.scalar(select(func.count()).select_from(FailureEmbedding))
    return {"failures": len(heads), "embedded_new": after - before, "vectors": after}


def main():
    argparse.ArgumentParser(description=__doc__.splitlines()[0]).parse_args()
    if not similar.embed_enabled():
        sys.exit("AI is off: set AMPS_AI_PROVIDER=gemini and AMPS_GEMINI_API_KEY (the panel still works on keywords).")
    init_db()
    with SessionLocal() as db:
        r = backfill(db)
    print(f"failures {r['failures']} · newly embedded {r['embedded_new']} · vectors stored {r['vectors']} "
          f"· model {similar.EMBED_MODEL} dim {similar.EMBED_DIM}")


if __name__ == "__main__":
    main()
