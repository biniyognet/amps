// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arup Biswas
// AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

/* Drawings & manuals — the PS drawing register (as-built sets, schematics,
   SLDs, O&M manuals), each tagged to its system, class, station and assets.
   The register page filters inline; a drawing opens in the viewer (pdf.js,
   byte-range, same engine as the contract reader) beside its details and the
   assets it covers. The asset page lists its own drawings. Signed-in only,
   from /api/drawings; tender drawings from the contract volumes follow below. */
import { useEffect, useRef, useState } from 'react'
import { getJSON } from './api.js'
import { PdfPane, TenderDrawings } from './tenders.jsx'

const API = import.meta.env.VITE_AMPS_API ?? ''
const has = (q, ...vals) => !q || vals.some((v) => String(v ?? '').toLowerCase().includes(q))
const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort()
export const viewHref = (id, p) => `#/drawings/view?d=${encodeURIComponent(id)}${p && p > 1 ? `&p=${p}` : ''}`
const fileUrl = (id) => `${API}/api/drawings/${encodeURIComponent(id)}/file`
/* rotate (landscape ⇄ portrait) + fit width / whole page, for the PDF viewers */
export function ViewControls({ rot, setRot, fit, setFit }) {
  return <>
    <button type="button" className="btn ghost sm" onClick={() => setRot((r) => (r + 270) % 360)} title="Rotate left" aria-label="Rotate left">⟲</button>
    <button type="button" className="btn ghost sm" onClick={() => setRot((r) => (r + 90) % 360)} title="Rotate right (landscape ⇄ portrait)" aria-label="Rotate right">⟳ Rotate</button>
    <button type="button" className="btn ghost sm" onClick={() => setFit((f) => f === 'page-fit' ? 'page-width' : 'page-fit')}
            title={fit === 'page-fit' ? 'Fit to width' : 'Show the whole page'}>{fit === 'page-fit' ? '↔ Fit width' : '⤢ Whole page'}</button>
  </>
}

const size = (b) => !b ? '' : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

export const DWG_CSS = `
.dw-filters { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.dw-filters select { max-width: 200px; }
.dw-stage { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 9px; background: var(--accent-soft); white-space: nowrap; }
.dw-stage.old { background: transparent; border: 1px dashed var(--accent-line); opacity: .75; }
.dw-stage.latest { background: #e9f7ef; color: #1e7a46; font-weight: 600; }
.dw-kind { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; opacity: .7; }
.dw { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 12px; align-items: start; }
.dw { --rd-top: calc(var(--topbar-h, 72px) + 52px); }
.dw-side { position: sticky; top: var(--rd-top); max-height: calc(100vh - var(--rd-top) - 10px); overflow: auto; font-size: 13px; }
.dw-side h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .5px; margin: 12px 0 6px; color: var(--accent); }
.dw-side dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0; }
.dw-side dt { opacity: .65; } .dw-side dd { margin: 0; }
.dw-side ul { list-style: none; padding: 0; margin: 0; }
.dw-side li { padding: 3px 0; border-bottom: 1px solid var(--accent-line); }
.dw-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
.dw .rd-pdf { position: relative; height: calc(100vh - var(--rd-top) - 50px); padding: 0; overflow: hidden; background: #e6e6e6; }
.dw .rd-pdf-box { position: absolute; inset: 0; overflow: auto; }
.dw .rd-pdf-wait { position: absolute; top: 12px; left: 12px; z-index: 2; }
@media (max-width: 900px) { .dw { grid-template-columns: 1fr; } .dw-side { position: static; max-height: none; } }
`

function Stage({ d }) {
  const cls = d.superseded ? 'old' : d.latest ? 'latest' : ''
  return d.stage ? <span className={`dw-stage ${cls}`} title={d.superseded ? 'Superseded by a later issue' : d.latest ? 'Latest issue' : ''}>{d.stage}</span> : null
}

function useRegister() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { getJSON('/api/drawings').then(setData).catch((e) => setError(String(e))) }, [])
  return { data, error }
}

