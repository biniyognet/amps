# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Read-only Google Drive download with a service-account key, stdlib only.

The image carries no Google or crypto packages, so the token is an RS256 JWT
signed here (PKCS#1 v1.5 over SHA-256 with the key's own n, d) and exchanged
for an access token, cached until shortly before it expires. Scope is
drive.readonly. The key file path comes from AMPS_GDRIVE_SA; without it,
`enabled()` is False and callers keep their old behaviour.

Every media file that came from Drive (drawings, contract volumes, …) is noted
in app/data/drive_sources.json; `pull()` brings a missing one back on demand.
"""
import base64
import hashlib
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

SA_PATH = os.environ.get("AMPS_GDRIVE_SA", "")
SCOPE = "https://www.googleapis.com/auth/drive.readonly"
_tok = {"v": None, "exp": 0.0}
_tok_lock = threading.Lock()


def enabled() -> bool:
    return bool(SA_PATH) and Path(SA_PATH).is_file()


def _der(b: bytes, i: int) -> tuple[int, int, int]:
    """(tag, content start, content end) of the DER element at i."""
    tag, ln = b[i], b[i + 1]
    i += 2
    if ln & 0x80:
        n = ln & 0x7F
        ln = int.from_bytes(b[i:i + n], "big")
        i += n
    return tag, i, i + ln


def _ints(b: bytes, i: int, end: int) -> list:
    out = []
    while i < end:
        tag, s, e = _der(b, i)
        out.append(int.from_bytes(b[s:e], "big") if tag == 0x02 else (tag, s, e))
        i = e
    return out


def _rsa_key(pem: str) -> tuple[int, int]:
    """n, d from a PKCS#8 (or PKCS#1) PEM private key."""
    body = "".join(l for l in pem.strip().splitlines() if not l.startswith("-----"))
    b = base64.b64decode(body)
    _, s, e = _der(b, 0)
    top = _ints(b, s, e)
    if isinstance(top[1], tuple):  # PKCS#8: version, algorithm, OCTET STRING(PKCS#1)
        _, os_s, os_e = top[2]
        _, s, e = _der(b, os_s)
        top = _ints(b, s, e)
    return top[1], top[3]  # version, n, e, d, …


_SHA256_INFO = bytes.fromhex("3031300d060960864801650304020105000420")


def _sign(msg: bytes, n: int, d: int) -> bytes:
    k = (n.bit_length() + 7) // 8
    t = _SHA256_INFO + hashlib.sha256(msg).digest()
    em = b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t
    return pow(int.from_bytes(em, "big"), d, n).to_bytes(k, "big")


def _b64(x: bytes) -> bytes:
    return base64.urlsafe_b64encode(x).rstrip(b"=")


def _token() -> str:
    with _tok_lock:
        if _tok["v"] and time.time() < _tok["exp"] - 120:
            return _tok["v"]
        sa = json.loads(Path(SA_PATH).read_text())
        now = int(time.time())
        head = _b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
        claim = _b64(json.dumps({"iss": sa["client_email"], "scope": SCOPE, "aud": sa["token_uri"],
                                 "iat": now, "exp": now + 3600}).encode())
        n, d = _rsa_key(sa["private_key"])
        jwt = head + b"." + claim + b"." + _b64(_sign(head + b"." + claim, n, d))
        body = urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                                       "assertion": jwt.decode()}).encode()
        with urllib.request.urlopen(urllib.request.Request(sa["token_uri"], data=body), timeout=30) as r:
            j = json.load(r)
        _tok.update(v=j["access_token"], exp=now + int(j.get("expires_in", 3600)))
        return _tok["v"]


MEDIA = Path(os.environ.get("AMPS_MEDIA_DIR", "/app/media"))
SOURCES = Path(__file__).resolve().parent / "data" / "drive_sources.json"
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def sources() -> dict:
    """media path -> {drive, name, size}: every media file that came from Drive."""
    try:
        return json.loads(SOURCES.read_text())["files"]
    except FileNotFoundError:
        return {}


DRIVE_ID = re.compile(r"(?:/d/|[?&]id=)([A-Za-z0-9_-]{20,})")


def link_id(url: str | None) -> str | None:
    """The Drive file id in a drive.google.com / docs.google.com link."""
    m = DRIVE_ID.search(url or "")
    return m[1] if m else None


def can_pull(rel: str, src: dict | None = None) -> bool:
    return (MEDIA / rel).is_file() or (enabled() and bool(src or rel in sources()))


def pull(rel: str, wait: float = 0.0, src: dict | None = None) -> dict:
    """Make sure media/<rel> is on the server, pulling it from Drive in the
    background when it is not. Returns {state: ready|fetching|failed|unknown,
    got, size, error}; `wait` blocks up to that many seconds for the pull."""
    dest = MEDIA / rel
    if dest.is_file():
        return {"state": "ready", "size": dest.stat().st_size}
    src = src or sources().get(rel)  # a record may carry its own Drive link (letters)
    if not src or not enabled():
        return {"state": "unknown", "error": "not on the server and no Drive source noted"}
    with _jobs_lock:
        job = _jobs.get(rel)
        if job is None or (job["error"] and time.time() - job["at"] > 30):  # retry a failed pull after 30 s
            job = _jobs[rel] = {"done": threading.Event(), "error": "", "at": time.time()}

            def run(job=job):
                try:
                    download(src["drive"], dest, src.get("size"))
                except Exception as e:  # Drive down, file moved, access removed
                    job["error"] = str(e)
                job["at"] = time.time()
                job["done"].set()
            threading.Thread(target=run, daemon=True, name=f"gdrive-pull {rel}").start()
    job["done"].wait(wait)
    if dest.is_file():
        return {"state": "ready", "size": dest.stat().st_size}
    if job["error"]:
        return {"state": "failed", "error": job["error"]}
    part = dest.with_name(dest.name + ".part")
    return {"state": "fetching", "got": part.stat().st_size if part.exists() else 0, "size": src.get("size")}


def download(file_id: str, dest: Path, size: int | None = None) -> None:
    """Stream a Drive file to dest (via dest.part, renamed only when complete)."""
    url = f"https://www.googleapis.com/drive/v3/files/{urllib.parse.quote(file_id)}?alt=media&supportsAllDrives=true"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {_token()}"})
    part = dest.with_name(dest.name + ".part")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(req, timeout=60) as r, open(part, "wb") as fh:
        while chunk := r.read(1 << 20):
            fh.write(chunk)
    if size and part.stat().st_size != size:
        part.unlink(missing_ok=True)
        raise IOError(f"short download ({part.stat().st_size if part.exists() else 0} of {size} bytes)")
    part.rename(dest)
