-- SPDX-License-Identifier: MIT
-- Read-back after load.sh: row counts, the risk bands, and 3 sample rows of each.
SELECT 'failures' AS t, COUNT(*) AS n FROM amps_demo.failures
UNION ALL SELECT 'failure_fields', COUNT(*) FROM amps_demo.failure_fields
UNION ALL SELECT 'failure_fields ai ok', COUNTIF(ai_status = '') FROM amps_demo.failure_fields
UNION ALL SELECT CONCAT('asset_risk ', band), COUNT(*) FROM amps_demo.asset_risk GROUP BY band
ORDER BY t;

SELECT asset_code, language, remark, component, symptom, reading, cause, action
FROM amps_demo.failure_fields
WHERE asset_code IN ('MTD-CC-ESC-01', 'EGS-CG-PTR-01', 'BSR-CB-GBX-01') OR language = 'hi'
ORDER BY started_at DESC LIMIT 4;

SELECT asset_code, asset_name, band, score, ARRAY_TO_STRING(why, ' · ') AS why
FROM amps_demo.asset_risk
WHERE band != 'green' ORDER BY score DESC LIMIT 5;
