/* Planned maintenance — the forward schedule contractors commit to (monthly
   schedule letters), as a list, a month calendar or a timeline (one row per
   asset, planned vs actual, drag to reschedule). Filters sit inline in the
   toolbar (state strip · system · station · contractor · cycle), never in a
   drawer. One click on Done files a normal MAINTENANCE log-book entry under
   the signed-in user; "Done ×N" does the same for every ticked row. Rows the
   log book already covers (sheet puller, manual entry) close themselves. */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { getJSON, useMe, encPath } from './api.js'

const API = import.meta.env.VITE_AMPS_API ?? ''
const CYCLE_BADGE = { Weekly: 'W', Monthly: 'M', Quarterly: 'Q', 'Half-Yearly': 'HY', Yearly: 'Y', '5-Yearly': '5Y' }
const STATES = [['all', 'All'], ['overdue', 'Overdue'], ['today', 'Due today'], ['upcoming', 'Upcoming'], ['done', 'Done'], ['skipped', 'Skipped']]
const OPEN = (r) => r.state === 'overdue' || r.state === 'today' || r.state === 'upcoming'
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const todayIso = () => { const d = new Date(); return `${ym(d)}-${String(d.getDate()).padStart(2, '0')}` }  // local, not UTC
const fmt = (d) => d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'
const STATE_LABEL = { overdue: 'Overdue', today: 'Due today', upcoming: 'Upcoming', done: 'Done', skipped: 'Skipped' }
const VIEWS = [['list', 'List'], ['cal', 'Calendar'], ['tl', 'Timeline']]
const SPANS = [['week', 'Week'], ['month', 'Month'], ['year', 'Year']]

const D = (s) => new Date(`${s}T00:00:00`)
const iso = (d) => `${ym(d)}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return iso(d) }
const diffDays = (a, b) => Math.round((D(b) - D(a)) / 864e5)
/* [first, last] day of the week (Mon-first), month or year holding `cursor` */
function spanRange(span, cursor) {
  const d = D(cursor)
  if (span === 'week') { const mon = addDays(cursor, -((d.getDay() + 6) % 7)); return [mon, addDays(mon, 6)] }
  if (span === 'year') return [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`]
  return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))]
}
/* Days between the date first promised and the day the work was logged —
   a reschedule does not reset it. null while not done. */
const slipOf = (r) => (r.done_on ? diffDays(r.original_date || r.planned_date, r.done_on) : null)
const slipCls = (n) => (n <= 0 ? 'ok' : n <= 3 ? 'warn' : 'bad')
const slipTxt = (n) => (n > 0 ? `+${n} d late` : n < 0 ? `${-n} d early` : 'on time')

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
          <label className="modal-lbl">Done on (actual date)
            <input className="modal-in" type="date" value={f.done_date} max={today} onChange={set('done_date')} />
            {one && f.done_date && (() => {
              const s = diffDays(one.original_date || one.planned_date, f.done_date)
              return s !== 0 && <small className={`tl-t-${slipCls(s)}`}>{slipTxt(s)} vs the plan</small>
            })()}
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

/* Per contractor over the rows on screen: planned, done on time, done late
   (with the average slip) and still overdue. Skipped rows are left out. */
function SlipSummary({ rows }) {
  const by = new Map()
  for (const r of rows) {
    if (r.state === 'skipped') continue
    const k = r.contractor || 'No contractor'
    const c = by.get(k) || { k, planned: 0, onTime: 0, late: 0, lateDays: 0, overdue: 0 }
    c.planned++
    const s = slipOf(r)
    if (s !== null) { if (s > 0) { c.late++; c.lateDays += s } else c.onTime++ }
    else if (r.state === 'overdue') c.overdue++
    by.set(k, c)
  }
  if (!by.size) return null
  return (
    <div className="pm-sum">
      {[...by.values()].sort((a, b) => b.planned - a.planned).map((c) => (
        <div key={c.k} className="pm-sum-c tl-sum">
          <b>{c.k}</b>
          <span><b className="dt">{c.planned}</b> planned</span>
          <span className="tl-t-ok">{c.onTime} on time</span>
          {c.late > 0 && <span className="tl-t-warn">{c.late} late · avg +{(c.lateDays / c.late).toFixed(1)} d</span>}
          {c.overdue > 0 && <span className="pc-red">{c.overdue} overdue</span>}
        </div>
      ))}
    </div>
  )
}

