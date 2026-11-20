-- SPDX-License-Identifier: MIT
-- F7 failure_risk_model (AI layer 2, learns over time): BigQuery ML logistic regression
-- that scores P(an asset fails in the next 30 days). It sits beside the hand-calibrated
-- asset_risk view (F6), which stays the explainable badge; this is the learned one.
--
-- Training rows = one per asset per month-start snapshot, built only from what was
-- known on that day (no look-ahead):
--   failures_90d, failures_365d, open_at_snap, downtime_365d_h, age_years,
--   past_codal_life, criticality, asset_class, line
-- Label = the asset logged a failure in the 30 days after the snapshot.
--
-- Why the first run (20 Nov 14:01) evaluated degenerate: the snapshots ended at
-- CURRENT_DATE, so the newest months had no future yet and the eval split had no
-- positives. Here the window is anchored on the last failure in the data (not today),
-- the final 30 days are held out of training, rare positives get AUTO_CLASS_WEIGHTS,
-- and the split is a fixed time cut (latest 20% of months = eval), so the evaluation is
-- "trained on the past, scored on the future".
--
-- Cost: a few MB scanned (assets x months); training on this size is pennies.
CREATE OR REPLACE TABLE amps_demo.risk_snapshots AS
WITH bounds AS (
  SELECT DATE_TRUNC(MIN(event_date), MONTH) AS first_m,
         DATE_SUB(MAX(event_date), INTERVAL 30 DAY) AS last_snap
  FROM amps_demo.failures
),
snaps AS (
  SELECT d AS snap FROM bounds,
  UNNEST(GENERATE_DATE_ARRAY(DATE_ADD(first_m, INTERVAL 3 MONTH), last_snap, INTERVAL 1 MONTH)) AS d
),
a AS (
  SELECT id AS asset_id, asset_class, line, criticality, commissioned_on, codal_life_years
  FROM amps_demo.assets
)
SELECT
  s.snap, a.asset_id,
  IFNULL(a.asset_class, 'unknown') AS asset_class,
  IFNULL(a.line, 'unknown') AS line,
  IFNULL(a.criticality, 'unknown') AS criticality,
  COUNTIF(f.event_date > DATE_SUB(s.snap, INTERVAL 90 DAY) AND f.event_date <= s.snap) AS failures_90d,
  COUNTIF(f.event_date > DATE_SUB(s.snap, INTERVAL 365 DAY) AND f.event_date <= s.snap) AS failures_365d,
  COUNTIF(f.event_date <= s.snap
          AND (f.recovered_at IS NULL OR DATE(f.recovered_at) > s.snap)) AS open_at_snap,
  ROUND(SUM(IF(f.event_date > DATE_SUB(s.snap, INTERVAL 365 DAY) AND f.event_date <= s.snap,
               IFNULL(f.downtime_hours, 0), 0)), 1) AS downtime_365d_h,
  IFNULL(DATE_DIFF(s.snap, a.commissioned_on, DAY) / 365.25, -1) AS age_years,
  IF(a.codal_life_years IS NOT NULL AND a.commissioned_on IS NOT NULL
     AND DATE_DIFF(s.snap, a.commissioned_on, DAY) / 365.25 > a.codal_life_years, 1, 0) AS past_codal_life,
  COUNTIF(f.event_date > s.snap AND f.event_date <= DATE_ADD(s.snap, INTERVAL 30 DAY)) > 0 AS fails_next_30d
FROM snaps AS s
CROSS JOIN a
LEFT JOIN amps_demo.failures AS f
  ON f.asset_id = a.asset_id AND f.event_date <= DATE_ADD(s.snap, INTERVAL 30 DAY)
GROUP BY s.snap, a.asset_id, a.asset_class, a.line, a.criticality, a.commissioned_on, a.codal_life_years;

CREATE OR REPLACE MODEL amps_demo.failure_risk_model
OPTIONS (
  model_type = 'LOGISTIC_REG',
  input_label_cols = ['fails_next_30d'],
  auto_class_weights = TRUE,
  data_split_method = 'SEQ',
  data_split_col = 'snap',
  data_split_eval_fraction = 0.2,
  enable_global_explain = TRUE
) AS
SELECT * EXCEPT (asset_id) FROM amps_demo.risk_snapshots;

-- Today's score per asset, for the app / dashboard (same features, snapshot = today).
CREATE OR REPLACE VIEW amps_demo.asset_risk_ml AS
WITH a AS (SELECT * FROM amps_demo.assets),
t AS (SELECT CURRENT_DATE('Asia/Kolkata') AS snap)
SELECT p.asset_id, a.asset_code, a.asset_name, a.station,
       ROUND((SELECT prob FROM UNNEST(p.predicted_fails_next_30d_probs) WHERE label), 3) AS p_fail_30d
FROM ML.PREDICT(MODEL amps_demo.failure_risk_model, (
  SELECT a.id AS asset_id,
         IFNULL(a.asset_class, 'unknown') AS asset_class, IFNULL(a.line, 'unknown') AS line,
         IFNULL(a.criticality, 'unknown') AS criticality,
         COUNTIF(f.event_date > DATE_SUB(t.snap, INTERVAL 90 DAY)) AS failures_90d,
         COUNTIF(f.event_date > DATE_SUB(t.snap, INTERVAL 365 DAY)) AS failures_365d,
         COUNTIF(f.state != 'rectified') AS open_at_snap,
         ROUND(SUM(IF(f.event_date > DATE_SUB(t.snap, INTERVAL 365 DAY), IFNULL(f.downtime_hours, 0), 0)), 1)
           AS downtime_365d_h,
         IFNULL(DATE_DIFF(t.snap, a.commissioned_on, DAY) / 365.25, -1) AS age_years,
         IF(a.codal_life_years IS NOT NULL AND a.commissioned_on IS NOT NULL
            AND DATE_DIFF(t.snap, a.commissioned_on, DAY) / 365.25 > a.codal_life_years, 1, 0) AS past_codal_life
  FROM a CROSS JOIN t LEFT JOIN amps_demo.failures AS f ON f.asset_id = a.id
  GROUP BY a.id, a.asset_class, a.line, a.criticality, a.commissioned_on, a.codal_life_years, t.snap
)) AS p
JOIN a ON a.id = p.asset_id;
