#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
"""Check the AMPS_AI_PROVIDER=vertex adapter (Gemini on Vertex AI).

    AMPS_VERTEX_PROJECT=gen-lang-client-0618042629 python scripts/vertex_check.py          # dry
    AMPS_VERTEX_PROJECT=gen-lang-client-0618042629 python scripts/vertex_check.py --live   # 2 tiny calls

Dry (default): no network call to Vertex AI, no token fetched. Prints the endpoints
the app will call and which Google credential source it would use, and exits 1
when something is missing.
--live: one generateContent ("reply OK", 5 tokens) and one embedding, both billed
to the project (well under a cent). Needs billing on the project.
Tokens and refresh secrets are never printed.
"""
import argparse
import json
import os
import shutil
import sys
import urllib.error

sys.path[:0] = [os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"), os.getcwd()]
os.environ.setdefault("AMPS_AI_PROVIDER", "vertex")

from app.api import ai, similar, vertex  # noqa: E402


def sources() -> list[tuple[str, bool, str]]:
    """(source, usable, note) for each credential source, without fetching a token."""
    adc, ok, note = vertex._adc_path(), False, "no file"
    if os.path.exists(adc):
        try:
            kind = json.load(open(adc)).get("type")
        except (OSError, ValueError):
            kind = "unreadable"
        ok, note = kind == "authorized_user", f"{adc} ({kind})"
    on_gcp = bool(os.environ.get("K_SERVICE"))   # set on Cloud Run
    return [("AMPS_VERTEX_TOKEN", bool(os.environ.get("AMPS_VERTEX_TOKEN")), "set" if os.environ.get("AMPS_VERTEX_TOKEN") else "unset"),
            ("ADC authorized_user", ok, note),
            ("metadata server", on_gcp, "Cloud Run" if on_gcp else "not on Cloud Run"),
            ("gcloud CLI", bool(shutil.which("gcloud")), shutil.which("gcloud") or "not on PATH")]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--live", action="store_true", help="make 2 tiny billed calls")
    a = ap.parse_args()
    bad = []
    print(f"provider   {ai.PROVIDER}   (AMPS_AI_PROVIDER)")
    print(f"project    {vertex.PROJECT or '-- unset (AMPS_VERTEX_PROJECT)'}")
    print(f"location   {vertex.LOCATION}   embed {similar.VERTEX_EMBED_LOCATION}")
    if ai.PROVIDER != "vertex":
        bad.append("AMPS_AI_PROVIDER is not vertex")
    if not vertex.configured():
        bad.append("AMPS_VERTEX_PROJECT unset")
    print(f"generate   {vertex.model_url(ai.GEMINI_MODEL, 'generateContent')}")
    print(f"embed      {vertex.model_url(similar.EMBED_MODEL, 'predict', similar.VERTEX_EMBED_LOCATION)}")
    found = sources()
    for name, ok, note in found:
        print(f"cred       {'ok ' if ok else '-- '} {name}: {note}")
    if not any(ok for _, ok, _ in found):
        bad.append("no Google credentials (run `gcloud auth application-default login`)")
    print(f"app        ai on={ai._enabled()}  gemini on={ai.gemini_on()}  seen-before embeddings={similar.embed_enabled()}")
    if bad:
        sys.exit("NOT READY: " + "; ".join(bad))
    if not a.live:
        print("DRY OK — no call made. Run with --live once billing is on.")
        return
    try:
        r = ai.gemini_generate({"contents": [{"role": "user", "parts": [{"text": "Reply with the word OK."}]}],
                                "generationConfig": {"temperature": 0, "maxOutputTokens": 5,
                                                     "thinkingConfig": {"thinkingBudget": 0}}})
        parts = (r.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        print(f"LIVE generate {ai.GEMINI_MODEL}: {''.join(p.get('text', '') for p in parts).strip()!r}"
              f"  (token from {vertex.token_source()})")
        v = similar._embed(["pump motor seal leak"])[0]
        print(f"LIVE embed    {similar.EMBED_MODEL}: dim {len(v)}")
    except urllib.error.HTTPError as e:   # Google's error JSON names the cause (billing, API off, IAM)
        sys.exit(f"LIVE FAILED: HTTP {e.code} {e.read()[:300].decode(errors='replace')}")
    except (urllib.error.URLError, TimeoutError, KeyError, IndexError, ValueError) as e:
        sys.exit(f"LIVE FAILED: {type(e).__name__}: {e}")
    print("LIVE OK")


if __name__ == "__main__":
    main()
