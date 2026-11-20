-- SPDX-License-Identifier: MIT
-- F4 Estate agent: the six questions it answers, each with its verified SQL.
-- Paste each pair into BigQuery → Agents → AMPS Estate Agent → Verified queries,
-- or run them one by one to read the reference answer (`bigquery/load.sh --agent`).
-- Plain SQL only (no AI.* functions), so the BigQuery sandbox runs every one.
-- Dates go through SAFE.PARSE_DATE('%F', SUBSTR(CAST(.. AS STRING), 1, 10)) so the SQL works whatever type
-- autodetect gave the column; "last N days/months" counts back from the latest
-- failure in the data, not from today (GEMINI.md rule 3).

-- Q1 Which assets are at red risk, and why?
SELECT asset_code, asset_name, station, line, score, ARRAY_TO_STRING(why, ' · ') AS why
FROM amps_demo.asset_risk
WHERE band = 'red'
ORDER BY score DESC, asset_code;

-- Q2 Which 5 assets failed most in the last 12 months?
WITH f AS (
  SELECT asset_code, asset_name, station, fault_type,
         SAFE.PARSE_DATE('%F', SUBSTR(CAST(started_at AS STRING), 1, 10)) AS day
  FROM amps_demo.failures
)
SELECT asset_code, asset_name, station, COUNT(*) AS failures,
       COUNT(DISTINCT fault_type) AS fault_types
FROM f
WHERE day > DATE_SUB((SELECT MAX(day) FROM f), INTERVAL 12 MONTH)
GROUP BY asset_code, asset_name, station
ORDER BY failures DESC, asset_code
LIMIT 5;

-- Q3 Failures by site and month (chart).
SELECT FORMAT_DATE('%Y-%m', SAFE.PARSE_DATE('%F', SUBSTR(CAST(started_at AS STRING), 1, 10))) AS month,
       line AS site, COUNT(*) AS failures
FROM amps_demo.failures
GROUP BY month, site
ORDER BY month, site;

-- Q4 How many failures are still open, by station?
SELECT line AS site, station, COUNT(*) AS open_failures,
       COUNTIF(state = 'open') AS not_seen_yet,
       COUNTIF(state = 'acknowledged') AS acknowledged,
       COUNTIF(state = 'job_card') AS job_card_raised
FROM amps_demo.failures
WHERE state != 'rectified'
GROUP BY site, station
ORDER BY open_failures DESC, station;

-- Q5 Which asset class takes longest to fix (MTTR)?
SELECT asset_class, COUNT(*) AS failures,
       COUNTIF(downtime_hours IS NOT NULL) AS fixed,
       COUNTIF(downtime_hours IS NULL) AS left_out_not_fixed,
       ROUND(AVG(downtime_hours), 1) AS mttr_hours
FROM amps_demo.failures
GROUP BY asset_class
HAVING COUNTIF(downtime_hours IS NOT NULL) >= 2
ORDER BY mttr_hours DESC
LIMIT 5;

-- Q6 Per site: preventive maintenance done vs failures in the last 90 days (logbook).
WITH l AS (
  SELECT line, type, SAFE.PARSE_DATE('%F', SUBSTR(CAST(log_date AS STRING), 1, 10)) AS day
  FROM amps_demo.log_entries
  WHERE line IS NOT NULL
)
SELECT line AS site,
       COUNTIF(type = 'maintenance') AS pm_done,
       COUNTIF(type = 'failure') AS failures,
       ROUND(SAFE_DIVIDE(COUNTIF(type = 'maintenance'), COUNTIF(type = 'failure')), 1) AS pm_per_failure
FROM l
WHERE day > DATE_SUB((SELECT MAX(day) FROM l), INTERVAL 90 DAY)
GROUP BY site
ORDER BY pm_per_failure;
