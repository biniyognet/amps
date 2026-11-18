/* Planned maintenance — the forward schedule contractors commit to (monthly
   schedule letters), as a list or a month calendar. Filters sit inline in the
   toolbar (state strip · system · station · contractor · cycle), never in a
   drawer. One click on Done files a normal MAINTENANCE log-book entry under
   the signed-in user; "Done ×N" does the same for every ticked row. Rows the
   log book already covers (sheet puller, manual entry) close themselves. */
import { useEffect, useMemo, useState } from 'react'
import { getJSON, useMe, encPath } from './api.js'

const API = import.meta.env.VITE_AMPS_API ?? ''
const CYCLE_BADGE = { Weekly: 'W', Monthly: 'M', Quarterly: 'Q', 'Half-Yearly': 'HY', Yearly: 'Y', '5-Yearly': '5Y' }
const STATES = [['all', 'All'], ['overdue', 'Overdue'], ['today', 'Due today'], ['upcoming', 'Upcoming'], ['done', 'Done'], ['skipped', 'Skipped']]
const OPEN = (r) => r.state === 'overdue' || r.state === 'today' || r.state === 'upcoming'
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const todayIso = () => { const d = new Date(); return `${ym(d)}-${String(d.getDate()).padStart(2, '0')}` }  // local, not UTC
const fmt = (d) => d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'
const STATE_LABEL = { overdue: 'Overdue', today: 'Due today', upcoming: 'Upcoming', done: 'Done', skipped: 'Skipped' }

async function send(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `HTTP ${r.status}`)
  return j
}

function Pick({ label, value, set, opts }) {
  return (
    <select value={value} onChange={(e) => set(e.target.value)} aria-label={`Filter by ${label}`} title={label}>
      <option value="">{label}: all</option>
      {opts.map(([k, n]) => <option key={k} value={k}>{`${k} (${n})`}</option>)}
    </select>
  )
}

const StateChip = ({ s }) => <span className={`chip pm-${s}`}><span className="dot" />{STATE_LABEL[s]}</span>

/* Optional details. Every field may stay blank — Done alone files the entry on
   the planned date with the contractor as the attending crew. */
function DoneModal({ rows, onClose, onDone }) {
  const one = rows.length === 1 ? rows[0] : null
  const [f, setF] = useState({ done_date: one ? one.planned_date : '', attended_by: '', remarks: '', action_taken: '', consumables: '' })
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const today = todayIso()
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v))
    try {
      if (one) {
        const res = await send('POST', `/api/planned/${one.id}/done`, body)
        if (photo) {
          const fd = new FormData(); fd.append('file', photo)
          await fetch(`${API}/api/logbook/${res.log_entry_id}/attachments`, { method: 'POST', body: fd })
        }
        onDone(`Logged — entry #${res.log_entry_id}`)
      } else {
        const res = await send('POST', '/api/planned/done', { ...body, ids: rows.map((r) => r.id) })
        onDone(`${res.done.length} logged${res.errors.length ? ` · ${res.errors.length} not: ${res.errors.map((x) => `#${x.id} ${x.error}`).join('; ')}` : ''}`)
      }
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card pm-modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit}>
          <h3 className="modal-h">{one ? <>Done — <span className="code">{one.asset_code}</span> · {one.cycle}</> : `Done ×${rows.length}`}</h3>
          <p className="dim pm-modal-sub">
            Files a MAINTENANCE entry in the log book under your name. All details are optional.
            {!one && ' Leave the date blank to log each row on its own planned date.'}
          </p>
          <label className="modal-lbl">Done on
            <input className="modal-in" type="date" value={f.done_date} max={today} onChange={set('done_date')} />
          </label>
          <label className="modal-lbl">Attended by
            <input className="modal-in" value={f.attended_by} onChange={set('attended_by')}
                   placeholder={(one && one.contractor) || 'contractor / crew'} />
          </label>
          <label className="modal-lbl">Remarks
            <input className="modal-in" value={f.remarks} onChange={set('remarks')} placeholder={`${one ? one.cycle : 'Cycle'} maintenance done as planned`} />
          </label>
          <label className="modal-lbl">Work done
            <input className="modal-in" value={f.action_taken} onChange={set('action_taken')} placeholder={(one && one.task) || ''} />
          </label>
          <label className="modal-lbl">Consumables
            <input className="modal-in" value={f.consumables} onChange={set('consumables')} />
          </label>
          {one && (
            <label className="modal-lbl">Photo / checksheet scan
              <input className="modal-in" type="file" accept="image/*,application/pdf" onChange={(e) => setPhoto(e.target.files[0] || null)} />
            </label>
          )}
          {err && <p className="modal-err">{err}</p>}
          <div className="modal-actions">
            <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="btn" type="submit" disabled={busy}>{busy ? 'Logging…' : one ? 'Mark done' : `Mark ${rows.length} done`}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ImportCsv({ onDone }) {
  const [file, setFile] = useState(null)
  const [dry, setDry] = useState(null)
  const [err, setErr] = useState('')
  const run = async (commit, f = file) => {
    setErr('')
    const fd = new FormData(); fd.append('file', f)
    const r = await fetch(`${API}/api/planned/import${commit ? '?commit=true' : ''}`, { method: 'POST', body: fd })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(typeof j.detail === 'string' ? j.detail : `HTTP ${r.status}`); return }
    if (commit) { setDry(null); setFile(null); onDone(`Imported ${j.created} planned rows`) } else setDry(j)
  }
  return (
    <span className="pm-import">
      <label className="btn ghost sm">Import CSV
        <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files[0]; if (f) { setFile(f); run(false, f) } e.target.value = '' }} />
      </label>
      {dry && (
        <span className="pm-dry">
          {dry.created} new · {dry.duplicates} already planned{dry.errors.length > 0 && <> · <b className="pc-red" title={dry.errors.map((x) => `row ${x.row}: ${x.asset_code || ''} ${x.error}`).join('\n')}>{dry.errors.length} errors</b></>}
          {dry.created > 0 && <button className="mini-btn ok" type="button" onClick={() => run(true)}>Add {dry.created}</button>}
          <button className="mini-btn" type="button" onClick={() => setDry(null)}>✕</button>
        </span>
      )}
      {err && <span className="pc-red">{err}</span>}
      <a className="mini-btn" href={`${API}/api/planned/import/sample`} title="CSV columns">sample</a>
    </span>
  )
}

