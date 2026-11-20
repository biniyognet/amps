/* Letters — the correspondence register in the Assets page's layout: one
   docked toolbar (search · mode stat-strip that filters · From · To), and each
   row carries an icon for its mode and for the people / offices on it. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ORG_ALIASES, getJSON, useMe } from './api.js'
import { PdfPane } from './tenders.jsx'
import { DWG_CSS, ViewControls } from './drawings.jsx'

const API = import.meta.env.VITE_AMPS_API ?? ''
const docUrl = (id) => `${API}/api/correspondence/${id}/file`
export const letterHref = (id) => `#/letters/view?id=${id}`
const isDrive = (l) => /drive\.google|docs\.google/.test(l || '')

// the operator's own name (and aliases) trails many addressees — drop it from the key
const ORG_TAIL = new RegExp(`\\s*(${ORG_ALIASES.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}).*$`, 'i')
const DESIG = /((?:[Dd][Yy]\.?\s?|[Ss][Rr]\.?\s?|[Cc][Hh]\.?\s?)?\b[A-Z]{2,5}(?:\s?\/\s?[A-Za-z0-9&.\-]+){1,2})/
const JUNK = /^=|^-+$|^_+$/

/* free-text sender / recipient → { key: office for the filter, person, label } */
export function partyOf(raw) {
  let t = (raw || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t || JUNK.test(t)) return null
  let person = ''
  const br = t.match(/^\[([^\]]+)\]\s*/)
  if (br) { person = br[1]; t = t.slice(br[0].length) }
  t = t.replace(/Senior Section Engineer/ig, 'SSE').replace(/Assistant Electrical Engineer/ig, 'AEE')
    .replace(/Senior Electrical Engineer/ig, 'SEE').replace(/Dy\.?\s*Chief Electrical Engineer/ig, 'Dy. CEE')
  t = t.replace(/^(for\.?|office of the|the)\s+/i, '')
  let key
  if (/^M\/s\b/i.test(t)) key = t.split(/[,;(]/)[0].trim()
  else {
    const m = t.match(DESIG)
    if (m) {
      key = m[1].replace(/\s*\/\s*/g, '/')
      const before = t.slice(0, m.index).replace(/\b(for|of|the)\b|[(,]/gi, ' ').trim()
      if (!person && /^[A-Za-z. ]{4,40}$/.test(before)) person = before
    } else key = t.split(/[,;\n]/)[0].trim()
  }
  key = key.replace(/\/(GREEN|GL)\b.*/i, '/GL').replace(ORG_TAIL, '')
    .toUpperCase().replace(/^M\/S\b/, 'M/s').slice(0, 30).trim()
  if (!key) return null
  return { key, person: person.replace(/\s+/g, ' ').trim(), label: t }
}

const initials = (p) => {
  const src = p.person || p.key.replace(/^M\/s\s*/i, '')
  const w = src.split(/[\s/.,&()-]+/).filter((x) => /[A-Za-z]/.test(x))
  return ((w[0] || '?')[0] + (p.person ? (w[w.length - 1] || '')[0] || '' : (w[1] || '')[0] || '')).toUpperCase()
}
const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h }

function Who({ p }) {
  if (!p) return <span className="dim">—</span>
  const ext = /^M\/s|KMRCL|WBSEDCL|SIEMENS|VOLTAS|@/i.test(p.key + p.label)
  return (
    <span className="lt-who" title={p.label}>
      <span className={`lt-av${ext ? ' ext' : ''}`} style={{ '--h': hue(p.key) }}>{initials(p)}</span>
      <span className="lt-wt"><b>{p.key}</b>{p.person && <small>{p.person}</small>}</span>
    </span>
  )
}

const ModeIcon = ({ mode }) => (
  <span className={`lt-mode is-${mode}`} title={mode === 'email' ? 'Email' : mode === 'mom' ? 'Minutes of meeting' : 'Letter'}>
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {mode === 'email' ? <><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" /></>
        : mode === 'mom' ? <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.4" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c3 0 6 1.8 6 5.5" /></>
        : <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>}
    </svg>
  </span>
)

function PartySelect({ label, value, set, opts }) {
  return (
    <select value={value} onChange={(e) => set(e.target.value)} aria-label={`Filter by ${label}`} title={label}>
      <option value="">{label}: all</option>
      {opts.map(([k, n]) => <option key={k} value={k}>{`${k} (${n})`}</option>)}
    </select>
  )
}

