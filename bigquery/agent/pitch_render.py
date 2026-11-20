# SPDX-License-Identifier: MIT
"""F4 pitch fallback: turn the q1/q3/q4 BigQuery results into one screenshot-ready page.

    python3 bigquery/agent/pitch_render.py pitch_out

Reads pitch_out/q{1,3,4}.sql (title = the "-- Qn" line) and q{1,3,4}.json
(`bq query --format=json` output), prints each answer as a terminal table and
writes pitch_out/pitch.html: one card per question, the SQL under it, Q3 as a
stacked bar chart (inline SVG, no network). Standard library only.
"""
import html
import json
import sys
from pathlib import Path

SITE_COLOURS = ["#2563eb", "#ea580c", "#16a34a", "#9333ea", "#0891b2", "#db2777"]

SAYS = {
    1: lambda r: f"{len(r)} assets are red. Top: {r[0]['asset_name']} {r[0]['asset_code']} "
                 f"(score {r[0]['score']}): {r[0]['why']}." if r else "No red assets.",
    3: lambda r: f"{sum(int(x['failures']) for x in r)} failures, "
                 f"{min(x['month'] for x in r)} to {max(x['month'] for x in r)}, "
                 f"across {len({x['site'] for x in r})} sites." if r else "No failures.",
    4: lambda r: f"{sum(int(x['open_failures']) for x in r)} failures still open across "
                 f"{len(r)} stations." if r else "Nothing open.",
}


def load(out, n):
    lines = (out / f"q{n}.sql").read_text().splitlines()
    title = lines[0].removeprefix("-- ").strip()
    title = title.split(" ", 1)[1] if title[:1] == "Q" else title
    title = title.removesuffix(" (chart).").rstrip(".")
    sql = "\n".join(l for l in lines[1:] if not l.startswith("--")).strip()
    rows = json.loads((out / f"q{n}.json").read_text() or "[]")
    return title, sql, rows


def text_table(rows):
    if not rows:
        return "(0 rows)"
    cols = list(rows[0])
    w = {c: max(len(c), *(len(str(r.get(c, ""))) for r in rows)) for c in cols}
    line = lambda vals: " | ".join(str(v).ljust(w[c]) for c, v in zip(cols, vals))
    return "\n".join([line(cols), "-+-".join("-" * w[c] for c in cols),
                      *(line([r.get(c, "") for c in cols]) for r in rows),
                      f"({len(rows)} rows)"])


