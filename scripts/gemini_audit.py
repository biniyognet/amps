#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
"""Audit a Gemini API key before the demo: which models it sees, and where it gets rate-limited.

    AMPS_GEMINI_API_KEY=... python scripts/gemini_audit.py [--burst 12] [--models gemini-2.5-flash,gemini-2.5-pro]

Reads the key from the environment only and never prints it (only its last 4
characters). Standard library only. Prints one row per model: OK calls, 429s,
median latency, and the first error message the API returned.
"""
import argparse
import json
import os
import statistics
import time
import urllib.error
import urllib.request

API = "https://generativelanguage.googleapis.com/v1beta"


def call(url, key, body=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None,
                                 headers={"x-goog-api-key": key, "content-type": "application/json"})
    t = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r), time.monotonic() - t
    except urllib.error.HTTPError as e:
        try:
            msg = json.load(e).get("error", {}).get("message", "")
        except Exception:
            msg = e.reason
        return e.code, {"error": msg}, time.monotonic() - t
    except OSError as e:  # timeouts and resets count as a failed call, not a crash
        return 0, {"error": f"{type(e).__name__}: {e}"}, time.monotonic() - t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--burst", type=int, default=12, help="back-to-back calls per model")
    ap.add_argument("--models", default="gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.5-pro")
    a = ap.parse_args()
    key = os.environ.get("AMPS_GEMINI_API_KEY", "").strip()
    if not key:
        raise SystemExit("set AMPS_GEMINI_API_KEY first")
    print(f"key …{key[-4:]}")

    code, out, _ = call(f"{API}/models?pageSize=200", key)
    if code != 200:
        raise SystemExit(f"models list: HTTP {code} {out.get('error', '')}")
    seen = {m["name"].split("/", 1)[1] for m in out.get("models", [])}
    print(f"models visible: {len(seen)}")

    body = {"contents": [{"role": "user", "parts": [{"text": "Reply with the single word: ok"}]}],
            "generationConfig": {"maxOutputTokens": 8}}
    print(f"{'model':28} {'ok':>3} {'429':>4} {'other':>5} {'p50 s':>6}  first error")
    for m in a.models.split(","):
        if m not in seen:
            print(f"{m:28}  not visible to this key")
            continue
        ok = rl = other = 0
        lat, first = [], ""
        for _ in range(a.burst):
            code, out, dt = call(f"{API}/models/{m}:generateContent", key, body)
            if code == 200:
                ok += 1
                lat.append(dt)
            else:
                rl += code == 429
                other += code != 429
                first = first or f"HTTP {code}: {str(out.get('error', ''))[:90]}"
        p50 = f"{statistics.median(lat):.2f}" if lat else "-"
        print(f"{m:28} {ok:>3} {rl:>4} {other:>5} {p50:>6}  {first}")
    print("429 inside a 12-call burst = free-tier limits; link the key's project to billing.")


if __name__ == "__main__":
    main()
