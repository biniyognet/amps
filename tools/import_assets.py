#!/usr/bin/env python3
"""Bulk-import an asset register from CSV into a running AMPS instance.

Talks to the HTTP API (not the database directly) so it works against any
deployment — local compose, LAN server, or a remote instance — and every
row passes the same validation and audit trail as manual entry.

CSV columns (header row required, extra columns ignored, order free):
    code, name, asset_class, location                  required
    line, system, make_model, criticality, status      optional
(`line` groups locations under a parent site — e.g. a rail line.)

Example:
    python3 tools/import_assets.py register.csv --base-url http://localhost:8080
    python3 tools/import_assets.py register.csv --dry-run

Rows whose code already exists are skipped (repeat runs are safe).
Only the Python standard library is required.
"""
import argparse
import csv
import json
import sys
import urllib.error
import urllib.request

REQUIRED = ("code", "name", "asset_class", "location")
OPTIONAL = ("line", "system", "make_model", "criticality", "status")


def clean(row: dict) -> dict:
    """Trim whitespace and drop empty optional fields."""
    out = {}
    for key in REQUIRED + OPTIONAL:
        val = (row.get(key) or "").strip()
        if val:
            out[key] = val
    return out


def post_asset(base_url: str, payload: dict, cookie: str = "") -> tuple[bool, str]:
    headers = {"Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(
        f"{base_url}/api/assets",
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30):
            return True, "created"
    except urllib.error.HTTPError as e:
        if e.code == 409:
            return True, "exists (skipped)"
        return False, f"HTTP {e.code}: {e.read().decode()[:200]}"
    except urllib.error.URLError as e:
        return False, f"unreachable: {e.reason}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("csv_file")
    ap.add_argument("--base-url", default="http://localhost:8080",
                    help="AMPS instance URL (default: %(default)s)")
    ap.add_argument("--dry-run", action="store_true",
                    help="validate the CSV and show what would be sent")
    ap.add_argument("--cookie", default="",
                    help="session cookie for authenticated instances "
                         '(e.g. "amps_session=..." from a signed-in browser '
                         "or POST /api/auth/login)")
    args = ap.parse_args()

    with open(args.csv_file, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        print("CSV has no data rows.")
        return 1

    missing_header = [c for c in REQUIRED if c not in rows[0]]
    if missing_header:
        print(f"CSV is missing required columns: {', '.join(missing_header)}")
        print(f"Required: {', '.join(REQUIRED)} · optional: {', '.join(OPTIONAL)}")
        return 1

    created = skipped = failed = 0
    for n, raw in enumerate(rows, start=2):  # start=2: line 1 is the header
        payload = clean(raw)
        gaps = [c for c in REQUIRED if c not in payload]
        if gaps:
            print(f"line {n}: SKIP — empty required field(s): {', '.join(gaps)}")
            failed += 1
            continue
        if args.dry_run:
            print(f"line {n}: OK   {json.dumps(payload)}")
            created += 1
            continue
        ok, msg = post_asset(args.base_url, payload, args.cookie)
        tag = payload["code"]
        if ok and msg == "created":
            created += 1
            print(f"line {n}: {tag}: created")
        elif ok:
            skipped += 1
            print(f"line {n}: {tag}: {msg}")
        else:
            failed += 1
            print(f"line {n}: {tag}: FAILED — {msg}")

    verb = "valid" if args.dry_run else "created"
    print(f"\n{verb}: {created} · skipped: {skipped} · failed: {failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
