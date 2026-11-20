# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""/api/ai/ask says which model answered: cloud Gemini, or the on-prem Gemma
fallback when Gemini fails. All network calls mocked."""
import io
import json
import os
import urllib.error

os.environ.setdefault("AMPS_AUTH", "0")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.api import ai  # noqa: E402
from app.main import app  # noqa: E402


class Resp(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False


@pytest.fixture()
def gem(monkeypatch):
    monkeypatch.setattr(ai, "PROVIDER", "gemini")
    monkeypatch.setattr(ai, "GEMINI_KEY", "k")
    monkeypatch.setattr(ai, "GEMINI_MODEL", "gemini-3.5-flash-lite")
    monkeypatch.setattr(ai, "FALLBACK_URL", "http://ollama:11434/v1")
    monkeypatch.setattr(ai, "FALLBACK_MODEL", "gemma3:4b")
    monkeypatch.setattr(ai, "_throttle", lambda ip: None)
    state = {"gemini_down": False, "urls": []}

    def fake_open(req, timeout=None):
        state["urls"].append(req.full_url)
        if "googleapis" in req.full_url:
            if state["gemini_down"]:
                raise urllib.error.HTTPError(req.full_url, 503, "overloaded", {}, io.BytesIO(b""))
            return Resp(json.dumps({"candidates": [{"content": {"parts": [{"text": "from gemini"}]}}]}).encode())
        return Resp(json.dumps({"choices": [{"message": {"content": "from gemma"}}]}).encode())
    monkeypatch.setattr("urllib.request.urlopen", fake_open)
    monkeypatch.setattr("time.sleep", lambda s: None)   # skip retry back-off on the 503
    return state


def test_gemini_answers_cloud_no_fallback(gem):
    with TestClient(app) as c:
        j = c.post("/api/ai/ask", json={"question": "how many sites?"}).json()
    assert j["answer"] == "from gemini"
    assert (j["model"], j["provider"], j["fallback"]) == ("gemini-3.5-flash-lite", "gemini", False)
    assert not any("ollama" in u for u in gem["urls"])


def test_gemini_fails_gemma_onprem_answers(gem):
    gem["gemini_down"] = True
    with TestClient(app) as c:
        j = c.post("/api/ai/ask", json={"question": "how many sites?"}).json()
    assert j["answer"] == "from gemma"
    assert (j["model"], j["provider"], j["fallback"]) == ("gemma3:4b", "gemma-onprem", True)
    assert gem["urls"][-1].startswith("http://ollama:11434/v1")


def test_gemini_fails_no_fallback_configured_is_502(gem, monkeypatch):
    gem["gemini_down"] = True
    monkeypatch.setattr(ai, "FALLBACK_URL", "")
    with TestClient(app) as c:
        r = c.post("/api/ai/ask", json={"question": "how many sites?"})
    assert r.status_code == 502
