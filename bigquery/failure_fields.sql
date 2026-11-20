-- SPDX-License-Identifier: MIT
-- F2 Fault fields: Gemini reads each free-text failure remark (English, हिन्दी, বাংলা,
-- lower-case shorthand) and returns columns you can count:
-- component · symptom · reading · cause · action (+ the remark's language).
--
-- Gemini is called from SQL with AI.GENERATE + output_schema (BigQuery's structured
-- extraction; no connection needed, it runs on the caller's Google credentials).
-- One call per failure (178 on the demo seed). Rows whose call failed keep ai_status.
CREATE OR REPLACE TABLE amps_demo.failure_fields AS
WITH g AS (
  SELECT
    f.id AS failure_id, f.asset_code, f.asset_name, f.asset_class, f.station, f.line,
    f.started_at, f.state, f.fault_type, f.description AS remark, f.action_taken,
    AI.GENERATE(
      CONCAT(
        'You read failure remarks from a maintenance logbook. The remark may be in English, ',
        'Hindi, Bengali or lower-case shorthand. Answer in short plain English, at most 8 words ',
        'per field. Use null when the text does not say it; never guess.\n',
        'component = the part that failed (e.g. "DE mechanical seal").\n',
        'symptom = what was seen or heard.\n',
        'reading = every measured value with its unit, as written (e.g. "OTI 92 °C, WTI 104 °C").\n',
        'cause = the cause the remark or the repair note names.\n',
        'action = the repair done (from the repair note), else the immediate action in the remark.\n',
        'language = en, hi, bn or mixed (the remark only).\n\n',
        'Asset: ', IFNULL(f.asset_name, '?'), ' (', IFNULL(f.asset_class, '?'), ')\n',
        'Fault type: ', IFNULL(f.fault_type, '-'), '\n',
        'Remark: ', IFNULL(f.description, ''), '\n',
        'Repair note: ', IFNULL(f.action_taken, 'none')),
      endpoint => 'gemini-3.5-flash-lite',
      output_schema => 'component STRING, symptom STRING, reading STRING, cause STRING, action STRING, language STRING'
    ) AS x
  FROM amps_demo.failures AS f
)
SELECT
  failure_id, asset_code, asset_name, asset_class, station, line, started_at, state,
  fault_type, remark, action_taken,
  x.component, x.symptom, x.reading, x.cause, x.action, x.language,
  x.status AS ai_status
FROM g;