/* One row per asset, grouped by station; days run left to right. The cycle
   pin sits on the planned date, a dot on the day it was actually logged, and
   the bar between them is the slip (green on time, amber ≤3 d, red later).
   An overdue row's bar runs on to today. Drag an open pin to reschedule (not
   into the past — late work is logged with its real date via Done). */
function Timeline({ span, from, to, rows, canWrite, onPick, onMove }) {
  const n = diffDays(from, to) + 1
  const today = todayIso()
  const x = (d) => `${((Math.min(Math.max(diffDays(from, d), 0), n - 1) + 0.5) / n) * 100}%`
  const [drag, setDrag] = useState(null)
  const ticks = useMemo(() => {
    if (span === 'year') {
      const y = Number(from.slice(0, 4))
      return Array.from({ length: 12 }, (_, i) => {
        const s = iso(new Date(y, i, 1))
        return { key: s, at: (diffDays(from, s) / n) * 100, w: (new Date(y, i + 1, 0).getDate() / n) * 100,
                 label: D(s).toLocaleDateString('en-GB', { month: 'short' }) }
      })
    }
    return Array.from({ length: n }, (_, i) => {
      const s = addDays(from, i), d = D(s)
      return { key: s, at: (i / n) * 100, w: 100 / n, sun: d.getDay() === 0,
               label: span === 'week' ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }) : d.getDate() }
    })
  }, [span, from, n])
  const groups = useMemo(() => {
    const assets = new Map()
    for (const r of rows) {
      const a = assets.get(r.asset_id) || { id: r.asset_id, code: r.asset_code, name: r.asset_name, station: r.station || '—', system: r.system || '', rows: [] }
      a.rows.push(r)
      assets.set(r.asset_id, a)
    }
    const byStn = new Map()
    for (const a of [...assets.values()].sort((p, q) => p.station.localeCompare(q.station)
      || p.system.localeCompare(q.system) || p.code.localeCompare(q.code, undefined, { numeric: true }))) {
      (byStn.get(a.station) || byStn.set(a.station, []).get(a.station)).push(a)
    }
    return [...byStn]
  }, [rows])
  const dateAt = (track, clientX) => {
    const b = track.getBoundingClientRect()
    const d = addDays(from, Math.min(Math.max(Math.floor(((clientX - b.left) / b.width) * n), 0), n - 1))
    return d < today ? today : d
  }
  const down = (e, r) => {
    if (!(canWrite && OPEN(r))) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ id: r.id, x0: e.clientX, date: r.planned_date, moved: false })
  }
  const move = (e, r) => {
    if (!drag || drag.id !== r.id) return
    if (!drag.moved && Math.abs(e.clientX - drag.x0) < 5) return
    const d = dateAt(e.currentTarget.parentElement, e.clientX)
    if (!drag.moved || d !== drag.date) setDrag({ ...drag, date: d, moved: true })
  }
  const up = (r) => {
    if (drag && drag.id === r.id) {
      setDrag(null)
      if (drag.moved) { if (drag.date !== r.planned_date) onMove(r, drag.date); return }
    }
    onPick(r)
  }
  if (!rows.length) return <div className="card"><p className="dim" style={{ margin: 0 }}>Nothing planned in this period.</p></div>
  const colW = span === 'week' ? 110 : span === 'year' ? 3.2 : 28
  const assetCount = groups.reduce((t, [, l]) => t + l.length, 0)
  return (
    <div className="card tl">
      <div className="tl-in" style={{ minWidth: `calc(var(--tl-lbl) + ${Math.round(n * colW)}px)` }}>
        <div className="tl-head">
          <div className="tl-lbl dim">{assetCount} asset{assetCount === 1 ? '' : 's'}</div>
          <div className="tl-scale">
            {ticks.map((t) => <span key={t.key} className={`tl-tick${t.sun ? ' sun' : ''}`} style={{ left: `${t.at}%`, width: `${t.w}%` }}>{t.label}</span>)}
          </div>
        </div>
        <div className="tl-body">
          <div className="tl-grid" aria-hidden="true">
            {ticks.map((t) => <span key={t.key} className={`tl-line${t.sun ? ' sun' : ''}`} style={{ left: `${t.at}%`, width: `${t.w}%` }} />)}
            {today >= from && today <= to && <span className="tl-now" style={{ left: x(today) }} />}
          </div>
          {groups.map(([stn, list]) => (
            <Fragment key={stn}>
              <div className="tl-grp"><b>{stn}</b> <span className="dim">· {list.length}</span></div>
              {list.map((a) => (
                <div className="tl-row" key={a.id}>
                  <div className="tl-lbl" title={a.name || ''}>
                    <a href={`#/asset/${encPath(a.code)}`} className="code">{a.code}</a>
                    {a.name && <small className="dim"> {a.name}</small>}
                  </div>
                  <div className="tl-track">
                    {a.rows.map((r) => {
                      const dragging = drag && drag.id === r.id && drag.moved
                      const plan = dragging ? drag.date : r.planned_date
                      const anchor = r.original_date || plan
                      const s = slipOf(r)
                      const end = r.done_on || (r.state === 'overdue' ? today : plan)
                      const [lo, hi] = anchor < end ? [anchor, end] : [end, anchor]
                      const bar = r.done_on ? slipCls(s) : r.state === 'overdue' ? 'bad' : 'moved'
                      const tip = [`${r.asset_code} · ${r.cycle}`, `planned ${fmt(r.planned_date)}`,
                        r.original_date && `originally ${fmt(r.original_date)}`,
                        r.done_on ? `done ${fmt(r.done_on)} (${slipTxt(s)})` : STATE_LABEL[r.state],
                        r.contractor, canWrite && OPEN(r) && 'drag to reschedule'].filter(Boolean).join(' · ')
                      return (
                        <Fragment key={r.id}>
                          {lo !== hi && <span className={`tl-bar tl-${bar}`} style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />}
                          {r.original_date && r.original_date !== plan && <span className="tl-ghost" style={{ left: x(r.original_date) }} />}
                          {r.done_on && <span className={`tl-dot tl-${slipCls(s)}`} style={{ left: x(r.done_on) }} />}
                          <button type="button" title={tip} style={{ left: x(plan) }}
                                  className={`tl-pin pm-${r.state}${canWrite && OPEN(r) ? ' movable' : ''}${dragging ? ' drag' : ''}`}
                                  onPointerDown={(e) => down(e, r)} onPointerMove={(e) => move(e, r)}
                                  onPointerUp={() => up(r)} onPointerCancel={() => setDrag(null)}
                                  onClick={(e) => { if (e.detail === 0) onPick(r) }}>
                            {CYCLE_BADGE[r.cycle] || r.cycle}
                          </button>
                          {dragging && <span className="tl-drag-lbl" style={{ left: x(plan) }}>{fmt(plan)}</span>}
                        </Fragment>
                      )
                    })}
                  </div>
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

export function PlannedView({ initialView = 'tl' }) {
  const { canWrite } = useMe()
  const [cursor, setCursor] = useState(todayIso)
  const [span, setSpan] = useState('month')
  const [rows, setRows] = useState(null)
  const [sum, setSum] = useState(null)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)
  const [view, setView] = useState(VIEWS.some(([k]) => k === initialView) ? initialView : 'tl')
  const per = view === 'tl' ? span : 'month'      // list + calendar always show one month
  const [from, to] = spanRange(per, cursor)
  const month = from.slice(0, 7)
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
    Promise.all([getJSON(`/api/planned?date_from=${from}&date_to=${to}`),
                 per === 'month' ? getJSON(`/api/planned/summary?month=${month}`) : null])
      .then(([r, s]) => { setRows(r); setSum(s); setError(null) })
      .catch((e) => setError(String(e)))
  }, [from, to, tick])
  const tally = (k) => {
    const c = new Map()
    for (const r of rows || []) if (r[k]) c.set(r[k], (c.get(r[k]) || 0) + 1)
    return [...c].sort((a, b) => a[0].localeCompare(b[0]))
  }
  const opts = useMemo(() => ({ system: tally('system'), station: tally('station'), contractor: tally('contractor'), cycle: tally('cycle') }), [rows])
  if (error) return <div className="card offline-note">Backend unreachable — {error}.</div>
  const shift = (k) => {
    const d = D(from)
    setCursor(per === 'week' ? addDays(from, 7 * k)
      : per === 'year' ? `${d.getFullYear() + k}-01-01` : iso(new Date(d.getFullYear(), d.getMonth() + k, 1)))
    setSel(new Set())
  }
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
  const monthName = D(from).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const periodName = per === 'year' ? from.slice(0, 4)
    : per === 'week' ? `${fmt(from)} – ${fmt(to)} ${to.slice(0, 4)}` : monthName
  const pick = (r) => (r.log_entry_id ? (location.hash = `#/log?d=${r.done_on}`)
    : !(canWrite && OPEN(r)) ? (location.hash = `#/asset/${encPath(r.asset_code)}`)
    : r.state === 'upcoming' ? setMsg(`${r.asset_code} is planned for ${fmt(r.planned_date)} — it can be marked done from that day.`)
    : setModal([r]))
  return (
    <>
      <div className="plan-bar">
        <h1 style={{ margin: 0 }}>Planned maintenance</h1>
        <div className="plan-nav">
          <button className="pbtn" onClick={() => shift(-1)} aria-label={`Previous ${per}`}>←</button>
          <span className="plan-month dt">{periodName}</span>
          <button className="pbtn" onClick={() => shift(1)} aria-label={`Next ${per}`}>→</button>
          {cursor !== todayIso() && <button className="btn ghost sm" type="button" onClick={() => setCursor(todayIso())}>Today</button>}
          <span className="pm-views" role="group" aria-label="View">
            {VIEWS.map(([k, l]) => (
              <button key={k} type="button" className={`btn ghost sm${view === k ? ' on' : ''}`} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>
            ))}
          </span>
          {view === 'tl' && (
            <span className="pm-views" role="group" aria-label="Span">
              {SPANS.map(([k, l]) => (
                <button key={k} type="button" className={`btn ghost sm${span === k ? ' on' : ''}`} aria-pressed={span === k} onClick={() => setSpan(k)}>{l}</button>
              ))}
            </span>
          )}
        </div>
      </div>

      {view === 'tl' ? rows && <SlipSummary rows={pre} />
        : sum && sum.contractors.length > 0 && (
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
        : view === 'cal' ? <Calendar month={month} rows={shown} canWrite={canWrite} onPick={pick} />
        : view === 'tl' ? <Timeline span={per} from={from} to={to} rows={shown} canWrite={canWrite} onPick={pick} onMove={resched} />
        : shown.length === 0 ? (
          <div className="card"><p className="dim" style={{ margin: 0 }}>
            {rows.length === 0 ? `Nothing planned for ${periodName}. Import a contractor schedule (CSV) to start.` : 'No planned maintenance in this view.'}
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
                      {r.done_on && <small className="dim pm-sub">{fmt(r.done_on)}{r.closed_by === 'reconcile' ? ' · from log' : ''}
                        {' · '}<span className={`tl-t-${slipCls(slipOf(r))}`}>{slipTxt(slipOf(r))}</span></small>}</td>
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
      <p className="roadmap">{view === 'tl'
        ? <>Pin = planned date (○ = the date first promised) · ● = the day it was actually logged · the bar between is the slip:
          green on time, amber up to 3 days late, red later or still overdue. Drag an open pin to reschedule; click it to mark done.</>
        : <>Red = overdue and not yet logged · amber = due today · blue = upcoming. Late work: Done takes the actual date, and the slip is kept against the original plan.</>}
        {' '}Done files a MAINTENANCE entry in the log book under your name;
        an entry for the same asset in the same month (same cycle or longer) closes the plan by itself.</p>
      {modal && <DoneModal rows={modal} onClose={() => setModal(null)} onDone={finish} />}
    </>
  )
}