def is_num(v):
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def html_table(rows):
    if not rows:
        return "<p class=empty>0 rows</p>"
    cols = list(rows[0])
    head = "".join(f"<th>{html.escape(c)}</th>" for c in cols)
    body = "".join(
        "<tr>" + "".join(
            f"<td class={'n' if is_num(r.get(c)) else 'w' if c == 'why' else 't'}>{html.escape(str(r.get(c, '')))}</td>"
            for c in cols) + "</tr>"
        for r in rows)
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def stacked_bars(rows):
    """Q3 rows (month, site, failures) → stacked bar SVG, one bar per month."""
    months = sorted({r["month"] for r in rows})
    sites = sorted({r["site"] for r in rows})
    val = {(r["month"], r["site"]): int(r["failures"]) for r in rows}
    top = max(sum(val.get((m, s), 0) for s in sites) for m in months) or 1
    W, H, L, B = 760, 230, 30, 34
    bw = (W - L) / len(months)
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Failures by site and month">']
    for t in range(0, top + 1, max(1, top // 4)):
        y = H - B - (H - B - 10) * t / top
        out.append(f'<line x1="{L}" x2="{W}" y1="{y:.1f}" y2="{y:.1f}" class=grid />'
                   f'<text x="{L - 6}" y="{y + 3:.1f}" class=ax text-anchor=end>{t}</text>')
    for i, m in enumerate(months):
        x, y = L + i * bw + bw * 0.15, H - B
        for j, s in enumerate(sites):
            v = val.get((m, s), 0)
            if not v:
                continue
            h = (H - B - 10) * v / top
            y -= h
            out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{bw * 0.7:.1f}" height="{h:.1f}" '
                       f'fill="{SITE_COLOURS[j % len(SITE_COLOURS)]}">'
                       f'<title>{html.escape(m)} · {html.escape(s)}: {v}</title></rect>')
        if i % 2 == 0 or len(months) <= 12:
            out.append(f'<text x="{x + bw * 0.35:.1f}" y="{H - B + 14}" class=ax '
                       f'text-anchor=middle>{html.escape(m[2:])}</text>')
    out.append("</svg><div class=legend>")
    out += [f'<span><i style="background:{SITE_COLOURS[j % len(SITE_COLOURS)]}"></i>'
            f'{html.escape(s)}</span>' for j, s in enumerate(sites)]
    out.append("</div>")
    return "".join(out)


CSS = """
:root{--bg:#f6f7f9;--card:#fff;--ink:#14171c;--ink2:#5b6472;--line:#e3e6eb;--acc:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#0f1216;--card:#171b21;--ink:#e8ebf0;--ink2:#97a0ad;--line:#2a3039}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,sans-serif}
main{max-width:980px;margin:0 auto;padding:16px}
header{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin:4px 0 12px}
header h1{font-size:17px;margin:0}header span{color:var(--ink2);font-size:12px}
section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin:0 0 14px}
.tag{font:600 10px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--acc)}
h2{font-size:18px;margin:4px 0 6px}.says{font-size:15px;margin:0 0 12px}
table{border-collapse:collapse;width:100%;font-size:13px}
th{font:600 10px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--ink2);text-align:left;border-bottom:1px solid var(--line);padding:6px 8px}
td{padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}td.w{white-space:normal;min-width:240px}td.n{text-align:right;font-variant-numeric:tabular-nums;font-family:ui-monospace,monospace}
.wrap{overflow-x:auto}svg{width:100%;height:auto;margin:4px 0 10px}
svg .grid{stroke:var(--line)}svg .ax{fill:var(--ink2);font-size:10px}
.legend{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;color:var(--ink2);margin:0 0 8px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
details{margin-top:10px}summary{cursor:pointer;color:var(--ink2);font-size:12px}
pre{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:10px;overflow-x:auto;font-size:12px}
footer{color:var(--ink2);font-size:11px;text-align:center;padding:4px 0 16px}
"""


def main(out):
    out = Path(out)
    cards = []
    for step, n in enumerate((1, 3, 4), 1):
        title, sql, rows = load(out, n)
        says = SAYS[n](rows)
        print(f"\n== Step {step} · Q{n} {title}\n{says}\n{text_table(rows)}")
        chart = f'<div class=wrap>{stacked_bars(rows)}</div>' if n == 3 and rows else ""
        table = html_table(rows) if n != 3 else f"<details><summary>{len(rows)} rows</summary><div class=wrap>{html_table(rows)}</div></details>"
        cards.append(
            f'<section id=q{n}><div class=tag>Step {step} · Q{n} · BigQuery SQL</div>'
            f'<h2>{html.escape(title)}</h2><p class=says>{html.escape(says)}</p>'
            f'{chart}<div class=wrap>{table if n != 3 else ""}</div>{table if n == 3 else ""}'
            f'<details><summary>SQL (the verified query the agent uses)</summary>'
            f'<pre>{html.escape(sql)}</pre></details></section>')
    page = (f'<!doctype html><html lang=en><head><meta charset=utf-8>'
            f'<meta name=viewport content="width=device-width,initial-scale=1">'
            f'<title>AMPS Estate Answers</title><style>{CSS}</style></head><body><main>'
            f'<header><h1>AMPS Estate Agent · three answers</h1>'
            f'<span>Demo Industries (fictional seed) · BigQuery amps_demo · plain SQL</span></header>'
            f'{"".join(cards)}<footer>Same SQL as bigquery/agent/questions.sql · read only</footer>'
            f'</main></body></html>')
    (out / "pitch.html").write_text(page)
    print(f"\nwrote {out / 'pitch.html'}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "pitch_out")
