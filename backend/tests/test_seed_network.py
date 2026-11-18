# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Demo network seed — site names, unit codes, and the asset codes the brief links to."""
import re
from pathlib import Path

import seed_network as sn

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _codes():
    """Every asset code the seed builds, without touching a database."""
    out = set()
    for line, depot, _y, _p, sector in sn.LINES:
        for stn in sn.STATIONS[line]:
            is_hub = stn == sn.STATIONS[line][-1]
            for _c, pfx, *_r, per, _cy, _mk in ((c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7])
                                                for c in sn.CLASSES[sector]):
                for k in range(per[1] if is_hub else per[0]):
                    out.add(f"{depot}-{sn._abbr(stn)}-{pfx}-{k + 1:02d}")
    return out


def test_demo_sites():
    assert [(l[0], l[1]) for l in sn.LINES] == [
        ("Metro Traction & Depot", "MTD"),
        ("Eastern Grid 132 kV Substation", "EGS"),
        ("City Water Treatment Plant", "CWT"),
        ("Bengal Steel & Rolling Mill", "BSR"),
    ]
    assert set(sn.STATIONS) == {l[0] for l in sn.LINES}


def test_no_old_site_names_or_codes():
    old = re.compile(r"Riverside|Hillcrest|Lakeside|Foundry|\b(RVM|HCS|LWW|FLF)-")
    src = Path(sn.__file__).read_text()
    for f in ("brief.jsx", "ask.jsx", "App.jsx"):
        src += (FRONTEND / f).read_text()
    assert not old.search(src)


def test_brief_links_resolve_to_seeded_codes():
    brief = (FRONTEND / "brief.jsx").read_text()
    linked = set(re.findall(r"#/(?:asset|snap)/([A-Z0-9-]+)'", brief))
    assert linked == {"MTD-CEN-TTR-01", "MTD-CEN-HSC-01"}
    assert linked <= _codes()
    assert "#/line/Metro%20Traction%20%26%20Depot'" in brief
