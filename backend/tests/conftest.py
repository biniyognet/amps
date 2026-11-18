# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Loaded before any test module: bind the whole suite to a throwaway DB.

app.db reads DATABASE_URL once at import and falls back to ./amps.db, so whichever
test module imports the app first decides the engine for every module after it.
Forcing a temp DB here keeps tests off the real file (and off any DATABASE_URL
exported in the shell), so a stale amps.db can no longer skew counts between runs.
"""
import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="amps-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["AMPS_MEDIA_DIR"] = os.path.join(_tmp, "media")
