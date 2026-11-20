# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Seen before — similar past failures and what fixed them (buildathon F1).

Every failure remark (fault type + equipment category + the technician's text)
is embedded once with gemini-embedding-001 and kept in `failure_embeddings`.
For an asset's current failure, the panel ranks earlier RECTIFIED failures
anywhere in the user's scope by cosine similarity and shows the top few with
the action that closed them — so the crew reads what worked last time before
they open the panel. Multilingual by design: a Hindi remark finds an English one.

pgvector is the startup default: on a Postgres with the `vector` extension
(app/sql/pgvector.sql, applied by init_db) a trigger mirrors each stored vector
into `embedding vector(768)` and the database ranks by cosine (`<=>`, HNSW).
The same SQL moves unchanged to AlloyDB when the estate outgrows one box
(deploy/gcp/alloydb/migrate.py). Without the extension the vectors stay
unit-length float32 bytes and the ranking is a dot product in Python.

Without a Gemini key (or when the embedding call fails) the panel still answers,
from word overlap, and says so (`mode: "keyword"`). The key is read from
AMPS_GEMINI_API_KEY through app.api.ai and is never logged or returned.
With AMPS_AI_PROVIDER=vertex the same model runs on Vertex AI (`:predict`, one
text per call there) under the project's Google credentials.
With AMPS_EMBED_PROVIDER=ollama the vectors come from EmbeddingGemma on the
plant's own Ollama (AMPS_EMBED_URL / AMPS_EMBED_MODEL): same 768 dims, no key.
The model name is part of each row's text hash, so switching provider re-embeds.
"""
import hashlib
import json
import math
import os
import re
import urllib.request
from array import array
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import bindparam, select, text
from sqlalchemy.orm import Session

from app.api import ai, vertex
from app.api.assets import visible_asset
from app.api.auth import optional_user, scope_location_ids
from app.api.logbook import _down_hours, _drop_superseded, _recovery_map
from app import db as dbmod
from app.db import get_db
from app.models import Asset, FailureEmbedding, LogEntry, LogEntryType

router = APIRouter()

# AMPS_EMBED_PROVIDER=ollama keeps search on-prem: EmbeddingGemma (768-dim, 100+
# languages) served by our own Ollama, no key, no quota, remarks never leave the plant.
EMBED_PROVIDER = os.environ.get("AMPS_EMBED_PROVIDER", "").strip().lower()
EMBED_URL = os.environ.get("AMPS_EMBED_URL", "http://ollama:11434").rstrip("/")
EMBED_MODEL = (os.environ.get("AMPS_EMBED_MODEL", "embeddinggemma") if EMBED_PROVIDER == "ollama"
               else os.environ.get("AMPS_GEMINI_EMBED_MODEL", "gemini-embedding-001"))
EMBED_DIM = int(os.environ.get("AMPS_GEMINI_EMBED_DIM", "768"))   # MRL: 768 of 3072 is plenty
# EmbeddingGemma is trained with task prompts; a failure remark is compared with
# other remarks (symmetric), so every text carries the document prompt
GEMMA_DOC = "title: none | text: "
BATCH = 100        # batchEmbedContents takes up to 100 texts per call
LAZY_CAP = 300     # texts a single page view may embed; the backfill script does the rest
MIN_SCORE = 0.35   # below this a "match" is noise — show fewer rather than wrong
# Vertex serves gemini-embedding-001 regionally; us-central1 sits next to the BigQuery dataset
VERTEX_EMBED_LOCATION = os.environ.get("AMPS_VERTEX_EMBED_LOCATION", "us-central1")


def failure_text(e: LogEntry) -> str:
    """What gets embedded: the symptom side only (not the fix), so a new failure
    with no action yet is comparable with old ones."""
    return " · ".join(s.strip() for s in (e.fault_type, e.category, e.text) if s and s.strip())


def _sha(text: str) -> str:
    return hashlib.sha256(f"{EMBED_MODEL}:{EMBED_DIM}:{text}".encode()).hexdigest()


def _unit(v):
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def embed_enabled() -> bool:
    return EMBED_PROVIDER == "ollama" or ai.gemini_on()


def _embed_ollama(texts: list[str]) -> list[list[float]]:
    """Ollama /api/embed — EmbeddingGemma on our own GPU, BATCH texts per call."""
    out = []
    for i in range(0, len(texts), BATCH):
        chunk = texts[i:i + BATCH]
        r = ai._post(f"{EMBED_URL}/api/embed",
                     {"model": EMBED_MODEL, "input": [GEMMA_DOC + t for t in chunk]}, {})
        vecs = r["embeddings"]
        if len(vecs) != len(chunk):
            raise ValueError("embedding count mismatch")
        out.extend(vecs)
    return out


def _embed_vertex(texts: list[str]) -> list[list[float]]:
    """Vertex AI :predict — gemini-embedding-001 takes one instance per request."""
    url = vertex.model_url(EMBED_MODEL, "predict", VERTEX_EMBED_LOCATION)
    out = []
    for t in texts:
        r = ai._post(url, {"instances": [{"content": t, "task_type": "SEMANTIC_SIMILARITY"}],
                           "parameters": {"outputDimensionality": EMBED_DIM}}, vertex.headers())
        out.append(r["predictions"][0]["embeddings"]["values"])
    return out


def _embed(texts: list[str]) -> list[list[float]]:
    """Gemini batchEmbedContents → one vector per text, same order."""
    if EMBED_PROVIDER == "ollama":
        return _embed_ollama(texts)
    if ai.PROVIDER == "vertex":
        return _embed_vertex(texts)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{EMBED_MODEL}:batchEmbedContents"
    out = []
    for i in range(0, len(texts), BATCH):
        chunk = texts[i:i + BATCH]
        req = urllib.request.Request(url, data=json.dumps({"requests": [
            {"model": f"models/{EMBED_MODEL}", "content": {"parts": [{"text": t}]},
             "taskType": "SEMANTIC_SIMILARITY", "outputDimensionality": EMBED_DIM} for t in chunk]}).encode(),
            headers={"Content-Type": "application/json", "x-goog-api-key": ai.GEMINI_KEY})
        with urllib.request.urlopen(req, timeout=ai.TIMEOUT) as r:
            vecs = [e["values"] for e in json.loads(r.read())["embeddings"]]
        if len(vecs) != len(chunk):
            raise ValueError("embedding count mismatch")
        out.extend(vecs)
    return out


def ensure_vectors(db: Session, entries: list[LogEntry], cap: int | None = None) -> dict[int, list[float]]:
    """entry id → unit vector, embedding (and storing) the ones that are missing or
    stale. `cap` bounds how many new texts one call may embed (None = all)."""
    have = {r.entry_id: r for r in db.scalars(select(FailureEmbedding).where(
        FailureEmbedding.entry_id.in_([e.id for e in entries] or [-1])))}
    out, todo = {}, []
    for e in entries:
        text = failure_text(e)
        if not text:
            continue
        row = have.get(e.id)
        if row and row.text_sha == _sha(text):
            out[e.id] = list(array("f", row.vector))
        else:
            todo.append((e, text))
    if cap is not None:
        todo = todo[:cap]
    if todo:
        vecs = _embed([t for _, t in todo])
        for (e, text), v in zip(todo, vecs):
            v = _unit(v)
            blob = array("f", v).tobytes()
            row = have.get(e.id)
            if row:
                row.model, row.text_sha, row.dim, row.vector = EMBED_MODEL, _sha(text), len(v), blob
            else:
                db.add(FailureEmbedding(entry_id=e.id, model=EMBED_MODEL, text_sha=_sha(text),
                                        dim=len(v), vector=blob))
            out[e.id] = v
        db.commit()
    return out


_WORD = re.compile(r"\w+", re.UNICODE)
_STOP = {"the", "and", "on", "at", "of", "to", "in", "a", "an", "is", "was", "for", "from", "with",
         "by", "no", "not", "after", "this", "that", "it", "as", "be", "again", "found", "1", "2"}


def _bag(text: str) -> Counter:
    return Counter(w for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 1)


def _keyword_score(a: Counter, b: Counter) -> float:
    dot = sum(n * b[w] for w, n in a.items() if w in b)
    na, nb = math.sqrt(sum(n * n for n in a.values())), math.sqrt(sum(n * n for n in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def failure_heads(db: Session, user) -> list[LogEntry]:
    """Current (not superseded, not retracted) failure entries in the user's scope."""
    q = select(LogEntry).where(LogEntry.type == LogEntryType.FAILURE, LogEntry.retracted.is_not(True))
    scope = scope_location_ids(db, user)
    if scope is not None:
        q = q.join(Asset, LogEntry.asset_id == Asset.id).where(Asset.location_id.in_(scope))
    return _drop_superseded(db, list(db.scalars(q)))


def _item(e: LogEntry, fix: LogEntry, score: float) -> dict:
    return {"failure_id": e.id, "score": round(score, 3),
            "asset_code": e.asset.code if e.asset else None,
            "asset_name": e.asset.name if e.asset else None,
            "station": e.station, "started_at": e.at, "fault_type": e.fault_type,
            "description": e.text, "fix": fix.action_taken or fix.text,
            "fixed_at": fix.at, "attended_by": fix.attended_by,
            "downtime_hrs": _down_hours(e, fix.at)}


def _pg_rank(db: Session, query_id: int, ids: list[int]):
    """(entry_id, cosine) for the candidates, ranked by pgvector; None when the
    extension is off or a row is not mirrored yet (then Python ranks them)."""
    if not dbmod.PGVECTOR or not ids:
        return None
    rows = db.execute(text(
        "SELECT f.entry_id, 1 - (f.embedding <=> q.embedding) FROM failure_embeddings f,"
        " (SELECT embedding FROM failure_embeddings WHERE entry_id = :q) q"
        " WHERE f.entry_id IN :ids AND f.embedding IS NOT NULL AND q.embedding IS NOT NULL"
        " ORDER BY f.embedding <=> q.embedding").bindparams(bindparam("ids", expanding=True)),
        {"q": query_id, "ids": ids}).all()
    return [(r[0], float(r[1])) for r in rows] if len(rows) == len(ids) else None


@router.get("")
def similar_failures(asset_code: str, failure_id: int | None = None, k: int = 3,
                     db: Session = Depends(get_db), user=Depends(optional_user)):
    """Top-k earlier, rectified failures most like this asset's failure.

    The query failure is `failure_id`, else the asset's newest OPEN failure, else
    its newest failure. Open to the QR walk-up viewer like the asset's own log
    (one asset per call); candidates stay inside the caller's scope."""
    asset = visible_asset(db, asset_code, user)
    k = max(1, min(k, 10))
    heads = failure_heads(db, user)
    rec = _recovery_map(db, heads)
    mine = sorted((e for e in heads if e.asset_id == asset.id), key=lambda e: (e.at, e.id), reverse=True)
    if failure_id is not None:
        query = next((e for e in mine if e.id == failure_id), None)
        if query is None:
            raise HTTPException(404, "failure not found on this asset")
    else:
        query = next((e for e in mine if e.id not in rec and not e.ended_at), None) or (mine[0] if mine else None)
    base = {"asset_code": asset.code, "query": None, "matches": [], "mode": None, "model": None}
    if query is None or not failure_text(query):
        return base
    base["query"] = {"failure_id": query.id, "started_at": query.at, "fault_type": query.fault_type,
                     "description": query.text, "open": query.id not in rec and not query.ended_at}
    cands = [e for e in heads if e.id != query.id and e.id in rec
             and (e.at, e.id) < (query.at, query.id) and failure_text(e)]
    scored, mode = None, "keyword"
    if embed_enabled():
        try:
            vecs = ensure_vectors(db, [query, *cands], cap=LAZY_CAP)
            qv = vecs.get(query.id)
            if qv is not None:
                ranked = _pg_rank(db, query.id, [e.id for e in cands if e.id in vecs])
                if ranked is not None:
                    by_id = {e.id: e for e in cands}
                    scored = [(s, by_id[i]) for i, s in ranked]
                else:
                    scored = [(sum(a * b for a, b in zip(qv, vecs[e.id])), e) for e in cands if e.id in vecs]
                mode = "embedding"
        except Exception:   # quota / network / bad reply: keyword ranking, never a 500
            db.rollback()
            scored = None
    if scored is None:
        qb = _bag(failure_text(query))
        scored = [(_keyword_score(qb, _bag(failure_text(e))), e) for e in cands]
        floor = 0.1
    else:
        floor = MIN_SCORE
    scored.sort(key=lambda t: (-t[0], -t[1].at.timestamp()))
    base["matches"] = [_item(e, rec[e.id], s) for s, e in scored if s >= floor][:k]
    base["mode"], base["model"] = mode, EMBED_MODEL if mode == "embedding" else None
    base["onprem"] = mode == "embedding" and EMBED_PROVIDER == "ollama"
    base["engine"] = ("pgvector" if dbmod.PGVECTOR else "python") if mode == "embedding" else None
    return base