function Calendar({ month, rows, onPick, canWrite }) {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const startPad = (first.getDay() + 6) % 7 // Monday-first
  const days = new Date(y, m, 0).getDate()
  const cells = [...Array(startPad).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  const byDay = {}
  for (const r of rows) (byDay[Number(r.planned_date.slice(8, 10))] ||= []).push(r)
  const now = new Date()
  const thisMonth = month === ym(now)
  return (
    <div className="card cal">
      <div className="cal-head">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d}>{d}</div>)}</div>
      <div className="cal-grid">
        {cells.map((d, i) => d === null ? <div key={`p${i}`} className="cal-cell pad" /> : (
          <div key={d} className={`cal-cell${thisMonth && d === now.getDate() ? ' today' : ''}`}>
            <span className="cal-day dt">{d}</span>
            {(byDay[d] || []).map((r) => (
              <button key={r.id} type="button" className={`cal-item pm-ci pm-${r.state}`}
                      title={`${r.asset_code} — ${r.asset_name || ''} · ${r.cycle} · ${STATE_LABEL[r.state]}${r.contractor ? ` · ${r.contractor}` : ''}`}
                      onClick={() => (OPEN(r) && canWrite ? onPick(r) : (location.hash = `#/asset/${encPath(r.asset_code)}`))}>
                <i className="cal-freq">{CYCLE_BADGE[r.cycle] || r.cycle}</i> <b>{r.asset_code}</b>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function PlannedView({ initialView = 'list' }) {
  const { canWrite } = useMe()
  const [month, setMonth] = useState(ym(new Date()))
  const [rows, setRows] = useState(null)
  const [sum, setSum] = useState(null)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)
  const [view, setView] = useState(initialView === 'cal' ? 'cal' : 'list')
  const [q, setQ] = useState('')
  const [state, setState] = useState('all')
  const [system, setSystem] = useState('')
  const [station, setStation] = useState('')
  const [contractor, setContractor] = useState('')
  const [cycle, setCycle] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const [modal, setModal] = useState(null)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    setRows(null)
    Promise.all([getJSON(`/api/planned?month=${month}`), getJSON(`/api/planned/summary?month=${month}`)])
      .then(([r, s]) => { setRows(r); setSum(s); setError(null) })
      .catch((e) => setError(String(e)))
  }, [month, tick])
  const tally = (k) => {
    const c = new Map()
    for (const r of rows || []) if (r[k]) c.set(r[k], (c.get(r[k]) || 0) + 1)
    return [...c].sort((a, b) => a[0].localeCompare(b[0]))
  }
  const opts = useMemo(() => ({ system: tally('system'), station: tally('station'), contractor: tally('contractor'), cycle: tally('cycle') }), [rows])
  if (error) return <div className="card offline-note">Backend unreachable — {error}.</div>
  const shiftMonth = (n) => { const [y, m] = month.split('-').map(Number); setMonth(ym(new Date(y, m - 1 + n, 1))); setSel(new Set()) }
  const ql = q.trim().toLowerCase()
  const pre = (rows || []).filter((r) => (!system || r.system === system) && (!station || r.station === station)
    && (!contractor || r.contractor === contractor) && (!cycle || r.cycle === cycle)
    && (!ql || [r.asset_code, r.asset_name, r.task, r.source, r.location_detail].some((v) => (v || '').toLowerCase().includes(ql))))
  const n = { all: pre.length, overdue: 0, today: 0, upcoming: 0, done: 0, skipped: 0 }
  for (const r of pre) n[r.state]++
  const shown = pre.filter((r) => state === 'all' || r.state === state)
  const picked = shown.filter((r) => sel.has(r.id) && OPEN(r) && r.planned_date <= todayIso())
  const toggle = (id) => setSel((s) => { const t = new Set(s); t.has(id) ? t.delete(id) : t.add(id); return t })
  const doneable = (r) => OPEN(r) && r.state !== 'upcoming'
  const allTick = shown.filter(doneable)
  const filtered = q || system || station || contractor || cycle || state !== 'all'
  const finish = (text) => { setModal(null); setSel(new Set()); setMsg(text); setTick((t) => t + 1) }
  const skip = async (r) => {
    try { await send('PATCH', `/api/planned/${r.id}`, { status: r.status === 'skipped' ? 'planned' : 'skipped' }); setTick((t) => t + 1) }
    catch (e) { setMsg(e.message) }
  }
  const resched = async (r, d) => {
    if (!d || d === r.planned_date) return
    try { await send('PATCH', `/api/planned/${r.id}`, { planned_date: d }); setTick((t) => t + 1) }
    catch (e) { setMsg(e.message) }
  }
  const monthName = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  return (
    <>
      <div className="plan-bar">
        <h1 style={{ margin: 0 }}>Planned maintenance</h1>
        <div className="plan-nav">
          <button className="pbtn" onClick={() => shiftMonth(-1)} aria-label="Previous month">←</button>
          <span className="plan-month dt">{monthName}</span>
          <button className="pbtn" onClick={() => shiftMonth(1)} aria-label="Next month">→</button>
          <span className="pm-views" role="group" aria-label="View">
            {[['list', 'List'], ['cal', 'Calendar']].map(([k, l]) => (
              <button key={k} type="button" className={`btn ghost sm${view === k ? ' on' : ''}`} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>
            ))}
          </span>
        </div>
      </div>

      {sum && sum.contractors.length > 0 && (
        <div className="pm-sum">
          {sum.contractors.map((c) => (
            <button key={c.contractor} type="button" className={`pm-sum-c${contractor === c.contractor ? ' on' : ''}`}
                    onClick={() => setContractor(contractor === c.contractor ? '' : c.contractor)}>
              <b>{c.contractor}</b>
              <span><b className="dt">{c.done}</b>/{c.planned} done</span>
              {c.overdue > 0 && <span className="pc-red">{c.overdue} overdue</span>}
              {c.compliance !== null && <span className="pm-pct">{c.compliance}%</span>}
            </button>
          ))}
        </div>
      )}

      <div className="asset-toolbar pm-toolbar">
        <input className="asset-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Search asset, task, letter…" aria-label="Search planned maintenance" />
        <div className={`asset-kpis hstrip${state !== 'all' ? ' has-pick' : ''}`} role="group" aria-label="State">
          {STATES.map(([k, l]) => (
            <button key={k} type="button" className={`rk-stat pm-k-${k}${state === k ? ' on' : ''}`} aria-pressed={state === k}
                    onClick={() => setState(state === k && k !== 'all' ? 'all' : k)}>
              <span className="v">{n[k]}</span><span className="k">{l}</span>
            </button>
          ))}
        </div>
        <Pick label="System" value={system} set={setSystem} opts={opts.system} />
        <Pick label="Station" value={station} set={setStation} opts={opts.station} />
        <Pick label="Contractor" value={contractor} set={setContractor} opts={opts.contractor} />
        <Pick label="Cycle" value={cycle} set={setCycle} opts={opts.cycle} />
        {filtered && (
          <button type="button" className="btn ghost sm" onClick={() => { setQ(''); setSystem(''); setStation(''); setContractor(''); setCycle(''); setState('all') }}>Clear</button>)}
        {canWrite && <ImportCsv onDone={finish} />}
        <span className="asset-count">{shown.length} shown</span>
      </div>

      {msg && <p className="pm-msg">{msg} <button className="mini-btn" type="button" onClick={() => setMsg('')}>✕</button></p>}
      {canWrite && picked.length > 0 && (
        <div className="pm-bulk">
          <b>{picked.length}</b> selected
          <button className="btn sm" type="button" onClick={() => setModal(picked)}>Done ×{picked.length}</button>
          <button className="btn ghost sm" type="button" onClick={() => setSel(new Set())}>Clear selection</button>
        </div>
      )}

      {rows === null ? <p className="dim">Loading schedule…</p>
        : view === 'cal' ? <Calendar month={month} rows={shown} canWrite={canWrite} onPick={(r) => (r.state === 'upcoming' ? setMsg(`${r.asset_code} is planned for ${fmt(r.planned_date)} — it can be marked done from that day.`) : setModal([r]))} />
        : shown.length === 0 ? (
          <div className="card"><p className="dim" style={{ margin: 0 }}>
            {rows.length === 0 ? `Nothing planned for ${monthName}. Import a contractor schedule (CSV) to start.` : 'No planned maintenance in this view.'}
          </p></div>
        ) : (
          <div className="card tbl-wrap">
            <table className="jc-table pm-table">
              <thead>
                <tr>
                  {canWrite && <th className="pm-ck"><input type="checkbox" aria-label="Select all due"
                    checked={allTick.length > 0 && allTick.every((r) => sel.has(r.id))}
                    onChange={(e) => setSel(e.target.checked ? new Set(allTick.map((r) => r.id)) : new Set())} /></th>}
                  <th>Date</th><th>Asset</th><th>Station</th><th>System</th><th>Cycle</th><th>Contractor</th><th>Source</th><th>State</th><th />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={`pm-row pm-${r.state}`}>
                    {canWrite && <td className="pm-ck">{doneable(r) && <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.asset_code}`} />}</td>}
                    <td className="dt">
                      {canWrite && OPEN(r)
                        ? <input type="date" className="pm-date" value={r.planned_date} onChange={(e) => resched(r, e.target.value)} title="Reschedule" />
                        : fmt(r.planned_date)}
                      {r.original_date && <small className="dim" title="Originally planned"> was {fmt(r.original_date)}</small>}
                    </td>
                    <td><a href={`#/asset/${encPath(r.asset_code)}`} className="code">{r.asset_code}</a>
                      {r.asset_name && <small className="dim pm-sub">{r.asset_name}</small>}</td>
                    <td>{r.station || '—'}{r.location_detail && <small className="dim pm-sub">{r.location_detail}</small>}</td>
                    <td>{r.system || '—'}</td>
                    <td><i className="cal-freq">{CYCLE_BADGE[r.cycle] || r.cycle}</i> {r.cycle}</td>
                    <td>{r.contractor || '—'}</td>
                    <td className="pm-src" title={r.source || ''}>{r.source || '—'}</td>
                    <td><StateChip s={r.state} />
                      {r.done_on && <small className="dim pm-sub">{fmt(r.done_on)}{r.closed_by === 'reconcile' ? ' · from log' : ''}</small>}</td>
                    <td className="pm-act">
                      {r.log_entry_id ? <a className="mini-btn" href={`#/log?d=${r.done_on}`}>Log ↗</a>
                        : canWrite && doneable(r) ? <button className="mini-btn ok" type="button" onClick={() => setModal([r])}>Done</button>
                        : null}
                      {canWrite && (OPEN(r) || r.state === 'skipped') && (
                        <button className="mini-btn muted" type="button" onClick={() => skip(r)}>{r.state === 'skipped' ? 'Reopen' : 'Skip'}</button>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <p className="roadmap">Red = overdue and not yet logged · amber = due today · blue = upcoming. Done files a MAINTENANCE entry in the log book under your name;
        an entry for the same asset in the same month (same cycle or longer) closes the plan by itself.</p>
      {modal && <DoneModal rows={modal} onClose={() => setModal(null)} onDone={finish} />}
    </>
  )
}
