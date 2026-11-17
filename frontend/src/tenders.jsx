// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arup Biswas
// AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

/* Tenders & Drawings — contract volume index, issues (clauses, linked letters,
   failures and job cards, all kept by hand), the contract reader with notes and
   bookmarks, and the drawing register. Served signed-in from /api/tenders. */
import { Fragment, useEffect, useRef, useState } from 'react'
import { getJSON } from './api.js'

function useTenders() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const reload = () => getJSON('/api/tenders').then(setData).catch((e) => setError(String(e)))
  useEffect(() => { reload() }, [])
  return { data, error, reload }
}

/* write to the API; throws the server's reason so forms can show it */
async function send(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : j.detail?.[0]?.msg || `failed (${r.status})`)
  return j
}

const CAP = { fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }
const FORM = { display: 'grid', gap: 8 }
const Lbl = ({ t, children, hint }) => (
  <label style={{ display: 'grid', gap: 3, fontSize: 13 }}>
    <span className="dim">{t}{hint && <span style={{ fontWeight: 400 }}> · {hint}</span>}</span>{children}
  </label>
)
const Err = ({ m }) => m ? <span style={{ color: 'var(--bad, #c33)', fontSize: 13 }}>{m}</span> : null

const gate = (error, data, what) => {
  if (error) return <div className="card offline-note">Sign in to view {what} — {error}.</div>
  if (data === null) return <p className="dim">Loading {what}…</p>
  return null
}

const has = (q, ...vals) => !q || vals.some((v) => String(v ?? '').toLowerCase().includes(q))

/* the issue id lives in the hash query: #/tenders?issue=ETS-SDAH */
const issueParam = () => new URLSearchParams(location.hash.split('?')[1] || '').get('issue')

/* park the hood exactly under the sticky topbar, like the asset pages */
function useTopbarVar() {
  useEffect(() => {
    const set = () => { const tb = document.querySelector('.topbar'); if (tb) document.documentElement.style.setProperty('--topbar-h', `${tb.offsetHeight}px`) }
    set(); window.addEventListener('resize', set); return () => window.removeEventListener('resize', set)
  })
}

const readHref = (vol, p, iid, c) => `#/tenders/read?v=${vol}&p=${p || 1}${c && c !== 'c1' ? `&c=${c}` : ''}${iid ? `&i=${encodeURIComponent(iid)}` : ''}`
const volKey = (r) => r.vol.split(' ')[0]
const SECT = { scrollMarginTop: 'calc(var(--topbar-h, 78px) + 64px)', marginTop: 18 }
const ref = (x) => x.link ? <a href={x.link} target="_blank" rel="noreferrer">{x.ref_no || x.jc || 'Open'}</a>
  : <span className="code">{x.ref_no || x.jc}</span>

function Search({ q, setQ, ph }) {
  return (
    <>
      <input className="asset-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
             placeholder={ph} aria-label="Search" />
      {q && <button type="button" className="btn ghost sm" onClick={() => setQ('')}>Clear</button>}
    </>
  )
}

