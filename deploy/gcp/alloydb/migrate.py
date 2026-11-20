#!/usr/bin/env python3
"""Copy the AMPS database from the laptop Postgres into AlloyDB, then add pgvector.

    python3 deploy/gcp/alloydb/migrate.py \\
        --source postgresql://amps:amps_dev_only@<laptop>:5432/amps \\
        --target postgresql://postgres:<pass>@<alloydb-ip>:5432/amps

Steps (each one printed):
  1. schema   the app's own tables on the target (create_all + its micro-migrations),
              so the target matches the code that will run on Cloud Run
  2. copy     every model table, parents before children, COPY source -> target,
              only the columns both sides have (failure_embeddings included)
  3. seq      serial sequences moved past the copied ids
  4. vector   pgvector.sql: extension, embedding column + sync trigger, backfill, HNSW
  5. verify   row counts per table, embeddings indexed, SQL top-5 == Python dot-product top-5

Read-only on the source. Refuses a non-empty target unless --force (which TRUNCATEs
the model tables on the target first). Needs psycopg2 + sqlalchemy (backend/requirements.txt).
"""
import argparse
import os
import sys
import tempfile
from array import array
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "backend"))

import psycopg2  # noqa: E402
from sqlalchemy import create_engine, inspect  # noqa: E402


def pg_dsn(url: str) -> str:
    """SQLAlchemy-style URL -> libpq URL (drop the +driver part)."""
    scheme, rest = url.split("://", 1)
    return "postgresql://" + rest if scheme.startswith("postgres") else url


def sa_url(url: str) -> str:
    return "postgresql+psycopg2://" + url.split("://", 1)[1]


def columns(cur, table: str) -> list[str]:
    cur.execute("SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = %s ORDER BY ordinal_position", (table,))
    return [r[0] for r in cur.fetchall()]


def count(cur, table: str) -> int:
    cur.execute(f'SELECT count(*) FROM "{table}"')
    return cur.fetchone()[0]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--source", required=True, help="laptop Postgres URL (read only)")
    ap.add_argument("--target", required=True, help="AlloyDB (or test) Postgres URL")
    ap.add_argument("--force", action="store_true", help="TRUNCATE a non-empty target first")
    ap.add_argument("--skip-vector", action="store_true", help="copy only, no pgvector step")
    a = ap.parse_args()

    # The app reads DATABASE_URL at import; point it at the target so nothing touches the source.
    os.environ["DATABASE_URL"] = sa_url(a.target)
    from app import models  # noqa: F401  (registers every table on Base)
    from app.db import Base, _migrate

    tengine = create_engine(sa_url(a.target))
    print("1/5 schema: create_all + additive migrations on target")
    Base.metadata.create_all(tengine)
    _migrate(tengine)
    tables = [t.name for t in Base.metadata.sorted_tables]

    src = psycopg2.connect(pg_dsn(a.source))
    src.set_session(readonly=True)
    dst = psycopg2.connect(pg_dsn(a.target))
    s, d = src.cursor(), dst.cursor()

    s.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
    src_tables = {r[0] for r in s.fetchall()}
    extra = sorted(src_tables - set(tables))
    if extra:
        print(f"   source-only tables, not copied: {', '.join(extra)}")

    busy = [t for t in tables if count(d, t)]
    if busy and not a.force:
        print(f"target not empty ({', '.join(busy[:5])}…): re-run with --force to TRUNCATE it", file=sys.stderr)
        return 2
    if busy:
        d.execute("TRUNCATE " + ", ".join(f'"{t}"' for t in tables) + " RESTART IDENTITY CASCADE")

    print("2/5 copy")
    copied = {}
    for t in tables:
        if t not in src_tables:
            print(f"   {t:<28} missing on source, left empty")
            continue
        sc, dc = columns(s, t), set(columns(d, t))
        cols = [c for c in sc if c in dc]
        dropped = [c for c in sc if c not in dc]
        collist = ", ".join(f'"{c}"' for c in cols)
        with tempfile.SpooledTemporaryFile(max_size=64 << 20) as buf:
            s.copy_expert(f'COPY (SELECT {collist} FROM "{t}") TO STDOUT', buf)
            buf.seek(0)
            d.copy_expert(f'COPY "{t}" ({collist}) FROM STDIN', buf)
        copied[t] = count(s, t)
        note = f"  (source-only cols skipped: {', '.join(dropped)})" if dropped else ""
        print(f"   {t:<28} {copied[t]:>7}{note}")

    print("3/5 sequences")
    d.execute("""SELECT table_name, column_name FROM information_schema.columns
                  WHERE table_schema = 'public' AND column_default LIKE 'nextval(%%'""")
    for t, c in d.fetchall():
        d.execute(f"""SELECT setval(pg_get_serial_sequence('"{t}"', '{c}'),
                                    COALESCE(MAX("{c}"), 1), MAX("{c}") IS NOT NULL) FROM "{t}" """)
    dst.commit()

    if not a.skip_vector:
        print("4/5 pgvector: extension, embedding column, sync trigger, backfill, HNSW")
        d.execute((HERE / "pgvector.sql").read_text())
        dst.commit()

    print("5/5 verify")
    bad = [(t, n, count(d, t)) for t, n in copied.items() if count(d, t) != n]
    for t, n, m in bad:
        print(f"   ✗ {t}: source {n} target {m}")
    if not a.skip_vector and "failure_embeddings" in copied:
        d.execute("SELECT count(*) FILTER (WHERE dim = 768), count(embedding) FROM failure_embeddings")
        want, got = d.fetchone()
        print(f"   embeddings dim 768: {want} · indexed: {got}")
        if want != got:
            bad.append(("failure_embeddings.embedding", want, got))
        if got:
            d.execute("SELECT entry_id FROM failure_embeddings WHERE embedding IS NOT NULL ORDER BY entry_id LIMIT 1")
            probe = d.fetchone()[0]
            d.execute("SET LOCAL hnsw.ef_search = 200")
            d.execute("SELECT entry_id FROM amps_similar_failures(%s, 5)", (probe,))
            sql_top = [r[0] for r in d.fetchall()]
            d.execute("SELECT entry_id, vector FROM failure_embeddings WHERE dim = 768")
            vecs = {i: array("f", bytes(v)) for i, v in d.fetchall()}
            q = vecs[probe]
            py_top = sorted((i for i in vecs if i != probe),
                            key=lambda i: -sum(x * y for x, y in zip(q, vecs[i])))[:5]
            ok = sql_top == py_top
            print(f"   top-5 for entry {probe}: SQL {sql_top} · Python {py_top} {'✓' if ok else '✗'}")
            if not ok:
                bad.append(("amps_similar_failures", py_top, sql_top))
            dst.rollback()
    print("OK: target matches source" if not bad else f"FAILED: {len(bad)} check(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
