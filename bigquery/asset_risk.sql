-- SPDX-License-Identifier: MIT
-- F6 Risk badge: one row per asset, red / amber / green, with up to 3 reasons ("why").
--
-- Points (calibrated on the demo seed, 20 Nov: 3 red · 41 amber · 1,830 green;
-- Pump Motor 1 CWT-AM-MTR-01 = red 15, Power Transformer 1 EGS-CG-PTR-01 = amber 5):
--   codal life   past 3 · within 15% of it 1
--   failures     2 per failure in the last 12 months, max 6
--   repeat       same fault type 2+ times in 12 months 2
--   open now     a failure not yet rectified 2
--   PM late      any PM plan past its due date 1 (plans with no last-done date are not counted)
--   criticality  A 1
-- Band: red >= 10, amber >= 5, else green. An asset with no failure in 12 months and
-- none open is green whatever its age (risk = old AND failing, not old alone).
-- Dates are read via SUBSTR(...,1,10) so the view works whether autodetect typed a
-- column as DATE, DATETIME, TIMESTAMP or STRING.
CREATE OR REPLACE VIEW amps_demo.asset_risk AS
WITH today AS (SELECT CURRENT_DATE('Asia/Kolkata') AS d),
fl AS (
  SELECT asset_id, fault_type, state,
         SAFE.PARSE_DATE('%F', SUBSTR(CAST(started_at AS STRING), 1, 10)) AS day, downtime_hours
  FROM amps_demo.failures
),
f AS (
  SELECT fl.asset_id,
         COUNTIF(fl.day > DATE_SUB(t.d, INTERVAL 365 DAY)) AS failures_12m,
         COUNTIF(fl.state != 'rectified') AS open_now,
         ROUND(SUM(IF(fl.day > DATE_SUB(t.d, INTERVAL 365 DAY), IFNULL(fl.downtime_hours, 0), 0)), 1) AS downtime_12m_h,
         MAX(fl.day) AS last_failure
  FROM fl CROSS JOIN today AS t GROUP BY fl.asset_id
),
rep AS (
  SELECT asset_id, MAX(n) AS repeat_max FROM (
    SELECT fl.asset_id, fl.fault_type, COUNT(*) AS n
    FROM fl CROSS JOIN today AS t
    WHERE fl.day > DATE_SUB(t.d, INTERVAL 365 DAY) GROUP BY 1, 2)
  GROUP BY asset_id
),
pm AS (
  SELECT p.asset_id,
         COUNTIF(DATE_ADD(SAFE.PARSE_DATE('%F', SUBSTR(CAST(p.last_done_seed AS STRING), 1, 10)),
                          INTERVAL CASE p.frequency WHEN 'Monthly' THEN 1 WHEN 'Quarterly' THEN 3
                                     WHEN 'Half-Yearly' THEN 6 WHEN 'Yearly' THEN 12
                                     WHEN '5-Yearly' THEN 60 END MONTH) < t.d) AS pm_late
  FROM amps_demo.pm_plans AS p CROSS JOIN today AS t GROUP BY p.asset_id
),
base AS (
  SELECT a.id AS asset_id, a.asset_code, a.asset_name, a.asset_class, a.station, a.line,
         a.criticality, a.codal_life_years,
         ROUND(DATE_DIFF(t.d, SAFE.PARSE_DATE('%F', SUBSTR(CAST(a.commissioned_on AS STRING), 1, 10)), DAY) / 365.25, 1) AS age_years,
         IFNULL(f.failures_12m, 0) AS failures_12m, IFNULL(f.open_now, 0) AS open_now,
         IFNULL(f.downtime_12m_h, 0) AS downtime_12m_h, f.last_failure,
         IFNULL(rep.repeat_max, 0) AS repeat_max, IFNULL(pm.pm_late, 0) AS pm_late
  FROM amps_demo.assets AS a CROSS JOIN today AS t
  LEFT JOIN f ON f.asset_id = a.id
  LEFT JOIN rep ON rep.asset_id = a.id
  LEFT JOIN pm ON pm.asset_id = a.id
),
pts AS (
  SELECT *,
         CASE WHEN SAFE_DIVIDE(age_years, codal_life_years) >= 1 THEN 3
              WHEN SAFE_DIVIDE(age_years, codal_life_years) >= 0.85 THEN 1 ELSE 0 END AS life_pts,
         LEAST(2 * failures_12m, 6) AS fail_pts,
         IF(repeat_max >= 2, 2, 0) AS repeat_pts,
         IF(open_now > 0, 2, 0) AS open_pts,
         IF(pm_late > 0, 1, 0) AS pm_pts,
         IF(criticality = 'A', 1, 0) AS crit_pts
  FROM base
),
scored AS (
  SELECT *, life_pts + fail_pts + repeat_pts + open_pts + pm_pts + crit_pts AS score FROM pts
)
SELECT
  asset_id, asset_code, asset_name, asset_class, station, line, criticality,
  age_years, codal_life_years, failures_12m, repeat_max, open_now, downtime_12m_h,
  last_failure, pm_late, score,
  CASE WHEN failures_12m = 0 AND open_now = 0 THEN 'green'
       WHEN score >= 10 THEN 'red' WHEN score >= 5 THEN 'amber' ELSE 'green' END AS band,
  ARRAY(
    SELECT r.why FROM UNNEST([
      STRUCT(life_pts AS p, IF(life_pts = 3, FORMAT('past codal life (%.0f of %d years)', age_years, codal_life_years),
                               'near the end of its codal life') AS why),
      STRUCT(fail_pts, FORMAT('%d failures in 12 months', failures_12m)),
      STRUCT(repeat_pts, FORMAT('same fault %d times', repeat_max)),
      STRUCT(open_pts, 'a failure is open now'),
      STRUCT(pm_pts, FORMAT('%d PM plans late', pm_late)),
      STRUCT(crit_pts, 'criticality A')
    ]) AS r WHERE r.p > 0 ORDER BY r.p DESC LIMIT 3
  ) AS why
FROM scored;
