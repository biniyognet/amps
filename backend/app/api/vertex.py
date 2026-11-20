# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Vertex AI transport for the Gemini features (AMPS_AI_PROVIDER=vertex).

Same Gemini models and the same generateContent body as the AI Studio key path,
but sent to Vertex AI on a Google Cloud project, billed to that project and
authorised by Google credentials instead of an API key:

  AMPS_VERTEX_PROJECT   GCP project id (required)
  AMPS_VERTEX_LOCATION  "global" (default) or a region such as us-central1

An OAuth access token is taken from the first source that works, and cached
until a minute before it expires:
  1. AMPS_VERTEX_TOKEN  a ready token (e.g. `gcloud auth print-access-token`), for a quick test
  2. Application Default Credentials of type authorized_user
     (GOOGLE_APPLICATION_CREDENTIALS, else ~/.config/gcloud/application_default_credentials.json,
     written by `gcloud auth application-default login`), refreshed over HTTPS
  3. the metadata server (Cloud Run / GCE: the service's own account)
  4. the gcloud CLI on PATH
Standard library only. Tokens and refresh secrets are never logged or returned.
"""
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

PROJECT = os.environ.get("AMPS_VERTEX_PROJECT", "").strip()
LOCATION = os.environ.get("AMPS_VERTEX_LOCATION", "global").strip() or "global"
TOKEN_URL = "https://oauth2.googleapis.com/token"
METADATA_URL = ("http://metadata.google.internal/computeMetadata/v1/"
                "instance/service-accounts/default/token")
_cache = {"token": None, "exp": 0.0, "source": None}


def configured() -> bool:
    return bool(PROJECT)


def host(location: str | None = None) -> str:
    loc = location or LOCATION
    return "aiplatform.googleapis.com" if loc == "global" else f"{loc}-aiplatform.googleapis.com"


def model_url(model: str, method: str, location: str | None = None) -> str:
    """https://…/v1/projects/P/locations/L/publishers/google/models/M:method"""
    loc = location or LOCATION
    return (f"https://{host(loc)}/v1/projects/{PROJECT}/locations/{loc}"
            f"/publishers/google/models/{model}:{method}")


def _adc_path() -> str:
    return os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or os.path.expanduser(
        "~/.config/gcloud/application_default_credentials.json")


def _from_env():
    t = os.environ.get("AMPS_VERTEX_TOKEN", "").strip()
    return (t, 3000) if t else None


def _from_adc():
    try:
        with open(_adc_path()) as f:
            c = json.load(f)
    except (OSError, ValueError):
        return None
    if c.get("type") != "authorized_user":   # a service-account key needs JWT signing: use the metadata server
        return None
    body = urllib.parse.urlencode({"grant_type": "refresh_token", "client_id": c["client_id"],
                                   "client_secret": c["client_secret"],
                                   "refresh_token": c["refresh_token"]}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=body), timeout=15) as r:
            d = json.loads(r.read())
    except OSError:
        return None
    return d["access_token"], int(d.get("expires_in", 3600))


def _from_metadata():
    req = urllib.request.Request(METADATA_URL, headers={"Metadata-Flavor": "Google"})
    try:
        with urllib.request.urlopen(req, timeout=2) as r:
            d = json.loads(r.read())
    except OSError:
        return None
    return d["access_token"], int(d.get("expires_in", 3600))


def _from_gcloud():
    if not shutil.which("gcloud"):
        return None
    p = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True, timeout=30)
    t = p.stdout.strip()
    return (t, 3000) if p.returncode == 0 and t else None


SOURCES = (("env", _from_env), ("adc", _from_adc), ("metadata", _from_metadata), ("gcloud", _from_gcloud))


def token() -> str:
    if _cache["token"] and time.time() < _cache["exp"]:
        return _cache["token"]
    for name, fn in SOURCES:
        try:
            got = fn()
        except (OSError, subprocess.SubprocessError, KeyError, ValueError):
            got = None
        if got:
            _cache.update(token=got[0], exp=time.time() + got[1] - 60, source=name)
            return got[0]
    # URLError, so every caller's existing "AI is busy" fallback applies
    raise urllib.error.URLError("no Google credentials for Vertex AI: run `gcloud auth application-default "
                                "login`, or set AMPS_VERTEX_TOKEN, or run on Cloud Run")


def headers() -> dict:
    h = {"Authorization": f"Bearer {token()}"}
    if PROJECT:
        h["x-goog-user-project"] = PROJECT   # bill the call to the project, not the user's quota project
    return h


def token_source() -> str | None:
    """Which source the cached token came from (never the token itself)."""
    return _cache["source"]
