-- SPDX-License-Identifier: MIT
-- Remote model: a BigQuery ML handle on Gemini in Vertex AI, through the
-- CLOUD_RESOURCE connection that gemini_go.sh creates (its service account gets
-- roles/aiplatform.user). Needs billing on the project. gemini_go.sh fills in
-- @CONN@ (e.g. us-central1.amps_vertex) and @MODEL@ (the Gemini endpoint).
CREATE OR REPLACE MODEL amps_demo.gemini
  REMOTE WITH CONNECTION `@CONN@`
  OPTIONS (ENDPOINT = '@MODEL@');
