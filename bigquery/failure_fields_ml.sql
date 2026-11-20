-- SPDX-License-Identifier: MIT
-- F2 Fault fields, second path: the same extraction as failure_fields.sql, but
-- through the remote model (remote_model.sql) with ML.GENERATE_TEXT, so Gemini is
-- billed to the project's Vertex AI connection rather than the caller.
-- Gemini answers one JSON object per remark; JSON_VALUE turns it into columns.
-- Same columns as failure_fields, into failure_fields_ml; rows whose call failed keep ai_status.
CREATE OR REPLACE TABLE amps_demo.failure_fields_ml AS
WITH g AS (
  SELECT *
  FROM ML.GENERATE_TEXT(
    MODEL amps_demo.gemini,
    (
      SELECT
        f.id AS failure_id, f.asset_code, f.asset_name, f.asset_class, f.station, f.line,
        f.started_at, f.state, f.fault_type, f.description AS remark, f.action_taken,
        CONCAT(
          'You read failure remarks from a maintenance logbook. The remark may be in English, ',
          'Hindi, Bengali or lower-case shorthand. Answer in short plain English, at most 8 words ',
          'per field. Use null when the text does not say it; never guess.\n',
          'component = the part that failed (e.g. "DE mechanical seal").\n',
          'symptom = what was seen or heard.\n',
          'reading = every measured value with its unit, as written (e.g. "OTI 92 °C, WTI 104 °C").\n',
          'cause = the cause the remark or the repair note names.\n',
          'action = the repair done (from the repair note), else the immediate action in the remark.\n',
          'language = en, hi, bn or mixed (the remark only).\n',
          'Reply with ONE JSON object with exactly these keys: ',
          'component, symptom, reading, cause, action, language. No other text.\n\n',
          'Asset: ', IFNULL(f.asset_name, '?'), ' (', IFNULL(f.asset_class, '?'), ')\n',
          'Fault type: ', IFNULL(f.fault_type, '-'), '\n',
          'Remark: ', IFNULL(f.description, ''), '\n',
          'Repair note: ', IFNULL(f.action_taken, 'none')) AS prompt
      FROM amps_demo.failures AS f
    ),
    STRUCT(0.0 AS temperature, 256 AS max_output_tokens, TRUE AS flatten_json_output)
  )
),
j AS (
  -- the model may wrap the object in a ```json fence: keep the outermost {...}
  SELECT g.*, REGEXP_EXTRACT(ml_generate_text_llm_result, r'(?s)\{.*\}') AS js FROM g
)
SELECT
  failure_id, asset_code, asset_name, asset_class, station, line, started_at, state,
  fault_type, remark, action_taken,
  JSON_VALUE(js, '$.component') AS component, JSON_VALUE(js, '$.symptom') AS symptom,
  JSON_VALUE(js, '$.reading') AS reading, JSON_VALUE(js, '$.cause') AS cause,
  JSON_VALUE(js, '$.action') AS action, JSON_VALUE(js, '$.language') AS language,
  IF(js IS NULL AND ml_generate_text_status = '', 'no JSON in reply', ml_generate_text_status) AS ai_status
FROM j;