/* ── Register ───────────────────────────────────────────────────────────── */
export function DrawingsView() {
  const { data, error } = useRegister()
  const [q, setQ] = useState('')
  const [f, setF] = useState({ kind: '', system: '', cls: '', location: '', latest: true })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  if (error) return <div className="card offline-note">Sign in to view drawings — {error}.</div>
  if (data === null) return <p className="dim">Loading drawings…</p>
  const all = data.drawings
  const ql = q.trim().toLowerCase()
  const shown = all.filter((d) => (!f.kind || d.kind === f.kind) && (!f.system || d.system === f.system)
    && (!f.cls || d.cls === f.cls) && (!f.location || d.location === f.location) && (!f.latest || !d.superseded)
    && has(ql, d.title, d.file, d.cls, d.location, d.dtype, d.section, d.remarks))
  const sel = (k, label, opts) => (
    <select value={f[k]} onChange={set(k)} aria-label={label}>
      <option value="">{label}</option>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
  return (
    <>
      <style>{DWG_CSS}</style>
      <div className="page-head"><h1>Drawings <span className="dim">· {data.line}</span></h1></div>
      <p className="dim" style={{ marginTop: -6 }}>
        As-built drawings, schematics and O&amp;M manuals, tagged to system, class, station and asset. Source: {data.source} · indexed {data.built}.
      </p>
      <div className="asset-toolbar">
        <input className="asset-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Search title, file, class, station…" aria-label="Search drawings" />
        <div className="dw-filters">
          {sel('kind', 'Drawings & manuals', ['drawing', 'manual'])}
          {sel('system', 'All systems', uniq(all.map((d) => d.system)))}
          {sel('cls', 'All classes', uniq(all.map((d) => d.cls)))}
          {sel('location', 'All stations', uniq(all.map((d) => d.location)))}
          <label className="dim" style={{ fontSize: 13 }}><input type="checkbox" checked={f.latest} onChange={set('latest')} /> hide superseded</label>
        </div>
        {(q || f.kind || f.system || f.cls || f.location) && (
          <button type="button" className="btn ghost sm" onClick={() => { setQ(''); setF({ kind: '', system: '', cls: '', location: '', latest: f.latest }) }}>Clear</button>
        )}
        <span className="asset-count">{shown.length} of {all.length}</span>
      </div>
      <div className="card tbl-wrap">
        <table className="jc-table corr-table">
          <colgroup>
            <col style={{ width: '5%' }} /><col style={{ width: '37%' }} /><col style={{ width: '17%' }} />
            <col style={{ width: '15%' }} /><col style={{ width: '14%' }} /><col style={{ width: '6%' }} /><col style={{ width: '6%' }} />
          </colgroup>
          <thead><tr><th>S N</th><th>Title</th><th>Class · system</th><th>Station</th><th>Stage</th><th>Assets</th><th>File</th></tr></thead>
          <tbody>
            {shown.map((d) => (
              <tr key={d.id}>
                <td className="dim" data-l="S N">{d.sn}</td>
                <td className="wrap-cell" data-l="Title">
                  <a href={viewHref(d.id)}>{d.title}</a>
                  <div className="dim" style={{ fontSize: 12 }}><span className="dw-kind">{d.kind}</span>{d.dtype && <> · {d.dtype}</>}{d.remarks && <> · {d.remarks}</>}</div>
                </td>
                <td className="wrap-cell" data-l="Class · system">{d.cls}<div className="dim" style={{ fontSize: 12 }}>{d.system}</div></td>
                <td className="wrap-cell" data-l="Station">{d.location}</td>
                <td data-l="Stage"><Stage d={d} />{d.date && <div className="dim" style={{ fontSize: 12 }}>{d.date}</div>}</td>
                <td data-l="Assets">{d.assets || <span className="dim">—</span>}</td>
                <td className="dim" data-l="File" title={d.file}>{d.ext.toUpperCase()}<div style={{ fontSize: 11 }}>{size(d.size)}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 style={{ marginTop: 28 }}>Tender drawings <span className="dim">· contract volumes</span></h2>
      <TenderDrawings embedded />
    </>
  )
}

/* ── Viewer: #/drawings/view?d=<id>&p=3 ──────────────────────────────────── */
export function DrawingViewer({ id, page: p0 }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(Number(p0) || 1)
  const [fetchErr, setFetchErr] = useState(null)
  const [got, setGot] = useState(0)
  const [rot, setRot] = useState(0)
  const [fit, setFit] = useState('page-fit')
  const pdfApi = useRef(null)
  useEffect(() => {
    let alive = true
    setD(null); setError(null); setFetchErr(null); setGot(0); setRot(0); setPage(Number(p0) || 1)
    getJSON(`/api/drawings/${encodeURIComponent(id)}`).then((x) => {
      if (!alive) return
      setD(x)
      if (!x.on_server && x.fetchable) { // first open: the server pulls it from Drive and keeps it
        const poll = () => fetch(`${API}/api/drawings/${encodeURIComponent(id)}/fetch`, { method: 'POST' })
          .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.detail || `failed (${r.status})`); return j })
          .then((j) => {
            if (!alive) return
            if (j.state === 'ready') setD({ ...x, on_server: true })
            else if (j.state === 'fetching') { setGot(j.got || 0); setTimeout(poll, 1500) }
            else throw new Error(j.error || 'no Drive copy noted')
          })
          .catch((e) => alive && setFetchErr(e.message))
        poll()
      }
    }).catch((e) => alive && setError(String(e)))
    return () => { alive = false }
  }, [id])
  useEffect(() => { // keep the page in the hash so a link reopens on it
    if (!d) return
    const want = viewHref(id, page)
    if (location.hash !== want) history.replaceState(null, '', want)
  }, [page, d])
  useEffect(() => {
    const set = () => { const tb = document.querySelector('.topbar'); if (tb) document.documentElement.style.setProperty('--topbar-h', `${tb.offsetHeight}px`) }
    set(); window.addEventListener('resize', set); return () => window.removeEventListener('resize', set)
  }, [])
  if (error) return <div className="card offline-note">{error.includes('404') ? 'No such drawing in the register.' : `Sign in to view drawings — ${error}.`}</div>
  if (!d) return <p className="dim">Loading drawing…</p>
  const pdf = d.ext === 'pdf'
  const pages = pdfApi.current?.pv?.pagesCount
  const go = (n) => setPage(Math.max(1, pages ? Math.min(pages, n) : n))
  const fetching = !d.on_server && d.fetchable && !fetchErr
  const nofile = fetching
    ? <div className="card"><p className="dim">Fetching from Drive… {got ? `${size(got)} of ` : ''}{size(d.size)} — first open only, it is kept on the server after this.</p></div>
    : <div className="card offline-note">{fetchErr ? `Could not fetch the file from Drive — ${fetchErr}.` : 'The file is not on the server yet.'} <a href="#/drawings">Back to the register</a>.</div>
  return (
    <>
      <style>{DWG_CSS}</style>
      <div className="dw-bar">
        <a className="btn ghost sm" href="#/drawings">← Drawings</a>
        <b style={{ marginRight: 'auto' }}>{d.title} <Stage d={d} /></b>
        {pdf && d.on_server && <>
          <button type="button" className="btn ghost sm" onClick={() => go(page - 1)} disabled={page <= 1}>‹ Prev</button>
          <span className="dim">p. {page}{pages ? ` / ${pages}` : ''}</span>
          <button type="button" className="btn ghost sm" onClick={() => go(page + 1)} disabled={!!pages && page >= pages}>Next ›</button>
          <ViewControls rot={rot} setRot={setRot} fit={fit} setFit={setFit} />
        </>}
        {d.on_server && <a className="btn ghost sm" href={fileUrl(d.id)} target="_blank" rel="noreferrer">{pdf ? 'Open PDF' : `Download ${d.ext.toUpperCase()}`}</a>}
      </div>
      <div className="dw">
        <main>
          {!d.on_server ? nofile
            : pdf ? <PdfPane key={d.id} url={fileUrl(d.id)} page={page} q="" onPage={setPage} api={pdfApi} fallback={nofile} rotation={rot} fit={fit} />
            : <div className="card">
                <p>{d.file} <span className="dim">· {d.ext.toUpperCase()} · {size(d.size)}</span></p>
                <p className="dim">This file type does not open in the browser — download it to view.</p>
                <a className="btn" href={fileUrl(d.id)}>Download</a>
              </div>}
        </main>
        <aside className="card dw-side">
          <h3>Details</h3>
          <dl>
            <dt>S N</dt><dd>{d.sn}</dd>
            <dt>Kind</dt><dd>{d.kind}{d.dtype && ` · ${d.dtype}`}</dd>
            <dt>System</dt><dd>{d.system || '—'}</dd>
            <dt>Class</dt><dd>{d.cls || '—'}</dd>
            <dt>Station</dt><dd>{d.location || '—'}</dd>
            <dt>Section</dt><dd>{d.section || '—'}</dd>
            <dt>Stage</dt><dd>{d.stage || '—'}{d.date && ` · ${d.date}`}</dd>
            <dt>File</dt><dd style={{ wordBreak: 'break-all' }}>{d.file} <span className="dim">({size(d.size)})</span></dd>
            {d.remarks && <><dt>Remarks</dt><dd>{d.remarks}</dd></>}
          </dl>
          {d.siblings?.length > 0 && <>
            <h3>Other issues of this set</h3>
            <ul>{d.siblings.map((s) => (
              <li key={s.id}><a href={viewHref(s.id)}>{s.title}</a> <span className="dim">{s.stage}{s.date && ` · ${s.date}`}</span>{s.latest && <b> · latest</b>}</li>
            ))}</ul>
          </>}
          <h3>Assets covered · {d.linked.length}</h3>
          {d.linked.length === 0 ? <p className="dim">Not tied to a single asset (general / line-wide document).</p>
            : <ul>{d.linked.slice(0, 200).map((a) => (
                <li key={a.id}><a href={`#/asset/${encodeURIComponent(a.code)}`}><span className="code">{a.code}</span></a> {a.name}
                  <div className="dim" style={{ fontSize: 12 }}>{a.location}</div></li>
              ))}{d.linked.length > 200 && <li className="dim">…and {d.linked.length - 200} more</li>}</ul>}
        </aside>
      </div>
    </>
  )
}

/* ── Asset page card: the drawings and manuals tagged to this asset ─────── */
export function AssetDrawings({ code, location }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let alive = true
    setRows(null)
    getJSON(`/api/drawings/for-asset?code=${encodeURIComponent(code)}&location=${encodeURIComponent(location || '')}`)
      .then((r) => alive && setRows(r)).catch(() => alive && setRows(false)) // signed out → no card
    return () => { alive = false }
  }, [code, location])
  if (!rows) return null
  return (
    <div className="card">
      <style>{DWG_CSS}</style>
      <div className="sect">
        <h3>Drawings &amp; manuals <span className="dim">· {rows.length}</span></h3>
        {rows.length === 0 ? <p className="dim">No drawing tagged to this asset yet. <a href="#/drawings">Browse the register</a>.</p>
          : <table className="jc-table corr-table">
              <tbody>{rows.map((d) => (
                <tr key={d.id} style={d.superseded ? { opacity: .6 } : undefined}>
                  <td className="wrap-cell" data-l="Drawing">
                    <a href={viewHref(d.id)}>{d.title}</a>
                    <div className="dim" style={{ fontSize: 12 }}><span className="dw-kind">{d.kind}</span> · {d.cls}{d.location && d.location !== location && <> · {d.location}</>}</div>
                  </td>
                  <td data-l="Stage"><Stage d={d} />{d.date && <div className="dim" style={{ fontSize: 12 }}>{d.date}</div>}</td>
                  <td className="dim" data-l="File">{d.ext.toUpperCase()} · {size(d.size)}</td>
                </tr>
              ))}</tbody>
            </table>}
      </div>
    </div>
  )
}