/* clause table — shared by the list (search hits) and the issue page */
function ClauseTable({ rows, onDel, iid }) {
  if (!rows.length) return <div className="card"><p className="dim" style={{ margin: 0 }}>No clauses match.</p></div>
  return (
    <div className="card tbl-wrap">
      <table className="jc-table corr-table">
        <colgroup>
          <col style={{ width: '12%' }} /><col style={{ width: '8%' }} /><col style={{ width: '14%' }} />
          <col style={{ width: '33%' }} /><col style={{ width: '33%' }} />
        </colgroup>
        <thead><tr><th>Volume</th><th>Page</th><th>Clause</th><th>What it says</th><th>Use</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="wrap-cell dim" data-l="Volume">{r.contract} · {r.vol}</td>
              <td data-l="Page" title="Open in the contract reader"><a href={readHref(volKey(r), range(r.pdf_p)?.[0], r._iid || iid, r.c)}>{r.pdf_p}</a>{r.printed_p !== '—' && <span className="dim"> ({r.printed_p})</span>}</td>
              <td className="wrap-cell" data-l="Clause"><span className="code">{r.clause}</span><div className="dim">{r.topic}</div></td>
              <td className="wrap-cell" data-l="What it says">{r.extract}</td>
              <td className="wrap-cell" data-l="Use">{r.use}
                {onDel && r.id && <div className="dim" style={{ marginTop: 4, fontSize: 12 }}>
                  added by {r.by}{' '}<button type="button" className="btn ghost sm" onClick={() => onDel(r)}>Remove</button></div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function TendersView() {
  useTopbarVar()
  const { data, error, reload } = useTenders()
  const iid = issueParam()
  if (new URLSearchParams(location.hash.split('?')[1] || '').has('guide')) return <TendersGuide />
  const g = gate(error, data, 'tenders')
  if (g) return g
  const can = !!data.can_edit
  const iss = iid && (data.issues || []).find((i) => i.id === iid)
  return iss ? <IssuePage key={iss.id} iss={iss} tenders={data.tenders || []} reload={reload} can={can} />
    : <TenderList data={data} reload={reload} can={can} />
}

/* 1 · all tenders (each volume opens in the reader) · 2 · issues · search across both */
/* Tenders page: every note in one table across contracts — status dropdown (any writer), edit (author) */
const NCL_CSS = `
.ncl-f button.dk { border: 0; cursor: pointer; font: inherit; font-size: 11.5px; }
.ncl-f .dk.on { background: var(--accent); color: #fff; }
.ncl-tbl td { vertical-align: top; font-size: 13px; }
.ncl-tbl .ncl-k.important { color: #d33; } .ncl-tbl .ncl-k.bookmark { color: #b98500; }
.ncl-tbl .ch { display: inline-block; font-size: 11px; padding: 0 6px; margin: 0 3px 2px 0; border-radius: 9px; background: #eef1f5; }
.ncl-tbl .sys { background: #f1e9fb; color: #5a3591; } .ncl-tbl .as { background: #e8f0fb; color: #1f4f8a; font-family: ui-monospace, monospace; }
.ncl-tbl select.ncl-st { font-size: 12px; padding: 1px 4px; border-radius: 6px; }
.ncl-tbl select.st-pending { background: #fff3d6; color: #8a5a00; } .ncl-tbl select.st-verified { background: #e2f5e6; color: #1e6b33; }
.ncl-ed { display: grid; gap: 4px; min-width: 220px; } .ncl-ed input, .ncl-ed textarea { width: 100%; font: inherit; font-size: 13px; }
.ncl-tbl td.nw { white-space: nowrap; }
.nd-back { position: fixed; inset: 0; background: rgba(10,25,40,.25); z-index: 90; }
.nd { position: fixed; top: 0; right: 0; bottom: 0; width: min(400px, 100vw); z-index: 91; background: #fff; box-shadow: -10px 0 30px -12px rgba(10,25,40,.4);
  padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; animation: nd-in .16s ease-out; }
@keyframes nd-in { from { transform: translateX(24px); opacity: .4; } }
.nd-h { display: flex; align-items: baseline; gap: 8px; }
.nd label { display: grid; gap: 3px; font-size: 12px; color: var(--ink-2); }
.nd input, .nd textarea, .nd select { width: 100%; min-width: 0; font: inherit; font-size: 13.5px; color: var(--ink); }
.nd-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.nd .rd-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.nd .rd-asset { font-size: 11px; padding: 1px 6px; border-radius: 9px; font-family: ui-monospace, monospace; background: #e8f0fb; color: #1f4f8a; }
.nd .rd-x { border: 0; background: none; padding: 0 0 0 4px; cursor: pointer; color: inherit; font: inherit; }
.nd-f { display: flex; gap: 8px; margin-top: auto; padding-top: 8px; border-top: 1px solid var(--border); }
.ncl-tbl { table-layout: auto; width: 100%; }
.ncl-tbl th:first-child, .ncl-tbl td:first-child { width: 1%; text-align: right; }
.ncl-tbl th:nth-child(2), .ncl-tbl td:nth-child(2) { width: 45%; min-width: 320px; }
.ncl-tbl td:nth-child(2) { white-space: pre-wrap; word-break: break-word; }
.ncl-ed { min-width: 300px; }
`
/* Edit a note from the Tenders page — opens as a right sidebar, same fields as the reader's notes bar */
function NoteDrawer({ ed, setEd, issues, onSave, err }) {
  const [all, setAll] = useState(null)
  useEffect(() => { getJSON('/api/tenders/note-assets').then(setAll).catch(() => setAll([])) }, [])
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') setEd(null) }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [setEd])
  const list = all || []
  const systems = [...new Set(list.map((a) => a.system).filter(Boolean))].sort()
  const pool = list.filter((a) => (!ed.system || a.system === ed.system) && !ed.assets.includes(a.code))
  const nameOf = (code) => list.find((a) => a.code === code)?.name || ''
  return (
    <>
      <div className="nd-back" onClick={() => setEd(null)} />
      <aside className="nd" role="dialog" aria-label="Edit note">
        <div className="nd-h"><h3 style={{ margin: 0 }}>Edit note</h3>
          <a className="dim" href={ed.href} style={{ fontSize: 12 }} title="Open the page in the reader">{ed.where} ›</a>
          <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setEd(null)} aria-label="Close">✕</button></div>
        <label>Title<input value={ed.title} maxLength={120} placeholder="Title (optional)" onChange={(e) => setEd({ ...ed, title: e.target.value })} /></label>
        <label>Note<textarea rows={6} value={ed.text} maxLength={2000} onChange={(e) => setEd({ ...ed, text: e.target.value })}
                             onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave() }} /></label>
        <div className="nd-2">
          <label>System<select value={ed.system} onChange={(e) => setEd({ ...ed, system: e.target.value })}>
            <option value="">{all ? '—' : 'Loading…'}</option>{systems.map((x) => <option key={x} value={x}>{x}</option>)}
          </select></label>
          <label>Add asset<select value="" disabled={!all} onChange={(e) => {
            const a = list.find((x) => x.code === e.target.value); if (!a) return
            setEd({ ...ed, assets: [...ed.assets, a.code], system: ed.system || a.system })
          }}>
            <option value="">{ed.system ? `In ${ed.system}…` : 'Any system…'}</option>
            {pool.slice(0, 1500).map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
          </select></label>
        </div>
        {ed.assets.length > 0 && (
          <div className="rd-chips">{ed.assets.map((c) => (
            <span key={c} className="rd-asset" title={nameOf(c)}>{c}
              <button type="button" className="rd-x" aria-label={`Remove ${c}`} onClick={() => setEd({ ...ed, assets: ed.assets.filter((x) => x !== c) })}>×</button></span>
          ))}</div>
        )}
        <div className="nd-2">
          <label>Issue<select value={ed.issue_id} onChange={(e) => setEd({ ...ed, issue_id: e.target.value })}>
            <option value="">No issue</option>{issues.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
          </select></label>
          <label>Status<select value={ed.status} onChange={(e) => setEd({ ...ed, status: e.target.value })}>
            <option value="">—</option>{Object.entries(NSTATUS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select></label>
        </div>
        {err && <div style={{ color: 'var(--critical)', fontSize: 13 }}>{err}</div>}
        <div className="nd-f">
          <button type="button" className="btn preset" onClick={onSave}>Save changes</button>
          <button type="button" className="btn ghost" onClick={() => setEd(null)}>Cancel</button>
        </div>
      </aside>
    </>
  )
}

function NoteChecklist({ issues, ql, can }) {
  const [notes, setNotes] = useState(null)
  const [show, setShow] = useState('pending')
  const [err, setErr] = useState('')
  const [ed, setEd] = useState(null)   // { id, title, text } while editing a row inline
  useEffect(() => { getJSON('/api/tenders/notes').then(setNotes).catch(() => setNotes([])) }, [])
  if (!notes) return null
  const iName = (id) => issues.find((i) => i.id === id)?.title || id
  const base = notes.filter((n) => n.text || n.title || (n.kind === 'note' && n.status))
    .filter((n) => has(ql, n.title, n.text, n.system, n.by, n.vol, ...(n.assets || []), ...(n.tags || []), n.issue_id && iName(n.issue_id)))
  const isV = (n) => n.status === 'verified'
  const nPend = base.filter((n) => !isV(n)).length
  const rows = base.filter((n) => (show === 'all' ? true : show === 'verified' ? isV(n) : !isV(n)))
    .sort((x, y) => (isV(x) - isV(y)) || x.id - y.id)
  const put = async (id, body) => {
    try {
      const m = await send('PATCH', `/api/tenders/notes/${id}`, body)
      setNotes((xs) => xs.map((x) => (x.id === id ? m : x))); setErr(''); return true
    } catch (x) { setErr(x.message); return false }
  }
  const saveEd = async () => {
    if (await put(ed.id, { title: ed.title.trim(), text: ed.text.trim(), issue_id: ed.issue_id || '', status: ed.status || '',
                           system: ed.system || '', assets: ed.assets })) setEd(null)
  }
  return (
    <>
      <style>{NCL_CSS}</style>
      <h2 style={{ margin: '20px 0 8px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>Notes <span className="dim">· {nPend} pending of {base.length}</span></span>
        <span className="dash-kpis ncl-f" style={{ marginLeft: 'auto' }}>
          {[['pending', `Pending ${nPend}`], ['verified', `Verified ${base.length - nPend}`], ['all', `All ${base.length}`]].map(([k, t]) => (
            <button key={k} type="button" className={`dk${show === k ? ' on' : ''}`} onClick={() => setShow(k)}>{t}</button>
          ))}
        </span>
      </h2>
      {err && !ed && <div className="dim" style={{ color: 'var(--critical)', marginBottom: 6 }}>{err}</div>}
      {ed && <NoteDrawer ed={ed} setEd={setEd} issues={issues} onSave={saveEd} err={err} />}
      {!rows.length ? (
        <div className="card"><p className="dim" style={{ margin: 0 }}>{base.length ? 'Nothing here.' : 'No notes yet — add them in the Reader’s right bar.'}</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="jc-table corr-table ncl-tbl">
            <thead><tr><th className="nw">Sl</th><th>Note</th><th>System</th><th>Assets</th><th>Issue</th><th>Page</th><th>By</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((n, i) => (
                <tr key={n.id}>
                  <td data-l="Sl" className="nw dim">{i + 1}</td>
                  <td data-l="Note">
                    {n.title && <b>{n.title}</b>}{n.title && n.text && ' — '}{n.text}
                    {(n.tags || []).length > 0 && <div>{n.tags.map((t) => <span key={t} className="ch">#{t}</span>)}</div>}
                  </td>
                  <td data-l="System">{n.system ? <span className="ch sys">{n.system}</span> : <span className="dim">—</span>}</td>
                  <td data-l="Assets">{(n.assets || []).length ? n.assets.map((x) => <span key={x} className="ch as">{x}</span>) : <span className="dim">—</span>}</td>
                  <td data-l="Issue">{n.issue_id ? <a href={`#/tenders?issue=${encodeURIComponent(n.issue_id)}`}>{iName(n.issue_id)}</a> : <span className="dim">—</span>}</td>
                  <td data-l="Page" className="nw"><a href={readHref(n.vol, n.page, n.issue_id, n.c)} title="Open this page in the reader">{(n.c || 'c1').toUpperCase()} · {n.vol} p{n.page}</a></td>
                  <td data-l="By" className="nw">{n.by}<div className="dim" style={{ fontSize: 11.5 }}>{n.at.replace('T', ' ')}</div></td>
                  <td data-l="Status">
                    <select className={`ncl-st st-${n.status || 'none'}`} value={n.status || ''} disabled={!can} aria-label="Status"
                            onChange={(e) => put(n.id, { status: e.target.value })}>
                      <option value="">—</option>{Object.entries(NSTATUS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    </select>
                  </td>
                  <td className="nw">
                    {n.mine && can && (
                      <button type="button" className={`btn ghost sm${ed?.id === n.id ? ' active' : ''}`} title="Edit this note"
                              onClick={() => setEd({ id: n.id, title: n.title || '', text: n.text || '', issue_id: n.issue_id || '', status: n.status || '',
                                                     system: n.system || '', assets: n.assets || [], where: `${(n.c || 'c1').toUpperCase()} · ${n.vol} p${n.page}`,
                                                     href: readHref(n.vol, n.page, n.issue_id, n.c) })}>✎ Edit</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function TenderList({ data, reload, can }) {
  const { tenders = [], issues = [], updated } = data
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const [adding, setAdding] = useState(false)
  const ql = q.trim().toLowerCase()
  const vols = tenders.flatMap((t) => t.volumes)
  const pages = vols.reduce((s, v) => s + (v.pages || 0), 0)
  const indexed = tenders.filter((t) => /^Indexed/.test(t.status)).length
  const openIss = issues.filter((i) => i.status === 'Open').length
  const tRows = tenders.filter((t) => has(ql, t.title, t.firm, t.brief, t.status,
    ...t.volumes.flatMap((v) => [v.vol, ...v.contents.map((c) => c[0])])))
  const iRows = issues.filter((i) => has(ql, i.id, i.title, i.summary, i.status, i.keywords))
  const cRows = ql ? issues.flatMap((i) => i.intel.filter((r) => has(ql, r.clause, r.topic, r.extract, r.use)).map((r) => ({ ...r, _iid: i.id }))) : []
  return (
    <>
      <div className="card dash-hood">
        <div className="dash-toolbar">
          <h1 className="dash-title">Tenders · Green Line</h1>
          <span className="dash-kpis">
            <span className="dk"><b>{tenders.length}</b> contracts</span>
            <span className="dk"><b>{vols.length}</b> volumes</span>
            <span className="dk"><b>{pages.toLocaleString('en-IN')}</b> pages</span>
            <span className="dk"><b>{indexed}</b> indexed</span>
            {openIss > 0 && <span className="dk dk-bad"><b>{openIss}</b> open issue{openIss === 1 ? '' : 's'}</span>}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <Search q={q} setQ={setQ} ph="Search tender, volume, issue, clause…" />
            <a className="btn ghost sm" href="#/tenders?guide" title="How tenders, issues and the reader work">Guide</a>
            <a className="btn preset" href="#/tenders/read">Reader</a>
          </span>
        </div>
      </div>

      <h2 style={{ margin: '4px 0 8px' }}>Contracts <span className="dim">· {tRows.length} · click a volume to read it · updated {updated}</span></h2>
      <div className="card tbl-wrap">
        <table className="jc-table corr-table">
          <colgroup>
            <col style={{ width: '4%' }} /><col style={{ width: '32%' }} /><col style={{ width: '42%' }} /><col style={{ width: '22%' }} />
          </colgroup>
          <thead><tr><th>SL</th><th>Contract</th><th>Volumes</th><th>Status</th></tr></thead>
          <tbody>
            {tRows.map((t) => (
              <Fragment key={t.sl}>
                <tr>
                  <td className="dim" data-l="SL">{t.sl}</td>
                  <td className="wrap-cell" data-l="Contract">
                    <button type="button" className="linkish" style={{ all: 'unset', cursor: 'pointer', fontWeight: 600 }}
                            onClick={() => setOpen(open === t.sl ? null : t.sl)} title="Show contents">
                      {open === t.sl ? '▾ ' : '▸ '}{t.title}</button>
                    <div className="dim">{t.firm}</div>
                  </td>
                  <td className="wrap-cell" data-l="Volumes">
                    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {t.volumes.map((v) => v.key
                        ? <a key={v.vol} className="dk" href={readHref(v.key, 1, '', t.key)} title={`${v.pages || '—'} pages · ${v.status}`}><b>{v.vol}</b></a>
                        : <span key={v.vol} className="dk" style={{ opacity: .6 }} title={v.status || 'Not in the reader yet'}>{v.vol}</span>)}
                    </span>
                  </td>
                  <td className="wrap-cell dim" data-l="Status">{t.status}</td>
                </tr>
                {open === t.sl && (
                  <tr><td colSpan={4} className="wrap-cell">
                    <p className="dim" style={{ margin: '4px 0 8px' }}>{t.brief}</p>
                    {t.volumes.map((v) => (
                      <div key={v.vol} style={{ marginBottom: 6 }}>
                        <b>{v.key ? <a href={readHref(v.key, 1, '', t.key)}>{v.vol}</a> : v.vol}</b> <span className="dim">· {v.pages ? `${v.pages} pp` : '—'}{v.status ? ` · ${v.status}` : ''}</span>
                        {v.contents.length > 0 && (
                          <ul style={{ margin: '2px 0 0 18px' }}>
                            {v.contents.map(([item, pp]) => (
                              <li key={item}>{v.key && range(pp) ? <a href={readHref(v.key, range(pp)[0], '', t.key)}>{item}</a> : item}
                                {pp && <span className="dim"> · p {pp}</span>}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <NoteChecklist issues={issues} ql={ql} can={can} />

      <h2 style={{ margin: '20px 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>Issues <span className="dim">· {iRows.length} · open one for its clauses, letters and failures</span></span>
        {can ? !adding && <button type="button" className="btn preset" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>＋ New issue</button>
          : <span className="dim" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 400 }}>Read only · issues are kept by Green Line logins</span>}
      </h2>
      {adding && <IssueForm onCancel={() => setAdding(false)}
                            onSaved={async (id) => { await reload(); location.hash = `#/tenders?issue=${encodeURIComponent(id)}` }} />}
      <div className="card tbl-wrap">
        <table className="jc-table corr-table">
          <colgroup>
            <col style={{ width: '12%' }} /><col style={{ width: '46%' }} /><col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} /><col style={{ width: '22%' }} />
          </colgroup>
          <thead><tr><th>ID</th><th>Issue</th><th>Status</th><th>Clauses</th><th>Actions</th></tr></thead>
          <tbody>
            {!iRows.length && <tr><td colSpan={5} className="dim">No issues{ql ? ' match' : can ? ' yet — add one with ＋ New issue' : ' yet'}.</td></tr>}
            {iRows.map((i) => {
              const href = `#/tenders?issue=${encodeURIComponent(i.id)}`
              const pend = i.actions.length
              return (
                <tr key={i.id} onClick={() => { location.hash = href }} style={{ cursor: 'pointer' }}>
                  <td data-l="ID"><a href={href} className="code">{i.id}</a></td>
                  <td className="wrap-cell" data-l="Issue"><b>{i.title}</b>{i.summary && <div className="dim">{i.summary.split('. ')[0].replace(/\.$/, '')}.</div>}</td>
                  <td data-l="Status"><span className={`dk${i.status === 'Open' ? ' dk-bad' : ''}`}>{i.status}</span></td>
                  <td data-l="Clauses">{i.intel.length}</td>
                  <td className="dim" data-l="Actions">{pend ? `${pend} to follow up` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {ql && (
        <>
          <h2 style={{ margin: '20px 0 8px' }}>Clauses <span className="dim">· {cRows.length} matching “{q.trim()}”</span></h2>
          <ClauseTable rows={cRows} />
        </>
      )}
    </>
  )
}

/* create an issue, or edit one (title, status, keywords, summary). Keywords are
   plain words or phrases, comma-separated: every letter/MoM whose subject, brief,
   assets or OCR text contains one is listed on the issue automatically. */
function IssueForm({ iss, onCancel, onSaved }) {
  const [f, setF] = useState({ id: '', title: iss?.title || '', status: iss?.status || 'Open',
    keywords: iss?.keywords || '', summary: iss?.summary || '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      const { id, ...rest } = f
      const r = iss ? await send('PATCH', `/api/tenders/issues/${iss.id}`, rest)
        : await send('POST', '/api/tenders/issues', { ...f, id: id.trim().toUpperCase() })
      await onSaved(iss ? iss.id : r.id)
    } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <form className="card" style={{ ...FORM, marginBottom: 10 }} onSubmit={save}>
      <b>{iss ? 'Edit issue' : 'New issue'}</b>
      <div style={{ display: 'grid', gridTemplateColumns: iss ? '1fr 140px' : '160px 1fr 140px', gap: 8 }}>
        {!iss && <Lbl t="ID" hint="optional"><input value={f.id} onChange={set('id')} placeholder="e.g. ETS-SDAH" maxLength={40} /></Lbl>}
        <Lbl t="Title"><input value={f.title} onChange={set('title')} required minLength={3} maxLength={200}
                              placeholder="e.g. Rectifier trips — Phoolbagan" /></Lbl>
        <Lbl t="Status"><select value={f.status} onChange={set('status')}>
          <option>Open</option><option>Watching</option><option>Closed</option></select></Lbl>
      </div>
      <Lbl t="Keywords" hint="comma-separated words or phrases; letters containing any of them are listed on the issue">
        <input value={f.keywords} onChange={set('keywords')} placeholder="e.g. rectifier, RTU, 750 V trip" maxLength={500} />
      </Lbl>
      {iss?.advanced && <span className="dim" style={{ fontSize: 12 }}>This issue currently matches letters by an advanced pattern; saving new keywords replaces it.</span>}
      <Lbl t="Summary"><textarea rows={4} value={f.summary} onChange={set('summary')} maxLength={5000}
                                 placeholder="What is happening, where, since when, and the contract position." /></Lbl>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button type="submit" className="btn preset" disabled={busy}>{iss ? 'Save' : 'Create issue'}</button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
        <Err m={err} />
      </span>
    </form>
  )
}

/* link a letter/MoM, a Green Line logbook entry (failure / job card / rectification), or an
   off-book job card to an issue, with a line on why it matters */
const LOGK = { failure: ['#fdecec', '#b42318'], 'job card': ['#fef6ec', '#92600f'], rectification: ['#e9f7ef', '#1e7a46'] }
const LogKind = ({ k }) => {
  const [bg, fg] = LOGK[k] || ['#eef1f4', '#4a5866']
  return <span style={{ background: bg, color: fg, borderRadius: 999, padding: '0 7px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{k}</span>
}

function LinkBox({ iid, onDone }) {
  const [kind, setKind] = useState('letter')
  const [q, setQ] = useState('')
  const [hits, setHits] = useState(null)
  const [pick, setPick] = useState(null)
  const [jc, setJc] = useState({ jc: '', date: '', subject: '' })
  const [why, setWhy] = useState('')
  const [key, setKey] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { setHits(null); setPick(null); setErr('') }, [kind])
  useEffect(() => {
    const qq = q.trim()
    if (kind === 'jobcard' || qq.length < 2) { setHits(null); return }
    const t = setTimeout(() => getJSON(`/api/tenders/${kind === 'letter' ? 'letters' : 'failures'}?q=${encodeURIComponent(qq)}`)
      .then(setHits).catch(() => setHits([])), 250)
    return () => clearTimeout(t)
  }, [q, kind])
  const save = async (e) => {
    e.preventDefault(); setErr('')
    try {
      await send('POST', `/api/tenders/issues/${iid}/links`, kind === 'jobcard' ? { kind, ...jc, why, key }
        : { kind, ref_id: pick?.id, why, key })
      setQ(''); setPick(null); setWhy(''); setKey(false); setJc({ jc: '', date: '', subject: '' }); setHits(null)
      onDone()
    } catch (x) { setErr(x.message) }
  }
  const tab = (k, label) => <button type="button" className={`dk ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}><b>{label}</b></button>
  return (
    <form className="card" style={{ ...FORM, marginTop: 10 }} onSubmit={save}>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ marginRight: 4 }}>＋ Link to this issue</b>{tab('letter', 'Letter / MoM')}{tab('log', 'Logbook entry')}{tab('jobcard', 'Job card (off-book)')}
      </span>
      {kind === 'jobcard' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '150px 150px 1fr', gap: 8 }}>
          <Lbl t="Job card no."><input value={jc.jc} onChange={(e) => setJc({ ...jc, jc: e.target.value })} placeholder="PS/255" maxLength={60} /></Lbl>
          <Lbl t="Date"><input type="date" value={jc.date} onChange={(e) => setJc({ ...jc, date: e.target.value })} /></Lbl>
          <Lbl t="Subject"><input value={jc.subject} onChange={(e) => setJc({ ...jc, subject: e.target.value })} maxLength={1000} /></Lbl>
        </div>
      ) : pick ? (
        <div className="rd-pin" style={{ marginBottom: 0 }}>
          {kind === 'letter' ? <><b>{pick.ref_no || `#${pick.id}`}</b> <span className="dim">· {pick.date} · {pick.kind}</span><div>{pick.subject}</div></>
            : <><LogKind k={pick.kind} /> <b>#{pick.id} · {pick.asset}</b> <span className="dim">· {pick.date} · {pick.location}</span><div>{pick.fault} {pick.description && <span className="dim">— {pick.description}</span>}</div></>}
          <button type="button" className="btn ghost sm" style={{ marginTop: 4 }} onClick={() => setPick(null)}>Change</button>
        </div>
      ) : (
        <>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
                 placeholder={kind === 'letter' ? 'Search letters — ref no., subject, words in the letter…' : 'Search the Green Line logbook — asset code, station, fault, #id…'} />
          {hits && (
            <div style={{ maxHeight: 260, overflow: 'auto' }}>
              {!hits.length && <p className="dim" style={{ margin: 0 }}>Nothing found.</p>}
              {hits.map((h) => (
                <button key={h.id} type="button" className="rd-item" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => setPick(h)}>
                  {kind === 'letter' ? <>{h.date} · <b>{h.ref_no || `#${h.id}`}</b> <span className="dim">· {h.kind}</span><div className="dim">{h.subject}</div></>
                    : <>{h.date} · <LogKind k={h.kind} /> <b>{h.asset}</b> <span className="dim">· #{h.id} · {h.location}</span><div className="dim">{h.fault} {h.description}</div></>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <Lbl t="Why it matters" hint="one line"><input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={1000}
            placeholder="e.g. First recorded false trip at Sealdah" /></Lbl>
      <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="submit" className="btn preset" disabled={kind !== 'jobcard' && !pick}>Link</button>
        {kind === 'log' && <label className="dim" style={{ fontSize: 13 }}><input type="checkbox" checked={key} onChange={(e) => setKey(e.target.checked)} /> key entry (bold)</label>}
        <Err m={err} />
      </span>
    </form>
  )
}

/* one issue on its own page: ← Tenders, sticky hood, sections in reading
   order, and a right rail to jump between them and open the volumes */
function IssuePage({ iss, tenders, reload, can }) {
  const [q, setQ] = useState('')
  const [t, setT] = useState(null)
  const [more, setMore] = useState(false)
  const [edit, setEdit] = useState(false)
  const [act, setAct] = useState(['', '', ''])
  const [err, setErr] = useState('')
  const loadT = () => getJSON(`/api/tenders/issue/${iss.id}/trail`).then(setT).catch(() => setT({ trail: [], auto: [], failures: [] }))
  useEffect(() => { loadT() }, [iss.id, iss.match])
  const run = async (fn) => { setErr(''); try { await fn() } catch (x) { setErr(x.message) } }
  const unlink = (lid) => run(async () => { await send('DELETE', `/api/tenders/issues/${iss.id}/links/${lid}`); await loadT() })
  const quickLink = (id) => run(async () => { await send('POST', `/api/tenders/issues/${iss.id}/links`, { kind: 'letter', ref_id: id }); await loadT() })
  const delClause = (r) => run(async () => {
    if (!window.confirm(`Remove clause ${r.clause || ''} from this issue?`)) return
    await send('DELETE', `/api/tenders/issues/${iss.id}/clauses/${r.id}`); await reload()
  })
  const saveActs = (rows) => run(async () => { await send('PATCH', `/api/tenders/issues/${iss.id}`, { actions: rows }); await reload() })
  useEffect(() => { window.scrollTo(0, 0) }, [iss.id])
  const ql = q.trim().toLowerCase()
  const clauses = iss.intel.filter((r) => has(ql, r.clause, r.topic, r.extract, r.use, r.vol))
  const acts = iss.actions.filter(([a, b, c]) => has(ql, a, b, c))
  const trail = (t?.trail || []).filter((x) => has(ql, x.date, x.kind, x.ref_no, x.jc, x.subject, x.why))
  const fails = (t?.failures || []).filter((f) => has(ql, f.kind, f.date, f.asset, f.location, f.fault, f.description, f.work_done))
  const auto = (t?.auto || []).filter((x) => has(ql, x.date, x.ref_no, x.subject, x.snippet))
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const sections = [['is-sum', 'Summary', null], ['is-act', 'Actions', acts.length], ['is-cl', 'Contract clauses', clauses.length],
    ['is-ev', 'Letters & job cards', t ? trail.length : '…'], ['is-fl', 'Logbook history', t ? fails.length : '…'],
    ['is-ot', 'Other letters', t ? auto.length : '…']]
  const cvKey = (r) => `${r.c || 'c1'}/${volKey(r)}`   // a clause's contract + volume (V1 exists in every contract)
  const used = [...new Set(iss.intel.map(cvKey))]
  const volName = Object.fromEntries(tenders.filter((x) => x.key).flatMap((x) => x.volumes.filter((v) => v.key)
    .map((v) => [`${x.key}/${v.key}`, x.key === 'c1' ? v.vol : `${x.short} · ${v.vol}`])))
  const Head = ({ id, children, n }) => <h2 id={id} style={SECT}>{children}{n != null && <span className="dim"> · {n}</span>}</h2>
  return (
    <>
      <div className="card dash-hood">
        <div className="dash-toolbar">
          <a className="dash-crumb" href="#/tenders">← Tenders</a>
          <h1 className="dash-title">{iss.title}</h1>
          <span className="dash-kpis">
            <span className={`dk${iss.status === 'Open' ? ' dk-bad' : ''}`}><b>{iss.status}</b></span>
            <span className="dk"><b>{iss.intel.length}</b> clauses</span>
            {t && <span className="dk"><b>{t.trail.length}</b> letters / JCs</span>}
            {t && <span className="dk"><b>{t.failures.length}</b> logbook entries</span>}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <Search q={q} setQ={setQ} ph="Search this issue…" />
            {can && <button type="button" className="btn ghost sm" onClick={() => setEdit(!edit)}>{edit ? 'Close edit' : 'Edit issue'}</button>}
          </span>
        </div>
      </div>

      <div className="detail-grid">
        <div style={{ minWidth: 0 }}>
          {err && <div className="card" style={{ marginTop: 10 }}><Err m={err} /></div>}
          <Head id="is-sum">Summary</Head>
          {edit ? <IssueForm iss={iss} onCancel={() => setEdit(false)} onSaved={async () => { await reload(); setEdit(false) }} /> : (
            <div className="card">
              <p style={{ margin: 0 }}>{iss.summary || <span className="dim">No summary yet{can ? ' — Edit issue to add one' : ''}.</span>}</p>
              <p className="dim" style={{ margin: '8px 0 0', fontSize: 12 }}>
                Letters are matched by {iss.advanced ? 'an advanced pattern' : iss.keywords ? <>keywords: <b>{iss.keywords}</b></> : 'no keywords yet'}
                {iss.by && iss.by !== 'seed' && <> · created by {iss.by}</>}</p>
            </div>
          )}

          <Head id="is-act" n={acts.length}>Actions</Head>
          <div className="card tbl-wrap">
            <table className="jc-table corr-table">
              <colgroup><col style={{ width: '40%' }} /><col style={{ width: '24%' }} /><col style={{ width: '28%' }} /><col style={{ width: '8%' }} /></colgroup>
              <thead><tr><th>Item</th><th>Status</th><th>Next</th><th></th></tr></thead>
              <tbody>
                {acts.map(([item, st, nx]) => (
                  <tr key={item}>
                    <td className="wrap-cell" data-l="Item">{item}</td>
                    <td className="wrap-cell" data-l="Status">{st}</td>
                    <td className="wrap-cell dim" data-l="Next">{nx}</td>
                    <td>{can && <button type="button" className="btn ghost sm" title="Remove"
                                onClick={() => saveActs(iss.actions.filter((a) => a[0] !== item))}>×</button>}</td>
                  </tr>
                ))}
                {can && <tr>
                  {['Item', 'Status', 'Next'].map((l, i) => (
                    <td key={l} data-l={l}><input value={act[i]} placeholder={['New action…', 'e.g. To issue', 'e.g. Letter to Siemens'][i]} maxLength={300}
                                                  onChange={(e) => setAct(act.map((v, j) => j === i ? e.target.value : v))} style={{ width: '100%' }} /></td>
                  ))}
                  <td><button type="button" className="btn preset sm" disabled={!act[0].trim()}
                              onClick={() => { saveActs([...iss.actions, act.map((v) => v.trim())]); setAct(['', '', '']) }}>Add</button></td>
                </tr>}
              </tbody>
            </table>
          </div>

          <Head id="is-cl" n={clauses.length}>Contract clauses</Head>
          {clauses.length ? <ClauseTable rows={clauses} onDel={can ? delClause : null} iid={iss.id} /> : null}
          {can && <p className="dim" style={{ fontSize: 13, margin: '6px 0 0' }}>
            Add clauses from the reader: open a volume from <b>Open in reader</b> (this issue comes along), select the clause text, press <b>＋ Add clause</b>.</p>}

          <Head id="is-ev" n={t ? trail.length : null}>Letters, MoMs & job cards</Head>
          {!t ? <p className="dim">Loading…</p> : (
            <div className="card tbl-wrap">
              <table className="jc-table corr-table">
                <colgroup><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /><col style={{ width: '16%' }} /><col style={{ width: '60%' }} /></colgroup>
                <thead><tr><th>Date</th><th>Kind</th><th>Ref</th><th>Subject · why it matters</th></tr></thead>
                <tbody>
                  {!trail.length && <tr><td colSpan={4} className="dim">Nothing linked yet{can ? ' — use the box below' : ''}.</td></tr>}
                  {trail.map((x, i) => (
                    <tr key={x.link_id || i}>
                      <td data-l="Date">{x.date}</td>
                      <td className="dim" data-l="Kind">{x.kind}</td>
                      <td className="wrap-cell" data-l="Ref">{ref(x)}</td>
                      <td className="wrap-cell" data-l="Subject">{x.subject}{x.why && <div className="dim">{x.why}</div>}
                        {x.link_id && <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>linked by {x.link_by}{' '}
                          {can && <button type="button" className="btn ghost sm" onClick={() => unlink(x.link_id)}>Remove</button>}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {can && <LinkBox iid={iss.id} onDone={loadT} />}

          <Head id="is-fl" n={t ? fails.length : null}>Failures &amp; job cards · Green Line logbook</Head>
          {t && (
            <div className="card tbl-wrap">
              {fails.length === 0 ? <p className="dim" style={{ margin: 0 }}>None recorded.</p> : (
                <table className="jc-table corr-table">
                  <colgroup><col style={{ width: '12%' }} /><col style={{ width: '20%' }} /><col style={{ width: '38%' }} /><col style={{ width: '30%' }} /></colgroup>
                  <thead><tr><th>Date</th><th>Equipment</th><th>Entry</th><th>Action taken</th></tr></thead>
                  <tbody>
                    {fails.map((f) => (
                      <tr key={f.id} style={f.key ? { fontWeight: 600 } : undefined}>
                        <td data-l="Date">{f.date}<div style={{ margin: '3px 0' }}><LogKind k={f.kind} /></div><div className="dim">#{f.id}{f.rectifies && <> · fixes #{f.rectifies}</>}</div></td>
                        <td className="wrap-cell" data-l="Equipment"><span className="code">{f.asset}</span><div className="dim">{f.location}</div></td>
                        <td className="wrap-cell" data-l="Entry">{f.fault && <b>{f.fault}</b>}{f.description && <div className={f.fault ? 'dim' : undefined} style={{ whiteSpace: 'pre-line' }}>{f.description}</div>}
                          {f.why && <div style={{ fontWeight: 400 }}>{f.why}</div>}
                          {f.linked ? <div className="dim" style={{ fontSize: 12, fontWeight: 400, marginTop: 3 }}>linked{f.key ? ' · key' : ''}{' '}
                            {can && <button type="button" className="btn ghost sm" onClick={() => unlink(f.link_id)}>Remove</button>}</div>
                            : <div className="dim" style={{ fontSize: 12, fontWeight: 400 }}>matched by keywords</div>}</td>
                        <td className="wrap-cell" data-l="Action taken">{f.work_done || <span className="dim">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <Head id="is-ot" n={t ? auto.length : null}>Other letters mentioning it</Head>
          {t && (auto.length === 0 ? <div className="card"><p className="dim" style={{ margin: 0 }}>None.</p></div> : (
            <>
              <button type="button" className="btn ghost sm" onClick={() => setMore(!more)}>{more ? 'Hide' : 'Show'} {auto.length} letters</button>
              {more && (
                <div className="card tbl-wrap" style={{ marginTop: 6 }}>
                  <table className="jc-table corr-table">
                    <colgroup><col style={{ width: '12%' }} /><col style={{ width: '18%' }} /><col style={{ width: '70%' }} /></colgroup>
                    <tbody>
                      {auto.map((x) => (
                        <tr key={x.id}>
                          <td data-l="Date">{x.date}</td>
                          <td className="wrap-cell" data-l="Ref">{ref(x)}<div className="dim">{x.kind}</div></td>
                          <td className="wrap-cell" data-l="Subject">{x.subject}{x.snippet && <div className="dim">…{x.snippet}…</div>}
                            {can && <button type="button" className="btn ghost sm" style={{ marginTop: 3 }} onClick={() => quickLink(x.id)}>Link to issue</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ))}
        </div>

        <aside style={{ position: 'sticky', top: 'calc(var(--topbar-h, 78px) + 64px)', marginTop: 18 }}>
          <div className="card" style={{ padding: '12px 14px' }}>
            <div className="dim" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>On this page</div>
            {sections.map(([id, label, n]) => (
              <button key={id} type="button" onClick={() => go(id)}
                      style={{ all: 'unset', display: 'flex', justifyContent: 'space-between', width: '100%', padding: '4px 0', cursor: 'pointer', fontSize: 13 }}>
                <span>{label}</span>{n != null && <span className="dim">{n}</span>}
              </button>
            ))}
          </div>
          <div className="card" style={{ padding: '12px 14px', marginTop: 10 }}>
            <div className="dim" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Open in reader</div>
            {used.map((k) => (
              <a key={k} href={readHref(k.split('/')[1], range(iss.intel.find((r) => cvKey(r) === k)?.pdf_p)?.[0], iss.id, k.split('/')[0])} style={{ display: 'block', padding: '3px 0', fontSize: 13 }}>
                {volName[k] || k} <span className="dim">· {iss.intel.filter((r) => cvKey(r) === k).length} clauses</span></a>
            ))}
          </div>
        </aside>
      </div>
    </>
  )
}

export function TenderDrawings({ embedded }) {
  const { data, error } = useTenders()
  const [q, setQ] = useState('')
  const [only, setOnly] = useState(false)
  const g = gate(error, data, 'drawings')
  if (g) return g
  const all = data.drawings || []
  const ql = q.trim().toLowerCase()
  const shown = all.filter((d) => (!only || d.flag) && has(ql, d.title, d.no, d.contract, d.vol))
  return (
    <>
      {!embedded && <div className="page-head"><h1>Drawings <span className="dim">· Green Line</span></h1></div>}
      <p className="dim" style={{ marginTop: -6 }}>Drawing register from the contract documents{embedded ? ' — each opens on its page in the contract reader.' : '.'}</p>
      <div className="asset-toolbar">
        <input className="asset-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Search title, drawing no., station…" aria-label="Search drawings" />
        <div className="asset-filter" role="tablist" aria-label="Filter">
          <button type="button" className={`btn preset ${!only ? 'active' : ''}`} onClick={() => setOnly(false)}>All {all.length}</button>
          <button type="button" className={`btn preset ${only ? 'active' : ''}`} onClick={() => setOnly(true)}>Sealdah / tunnel {all.filter((d) => d.flag).length}</button>
        </div>
        {q && <button type="button" className="btn ghost sm" onClick={() => setQ('')}>Clear</button>}
        <span className="asset-count">{shown.length} shown</span>
      </div>
      <div className="card tbl-wrap">
        <table className="jc-table corr-table">
          <colgroup>
            <col style={{ width: '40%' }} /><col style={{ width: '26%' }} /><col style={{ width: '20%' }} />
            <col style={{ width: '6%' }} /><col style={{ width: '8%' }} />
          </colgroup>
          <thead><tr><th>Title</th><th>Drawing no.</th><th>Source</th><th>Page</th><th>Format</th></tr></thead>
          <tbody>
            {shown.map((d, i) => (
              <tr key={i}>
                <td className="wrap-cell" data-l="Title">{d.flag && <b>● </b>}{d.title}</td>
                <td className="wrap-cell" data-l="Drawing no."><span className="code">{d.no}</span></td>
                <td className="wrap-cell dim" data-l="Source">{d.contract} · {d.vol}</td>
                <td data-l="Page" title="Open in the contract reader"><a href={`#/tenders/read?v=V3&p=${d.pdf_p}`}>{d.pdf_p}</a></td>
                <td className="dim" data-l="Format">{d.fmt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ── Contract reader ──────────────────────────────────────────────────────
   #/tenders/read?v=V2&p=210&q=spurious — page image + its text side by side.
   Left rail: collapsible groups — search hits, one group per issue (its clauses
   by volume), bookmarks & notes, then the volume's contents with per-section
   badges; the section holding the current page opens itself. Clauses (§),
   marks (★ 🔖 ✎) and hits (🔎) each carry their own colour. Open/closed state
   and a hidden rail are remembered per browser. Notes, ★ important and
   bookmarks are shared across signed-in users. */
const READER_CSS = `
.rd { display: grid; grid-template-columns: 290px minmax(0, 1fr) 320px; gap: 12px; align-items: start; }
.rd { --rd-top: calc(var(--topbar-h, 72px) + var(--rd-hood-h, 44px) + 4px); margin-top: 0; }
.rd-rail, .rd-side, .rd > main { position: sticky; top: var(--rd-top); max-height: calc(100vh - var(--rd-top) - 10px); overflow: auto; }
.rd-rail h3, .rd-side h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .5px; margin: 12px 0 6px; color: var(--accent); }
.rd-item { display: block; width: 100%; text-align: left; background: none; border: 0; border-left: 3px solid transparent;
  padding: 5px 8px; cursor: pointer; font: inherit; font-size: 13px; color: inherit; border-radius: 4px; }
.rd-item:hover { background: var(--accent-soft); }
.rd-item.on { border-left-color: var(--accent); background: var(--accent-soft); font-weight: 600; }
.rd-item .dim { font-weight: 400; }
.rd-sec { margin-left: 10px; border-left: 1px dashed var(--accent-line); padding-left: 4px; }
.rd-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
.rd-bar input[type=number] { width: 74px; }
.rd-page { background: #fff; border-radius: 6px; overflow: auto; max-height: calc(100vh - var(--rd-top) - 50px); text-align: center; }
.rd-page img { display: block; margin: 0 auto; max-width: 100%; }
.rd-page.zoom img { max-width: none; width: 160%; }
.rd-pdf { position: relative; height: calc(100vh - var(--rd-top) - 50px); padding: 0; overflow: hidden; background: #e6e6e6; }
.rd-pdf-box { position: absolute; inset: 0; overflow: auto; }
.rd-pdf-wait { position: absolute; top: 12px; left: 12px; z-index: 2; }
.rd-rail mark { background: #ffe58a; padding: 0 1px; }
.rd-pin { border-left: 3px solid var(--accent); padding: 6px 8px; margin-bottom: 8px; font-size: 13px; background: var(--accent-soft); border-radius: 4px; }
.rd-note { border-left: 3px solid #999; padding: 5px 8px; margin-bottom: 6px; font-size: 13px; }
.rd-note.important { border-left-color: #d33; } .rd-note.bookmark { border-left-color: #e0a100; }
.rd-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.rd-chips span { font-size: 11px; padding: 1px 6px; border-radius: 9px; background: #eef1f5; color: #445; }
.rd-chips .rd-asset { font-family: ui-monospace, monospace; background: #e8f0fb; color: #1f4f8a; }
.rd-st.st-pending { background: #fff3d6; color: #8a5a00; } .rd-st.st-verified { background: #e2f5e6; color: #1e6b33; }
.rd-opt { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 4px; }
.rd-opt input, .rd-opt select { width: 100%; min-width: 0; } .rd-opt select { grid-column: 1 / -1; }
.rd-bar select.sm { font-size: 12px; padding: 1px 4px; }
.rd-chips .rd-sys { background: #f1e9fb; color: #5a3591; }
.rd-note.editing { outline: 2px solid var(--accent); outline-offset: 1px; }
.rd-ck { margin: 0 5px 0 0; vertical-align: -2px; cursor: pointer; }
.rd-note.done > b, .rd-note.done > div:not(.rd-chips):not(.rd-bar) { text-decoration: line-through; color: var(--ink-2); }
.rd-x { border: 0; background: none; padding: 0 0 0 4px; cursor: pointer; color: inherit; font: inherit; line-height: 1; }
.dash-kpis button.dk { border: 0; cursor: pointer; font: inherit; font-size: 11.5px; }
.dash-kpis .dk.on { background: var(--accent); color: #fff; } .dash-kpis .dk.on b { color: #fff; }
.rd-sum { font-size: 13px; line-height: 1.5; } .rd-sum div { display: flex; justify-content: space-between; gap: 8px; }
/* slim one-row hood */
.rd-hood { margin-bottom: 8px; overflow: visible; }  /* the issue dropdown hangs below it */
.rd-hood .dash-toolbar { padding: 4px 12px; gap: 4px 10px; flex-wrap: nowrap; min-height: 38px; }
.rd-hood .dash-title { font-size: 14px; white-space: nowrap; }
.rd-hood select.rd-ct { font-weight: 700; max-width: 220px; padding: 2px 6px; }
.rd-vols { display: inline-flex; border: 1px solid var(--border); border-radius: 7px; overflow: hidden; flex: none; }
.rd-vols button { border: 0; background: none; font: inherit; font-size: 12px; font-weight: 700; padding: 3px 9px; cursor: pointer; color: var(--ink-2); }
.rd-vols button + button { border-left: 1px solid var(--border); }
.rd-vols button.on { background: var(--accent); color: #fff; }
.rd-ip { position: relative; flex: 0 1 300px; min-width: 150px; }
.rd-ip-btn { display: flex; align-items: center; gap: 7px; width: 100%; height: 28px; padding: 0 8px; border: 1px solid var(--border);
  border-radius: 7px; background: #fff; font: inherit; font-size: 12.5px; cursor: pointer; color: var(--ink); box-shadow: inset 3px 0 0 var(--accent); }
.rd-ip-btn:hover, .rd-ip-btn[aria-expanded="true"] { border-color: var(--accent); }
.rd-ip-t { flex: 1; min-width: 0; text-align: left; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rd-ip-k { font-size: 10.5px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); flex: none; }
.rd-ip-pop { position: absolute; top: calc(100% + 4px); left: 0; z-index: 60; width: max(100%, 360px); max-height: 60vh; overflow: auto;
  background: #fff; border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 10px 30px rgba(11,42,63,.16); padding: 4px; }
.rd-ip-o { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: none; font: inherit; font-size: 13px;
  text-align: left; padding: 7px 8px; border-radius: 7px; cursor: pointer; color: inherit; text-decoration: none; }
.rd-ip-o:hover, .rd-ip-o:focus-visible { background: rgba(11,42,63,.05); outline: none; }
.rd-ip-o.on { background: var(--accent-soft); }
.rd-ip-o.on .rd-ip-t { color: var(--accent); }
.rd-ip-st { font-size: 11px; color: var(--ink-2); flex: none; }
.rd-ip-sep { height: 1px; background: var(--border-2, #EAF1F6); margin: 4px 2px; }
.rd-hmeta { font-size: 12px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.rd-hmeta b { color: var(--ink); font-variant-numeric: tabular-nums; }
.rd-hsearch { margin-left: auto; display: flex; gap: 5px; align-items: center; flex: 0 1 400px; min-width: 200px; }
.rd-hsearch input { flex: 1; min-width: 0; height: 28px; padding: 2px 9px; font-size: 13px; }
.rd-hsearch .btn { padding: 3px 10px; font-size: 12.5px; }
/* rail */
.rd-rail.card { padding: 0; }
.rd-railbar { position: sticky; top: 0; z-index: 2; display: flex; gap: 4px; padding: 8px; background: #fff; border-bottom: 1px solid var(--border-2, #EAF1F6); }
.rd-railbar input { flex: 1; min-width: 0; height: 28px; font-size: 12.5px; padding: 2px 8px; }
.rd-ib { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 7px; background: #fff;
  cursor: pointer; color: var(--ink-2); font: inherit; font-size: 13px; flex: none; padding: 0; }
.rd-ib:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.rg { border-bottom: 1px solid var(--border-2, #EAF1F6); }
.rg-h { display: flex; align-items: center; gap: 4px; padding-right: 6px; }
.rg-t { flex: 1; display: flex; align-items: center; gap: 6px; border: 0; background: none; font: inherit; cursor: pointer;
  padding: 8px 10px; text-align: left; color: inherit; min-width: 0; }
.rg-t:hover { background: rgba(11,42,63,.03); }
.rg-chev { width: 10px; color: var(--ink-2); font-size: 10px; flex: none; }
.rg-title { flex: 1; min-width: 0; font-size: 11.5px; font-weight: 750; text-transform: uppercase; letter-spacing: .06em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rg-n { font-size: 11px; font-weight: 700; padding: 0 7px; border-radius: 999px; background: rgba(11,42,63,.06); color: var(--ink-2);
  font-variant-numeric: tabular-nums; flex: none; }
.rg-b { padding: 0 8px 8px; }
.rg-iss { box-shadow: inset 3px 0 0 var(--accent); }
.rg-iss .rg-title { text-transform: none; letter-spacing: 0; font-size: 13px; color: var(--accent); }
.rg-iss .rg-n { background: #e8f0fb; color: var(--accent); }
.rg-mk .rg-title { color: #92600f; } .rg-mk .rg-n { background: #fef6ec; color: #92600f; }
.rg-hit .rg-title { color: #6b3fa0; } .rg-hit .rg-n { background: #f3eefa; color: #6b3fa0; }
.rg-sec .rg-title { color: var(--ink); }
.rd-dot { width: 8px; height: 8px; border-radius: 50%; background: #2e8b57; flex: none; } .rd-dot.off { background: #a7b0b9; }
.rg-go { font-size: 11.5px; padding: 2px 6px; border-radius: 6px; text-decoration: none; color: var(--ink-2); flex: none; }
.rg-go:hover { background: var(--accent-soft); color: var(--accent); }
.rd-vh { font-size: 10.5px; font-weight: 750; color: var(--ink-2); letter-spacing: .07em; text-transform: uppercase; margin: 6px 4px 2px; }
.rd-it { display: block; width: 100%; text-align: left; background: none; border: 0; border-left: 3px solid transparent; padding: 5px 8px;
  margin: 1px 0; cursor: pointer; font: inherit; font-size: 13px; color: inherit; border-radius: 0 6px 6px 0; }
.rd-it:hover { background: rgba(11,42,63,.04); }
.rd-top { display: flex; gap: 6px; align-items: baseline; justify-content: space-between; }
.rd-tag { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.rd-pg { font-size: 11px; color: var(--ink-2); font-variant-numeric: tabular-nums; flex: none; }
.rd-sub { font-size: 12px; color: var(--ink-2); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.rd-it.cl { border-left-color: #b9d0ec; } .rd-it.cl .rd-tag { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--accent); }
.rd-it.cl.on { border-left-color: var(--accent); background: var(--accent-soft); }
.rd-it.mk.important { border-left-color: #d33; } .rd-it.mk.bookmark { border-left-color: #e0a100; } .rd-it.mk.note { border-left-color: #9aa5b1; }
.rd-it.mk.on { background: #fef6ec; }
.rd-it.hit { border-left-color: #b9a3dd; } .rd-it.hit.on { border-left-color: #6b3fa0; background: #f3eefa; }
.rd-it mark { background: #ffe58a; padding: 0 1px; }
.rd-chips { display: flex; gap: 3px; flex-wrap: wrap; align-items: center; margin: 0 0 6px; }
.rd-chip { border: 1px solid var(--border); background: #fff; border-radius: 999px; font: inherit; font-size: 11.5px; padding: 1px 8px; cursor: pointer; color: var(--ink-2); }
.rd-chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.rd-secrow { display: flex; align-items: flex-start; border-radius: 6px; }
.rd-secrow.cur { background: var(--accent-soft); }
.rd-chv { border: 0; background: none; cursor: pointer; padding: 6px 2px 6px 4px; color: var(--ink-2); font-size: 10px; width: 18px; flex: none; }
.rd-chv:disabled { visibility: hidden; }
.rd-secname { flex: 1; min-width: 0; text-align: left; border: 0; background: none; font: inherit; font-size: 13px; padding: 5px 6px 5px 0; cursor: pointer; color: inherit; }
.rd-secrow.cur .rd-secname { font-weight: 650; }
.rd-badges { display: inline-flex; gap: 3px; margin-left: 4px; vertical-align: 1px; }
.rd-b { font-size: 10.5px; padding: 0 5px; border-radius: 999px; font-weight: 700; }
.rd-b.cl { background: #e8f0fb; color: var(--accent); } .rd-b.mk { background: #fef6ec; color: #92600f; } .rd-b.hit { background: #f3eefa; color: #6b3fa0; }
.rd-prog { height: 3px; background: rgba(11,42,63,.08); border-radius: 3px; margin: 0 8px 4px 22px; overflow: hidden; }
.rd-prog i { display: block; height: 100%; background: var(--accent); }
.rd-legend { font-size: 11px; color: var(--ink-2); padding: 8px 10px; display: flex; flex-wrap: wrap; gap: 4px 10px; }
.rd-empty { font-size: 12px; color: var(--ink-2); padding: 2px 8px 4px; }
.rd.nr { grid-template-columns: 44px minmax(0, 1fr) 320px; }
.rd-side > .card { padding: 10px 12px; }
.rd-here { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; margin-bottom: 10px; padding: 8px 12px; }
.rd-here .rd-here-sec { flex: 1 1 100%; color: var(--ink-2); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rd-here .rd-prog { flex: 1 1 100%; margin: 4px 0 0; }
.rd-mini { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 4px; }
.rd-mini .rd-ib { width: 34px; height: auto; padding: 5px 0; display: flex; flex-direction: column; align-items: center; gap: 1px; }
.rd-mini .rd-ib small { font-size: 10px; font-weight: 750; font-variant-numeric: tabular-nums; }
.rd-pin .rd-pin-iss { font-size: 11.5px; color: var(--ink-2); }
@media (max-width: 1100px) { .rd, .rd.nr { grid-template-columns: 1fr; } .rd-rail, .rd-side, .rd > main { position: static; max-height: none; } .rd > main { order: -1; } }
@media (max-width: 900px) { .rd-ip { flex: 1 1 100%; } .rd-ip-pop { width: 100%; } .rd-hood .dash-toolbar { flex-wrap: wrap; } .rd-hsearch { flex: 1 1 100%; } .rd-hsearch input, .rd-railbar input { font-size: 16px; } }
`
const RAIL_KEY = 'amps.reader.rail.v1'
const loadRail = () => { try { return JSON.parse(localStorage.getItem(RAIL_KEY) || '{}') || {} } catch { return {} } }
const MKI = { important: '★', bookmark: '🔖', note: '✎' }

/* one collapsible rail group: chevron · icon · title · count, optional header action */
function Group({ id, open, onToggle, tone, icon, title, count, extra, children }) {
  return (
    <section className={`rg rg-${tone || 'plain'}`}>
      <div className="rg-h">
        <button type="button" className="rg-t" aria-expanded={open} onClick={() => onToggle(id, !open)}>
          <span className="rg-chev">{open ? '▼' : '▶'}</span>{icon}
          <span className="rg-title">{title}</span>
          {count != null && <span className="rg-n">{count}</span>}
        </button>
        {extra}
      </div>
      {open && <div className="rg-b">{children}</div>}
    </section>
  )
}
const API = import.meta.env.VITE_AMPS_API ?? ''
const range = (s) => {
  const m = String(s ?? '').match(/(\d+)(?:\s*[–-]\s*(\d+))?/)
  return m ? [+m[1], +(m[2] || m[1])] : null
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const NSTATUS = { pending: 'Pending', verified: 'Verified' }
const splitList = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => x.trim()).filter(Boolean)
const KIND = { important: '★ Important', bookmark: '🔖 Bookmark', note: '✎ Note' }

function Highlight({ text, terms }) {
  const ts = terms.filter((t) => t && t.length > 2)
  if (!ts.length) return text
  const rx = new RegExp(`(${ts.map((t) => esc(t).replace(/\s+/g, '\\s+')).join('|')})`, 'ig')
  const first = ts[0].toLowerCase().replace(/\s+/g, ' ')
  return text.split(rx).map((part, i) => i % 2
    ? <mark key={i} className={part.toLowerCase().replace(/\s+/g, ' ') === first ? '' : 'pin'}>{part}</mark>
    : part)
}

/* The searchable (OCR) volume PDF via pdf.js, vendored in public/pdfjs so no
   package change: continuous scroll, selectable text, find-highlight. Byte-range
   loading, so a 350 MB volume opens on the pages in view. Falls back to the page
   images while a volume has no PDF on the server. */
let pdfjs
const PDFJS = location.origin + '/pdfjs/' // runtime URL: keeps Rollup from bundling the vendored files
const loadPdfjs = () => (pdfjs ||= (async () => {
  const lib = await import(/* @vite-ignore */ PDFJS + 'pdf.min.js')
  globalThis.pdfjsLib = lib // pdf_viewer reads it at import
  lib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js'
  const css = document.createElement('link')
  css.rel = 'stylesheet'; css.href = '/pdfjs/pdf_viewer.css'
  document.head.appendChild(css)
  return { lib, V: await import(/* @vite-ignore */ PDFJS + 'pdf_viewer.js') }
})().catch((e) => { pdfjs = null; throw e }))

export function PdfPane({ url, page, q, onPage, api, fallback, rotation = 0, fit = 'page-width' }) {
  const box = useRef(null)
  const inner = useRef(null)
  const live = useRef({ page, q, onPage, rotation, fit })
  live.current = { page, q, onPage, rotation, fit }
  const [state, setState] = useState('loading')
  const find = (x, query) => x?.bus.dispatch('find', {
    source: null, type: '', query, caseSensitive: false, entireWord: false,
    highlightAll: true, findPrevious: false, phraseSearch: true, matchDiacritics: false,
  })

  useEffect(() => {
    let dead = false
    let task
    setState('loading')
    loadPdfjs().then(async ({ lib, V }) => {
      if (dead) return
      const bus = new V.EventBus()
      const link = new V.PDFLinkService({ eventBus: bus })
      const fc = new V.PDFFindController({ eventBus: bus, linkService: link })
      const pv = new V.PDFViewer({ container: box.current, viewer: inner.current, eventBus: bus,
                                  linkService: link, findController: fc })
      link.setViewer(pv)
      bus.on('pagesinit', () => {
        pv.pagesRotation = live.current.rotation
        pv.currentScaleValue = live.current.fit
        pv.currentPageNumber = live.current.page
        if (live.current.q) find(api.current, live.current.q)
        setState('ok')
      })
      bus.on('pagechanging', (e) => live.current.onPage(e.pageNumber))
      task = lib.getDocument({ url, withCredentials: true, disableAutoFetch: true, disableStream: true,
                               rangeChunkSize: 1 << 20 })
      const doc = await task.promise
      if (dead) return
      api.current = { pv, bus }
      pv.setDocument(doc); link.setDocument(doc)
    }).catch(() => { if (!dead) setState('fail') })
    return () => { dead = true; api.current = null; task?.destroy() }
  }, [url])
  useEffect(() => { // rail / Prev / Next jumps; scrolling itself already set the page
    const pv = api.current?.pv
    if (pv?.pagesCount && pv.currentPageNumber !== page) pv.currentPageNumber = page
  }, [page])
  useEffect(() => { if (state === 'ok') find(api.current, q || '') }, [q])
  useEffect(() => { // drawing viewer: rotate (landscape ⇄ portrait) and fit width / whole page
    const pv = api.current?.pv
    if (state !== 'ok' || !pv?.pagesCount) return
    const n = pv.currentPageNumber
    pv.pagesRotation = rotation
    pv.currentScaleValue = fit
    pv.currentPageNumber = n
  }, [rotation, fit, state])

  if (state === 'fail') return fallback
  return (
    <div className="card rd-pdf">
      {state === 'loading' && <span className="dim rd-pdf-wait">Opening the volume…</span>}
      <div className="rd-pdf-box" ref={box}><div className="pdfViewer" ref={inner} /></div>
    </div>
  )
}

/* header issue picker: the reader works on one issue at a time (or all of them) */
function IssuePick({ issues, issue, all, count, onPick, can, onNew }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const out = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc) }
  }, [open])
  const pick = (id) => { onPick(id); setOpen(false) }
  const nCl = (i) => (i.intel || []).length
  const sorted = [...issues].sort((x, y) => (x.status === 'Open' ? 0 : 1) - (y.status === 'Open' ? 0 : 1))
  return (
    <span className="rd-ip" ref={ref}>
      <button type="button" className="rd-ip-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}
              title={all ? 'All issues' : issue?.title || 'Pick an issue to load its clauses'}>
        <span className="rd-ip-k">Issue</span>
        {!all && issue && <span className={`rd-dot ${issue.status === 'Open' ? '' : 'off'}`} />}
        <span className="rd-ip-t" style={!all && !issue ? { fontWeight: 400, color: 'var(--ink-2)' } : undefined}>
          {all ? 'All issues' : issue?.title || (issues.length ? 'None — pick to load clauses' : 'No issues yet')}</span>
        {(all || issue) && <span className="rg-n">§{count}</span>}<span className="rg-chev">▾</span>
      </button>
      {open && (
        <div className="rd-ip-pop" role="listbox">
          {(all || issue) && <><button type="button" role="option" aria-selected={false} className="rd-ip-o" onClick={() => pick('')}>
            <span className="rd-ip-t" style={{ fontWeight: 400 }}>✕ No issue — just read the volume</span></button><div className="rd-ip-sep" /></>}
          {sorted.map((i) => (
            <button key={i.id} type="button" role="option" aria-selected={!all && i.id === issue?.id}
                    className={`rd-ip-o ${!all && i.id === issue?.id ? 'on' : ''}`} onClick={() => pick(i.id)}>
              <span className={`rd-dot ${i.status === 'Open' ? '' : 'off'}`} />
              <span className="rd-ip-t">{i.title}</span>
              <span className="rd-ip-st">{i.status}</span><span className="rg-n">§{nCl(i)}</span>
            </button>
          ))}
          {issues.length > 1 && (
            <button type="button" role="option" aria-selected={all} className={`rd-ip-o ${all ? 'on' : ''}`} onClick={() => pick('*')}>
              <span className="rd-dot off" style={{ background: 'var(--accent)' }} /><span className="rd-ip-t">All issues</span>
              <span className="rg-n">§{issues.reduce((a, i) => a + nCl(i), 0)}</span>
            </button>
          )}
          <div className="rd-ip-sep" />
          {!all && issue && <a className="rd-ip-o" href={`#/tenders?issue=${encodeURIComponent(issue.id)}`}>↗ Open this issue's page</a>}
          {can && <button type="button" className="rd-ip-o" style={{ color: 'var(--accent)', fontWeight: 650 }}
                          onClick={() => { setOpen(false); onNew() }}>＋ New issue</button>}
          <a className="rd-ip-o" href="#/tenders">{can ? 'Manage issues on the Tenders page' : 'All issues on the Tenders page'}</a>
        </div>
      )}
    </span>
  )
}

export function ReaderView({ vol: v0, page: p0, q: q0 }) {
  /* the issue in focus rides in the URL (&i=ID, or * = all) so issue-page links bring it and a plain volume link
     opens with none; App's router passes v/p/q only, so it is read from the hash here */
  const [, bump] = useState(0)
  useEffect(() => { const h = () => bump((n) => n + 1); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h) }, [])
  const hq = new URLSearchParams(location.hash.split('?')[1] || '')
  const issId = hq.get('i') || ''
  const c0 = /^c[1-9]$/.test(hq.get('c') || '') ? hq.get('c') : 'c1'   // contract (register key); c1 = Siemens PS
  const { data, error, reload } = useTenders()
  const [notes, setNotes] = useState([])
  const [cf, setCf] = useState(null)   // clause being added from this page
  const [mf, setMf] = useState(null)   // bookmark / important being titled
  const [newIss, setNewIss] = useState(false)
  const [logs, setLogs] = useState(null) // the issue's logbook history (failures, job cards, rectifications)
  const [allMarks, setAllMarks] = useState(false)
  const [q, setQ] = useState(q0 || '')
  const [res, setRes] = useState(null)
  const [zoom, setZoom] = useState(false)
  const [draft, setDraft] = useState({ kind: 'note', title: '', text: '' })
  const [editId, setEditId] = useState(null)   // note being edited in the right-bar form
  const [msg, setMsg] = useState('')
  const pdfApi = useRef(null)
  const [at, setAt] = useState(null) // page scrolled to in the PDF (hash kept in step, no history spam)
  const [rail, setRail] = useState(loadRail) // { g: {group: open}, s: {section: open}, hide }
  const [rf, setRf] = useState('')           // rail filter
  const [mkKind, setMkKind] = useState('')
  const [mkIss, setMkIss] = useState(false)  // marks: only the issue in focus
  const hoodRef = useRef(null)
  useEffect(() => setAt(null), [v0, p0, c0])
  useTopbarVar()
  /* the columns dock exactly under the hood, whatever its height */
  useEffect(() => {
    const el = hoodRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--rd-hood-h', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [!!data])

  const issues = data?.issues || []
  const issue = issues.find((i) => i.id === issId) // none unless picked
  const can = !!data?.can_edit   // Green Line logins edit issues/clauses; other lines read
  const pinsOf = (i) => (i?.intel || []).filter((r) => (r.c || 'c1') === c0).map((r) => ({ ...r, iid: i.id, key: r.vol.split(' ')[0], rg: range(r.pdf_p) })).filter((r) => r.rg)
  const pins = pinsOf(issue)
  /* an issue belongs to the contracts its clauses cite: the reader lists only this contract's (the one in focus stays, so its first clause here can be added) */
  const cIss = issues.filter((i) => i.id === issId || (i.intel || []).some((r) => (r.c || 'c1') === c0))
  const all = issId === '*' && cIss.length > 1
  const shownIss = all ? cIss : [issue].filter(Boolean)
  const allPins = shownIss.flatMap(pinsOf) // pins of the issue picked in the header (or of every issue)
  const cts = (data?.tenders || []).filter((t) => t.key && t.volumes.some((x) => x.key))
  const ct = cts.find((t) => t.key === c0) || cts[0]
  const c = ct?.key || 'c1'
  const cq = `?c=${c}`
  const vols = (ct?.volumes || []).filter((x) => x.key)
  const vWant = v0 || pins[0]?.key || 'V1'
  const vol = vols.some((x) => x.key === vWant) ? vWant : (vols[0]?.key || 'V1')   // a V5 link on a 2-volume contract
  const meta = vols.find((x) => x.key === vol)
  const page = at?.vol === vol ? at.page : Math.max(1, +p0 || (v0 ? 1 : pins[0]?.rg?.[0] || 1))
  const total = meta?.pages || 1
  const hash = (v, p, qq, ii = issId, cc = c) => `#/tenders/read?v=${v}&p=${p}${cc !== 'c1' ? `&c=${cc}` : ''}${qq ? `&q=${encodeURIComponent(qq)}` : ''}${ii ? `&i=${encodeURIComponent(ii)}` : ''}`
  const open = (v, p, qq = q) => {
    setAt({ vol: v, page: p })
    location.hash = hash(v, p, qq)
  }

  useEffect(() => { getJSON('/api/tenders/notes').then(setNotes).catch(() => {}) }, [])
  const [nAssets, setNAssets] = useState(null)   // System → Asset dropdown source, fetched once
  useEffect(() => { getJSON('/api/tenders/note-assets').then(setNAssets).catch(() => setNAssets([])) }, [])
  useEffect(() => {
    setLogs(null)
    if (!issue?.id) return
    getJSON(`/api/tenders/issue/${encodeURIComponent(issue.id)}/trail`).then((t) => setLogs(t.failures || [])).catch(() => setLogs([]))
  }, [issue?.id])
  useEffect(() => {
    const qq = (q0 || '').trim()
    if (qq.length < 3) { setRes(null); return }
    getJSON(`/api/tenders/search?q=${encodeURIComponent(qq)}&c=${c0}`).then(setRes).catch(() => setRes(null))
  }, [q0, c0])
  useEffect(() => {
    const k = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return
      if (e.key === 'ArrowRight' && page < total) open(vol, page + 1, q0)
      if (e.key === 'ArrowLeft' && page > 1) open(vol, page - 1, q0)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  const g = gate(error, data, 'the contract reader')
  if (g) return g
  if (!vols.length) return <div className="card">No contract volume is on file for reading yet.</div>

  const here = (r) => r.key === vol && r.rg && page >= r.rg[0] && page <= r.rg[1]
  const pagePins = allPins.filter(here)
  const cNotes = notes.filter((n) => (n.c || 'c1') === c)
  const pageNotes = cNotes.filter((n) => n.vol === vol && n.page === page)
  const marks = cNotes.filter((n) => (n.kind !== 'note' || n.text || n.title) && (allMarks || n.mine))
  const secs = (meta?.contents || []).map(([name, pp]) => ({ name, rg: range(pp) })).filter((s) => s.rg)
  const curSec = secs.find((s) => page >= s.rg[0] && page <= s.rg[1])
  const volPins = allPins.filter((r) => r.key === vol)
  const putRail = (patch) => setRail((st) => {
    const n = { ...st, ...patch }
    try { localStorage.setItem(RAIL_KEY, JSON.stringify(n)) } catch { /* private window: state just isn't kept */ }
    return n
  })
  const f = rf.trim().toLowerCase()
  const isOpen = (id, dflt) => (f ? true : (rail.g?.[id] ?? dflt))
  const toggle = (id, v) => putRail({ g: { ...(rail.g || {}), [id]: v } })
  const secKey = (s) => `${c === 'c1' ? '' : `${c}/`}${vol}:${s.name}`
  const secOpen = (s) => rail.s?.[secKey(s)] ?? (s === curSec)
  const clauseOk = (r) => has(f, r.clause, r.topic, r.extract, r.use)
  const shownMarks = marks.filter((n) => (!mkKind || n.kind === mkKind) && (!mkIss || !issue || n.issue_id === issue.id) && has(f, n.title, n.text, `${n.vol} p${n.page}`))
    .sort((a, b) => a.vol.localeCompare(b.vol) || a.page - b.page)
  const hits = res?.hits || []
  const inSec = (s) => (x) => (x.vol ?? x.key) === vol && (x.page ?? x.rg[0]) >= s.rg[0] && (x.page ?? x.rg[0]) <= s.rg[1]
  const setAll = (v) => putRail({
    g: Object.fromEntries(['marks', 'secs', ...issues.flatMap((i) => [`iss:${i.id}`, `ov:${i.id}`, `fl:${i.id}`])].map((k) => [k, v])),
    s: Object.fromEntries(secs.map((s) => [secKey(s), v])),
  })
  const pickIssue = (id) => {          // keep the page; the issue's clauses load into the right bar
    setAt({ vol, page }); location.hash = hash(vol, page, q0, id)
    if (id) putRail({ g: { ...(rail.g || {}), [`iss:${id}`]: true } })
  }
  const showRail = (g) => putRail({ hide: false, g: { ...(rail.g || {}), [g]: true } })

  const submitQ = (e) => { e.preventDefault(); open(vol, page, q.trim()) }
  const addNote = async (b) => {
    const body = { c, vol, page, kind: b.kind, title: (b.title || '').trim(), text: (b.text || '').trim(), issue_id: (b.issue_id ?? issue?.id) || null,
                   tags: splitList(b.tags), assets: splitList(b.assets), status: b.status || '', system: b.system || '' }
    if (body.kind === 'note' && !body.text && !body.title) return false
    try {
      const n = await send('POST', '/api/tenders/notes', body)
      setNotes((xs) => [...xs, n]); setMsg(''); return true
    } catch (x) { setMsg(x.message); return false }
  }
  const patchNote = async (id, b) => {
    try { const n = await send('PATCH', `/api/tenders/notes/${id}`, b); setNotes((xs) => xs.map((x) => (x.id === id ? n : x))); setMsg(''); return true }
    catch (x) { setMsg(x.message); return false }
  }
  const delNote = async (id) => {
    try { await send('DELETE', `/api/tenders/notes/${id}`); setNotes((xs) => xs.filter((x) => x.id !== id)) }
    catch (x) { setMsg(x.message) }
  }
  /* text selected in the PDF becomes the clause extract; read on mousedown so the click doesn't clear it */
  const startClause = (e) => {
    e.preventDefault()
    const sel = (window.getSelection()?.toString() || '').replace(/\s+/g, ' ').trim().slice(0, 4000)
    setCf({ iid: issue?.id || '', pdf_p: String(page), printed_p: '', clause: '', topic: '', extract: sel, use: '', err: '' })
  }
  const saveClause = async (e) => {
    e.preventDefault()
    const { iid, err, ...body } = cf
    try {
      await send('POST', `/api/tenders/issues/${iid}/clauses`, { ...body, c, vol })
      setCf(null); await reload()
      if (!all && iid !== issue?.id) pickIssue(iid)
    } catch (x) { setCf({ ...cf, err: x.message }) }
  }
  const issueName = (id) => issues.find((i) => i.id === id)?.title || id
  const PinBtn = ({ r, iss, go }) => (
    <button type="button" className={`rd-it cl ${go ? '' : here(r) ? 'on' : ''}`} title={r.extract}
            onClick={() => (go ? (setAt({ vol: r.key, page: r.rg[0] }), location.hash = hash(r.key, r.rg[0], q0, go)) : open(r.key, r.rg[0], q0))}>
      <span className="rd-top"><span className="rd-tag">§ {r.clause}</span><span className="rd-pg">{r.key} p{r.rg[0]}</span></span>
      {(r.topic || iss) && <div className="rd-sub">{r.topic}{iss && <> · ↳ {issueName(r.iid)}</>}</div>}
    </button>
  )
  const MarkBtn = ({ n }) => (
    <button type="button" className={`rd-it mk ${n.kind} ${n.vol === vol && n.page === page ? 'on' : ''}`} onClick={() => open(n.vol, n.page, q0)}>
      <span className="rd-top"><span className="rd-tag">{MKI[n.kind]} {n.title || KIND[n.kind].slice(2)}</span><span className="rd-pg">{n.vol} p{n.page}</span></span>
      {n.text && <div className="rd-sub">{n.text}</div>}
      {(n.issue_id || (allMarks && !n.mine)) && <div className="rd-sub" style={{ fontSize: 11 }}>
        {n.issue_id && <>↳ {issueName(n.issue_id)}</>}{allMarks && !n.mine && <> · {n.by}</>}</div>}
    </button>
  )

  return (
    <>
      <style>{READER_CSS}</style>
      <div className="card dash-hood rd-hood" ref={hoodRef}>
        <form className="dash-toolbar" onSubmit={submitQ}>
          <a className="dash-crumb" href="#/tenders" title="All tenders">← Tenders</a>
          {cts.length > 1
            ? <select className="dash-title rd-ct" value={c} aria-label="Contract" title={ct.title}
                      onChange={(e) => { setAt(null); location.hash = hash('V1', 1, '', '', e.target.value) }}>
                {cts.map((t) => <option key={t.key} value={t.key}>{t.short}</option>)}
              </select>
            : <h1 className="dash-title">{ct.short || ct.title}</h1>}
          <span className="rd-vols">
            {vols.map((x) => (
              <button key={x.key} type="button" className={x.key === vol ? 'on' : ''} title={`${x.vol} · ${x.pages} pp`}
                      onClick={() => open(x.key, 1, q0)}>{x.key}</button>
            ))}
          </span>
          <IssuePick issues={cIss} issue={issue} all={all} count={allPins.length} onPick={pickIssue} can={can} onNew={() => setNewIss(true)} />
          <span className="rd-hmeta" title={curSec?.name || ''}>
            {meta.vol} · p <b>{page}</b>/{total}
            {volPins.length > 0 && <> · <b>{volPins.length}</b> § here</>}
            {res && <> · <b>{res.total}</b> hits</>}
          </span>
          <span className="rd-hsearch">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="Search all volumes — clause no., word…" aria-label="Search contract" />
            <button type="submit" className="btn preset">Search</button>
            {q0 && <button type="button" className="btn ghost sm" onClick={() => { setQ(''); open(vol, page, '') }}>Clear</button>}
          </span>
        </form>
      </div>

      <div className={`rd ${rail.hide ? 'nr' : ''}`}>
        {rail.hide ? (
          <aside className="card rd-rail rd-mini">
            <button type="button" className="rd-ib" title="Show sidebar" onClick={() => putRail({ hide: false })}>⟩</button>
            {cIss.length > 0 && <button type="button" className="rd-ib" title={issue ? 'Issue clauses' : 'Issues'}
                    onClick={() => showRail(issue ? `iss:${issue.id}` : `ov:${cIss[0].id}`)}>§<small>{issue || all ? allPins.length : cIss.length}</small></button>}
            <button type="button" className="rd-ib" title="Bookmarks & notes" onClick={() => showRail('marks')}>🔖<small>{marks.length}</small></button>
            <button type="button" className="rd-ib" title="Contents" onClick={() => showRail('secs')}>☰<small>{secs.length}</small></button>
          </aside>
        ) : (
        <aside className="card rd-rail">
          <div className="rd-railbar">
            <input type="search" value={rf} onChange={(e) => setRf(e.target.value)} placeholder="Filter clauses, marks, sections…" aria-label="Filter sidebar" />
            <button type="button" className="rd-ib" title="Expand all" onClick={() => setAll(true)}>⊞</button>
            <button type="button" className="rd-ib" title="Collapse all" onClick={() => setAll(false)}>⊟</button>
            <button type="button" className="rd-ib" title="Hide sidebar" onClick={() => putRail({ hide: true })}>⟨</button>
          </div>

          {/* issue: overview of all when none is picked, its clauses by volume once picked */}
          {!all && !issue ? (<>
            <div style={{ padding: '6px 4px 4px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b>Issues · {cIss.length}</b>
                {can && !newIss && <button type="button" className="btn preset sm" style={{ marginLeft: 'auto' }} onClick={() => setNewIss(true)}>＋ New issue</button>}</span>
              <div className="dim" style={{ fontSize: 12, margin: '2px 0 4px' }}>
                {cIss.length ? 'None in focus. Pick one to load its clauses on the pages; open a clause to jump there with it.' : issues.length ? 'No issue cites this contract yet.' : 'No issues yet.'}</div>
            </div>
            {[...cIss].sort((x, y) => (x.status === 'Open' ? 0 : 1) - (y.status === 'Open' ? 0 : 1)).map((i) => {
              const ps = pinsOf(i).filter(clauseOk)
              return (
                <Group key={i.id} id={`ov:${i.id}`} tone="iss" open={isOpen(`ov:${i.id}`, false)} onToggle={toggle}
                       icon={<span className={`rd-dot ${i.status === 'Open' ? '' : 'off'}`} title={i.status} />} title={i.title} count={ps.length}
                       extra={<a className="rg-go" href={`#/tenders?issue=${encodeURIComponent(i.id)}`} title="Open the issue page">↗</a>}>
                  {i.summary && <div className="rd-sub" style={{ padding: '2px 4px 6px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{i.summary}</div>}
                  <button type="button" className="btn preset sm" style={{ margin: '0 4px 6px' }} onClick={() => pickIssue(i.id)}>Load its clauses</button>
                  {!ps.length && <div className="rd-empty">No clauses yet.</div>}
                  {ps.sort((x, y) => x.key.localeCompare(y.key) || x.rg[0] - y.rg[0]).map((r, n) => <PinBtn key={r.id || n} r={r} go={i.id} />)}
                </Group>
              )
            })}
          </>) : shownIss.map((i) => {
            const ps = pinsOf(i).filter(clauseOk)
            const byVol = [...new Set(ps.map((r) => r.key))].sort()
            return (
              <Group key={i.id} id={`iss:${i.id}`} tone="iss" open={isOpen(`iss:${i.id}`, !all || i.id === issue?.id)} onToggle={toggle}
                     icon={<span className={`rd-dot ${i.status === 'Open' ? '' : 'off'}`} title={i.status} />}
                     title={all ? i.title : 'Issue clauses'} count={ps.length}
                     extra={<a className="rg-go" href={`#/tenders?issue=${encodeURIComponent(i.id)}`} title="Open the issue page">↗</a>}>
                {!ps.length && <div className="rd-empty">No clauses yet{can ? ' — select text on a page, then ＋ Add clause' : ''}.</div>}
                {byVol.map((k) => (
                  <Fragment key={k}>
                    <div className="rd-vh">{vols.find((x) => x.key === k)?.vol || k} · {ps.filter((r) => r.key === k).length}</div>
                    {ps.filter((r) => r.key === k).sort((x, y) => x.rg[0] - y.rg[0]).map((r, n) => <PinBtn key={r.id || n} r={r} />)}
                  </Fragment>
                ))}
              </Group>
            )
          })}

          {issue && !all && (() => {
            const fl = (logs || []).filter((x) => has(f, x.kind, x.date, x.asset, x.location, x.fault, x.description, x.work_done))
              .sort((x, y) => (y.key - x.key) || (y.date || '').localeCompare(x.date || ''))
            const nf = fl.filter((x) => /fail/i.test(x.kind)).length
            return (
              <Group id={`fl:${issue.id}`} tone="iss" open={isOpen(`fl:${issue.id}`, false)} onToggle={toggle}
                     title="Failures & job cards" count={logs ? fl.length : '…'}
                     extra={<a className="rg-go" href={`#/tenders?issue=${encodeURIComponent(issue.id)}`} title="Link / mark key failures on the issue page">↗</a>}>
                {logs && <div className="dim" style={{ fontSize: 12, padding: '2px 4px 4px' }}>{nf} failures · Green Line logbook entries matching the issue{fl.some((x) => x.key) ? ' · ★ = key' : ''}</div>}
                {!logs && <div className="rd-empty">Loading…</div>}
                {logs && !fl.length && <div className="rd-empty">No logbook entries match this issue.</div>}
                {fl.slice(0, 60).map((x) => (
                  <div key={x.id} className="rd-it" style={{ cursor: 'default' }}
                       title={[x.description, x.work_done && `Work done: ${x.work_done}`, x.why && `Why linked: ${x.why}`].filter(Boolean).join('\n\n')}>
                    <span className="rd-top"><span className="rd-tag">{x.key ? '★ ' : ''}{x.kind} · {x.asset}</span><span className="rd-pg">{x.date || '—'}</span></span>
                    <div className="rd-sub" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {x.location && <>{x.location} · </>}{x.description}</div>
                  </div>
                ))}
                {fl.length > 60 && <a className="rd-empty" href={`#/tenders?issue=${encodeURIComponent(issue.id)}`}>All {fl.length} on the issue page ↗</a>}
              </Group>
            )
          })()}

          <Group id="secs" tone="sec" open={isOpen('secs', true)} onToggle={toggle} title={`${meta.vol} · contents`} count={secs.length}>
            {!secs.length && <div className="rd-empty">Section index not built for this volume — use the clauses and search.</div>}
            {secs.map((s) => {
              const cur = s === curSec
              const sp = allPins.filter(inSec(s)).filter(clauseOk)
              const sh = (res?.hits || []).filter(inSec(s))
              const sn = notes.filter(inSec(s))
              if (f && !has(f, s.name) && !sp.length) return null
              const on = f ? sp.length > 0 || cur : secOpen(s)
              const any = sp.length + sh.length + sn.length > 0
              return (
                <Fragment key={s.name}>
                  <div className={`rd-secrow ${cur ? 'cur' : ''}`}>
                    <button type="button" className="rd-chv" disabled={!any && !cur} aria-label={on ? 'Collapse' : 'Expand'}
                            onClick={() => putRail({ s: { ...(rail.s || {}), [secKey(s)]: !on } })}>{on ? '▼' : '▶'}</button>
                    <button type="button" className="rd-secname" onClick={() => open(vol, s.rg[0], q0)}>
                      {s.name}
                      <span className="rd-badges">
                        {sp.length > 0 && <span className="rd-b cl" title="clauses">§{sp.length}</span>}
                        {sn.length > 0 && <span className="rd-b mk" title="bookmarks & notes">🔖{sn.length}</span>}
                        {sh.length > 0 && <span className="rd-b hit" title="search hits">🔎{sh.length}</span>}
                      </span>
                      <div className="rd-pg">p {s.rg[0]}–{s.rg[1]}{cur && <> · on p {page - s.rg[0] + 1} of {s.rg[1] - s.rg[0] + 1}</>}</div>
                    </button>
                  </div>
                  {cur && <div className="rd-prog"><i style={{ width: `${Math.round(100 * (page - s.rg[0] + 1) / (s.rg[1] - s.rg[0] + 1))}%` }} /></div>}
                  {on && any && (
                    <div className="rd-sec">
                      {sp.sort((x, y) => x.rg[0] - y.rg[0]).map((r, n) => <PinBtn key={`${r.iid}${n}`} r={r} iss={all} />)}
                      {sn.map((n) => <MarkBtn key={n.id} n={n} />)}
                      {sh.map((h) => (
                        <button key={h.page} type="button" className={`rd-it hit ${h.page === page ? 'on' : ''}`}
                                onClick={() => open(vol, h.page, q0)}>
                          <span className="rd-top"><span className="rd-tag">🔎 p{h.page}</span><span className="rd-pg">{h.count}×</span></span>
                        </button>
                      ))}
                    </div>
                  )}
                </Fragment>
              )
            })}
          </Group>

          <Group id="marks" tone="mk" open={isOpen('marks', true)} onToggle={toggle} title="Bookmarks & notes" count={shownMarks.length}>
            <div className="rd-chips">
              {[['', 'All'], ['important', '★'], ['bookmark', '🔖'], ['note', '✎']].map(([k, t]) => (
                <button key={k || 'all'} type="button" className={`rd-chip ${mkKind === k ? 'on' : ''}`} title={k ? KIND[k] : 'All kinds'}
                        onClick={() => setMkKind(k)}>{t}</button>
              ))}
              {issue && <button type="button" className={`rd-chip ${mkIss ? 'on' : ''}`} title={`Only marks tagged to ${issue.title}`}
                                onClick={() => setMkIss(!mkIss)}>↳ issue</button>}
              <span style={{ flex: 1 }} />
              <button type="button" className={`rd-chip ${!allMarks ? 'on' : ''}`} onClick={() => setAllMarks(false)}>Mine</button>
              <button type="button" className={`rd-chip ${allMarks ? 'on' : ''}`} onClick={() => setAllMarks(true)}>Everyone</button>
            </div>
            {!shownMarks.length && <div className="rd-empty">{f || mkKind ? 'Nothing matches.' : allMarks ? 'None yet.' : 'None of yours yet — use ★ or 🔖 above the page.'}</div>}
            {shownMarks.map((n) => <MarkBtn key={n.id} n={n} />)}
          </Group>
          <div className="rd-legend"><span style={{ color: 'var(--accent)' }}>§ clause</span><span>★ important</span><span>🔖 bookmark</span><span>✎ note</span><span>🔎 hit</span></div>
        </aside>
        )}

        <main>
          <div className="rd-bar">
            <button type="button" className="btn ghost sm" disabled={page <= 1} onClick={() => open(vol, page - 1, q0)}>‹ Prev</button>
            <input type="number" min={1} max={total} defaultValue={page} key={vol + page} aria-label="Page"
                   onKeyDown={(e) => { if (e.key === 'Enter') open(vol, Math.min(total, Math.max(1, +e.currentTarget.value || 1)), q0) }} />
            <span className="dim">/ {total}</span>
            <button type="button" className="btn ghost sm" disabled={page >= total} onClick={() => open(vol, page + 1, q0)}>Next ›</button>
            <button type="button" className="btn ghost sm" title="Zoom out"
                    onClick={() => (pdfApi.current ? pdfApi.current.pv.decreaseScale() : setZoom(false))}>−</button>
            <button type="button" className="btn ghost sm" title="Fit width"
                    onClick={() => { if (pdfApi.current) pdfApi.current.pv.currentScaleValue = 'page-width'; setZoom(false) }}>Fit</button>
            <button type="button" className="btn ghost sm" title="Zoom in"
                    onClick={() => (pdfApi.current ? pdfApi.current.pv.increaseScale() : setZoom(true))}>+</button>
            <a className="btn ghost sm" href={`${API}/api/tenders/read/${vol}/pdf${cq}#page=${page}`} target="_blank" rel="noreferrer">Open PDF</a>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn ghost sm" onClick={() => setMf({ kind: 'important', title: '', issue_id: issue?.id || '' })}>★ Important</button>
            <button type="button" className="btn ghost sm" onClick={() => setMf({ kind: 'bookmark', title: '', issue_id: issue?.id || '' })}>🔖 Bookmark</button>
          </div>
          {newIss && <IssueForm onCancel={() => setNewIss(false)}
                                onSaved={async (id) => { await reload(); setNewIss(false); pickIssue(id) }} />}
          {mf && (
            <form className="rd-bar card" style={{ padding: '6px 8px', marginBottom: 8 }}
                  onSubmit={async (e) => { e.preventDefault(); if (await addNote(mf)) setMf(null) }}>
              <b>{KIND[mf.kind]} · {vol} p{page}</b>
              <input autoFocus value={mf.title} maxLength={120} placeholder="Title (optional) — e.g. DLP 36 months"
                     onChange={(e) => setMf({ ...mf, title: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
              <select value={mf.issue_id} onChange={(e) => setMf({ ...mf, issue_id: e.target.value })} aria-label="Issue">
                <option value="">No issue</option>
                {issues.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
              </select>
              <button type="submit" className="btn preset sm">Save</button>
              <button type="button" className="btn ghost sm" onClick={() => setMf(null)}>Cancel</button>
            </form>
          )}
          <PdfPane key={c + vol} url={`${API}/api/tenders/read/${vol}/pdf${cq}`} page={page} q={q0} api={pdfApi}
                   onPage={(p) => {
                     setAt({ vol, page: p })
                     history.replaceState(null, '', hash(vol, p, q0))
                   }}
                   fallback={(
                     <div className={`card rd-page ${zoom ? 'zoom' : ''}`}>
                       <img src={`${API}/api/tenders/read/${vol}/page/${page}${cq}`} alt={`${meta.vol} page ${page}`} />
                       {page < total && <link rel="prefetch" href={`${API}/api/tenders/read/${vol}/page/${page + 1}${cq}`} />}
                     </div>
                   )} />
        </main>

        <aside className="rd-side">
          <div className="card rd-sum rd-here">
            <b>{meta.vol}</b><span>p <b>{page}</b> / {total}</span>
            {curSec && <span className="rd-here-sec" title={curSec.name}>{curSec.name} · {page - curSec.rg[0] + 1}/{curSec.rg[1] - curSec.rg[0] + 1}</span>}
            {curSec && <div className="rd-prog"><i style={{ width: `${Math.round(100 * (page - curSec.rg[0] + 1) / (curSec.rg[1] - curSec.rg[0] + 1))}%` }} /></div>}
          </div>
          {res && (
            <div className="card" style={{ padding: 0, marginBottom: 10, overflow: 'hidden' }}>
              <Group id="search" tone="hit" open={isOpen('search', true)} onToggle={toggle} title={`Search · “${res.q}”`} count={hits.length}
                     extra={<button type="button" className="rg-go" title="Clear search" onClick={() => { setQ(''); open(vol, page, '') }}>✕</button>}>
                {!hits.length && <div className="rd-empty">No page matches.</div>}
                {hits.map((h) => (
                  <button key={h.vol + h.page} type="button" className={`rd-it hit ${h.vol === vol && h.page === page ? 'on' : ''}`}
                          onClick={() => open(h.vol, h.page, q0)}>
                    <span className="rd-top"><span className="rd-tag">🔎 {h.vol} p{h.page}</span><span className="rd-pg">{h.count}×</span></span>
                    <div className="rd-sub"><Highlight text={h.snippet} terms={[res.q]} /></div>
                  </button>
                ))}
              </Group>
            </div>
          )}
          {(pagePins.length > 0 || (can && issues.length > 0)) && (
            <div className="card" style={{ marginBottom: 10 }}>
              <h3 style={{ marginTop: 0 }}>Clauses on this page{pagePins.length > 0 && <> · {pagePins.length}</>}</h3>
              {pagePins.map((r, i) => (
                <div key={r.id || i} className="rd-pin">
                  <b className="code">§ {r.clause}</b> <span className="dim">· {r.topic}</span>
                  {all && <div className="rd-pin-iss">↳ {issueName(r.iid)}</div>}
                  <div>{r.extract}</div><div className="dim" style={{ marginTop: 3 }}>Use: {r.use}</div>
                </div>
              ))}
              {!pagePins.length && <div className="rd-empty">None on this page.</div>}
            {can && issues.length > 0 && !cf && (
              <button type="button" className="btn preset" style={{ width: '100%', marginTop: 8 }} onMouseDown={startClause}
                      title="Select the clause text in the page first, then press this">＋ Add clause to issue</button>
            )}
            {cf && (
              <form style={{ ...FORM, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-2, #EAF1F6)' }} onSubmit={saveClause}>
                <h3 style={{ margin: 0 }}>Add clause · {vol}</h3>
                <Lbl t="Issue"><select value={cf.iid} onChange={(e) => setCf({ ...cf, iid: e.target.value })} required>
                  {!cf.iid && <option value="">— pick the issue —</option>}{issues.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}</select></Lbl>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <Lbl t="PDF page" hint="or 12–14"><input value={cf.pdf_p} onChange={(e) => setCf({ ...cf, pdf_p: e.target.value })} required /></Lbl>
                  <Lbl t="Printed page" hint="optional"><input value={cf.printed_p} maxLength={20} onChange={(e) => setCf({ ...cf, printed_p: e.target.value })} /></Lbl>
                </div>
                <Lbl t="Clause no."><input value={cf.clause} required maxLength={120} placeholder="e.g. GCC 10.8 / PS 16.4.1.7"
                                           onChange={(e) => setCf({ ...cf, clause: e.target.value })} /></Lbl>
                <Lbl t="Topic"><input value={cf.topic} maxLength={200} placeholder="e.g. Defects liability period"
                                      onChange={(e) => setCf({ ...cf, topic: e.target.value })} /></Lbl>
                <Lbl t="Extract" hint={cf.extract ? 'from your selection' : 'select text in the page, or type'}>
                  <textarea rows={5} value={cf.extract} maxLength={4000} onChange={(e) => setCf({ ...cf, extract: e.target.value })} /></Lbl>
                <Lbl t="Use" hint="how it helps the issue"><textarea rows={2} value={cf.use} maxLength={4000}
                                                                 onChange={(e) => setCf({ ...cf, use: e.target.value })} /></Lbl>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="submit" className="btn preset">Save clause</button>
                  <button type="button" className="btn ghost sm" onClick={() => setCf(null)}>Cancel</button>
                  <Err m={cf.err} />
                </span>
              </form>
            )}
            </div>
          )}
          <div className="card" >
            <h3 style={{ marginTop: 0 }}>Notes · p {page}</h3>
            {pageNotes.filter((n) => n.kind === 'note' || n.text || n.title).map((n) => (
              <div key={n.id} className={`rd-note${editId === n.id ? ' editing' : ''}`}>
                {n.title ? <b>{n.title}</b> : <b className="dim">Note</b>} <span className="dim">· {n.by} · {n.at.replace('T', ' ')}</span>
                {n.issue_id && <div className="dim" style={{ fontSize: 12 }}>↳ {issueName(n.issue_id)}</div>}
                {n.text && <div>{n.text}</div>}
                {(n.status || n.system || n.tags?.length > 0 || n.assets?.length > 0) && (
                  <div className="rd-chips">
                    {n.status && <span className={`rd-st st-${n.status}`}>{NSTATUS[n.status]}</span>}
                    {n.system && <span className="rd-sys" title="System">{n.system}</span>}
                    {(n.tags || []).map((t) => <span key={`t${t}`} className="rd-tag">#{t}</span>)}
                    {(n.assets || []).map((a) => <span key={`a${a}`} className="rd-asset" title="Asset">{a}</span>)}
                  </div>
                )}
                {n.mine && (
                  <div className="rd-bar" style={{ marginTop: 3 }}>
                    <select className="sm" value={n.status || ''} aria-label="Note status" onChange={(e) => patchNote(n.id, { status: e.target.value })}>
                      <option value="">No status</option>{Object.entries(NSTATUS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    </select>
                    <button type="button" className="btn ghost sm" onClick={() => {
                      setEditId(n.id)
                      setDraft({ kind: n.kind, title: n.title || '', text: n.text || '', issue_id: n.issue_id || '', status: n.status || '',
                                 system: n.system || '', assets: (n.assets || []).join(','), tags: (n.tags || []).join(',') })
                    }}>Edit</button>
                    <button type="button" className="btn ghost sm" onClick={() => delNote(n.id)}>Remove</button>
                  </div>
                )}
              </div>
            ))}
            <input style={{ width: '100%', marginBottom: 4 }} value={draft.title} maxLength={120} placeholder="Title (optional)"
                   onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <textarea rows={3} style={{ width: '100%' }} value={draft.text} placeholder="Add a note on this page…"
                      onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            <div className="rd-opt">
              {(() => {
                const all = nAssets || []
                const systems = [...new Set(all.map((a) => a.system).filter(Boolean))].sort()
                const picked = splitList(draft.assets)
                const pool = all.filter((a) => (!draft.system || a.system === draft.system) && !picked.includes(a.code))
                const nameOf = (code) => all.find((a) => a.code === code)?.name || ''
                return (<>
                  <select value={draft.system || ''} aria-label="System"
                          onChange={(e) => setDraft({ ...draft, system: e.target.value })}>
                    <option value="">{nAssets ? 'System (optional)' : 'Loading systems…'}</option>
                    {systems.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select value="" aria-label="Add asset" disabled={!nAssets}
                          onChange={(e) => {
                            const a = all.find((x) => x.code === e.target.value); if (!a) return
                            setDraft({ ...draft, assets: [...picked, a.code].join(','), system: draft.system || a.system })
                          }}>
                    <option value="">{draft.system ? `Asset in ${draft.system}…` : 'Asset (optional)…'}</option>
                    {pool.slice(0, 1500).map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                  </select>
                  {picked.length > 0 && (
                    <div className="rd-chips" style={{ gridColumn: '1 / -1', marginTop: 0 }}>
                      {picked.map((c) => (
                        <span key={c} className="rd-asset" title={nameOf(c)}>{c}
                          <button type="button" className="rd-x" aria-label={`Remove ${c}`}
                                  onClick={() => setDraft({ ...draft, assets: picked.filter((x) => x !== c).join(',') })}>×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </>)
              })()}
              <select value={draft.status || ''} aria-label="Status" onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                <option value="">Status (optional)</option>{Object.entries(NSTATUS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </div>
            <div className="rd-bar" style={{ marginTop: 4 }}>
              <select value={draft.issue_id ?? (issue?.id || '')} onChange={(e) => setDraft({ ...draft, issue_id: e.target.value })} aria-label="Issue" style={{ maxWidth: 140 }}>
                <option value="">No issue</option>{issues.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
              </select>
              <button type="button" className="btn preset"
                      onClick={async () => {
                        const reset = () => { setEditId(null); setDraft({ ...draft, kind: 'note', title: '', text: '', tags: '', assets: '', status: '', system: '', issue_id: undefined }) }
                        if (editId) {
                          if (await patchNote(editId, { kind: draft.kind, title: (draft.title || '').trim(), text: (draft.text || '').trim(),
                            issue_id: draft.issue_id || '', status: draft.status || '', system: draft.system || '',
                            assets: splitList(draft.assets), tags: splitList(draft.tags) })) reset()
                        } else if (await addNote(draft)) reset()
                      }}>{editId ? 'Update note' : 'Save note'}</button>
              {editId && <button type="button" className="btn ghost sm" onClick={() => { setEditId(null); setDraft({ kind: 'note', title: '', text: '' }) }}>Cancel edit</button>}
              {msg && <span className="dim">{msg}</span>}
            </div>
          </div>
        </aside>
      </div>
    </>
  )
}

/* ---------- the tender desk, in one page (linked from the Guide) ---------- */
export function TendersGuide() {
  useTopbarVar()
  const S = ({ h, children }) => <section className="card docs-sec"><h2>{h}</h2>{children}</section>
  return (
    <div style={{ maxWidth: 860 }}>
      <p style={{ margin: '4px 0 0' }}><a href="#/tenders">← Tenders</a> · <a href="#/guide">AMPS guide</a></p>
      <h1 className="docs-h1">Tenders, issues &amp; the reader</h1>
      <p className="docs-lead">The contract volumes, the issues raised against them, and the clauses, letters and logbook entries
        that back each issue — in one place, cross-referenced by page.</p>
      <S h="1 · Who can edit">
        <ul>
          <li><b>Green Line logins</b> create and edit issues, add clauses, and link letters, MoMs, logbook entries and job cards.</li>
          <li><b>Other lines</b> read everything — tenders, issues, clauses, the reader — but cannot add or change them.</li>
          <li><b>Notes and bookmarks</b> are personal and open to every login that can write.</li>
        </ul>
      </S>
      <S h="2 · Tenders and volumes">
        <ul>
          <li>The <b>Tenders</b> page lists every contract; expand one to see its volumes and contents. A volume link opens the reader at that page.</li>
          <li>Opening a volume this way shows <b>no issue</b> — just the document, its contents and search.</li>
        </ul>
      </S>
      <S h="3 · Issues">
        <ul>
          <li><b>＋ New issue</b> on the Tenders page, or in the reader (issue dropdown or the left bar): a short id (e.g. <span className="docs-k">ETS-SDAH</span>), title, summary and keywords. Keywords pull matching letters in automatically.</li>
          <li>The issue page gathers its <b>actions</b>, <b>contract clauses</b>, <b>letters / MoMs / job cards</b> and <b>Green Line logbook</b> failures, job cards and rectifications.</li>
          <li>Use <b>＋ Link to this issue</b> to attach a letter, a logbook entry (by #id) or an off-book job card.</li>
        </ul>
      </S>
      <S h="4 · Clauses in the reader">
        <ol>
          <li>Pick the issue in the header dropdown (or come in from the issue page with <b>Open in reader</b>). Its clauses load in the left bar, by volume, and on the pages; below them, <b>Failures &amp; job cards</b> lists the matching Green Line logbook entries (hover for the full text).</li>
          <li>Select the clause text on the page, then press <b>＋ Add clause to issue</b>.</li>
          <li>Check the page, clause number and topic, write how it helps the issue, and save.</li>
        </ol>
        <p className="docs-note">With no issue picked, the left bar lists every issue with its clauses — open one to jump there with it.</p>
      </S>
      <S h="5 · Notes, bookmarks, search">
        <ul>
          <li><b>★ Important</b> and <b>🔖 Bookmark</b> above the page mark it; notes go in the right bar. Tag either to an issue.</li>
          <li>Left bar = where to go: the issue, the volume's contents, your marks (Mine / Everyone). Right bar = this page: search hits, its clauses (＋ Add clause), notes.</li>
          <li>Search in the header finds words across every volume's text; the Tenders page search covers tenders, issues and clauses.</li>
        </ul>
      </S>
    </div>
  )
}
