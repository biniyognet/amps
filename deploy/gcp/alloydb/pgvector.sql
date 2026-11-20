-- AMPS on AlloyDB: pgvector for "Seen before" (buildathon F1).
--
-- Additive and safe to re-run. The app keeps writing failure_embeddings.vector
-- (unit-length float32 bytes, see backend/app/api/similar.py); a trigger mirrors
-- every write into a real pgvector column, so the database can rank failures
-- itself (HNSW cosine index) without an app change. Works the same on AlloyDB
-- and on plain Postgres 16 + pgvector (how deploy/gcp/alloydb/test_local.sh tests it).

CREATE EXTENSION IF NOT EXISTS vector;

-- 768 = AMPS_GEMINI_EMBED_DIM default (gemini-embedding-001, MRL-truncated).
-- A row embedded at another dim keeps embedding NULL and is simply not indexed.
ALTER TABLE failure_embeddings ADD COLUMN IF NOT EXISTS embedding vector(768);

-- float32 little-endian bytes -> vector. Plain PL/pgSQL (AlloyDB has no plpython).
CREATE OR REPLACE FUNCTION amps_f32_to_vector(b bytea, want_dim int DEFAULT 768)
RETURNS vector LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
    n int := length(b) / 4;
    out real[] := '{}';
    bits bigint; e int; m bigint; v float8; o int;
BEGIN
    IF length(b) % 4 <> 0 OR n <> want_dim THEN
        RETURN NULL;
    END IF;
    FOR i IN 0 .. n - 1 LOOP
        o := i * 4;
        bits := get_byte(b, o)::bigint
              | (get_byte(b, o + 1)::bigint << 8)
              | (get_byte(b, o + 2)::bigint << 16)
              | (get_byte(b, o + 3)::bigint << 24);
        e := ((bits >> 23) & 255)::int;
        m := bits & 8388607;
        IF e = 255 THEN
            RETURN NULL;                       -- NaN / inf: not a usable embedding
        ELSIF e = 0 THEN
            v := m * 2.0 ^ (-149);             -- subnormal
        ELSE
            v := (1 + m / 8388608.0) * 2.0 ^ (e - 127);
        END IF;
        IF (bits >> 31) & 1 = 1 THEN
            v := -v;
        END IF;
        out := out || v::real;
    END LOOP;
    RETURN out::vector;
END $$;

CREATE OR REPLACE FUNCTION amps_failure_embedding_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.embedding := amps_f32_to_vector(NEW.vector, 768);
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS failure_embeddings_sync ON failure_embeddings;
CREATE TRIGGER failure_embeddings_sync
    BEFORE INSERT OR UPDATE OF vector ON failure_embeddings
    FOR EACH ROW EXECUTE FUNCTION amps_failure_embedding_sync();

-- Backfill rows that arrived before the trigger (the migration's COPY, or an old DB).
UPDATE failure_embeddings SET embedding = amps_f32_to_vector(vector, 768)
 WHERE embedding IS NULL AND dim = 768;

-- Cosine HNSW. On AlloyDB, ScaNN is the alternative at larger scale:
--   CREATE EXTENSION IF NOT EXISTS alloydb_scann;
--   CREATE INDEX failure_embeddings_scann ON failure_embeddings
--       USING scann (embedding cosine) WITH (num_leaves = 50);
-- (ScaNN wants a few thousand rows before it builds; HNSW has no minimum.)
CREATE INDEX IF NOT EXISTS failure_embeddings_hnsw
    ON failure_embeddings USING hnsw (embedding vector_cosine_ops);

-- Top-k nearest failures to one logbook entry, in SQL. score = cosine similarity.
-- The app's scope and "rectified only" rules stay in similar.py; this is the raw ranking.
CREATE OR REPLACE FUNCTION amps_similar_failures(p_entry_id int, p_k int DEFAULT 5)
RETURNS TABLE (entry_id int, score float8) LANGUAGE sql STABLE AS $$
    SELECT f.entry_id, 1 - (f.embedding <=> q.embedding)
      FROM failure_embeddings f,
           (SELECT embedding FROM failure_embeddings WHERE entry_id = p_entry_id) q
     WHERE f.entry_id <> p_entry_id AND f.embedding IS NOT NULL
     ORDER BY f.embedding <=> q.embedding
     LIMIT p_k
$$;

-- AlloyDB extra (optional, needs google_ml_integration + Vertex AI access):
-- embed straight from SQL instead of the app's Gemini REST call, e.g.
--   SELECT embedding('gemini-embedding-001', 'seal leak on pump motor')::vector;