export function LettersView({ line = '' }) {
  const { me } = useMe()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [mode, setMode] = useState('all')   // all | letter | email | mom | linked
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  useEffect(() => {
    const lq = line ? `?line=${encodeURIComponent(line)}` : ''
    getJSON(`/api/correspondence${lq}`)
      .then((r) => setRows((r || []).map((x) => ({ ...x, _f: partyOf(x.sender), _t: partyOf(x.recipient) }))))
      .catch((e) => setError(String(e)))
  }, [line])
  const tally = (k) => {
    const c = new Map()
    for (const r of rows || []) if (r[k]) c.set(r[k].key, (c.get(r[k].key) || 0) + 1)
    return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }
  const fromOpts = useMemo(() => tally('_f'), [rows])
  const toOpts = useMemo(() => tally('_t'), [rows])
  if (error) return <div className="card offline-note">Backend unreachable — {error}.</div>
  if (rows === null) return <p className="dim">Loading correspondence…</p>
  const isLinked = (r) => r.related_assets && !['-', '___', ''].includes((r.related_assets || '').trim())
  const ql = q.trim().toLowerCase()
  const pre = rows.filter((r) => (!from || r._f?.key === from) && (!to || r._t?.key === to)
    && (!ql || [r.ref_no, r.subject, r.related_assets, r.brief, r.sender, r.recipient].some((v) => (v || '').toLowerCase().includes(ql))))
  const n = { all: pre.length, letter: 0, email: 0, mom: 0, linked: 0 }
  for (const r of pre) { n[r.mode] = (n[r.mode] || 0) + 1; if (isLinked(r)) n.linked++ }
  const shown = pre.filter((r) => mode === 'all' || (mode === 'linked' ? isLinked(r) : r.mode === mode))
  const fmt = (d) => d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
  const oneLine = (s, k = 90) => { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > k ? `${t.slice(0, k)}…` : t }
  const line_ = me?.line || line
  const STATS = [['all', 'All'], ['letter', 'Letters'], ['email', 'Emails'], ['mom', 'MOM'], ['linked', 'Asset-linked']]
  return (
    <>
      <div className="page-head"><h1>Letters {line_ && <span className="dim">· {line_}</span>}</h1></div>
      <div className="asset-toolbar lt-toolbar">
        <input className="asset-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Search subject, ref no., asset…" aria-label="Search correspondence" />
        <div className={`asset-kpis hstrip${mode !== 'all' ? ' has-pick' : ''}`} role="group" aria-label="Mode">
          {STATS.map(([k, lbl]) => (
            <button key={k} type="button" className={`rk-stat${mode === k ? ' on' : ''}`} aria-pressed={mode === k}
                    onClick={() => setMode(mode === k && k !== 'all' ? 'all' : k)}>
              {k !== 'all' && k !== 'linked' && <ModeIcon mode={k} />}
              <span className="v">{n[k].toLocaleString()}</span><span className="k">{lbl}</span>
            </button>
          ))}
        </div>
        <PartySelect label="From" value={from} set={setFrom} opts={fromOpts} />
        <PartySelect label="To" value={to} set={setTo} opts={toOpts} />
        {(q || from || to || mode !== 'all') && (
          <button type="button" className="btn ghost sm" onClick={() => { setQ(''); setFrom(''); setTo(''); setMode('all') }}>Clear</button>)}
        <span className="asset-count">{shown.length} shown</span>
      </div>
      {shown.length === 0 ? (
        <div className="card"><p className="dim" style={{ margin: 0 }}>No correspondence in this view.</p></div>
      ) : (
        <div className="card tbl-wrap">
          <table className="jc-table corr-table lt-table">
            <colgroup>
              <col style={{ width: '8%' }} /><col style={{ width: '4%' }} /><col style={{ width: '13%' }} />
              <col style={{ width: '31%' }} /><col style={{ width: '13%' }} /><col style={{ width: '13%' }} />
              <col style={{ width: '13%' }} /><col style={{ width: '5%' }} />
            </colgroup>
            <thead><tr><th>Date</th><th aria-label="Mode" /><th>Ref no.</th><th>Subject</th><th>Related assets</th><th>From</th><th>To</th><th>Doc</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="dim" data-l="Date">{fmt(r.date)}</td>
                  <td data-l="Mode"><ModeIcon mode={r.mode} /></td>
                  <td className="wrap-cell" data-l="Ref no."><span className="code">{oneLine(r.ref_no, 40) || '—'}</span></td>
                  <td className="wrap-cell" data-l="Subject" title={r.brief || ''}>{oneLine(r.subject, 120) || '—'}</td>
                  <td className="wrap-cell dim" data-l="Related assets">{oneLine(r.related_assets, 60) || '—'}</td>
                  <td data-l="From"><button type="button" className="lt-pick" onClick={() => r._f && setFrom(r._f.key)} title="Show only letters from here"><Who p={r._f} /></button></td>
                  <td data-l="To"><button type="button" className="lt-pick" onClick={() => r._t && setTo(r._t.key)} title="Show only letters to here"><Who p={r._t} /></button></td>
                  <td data-l="Doc">{r.link && isDrive(r.link) && !/\/folders\//.test(r.link)
                    ? <a className="mini-btn" href={letterHref(r.id)}>Open</a>
                    : r.link && /^https?:\/\//.test(r.link)
                      ? <a className="mini-btn" href={r.link} target="_blank" rel="noreferrer">Open</a>
                      : <span className="dim">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/* ── Letter viewer: the scan opens here (local copy, pulled from Drive on first
   open), beside the letter's details; the Drive link stays as the record. ── */
const fmtD = (d) => d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export function LetterViewer({ id }) {
  const [r, setR] = useState(null)
  const [error, setError] = useState(null)
  const [st, setSt] = useState(null)        // fetch state while the copy is pulled
  const [page, setPage] = useState(1)
  const [rot, setRot] = useState(0)
  const [fit, setFit] = useState('page-width')
  const pdfApi = useRef(null)
  useEffect(() => {
    let alive = true
    setR(null); setError(null); setSt(null); setPage(1); setRot(0)
    getJSON(`/api/correspondence/${id}`).then((x) => {
      if (!alive) return
      setR(x)
      if (!x.on_server && x.fetchable) {
        const poll = () => fetch(`${API}/api/correspondence/${id}/fetch`, { method: 'POST' })
          .then(async (res) => { const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(j.detail || `failed (${res.status})`); return j })
          .then((j) => {
            if (!alive) return
            if (j.state === 'ready') setR({ ...x, on_server: true })
            else if (j.state === 'fetching') { setSt(j); setTimeout(poll, 1500) }
            else setSt(j)
          })
          .catch((e) => alive && setSt({ state: 'failed', error: e.message }))
        poll()
      }
    }).catch((e) => alive && setError(String(e)))
    return () => { alive = false }
  }, [id])
  if (error) return <div className="card offline-note">Sign in to view letters — {error}.</div>
  if (r === null) return <p className="dim">Loading letter…</p>
  const pages = pdfApi.current?.pv?.pagesCount
  const go = (n) => setPage(Math.max(1, pages ? Math.min(pages, n) : n))
  const drive = r.link && /^https?:\/\//.test(r.link)
    ? <a href={r.link} target="_blank" rel="noreferrer">Open in Drive</a> : null
  const img = <div className="card" style={{ textAlign: 'center' }}><img src={docUrl(r.id)} alt={r.subject || 'Letter'} style={{ maxWidth: '100%' }} /></div>
  const wait = !r.on_server && (r.fetchable && (!st || st.state === 'fetching')
    ? <div className="card"><p className="dim">Fetching the scan from Drive…{st?.got ? ` ${(st.got / 1048576).toFixed(1)} MB` : ''} — first open only, it is kept on the server after this.</p></div>
    : <div className="card offline-note">{st?.error ? `Could not fetch the scan — ${st.error}.` : 'The scan is not on the server.'} {drive}</div>)
  const f = partyOf(r.sender), t = partyOf(r.recipient)
  return (
    <>
      <style>{DWG_CSS}</style>
      <div className="dw-bar">
        <a className="btn ghost sm" href="#/letters">← Letters</a>
        <ModeIcon mode={r.mode} />
        <b style={{ marginRight: 'auto' }}>{r.subject || r.ref_no || 'Letter'}</b>
        {r.on_server && <>
          <button type="button" className="btn ghost sm" onClick={() => go(page - 1)} disabled={page <= 1}>‹ Prev</button>
          <span className="dim">p. {page}{pages ? ` / ${pages}` : ''}</span>
          <button type="button" className="btn ghost sm" onClick={() => go(page + 1)} disabled={!!pages && page >= pages}>Next ›</button>
          <ViewControls rot={rot} setRot={setRot} fit={fit} setFit={setFit} />
          <a className="btn ghost sm" href={docUrl(r.id)} target="_blank" rel="noreferrer">Open file</a>
        </>}
      </div>
      <div className="dw">
        <main>
          {wait || <PdfPane key={r.id} url={docUrl(r.id)} page={page} q="" onPage={setPage} api={pdfApi} fallback={img} rotation={rot} fit={fit} />}
        </main>
        <aside className="card dw-side">
          <h3>Details</h3>
          <dl>
            <dt>Date</dt><dd>{fmtD(r.date)}</dd>
            <dt>Ref no.</dt><dd className="code">{r.ref_no || '—'}</dd>
            <dt>From</dt><dd><Who p={f} /></dd>
            <dt>To</dt><dd><Who p={t} /></dd>
            {r.copy_to && <><dt>Copy</dt><dd>{r.copy_to}</dd></>}
            {r.related_assets && <><dt>Assets</dt><dd>{r.related_assets}</dd></>}
            {r.line && <><dt>Line</dt><dd>{r.line}</dd></>}
            {r.drafting_by && <><dt>Drafted</dt><dd>{r.drafting_by}{r.drafting_date && ` · ${fmtD(r.drafting_date)}`}</dd></>}
          </dl>
          {r.brief && <><h3>Brief</h3><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.brief}</p></>}
          {drive && <><h3>Source</h3><p style={{ margin: 0 }}>{drive}</p></>}
        </aside>
      </div>
    </>
  )
}
