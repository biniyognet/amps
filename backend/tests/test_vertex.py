# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""AMPS_AI_PROVIDER=vertex: Gemini on Vertex AI. All network calls mocked."""
import io
import json
import os
import subprocess
import sys
import urllib.error

os.environ.setdefault("AMPS_AUTH", "0")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.api import ai, similar, vertex  # noqa: E402
from app.main import app  # noqa: E402

TOKEN = "ya29.test-token-never-shown"
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


class Resp(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False


@pytest.fixture()
def vx(monkeypatch, tmp_path):
    monkeypatch.setattr(ai, "PROVIDER", "vertex")
    monkeypatch.setattr(ai, "GEMINI_KEY", "")
    monkeypatch.setattr(vertex, "PROJECT", "demo-proj")
    monkeypatch.setattr(vertex, "LOCATION", "global")
    monkeypatch.setattr(vertex, "_cache", {"token": None, "exp": 0.0, "source": None})
    monkeypatch.setenv("AMPS_VERTEX_TOKEN", TOKEN)
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(tmp_path / "none.json"))
    calls = []

    def fake_open(req, timeout=None):
        calls.append({"url": req.full_url, "headers": {k.lower(): v for k, v in req.header_items()},
                      "body": json.loads(req.data) if req.data else None})
        if req.full_url.endswith(":predict"):
            n = len(calls[-1]["body"]["instances"])
            return Resp(json.dumps({"predictions": [{"embeddings": {"values": [0.6, 0.8]}}] * n}).encode())
        return Resp(json.dumps({"candidates": [{"content": {"parts": [{"text": "OK"}]}}]}).encode())
    monkeypatch.setattr("urllib.request.urlopen", fake_open)
    return calls


def test_generate_goes_to_vertex_with_a_bearer_token(vx):
    assert ai.gemini_on() and ai._enabled() and ai._model() == ai.GEMINI_MODEL
    r = ai.gemini_generate({"contents": [{"role": "user", "parts": [{"text": "hi"}]}]})
    assert r["candidates"][0]["content"]["parts"][0]["text"] == "OK"
    c = vx[-1]
    assert c["url"] == ("https://aiplatform.googleapis.com/v1/projects/demo-proj/locations/global"
                        f"/publishers/google/models/{ai.GEMINI_MODEL}:generateContent")
    assert c["headers"]["authorization"] == f"Bearer {TOKEN}"
    assert c["headers"]["x-goog-user-project"] == "demo-proj"
    assert "x-goog-api-key" not in c["headers"]
    assert c["body"]["contents"][0]["parts"][0]["text"] == "hi"   # same body as the AI Studio path


def test_regional_host_and_key_path_unchanged(vx, monkeypatch):
    monkeypatch.setattr(vertex, "LOCATION", "us-central1")
    assert ai.gemini_target("m")[0].startswith(
        "https://us-central1-aiplatform.googleapis.com/v1/projects/demo-proj/locations/us-central1/")
    monkeypatch.setattr(ai, "PROVIDER", "gemini")
    monkeypatch.setattr(ai, "GEMINI_KEY", "k")
    url, h = ai.gemini_target("m")
    assert url == "https://generativelanguage.googleapis.com/v1beta/models/m:generateContent" and h == {"x-goog-api-key": "k"}


def test_vertex_needs_a_project(vx, monkeypatch):
    monkeypatch.setattr(vertex, "PROJECT", "")
    assert not ai.gemini_on() and not ai._enabled()


def test_status_and_ask_answer_on_vertex(vx, monkeypatch):
    monkeypatch.setattr(ai, "_throttle", lambda ip: None)
    with TestClient(app) as c:
        s = c.get("/api/ai/status").json()
        assert s == {"enabled": True, "provider": "vertex", "model": ai.GEMINI_MODEL}
        r = c.post("/api/ai/ask", json={"question": "how many sites?"})
    assert r.status_code == 200 and r.json()["answer"] == "OK"
    assert TOKEN not in r.text and "aiplatform" in vx[-1]["url"]


def test_adc_refresh_then_cached(vx, monkeypatch, tmp_path):
    monkeypatch.delenv("AMPS_VERTEX_TOKEN")
    adc = tmp_path / "adc.json"
    adc.write_text(json.dumps({"type": "authorized_user", "client_id": "cid",
                               "client_secret": "sec", "refresh_token": "rt"}))
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(adc))
    got = []

    def fake_open(req, timeout=None):
        got.append(req)
        return Resp(json.dumps({"access_token": "fresh", "expires_in": 3599}).encode())
    monkeypatch.setattr("urllib.request.urlopen", fake_open)
    assert vertex.token() == "fresh" and vertex.token() == "fresh"
    assert len(got) == 1 and got[0].full_url == vertex.TOKEN_URL
    assert b"refresh_token=rt" in got[0].data and vertex.token_source() == "adc"


def test_no_credentials_is_a_urlerror_so_callers_fall_back(vx, monkeypatch):
    monkeypatch.delenv("AMPS_VERTEX_TOKEN")
    monkeypatch.setattr(vertex, "SOURCES", (("env", vertex._from_env), ("adc", vertex._from_adc)))
    with pytest.raises(urllib.error.URLError):
        vertex.headers()


def test_seen_before_embeds_on_vertex_one_text_per_call(vx):
    assert similar.embed_enabled()
    assert similar._embed(["seal leak", "bearing hot"]) == [[0.6, 0.8], [0.6, 0.8]]
    preds = [c for c in vx if c["url"].endswith(":predict")]
    assert len(preds) == 2 and all(len(c["body"]["instances"]) == 1 for c in preds)
    assert preds[0]["url"] == ("https://us-central1-aiplatform.googleapis.com/v1/projects/demo-proj/"
                               f"locations/us-central1/publishers/google/models/{similar.EMBED_MODEL}:predict")
    b = preds[0]["body"]
    assert b["instances"][0] == {"content": "seal leak", "task_type": "SEMANTIC_SIMILARITY"}
    assert b["parameters"]["outputDimensionality"] == similar.EMBED_DIM


def _check(env, *args):
    e = {k: v for k, v in os.environ.items() if not k.startswith(("AMPS_", "GOOGLE_"))}
    e.update(env, PATH="/usr/bin:/bin", GOOGLE_APPLICATION_CREDENTIALS="/nonexistent")
    return subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "vertex_check.py"), *args],
                          env=e, capture_output=True, text=True, cwd=ROOT, timeout=60)


def test_vertex_check_dry_makes_no_call_and_never_prints_the_token():
    p = _check({"AMPS_VERTEX_PROJECT": "demo-proj", "AMPS_VERTEX_TOKEN": TOKEN,
                "DATABASE_URL": os.environ["DATABASE_URL"]})
    assert p.returncode == 0, p.stdout + p.stderr
    assert "DRY OK" in p.stdout and "projects/demo-proj/locations/global" in p.stdout
    assert TOKEN not in p.stdout + p.stderr
    p = _check({"DATABASE_URL": os.environ["DATABASE_URL"]})
    assert p.returncode == 1 and "AMPS_VERTEX_PROJECT unset" in p.stderr
