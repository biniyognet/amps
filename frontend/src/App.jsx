// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arup Biswas and AMPS contributors (binidev)
// AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ASSETS, PM_SCHEDULES, JOB_CARDS, SPECS, PROCUREMENTS, PROC_STAGES,
  FAILURES, SPARES, spareStats, checksheetFor, CHECKSHEET_TEMPLATES, CHECKSHEET_RESULTS,
  completedChecksheets, kpis, fmtDate, fmtTime, dueState, durationHrs, failureStats,
  failuresByMonth, classCountsAll, downtimeByAsset, recoveryStatus, pmOccurrencesInMonth,
} from './data.js'
import { LIVE, ORG, getJSON, useLiveAssets, useLiveAsset, useMe, apiLogin, apiLogout } from './api.js'
import QR, { assetUrl } from './qr.jsx'
import DutyRoster from './roster.jsx'
import LogBook, { AttachmentUpload } from './logbook.jsx'
import { CHECKSHEET_FORMATS } from './checksheets.js'

const STATUS_LABEL = {
  in_service: 'In service',
  under_maintenance: 'Under maintenance',
  out_of_service: 'Out of service',
  decommissioned: 'Decommissioned',
}

const StatusChip = ({ status }) => (
  <span className={`chip s-${status}`}><span className="dot" />{STATUS_LABEL[status]}</span>
)

/* the maker's mark — Arup's own signature, the way an artist signs a canvas.
   alt carries the full name so the credit stays in the source and for readers. */
const SignatureMark = () => (
  <img src="/signature.png" className="sig-mark" alt="maker's signature" title="AMPS" />
)
/* a pencil that deep-links a log entry into the log book for editing — the
   single editing surface everything else points at */
const EditLink = ({ id, date, label = 'Edit in log book' }) => (
  <a href={`#/log?d=${date}&edit=${id}`} className="icon-btn edit-link"
     title={label} aria-label={label} onClick={(e) => e.stopPropagation()}>
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none"
         stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.4 2.3a1.35 1.35 0 0 1 1.9 1.9L5 12.6l-2.6.6.6-2.6 8.4-8.3z" />
    </svg>
  </a>
)

/* the word AMPS is the doorway to the about/credits page — but only once
   signed in; a public walk-up sees plain text, not a link */
const AmpsLink = () => {
  const { canWrite } = useMe()
  return canWrite
    ? <a href="#/about" className="foot-amps">AMPS</a>
    : <span>AMPS</span>
}
/* the footer signature links to About only for signed-in staff */
const FootSig = () => {
  const { canWrite } = useMe()
  return canWrite
    ? <a href="#/about" className="foot-sig" aria-label="About AMPS"><SignatureMark /></a>
    : <SignatureMark />
}

/* Showcase dropdown — demo-only (amps.binihost.com). Points to the real
   deployments of AMPS so a demo visitor can see it running in the field.
   Metro AMPS is served from the office server over a Cloudflare Tunnel. */
const SHOWCASE = [
  { name: 'Metro AMPS', sub: 'Live · Kolkata Metro power-supply', href: 'https://metro.binihost.com', live: true },
  { name: 'This demo', sub: 'Synthetic data — you are here', href: '#/', here: true },
  { divider: true },
  { name: 'biniHost', sub: 'The platform behind it', href: 'https://binihost.com' },
]

function ShowcaseDropdown() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return undefined
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])
  return (
    <span className="showcase" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={`showcase-btn${open ? ' open' : ''}`}
              onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true">
        Showcase <span className="caret">▾</span>
      </button>
      {open && (
        <div className="showcase-menu" role="menu">
          {SHOWCASE.map((it, i) => it.divider
            ? <div className="sc-divider" key={i} />
            : (
              <a key={i} className="sc-item" role="menuitem"
                 href={it.href}
                 target={it.href.startsWith('http') ? '_blank' : undefined}
                 rel={it.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                 onClick={() => setOpen(false)}>
                <span className="sc-name">
                  {it.name}
                  {it.live && <span className="sc-live">● LIVE</span>}
                  {it.here && <span className="sc-here">•</span>}
                </span>
                <span className="sc-sub">{it.sub}</span>
              </a>
            ))}
        </div>
      )}
    </span>
  )
}

/* the masthead: emblem + AMPS wordmark with its full form, and the
   organisation on a second line so it never drops out after sign-in */
const Brand = () => (
  <a href="#/" className="brand">
    {/* the real Indian Railways emblem is for the live office deployment only —
       a public synthetic demo must not carry a national/government emblem */}
    {LIVE && <img className="brand-emblem" src={`${import.meta.env.BASE_URL}ir-railways.png`} alt="" />}
    <span className="brand-lines">
      <span className="brand-l1">
        <span className="brand-name">AMPS</span>
        <span className="brand-org">{ORG}</span>
      </span>
      <span className="brand-tag">Asset Maintenance &amp; Preventive Scheduling</span>
    </span>
  </a>
)

const DueChip = ({ nextDue }) => {
  const s = dueState(nextDue)
  return <span className={`chip d-${s.key}`}><span className="dot" />{s.label}</span>
}

const cap = (s) => s[0].toUpperCase() + s.slice(1)

const WoChip = ({ status }) => (
  <span className={`chip w-${status}`}><span className="dot" />{cap(status)}</span>
)

const StageChip = ({ stage }) => (
  <span className={`chip p-${stage}`}><span className="dot" />{cap(stage)}</span>
)

/* ---------- dashboard (live) ---------- */

const SEV_RANK = { overdue: 0, never: 0.5, due_soon: 1, long_overdue: 2, ok: 3 }

/* filters that survive tab switches — parked in localStorage under a namespaced
   key so leaving a page and coming back keeps the view you set up. */
function usePersistedState(key, initial) {
  const k = `amps.filter.${key}`
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(k); return s !== null ? JSON.parse(s) : initial } catch { return initial }
  })
  useEffect(() => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* quota/private mode */ } }, [k, v])
  return [v, setV]
}

// codes repeat across lines — schedule & failure lookups are keyed by line|code
const assetKey = (a) => `${a.line || ''}|${a.code}`

function LiveDashboard({ go, initialLine = null }) {
  const { assets: all, sched, openFail, loading, error } = useLiveAssets()
  const { me, canWrite } = useMe()
  const [line, setLine] = useState(initialLine)
  // multi-select state filter: an array of active bucket keys; empty = All.
  // Migrate the old single-string persisted value ('all'/'overdue'/…) to an array.
  const [filterRaw, setFilter] = usePersistedState('reg.state', [])
  const filters = Array.isArray(filterRaw) ? filterRaw : (filterRaw && filterRaw !== 'all' ? [filterRaw] : [])
  const [q, setQ] = useState('')
  // column filters are MULTI-SELECT (arrays). Migrate any old single-string value.
  const asArr = (v) => Array.isArray(v) ? v : (v ? [v] : [])
  const [fSystemR, setFSystem] = usePersistedState('reg.system', [])
  const [fClassR, setFClass] = usePersistedState('reg.class', [])
  const [fLocationR, setFLocation] = usePersistedState('reg.location', [])
  const [fStatusR, setFStatus] = usePersistedState('reg.status', [])
  const [fLocDetR, setFLocDet] = usePersistedState('reg.locdet', [])
  const [fCode, setFCode] = usePersistedState('reg.code', '')     // Code: contains-text filter
  const [fName, setFName] = usePersistedState('reg.name', '')     // Asset: contains-text filter
  const fSystem = asArr(fSystemR), fClass = asArr(fClassR), fLocation = asArr(fLocationR), fStatus = asArr(fStatusR), fLocDet = asArr(fLocDetR)
  const [fDepot, setFDepot] = usePersistedState('reg.depot', '')
  const [sortKey, setSortKey] = usePersistedState('reg.sortKey', null)  // null = register order
  const [sortDir, setSortDir] = usePersistedState('reg.sortDir', 'asc')
  const [page, setPage] = useState(0)   // register pages 150 rows/page for speed
  const [newOpen, setNewOpen] = useState(false)   // inline "+ new asset" form
  const [impBusy, setImpBusy] = useState(false)
  const [impResult, setImpResult] = useState(null)
  const fileRef = useRef(null)
  const toolbarRef = useRef(null)
  useEffect(() => { setLine(initialLine) }, [initialLine])
  // freeze the toolbar + table header: measure the sticky topbar and this
  // toolbar so the header parks exactly beneath them however the row wraps
  useEffect(() => {
    const setVars = () => {
      const tb = document.querySelector('.topbar')
      if (tb) document.documentElement.style.setProperty('--topbar-h', `${tb.offsetHeight}px`)
      if (toolbarRef.current) document.documentElement.style.setProperty('--toolbar-h', `${toolbarRef.current.offsetHeight}px`)
    }
    setVars()
    const ro = new ResizeObserver(setVars)
    const tb = document.querySelector('.topbar')
    if (tb) ro.observe(tb)
    if (toolbarRef.current) ro.observe(toolbarRef.current)
    window.addEventListener('resize', setVars)
    return () => { ro.disconnect(); window.removeEventListener('resize', setVars) }
  })
  const lines = [...new Set(all.map((a) => a.line).filter(Boolean))].sort()
  // each line stands alone — no aggregated all-lines view; default to the
  // signed-in user's own line, else the first registered line
  const effLine = line ?? me?.line ?? lines[0] ?? null
  const assets = effLine ? all.filter((a) => a.line === effLine) : all
  const stateOf = (a) => sched[assetKey(a)]?.state || null
  // never-done shares the 'overdue' state but is its own tag — give it a distinct
  // display state so the list groups all "Never done" rows together, not mixed in
  const dispState = (a) => (sched[assetKey(a)]?.never_done ? 'never' : stateOf(a))
  // Outstanding failures on this asset. Acknowledge and rectify are TWO
  // INDEPENDENT flags — an acknowledged (or job-carded) failure is NOT fixed and
  // still needs rectification. So a faulty asset carries both an acknowledged
  // flag and the outstanding count; it clears only when rectified.
  const faultOf = (a) => openFail[assetKey(a)] || null
  const openN = (a) => faultOf(a)?.open || 0        // outstanding, not yet acknowledged
  const ackN = (a) => faultOf(a)?.ack || 0          // acknowledged (amber)
  const jobN = (a) => faultOf(a)?.jobcard || 0      // job card raised (yellow)
  const attnOf = (a) => openN(a) + ackN(a) + jobN(a)   // total outstanding (all need rectifying)
  const isAcked = (a) => !!faultOf(a)?.acknowledged    // any outstanding failure acknowledged
  // float order: not-acknowledged (red) first — nobody has even noted it — then
  // acknowledged (amber) / job-carded (yellow) which are at least in hand
  const attnRank = (a) => (openN(a) ? 3 : ackN(a) ? 2 : jobN(a) ? 1 : 0)
  const failId = (a) => faultOf(a)?.failure_id
  const failDate = (a) => faultOf(a)?.failure_date
  const ql = q.trim().toLowerCase()
  const matchQ = (a) => !ql || [a.code, a.name, a.location, a.locationDetail, a.cls, a.sys].some((v) => (v || '').toLowerCase().includes(ql))
  // all depots on this line, ignoring the other filters — used only to guard a
  // stale depot filter persisted from another line (below)
  const lineDepots = [...new Set(assets.map((a) => a.depot).filter(Boolean))].sort()
  // CASCADING filters: each dropdown offers only the values still present once the
  // OTHER active filters are applied — pick a depot and the class/location/system
  // lists narrow to that depot. A dropdown never constrains itself, and always
  // keeps its own current value so a selection stays visible.
  // multi-select array fields + the single depot field
  const FILTER_FIELDS = [['sys', fSystem], ['cls', fClass], ['location', fLocation], ['status', fStatus], ['locationDetail', fLocDet]]
  const passesExcept = (a, exceptKey) => FILTER_FIELDS.every(
    ([k, v]) => k === exceptKey || v.length === 0 || v.includes(a[k]))
    && (exceptKey === 'depot' || !fDepot || !lineDepots.includes(fDepot) || a.depot === fDepot)
  const optsFor = (k, cur) => {
    const s = new Set(assets.filter((a) => matchQ(a) && passesExcept(a, k)).map((a) => a[k]).filter(Boolean))
    for (const c of (Array.isArray(cur) ? cur : cur ? [cur] : [])) s.add(c)
    return [...s].sort()
  }
  const systemsList = optsFor('sys', fSystem); const classesList = optsFor('cls', fClass)
  const locationsList = optsFor('location', fLocation); const statusesList = optsFor('status', fStatus)
  const locDetList = optsFor('locationDetail', fLocDet)
  const depotsList = optsFor('depot', fDepot)   // maintenance depots present in the narrowed view
  // the sort accessor per column; PM columns read the derived schedule
  const sortVal = (a, k) => k === 'next_due' ? (sched[assetKey(a)]?.next_due || '9999')
    : k === 'pm' ? (SEV_RANK[dispState(a)] ?? 3)
    : (a[k] || '')
  // base = everything the search + dropdown filters allow (state chip excluded),
  // so the chip counts reflect the current view and update as you filter
  let base = assets
  if (ql) base = base.filter((a) => [a.code, a.name, a.location, a.locationDetail, a.cls, a.sys].some((v) => (v || '').toLowerCase().includes(ql)))
  if (fSystem.length) base = base.filter((a) => fSystem.includes(a.sys))
  if (fClass.length) base = base.filter((a) => fClass.includes(a.cls))
  if (fLocation.length) base = base.filter((a) => fLocation.includes(a.location))
  if (fStatus.length) base = base.filter((a) => fStatus.includes(a.status))
  if (fLocDet.length) base = base.filter((a) => fLocDet.includes(a.locationDetail))
  if (fCode.trim()) base = base.filter((a) => (a.code || '').toLowerCase().includes(fCode.trim().toLowerCase()))
  if (fName.trim()) base = base.filter((a) => (a.name || '').toLowerCase().includes(fName.trim().toLowerCase()))
  // only apply a depot filter that actually belongs to the current line — a
  // depot picked on another line (persisted) must not blank this line's register
  if (fDepot && lineDepots.includes(fDepot)) base = base.filter((a) => a.depot === fDepot)
  const overdueAll = base.filter((a) => stateOf(a) === 'overdue')
  const neverDone = overdueAll.filter((a) => dispState(a) === 'never')  // never once maintained
  const overdue = overdueAll.filter((a) => dispState(a) !== 'never')    // lapsed only (Overdue = overdue − never-done)
  const notScheduled = base.filter((a) => !sched[assetKey(a)])          // no PM plan at all — out of scope
  const dueSoon = base.filter((a) => stateOf(a) === 'due_soon')
  const longOverdue = base.filter((a) => stateOf(a) === 'long_overdue')  // 5-Yearly overdue / never started
  const faulty = base.filter((a) => attnOf(a) > 0)   // open OR acknowledged
  // one asset matches a bucket key; several selected chips OR together
  const inBucket = (k, a) => k === 'faulty' ? attnOf(a) > 0
    : k === 'not_scheduled' ? !sched[assetKey(a)]
    : k === 'never' ? dispState(a) === 'never'
    : k === 'overdue' ? (stateOf(a) === 'overdue' && dispState(a) !== 'never')
    : stateOf(a) === k
  let shown = filters.length === 0 ? base
    : base.filter((a) => filters.some((k) => inBucket(k, a)))
  // Assets with an outstanding failure ALWAYS float to the top — open (red) above
  // acknowledged (amber) above job-carded — regardless of the chosen sort, like
  // the fibre console floats blocked lines. Any manual sort orders within bands.
  if (sortKey) {
    const dir = sortDir === 'asc' ? 1 : -1
    shown = [...shown].sort((x, y) => {
      const f = attnRank(y) - attnRank(x)          // faulty first, always
      if (f) return f
      const a = sortVal(x, sortKey), b = sortVal(y, sortKey)
      return (a < b ? -1 : a > b ? 1 : x.code.localeCompare(y.code)) * dir
    })
  } else if (faulty.length) {
    shown = [...shown].sort((x, y) => attnRank(y) - attnRank(x))
  }
  // page the (already filtered + sorted) rows — rendering all 3000+ at once is
  // ~38k DOM nodes and janky; a page is ~1.5k and snappy. Reset on any change.
  const REG_PAGE = 150
  const pageCount = Math.max(1, Math.ceil(shown.length / REG_PAGE))
  const pageSafe = Math.min(page, pageCount - 1)
  const pageRows = shown.slice(pageSafe * REG_PAGE, (pageSafe + 1) * REG_PAGE)
  useEffect(() => { setPage(0) }, [filters.join(','), q, fSystem, fClass, fLocation, fStatus, fLocDet.join(','), fCode, fName, sortKey, sortDir]) // eslint-disable-line

  const toggleSort = (k) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('asc') }
  }
  const sortArrow = (k) => sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  const COLS = [['code', 'Code'], ['name', 'Asset'], ['cls', 'Class'], ['location', 'Station'],
    ['locationDetail', 'Location'], ['sys', 'System'], ['status', 'Status'], ['next_due', 'Next PM'], ['pm', 'PM state']]
  // per-column header filters (Class/Location/System/Status), multi-select — off the ribbon
  const toggleIn = (set) => (v) => set((prev) => { const a = asArr(prev); return a.includes(v) ? a.filter((x) => x !== v) : [...a, v] })
  // PM-state column filter shares the ribbon's `filters` buckets, so the header
  // funnel and the ribbon chips stay in sync.
  const PM_OPTS = ['overdue', 'never', 'due_soon', 'long_overdue', 'ok', 'not_scheduled']
  const PM_LBL = { overdue: 'Overdue', never: 'Awaiting 1st service', due_soon: 'Due soon', long_overdue: '5-Yearly', ok: 'On schedule', not_scheduled: 'Unscheduled' }
  const colFilters = {
    code: { text: fCode, setText: setFCode },
    name: { text: fName, setText: setFName },
    cls: { values: fClass, toggle: toggleIn(setFClass), clear: () => setFClass([]), opts: classesList, allLabel: 'All classes' },
    location: { values: fLocation, toggle: toggleIn(setFLocation), clear: () => setFLocation([]), opts: locationsList, allLabel: 'All stations' },
    locationDetail: { values: fLocDet, toggle: toggleIn(setFLocDet), clear: () => setFLocDet([]), opts: locDetList, allLabel: 'All locations' },
    sys: { values: fSystem, toggle: toggleIn(setFSystem), clear: () => setFSystem([]), opts: systemsList, allLabel: 'All systems' },
    status: { values: fStatus, toggle: toggleIn(setFStatus), clear: () => setFStatus([]), opts: statusesList, allLabel: 'Any status', fmt: (v) => STATUS_LABEL[v] || v },
    pm: { values: filters.filter((k) => PM_OPTS.includes(k)), toggle: (v) => setFilter(filters.includes(v) ? filters.filter((x) => x !== v) : [...filters, v]),
          clear: () => setFilter(filters.filter((k) => !PM_OPTS.includes(k))), opts: PM_OPTS, allLabel: 'All states', fmt: (v) => PM_LBL[v] || v },
  }
  const [openCol, setOpenCol] = useState(null)

  // download the table exactly as filtered & sorted, as CSV
  const exportCsv = () => {
    const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const head = [...COLS.map(([, l]) => l), 'Open failures', 'Acknowledged', 'Job card']
    const body = shown.map((a) => {
      const s = sched[assetKey(a)]
      return [a.code, a.name, a.cls, a.location, a.sys || '', STATUS_LABEL[a.status] || a.status,
        s?.next_due || '', s ? SCHED_LABEL[s.state] : '', openN(a) || '', ackN(a) || '', jobN(a) || ''].map(cell).join(',')
    })
    const csv = [head.map(cell).join(','), ...body].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `amps-assets-${effLine ? effLine.replace(/\s+/g, '-').toLowerCase() + '-' : ''}${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }
  // bulk import the standard register CSV
  const onImportFile = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setImpBusy(true); setImpResult(null)
    try {
      const base = import.meta.env.VITE_AMPS_API ?? ''
      const r = await fetch(`${base}/api/assets/import`, {
        method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: await file.text(),
      })
      const body = await r.json().catch(() => null)
      setImpResult(r.ok ? body : { error: body?.detail || `HTTP ${r.status}` })
      // Any row that didn't import must be impossible to miss — pop a summary so
      // a coordinator never assumes "all imported" when some were skipped/failed.
      if (r.ok && body && (body.skipped > 0 || body.failed > 0)) {
        const lines = [
          `Import finished: ${body.created} added` +
          (body.skipped ? `, ${body.skipped} skipped (already in the register at that location)` : '') +
          (body.failed ? `, ${body.failed} failed` : '') + '.',
        ]
        if (body.errors?.length) lines.push('', 'First issues:', ...body.errors.slice(0, 8))
        if (body.failed) lines.push('', 'Fix the flagged rows in the sheet and re-import — repeats are safe.')
        alert(lines.join('\n'))
      }
    } catch (err) {
      setImpResult({ error: String(err) })
    }
    setImpBusy(false)
  }

  if (loading) return <p className="dim">Loading the asset register…</p>
  if (error) return <div className="card offline-note">Backend unreachable — {error}. Check the server and reload.</div>
  return (
    <>
      {!initialLine && lines.length > 1 && (
        <div className="preset-bar" role="tablist" aria-label="Line">
          {lines.map((l) => (
            <button key={l} type="button" className={`btn preset ${effLine === l ? 'active' : ''}`} onClick={() => setLine(l)}>
              <span className="dot" style={{ background: lineColor(l), display: 'inline-block', width: 8, height: 8, borderRadius: 99, marginRight: 6 }} />{l}
            </button>
          ))}
        </div>
      )}
      {assets.length === 0 ? (
        <>
        <div className="card"><p className="dim" style={{ margin: 0 }}>
          The register is empty.{' '}
          {canWrite ? <>Add assets one at a time with <b>+ New asset</b>, or bulk-load them from the <a href={`${import.meta.env.VITE_AMPS_API ?? ''}/api/assets/import/sample`} download>blank template</a> with <b>↑ Import CSV</b> — you can start now and import a sheet later. The register, QR tags and asset pages all fill in from here.</>
            : <>A writer can add assets here or import the standard register CSV.</>}
        </p>
        {canWrite && (
          <div className="import-status" style={{ marginTop: 12 }}>
            <button type="button" className={`btn sm ${newOpen ? 'ghost' : ''}`} onClick={() => setNewOpen((v) => !v)}>{newOpen ? 'Close' : '+ New asset'}</button>
            <button type="button" className="btn ghost sm" onClick={() => fileRef.current?.click()} disabled={impBusy}>{impBusy ? 'Importing…' : '↑ Import CSV'}</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onImportFile} />
            {impResult && (impResult.error
              ? <span className="import-msg err">{impResult.error}</span>
              : <span className={`import-msg${(impResult.skipped > 0 || impResult.failed > 0) ? ' warn' : ''}`}>
                  {(impResult.skipped > 0 || impResult.failed > 0) && '⚠ '}
                  {impResult.created} created · {impResult.skipped} skipped · {impResult.failed} failed
                  {impResult.created > 0 && <button type="button" className="mini-btn" onClick={() => location.reload()}>Reload</button>}
                </span>)}
          </div>
        )}
        </div>
        {newOpen && canWrite && (
          <div className="card newasset-card">
            <AssetForm mode="create"
                       initial={effLine ? { line: effLine, criticality: 'B', status: 'in_service' } : null}
                       onCancel={() => setNewOpen(false)}
                       onDone={(code) => { setNewOpen(false); location.hash = `/asset/${code}` }} />
          </div>
        )}
        </>
      ) : (
        <>
          <div className="asset-toolbar" ref={toolbarRef}>
            <input className="asset-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="Search code, asset, class or location…" aria-label="Search assets" />
            <div className="asset-filter" role="tablist" aria-label="PM state filter">
              {[['all', `All ${base.length}`], ['faulty', `Faulty ${faulty.length}`],
                ['overdue', `Overdue ${overdue.length}`],
                ['never', <>Awaiting 1st service <span className="cnt-never">{neverDone.length}</span></>],
                ['due_soon', `Due soon ${dueSoon.length}`], ['long_overdue', `5-Yearly ${longOverdue.length}`],
                ['not_scheduled', `Unscheduled ${notScheduled.length}`]]
                .filter(([k]) => (k !== 'faulty' || faulty.length) && (k !== 'long_overdue' || longOverdue.length) && (k !== 'not_scheduled' || notScheduled.length) && (k !== 'never' || neverDone.length))
                .map(([k, lbl]) => {
                  const active = k === 'all' ? filters.length === 0 : filters.includes(k)
                  const toggle = () => k === 'all' ? setFilter([])
                    : setFilter(filters.includes(k) ? filters.filter((x) => x !== k) : [...filters, k])
                  return (
                <button key={k} type="button" aria-pressed={active}
                        className={`btn preset ${k === 'never' ? 'preset-never ' : ''}${active ? 'active' : ''}${(k === 'overdue' && overdue.length) || (k === 'faulty' && faulty.length) ? ' has-od' : ''}`}
                        title={FILTER_TIP(k, { base: base.length, faulty: faulty.length, overdue: overdue.length, never: neverDone.length, dueSoon: dueSoon.length, longOverdue: longOverdue.length, notScheduled: notScheduled.length })}
                        onClick={toggle}>{lbl}</button>
                )})}
            </div>
            {/* Class · Location · System · Status filters now live in the table
                column headers (▾). Only depot stays here — it has no column. */}
            {depotsList.length > 0 && !me?.depot && (
              <select value={fDepot} onChange={(e) => setFDepot(e.target.value)} aria-label="Filter by depot">
                <option value="">All depots</option>
                {depotsList.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            {(fSystem.length || fClass.length || fLocation.length || fStatus.length || fLocDet.length || fCode || fName || fDepot || q || filters.length || sortKey) && (
              <button type="button" className="btn ghost sm" onClick={() => {
                setFSystem([]); setFClass([]); setFLocation([]); setFStatus([]); setFLocDet([]); setFCode(''); setFName(''); setFDepot(''); setQ(''); setFilter([]); setSortKey(null)
              }}>Clear</button>
            )}
            <span className="asset-count">{shown.length} shown</span>
            <div className="asset-actions">
              {canWrite && (
                <button type="button" className={`icon-btn${newOpen ? ' on' : ''}`} title="New asset"
                        aria-label="New asset" onClick={() => setNewOpen((v) => !v)}>
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M8 3.2v9.6M3.2 8h9.6" /></svg>
                </button>
              )}
              <button type="button" className="icon-btn" title="Download the filtered table (CSV)"
                      aria-label="Download filtered table" onClick={exportCsv}>
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 2.4v7.2M4.8 6.6 8 9.8l3.2-3.2M3 12.8h10" /></svg>
              </button>
              <button type="button" className="icon-btn" title="Print the filtered table"
                      aria-label="Print filtered table" onClick={() => window.print()}>
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4.5 6V2.5h7V6M4.5 12H3.2V6.4h9.6V12H11.5M4.5 9.6h7V13.5h-7z" /></svg>
              </button>
              {canWrite && (
                <button type="button" className={`icon-btn${impBusy ? ' disabled' : ''}`} title="Import register CSV"
                        aria-label="Import CSV" onClick={() => fileRef.current?.click()} disabled={impBusy}>
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 9.8V2.6M4.8 5.8 8 2.6l3.2 3.2M3 12.8h10" /></svg>
                </button>
              )}
              <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onImportFile} />
            </div>
          </div>
          {/* a caption that appears only on the printout: what's being shown */}
          <div className="print-caption">
            AMPS · {effLine || 'All lines'} — {filters.length === 0 ? 'all assets' : filters.map((k) => FILTER_LABEL[k] || k).join(' + ')}
            {fSystem.length ? ` · ${fSystem.join('/')}` : ''}{fClass.length ? ` · ${fClass.join('/')}` : ''}{fLocation.length ? ` · ${fLocation.join('/')}` : ''}{fStatus.length ? ` · ${fStatus.map((s) => STATUS_LABEL[s] || s).join('/')}` : ''}
            {q ? ` · “${q}”` : ''} · {shown.length} assets · {new Date().toISOString().slice(0, 10)}
          </div>
          {newOpen && canWrite && (
            <div className="card newasset-card">
              <AssetForm mode="create"
                         initial={effLine ? { line: effLine, criticality: 'B', status: 'in_service' } : null}
                         onCancel={() => setNewOpen(false)}
                         onDone={(code) => { setNewOpen(false); location.hash = `/asset/${code}` }} />
            </div>
          )}
          {(impBusy || impResult) && (
            <div className="import-status">
              {impBusy ? <span className="dim">Importing…</span>
                : impResult.error ? <span className="import-msg err">{impResult.error}</span>
                : <span className={`import-msg${(impResult.skipped > 0 || impResult.failed > 0) ? ' warn' : ''}`}>
                    {(impResult.skipped > 0 || impResult.failed > 0) && '⚠ '}
                    {impResult.created} created · {impResult.skipped} skipped · {impResult.failed} failed
                    {impResult.errors?.length ? ` — ${impResult.errors[0]}` : ''}
                    {impResult.created > 0 && <button type="button" className="mini-btn" onClick={() => location.reload()}>Reload register</button>}
                  </span>}
            </div>
          )}
          {shown.length === 0 ? (
            <div className="card"><p className="dim" style={{ margin: 0 }}>No assets match — clear the search or filters.</p></div>
          ) : (
            <div className="card tbl-wrap freeze-head">
              <table className="sortable">
                <thead>
                  <tr>
                    {COLS.map(([k, lbl]) => {
                      const cf = colFilters[k]
                      const cfOn = cf && (cf.text !== undefined ? !!cf.text : cf.values.length)
                      return (
                      <th key={k} className={`th-sort${sortKey === k ? ' active' : ''}${cfOn ? ' th-filtered' : ''}`}>
                        <span className="th-lbl" onClick={() => toggleSort(k)} title={`Sort by ${lbl}`}>{lbl}{sortArrow(k)}</span>
                        {cf && <ColFilter open={openCol === k} onToggle={() => setOpenCol(openCol === k ? null : k)}
                                          onClose={() => setOpenCol(null)} {...cf} />}
                      </th>
                    )})}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((a) => {
                    const s = sched[assetKey(a)]
                    const nOpen = openN(a), nAck = ackN(a), nJob = jobN(a)
                    const nOut = nOpen + nAck + nJob  // outstanding failures on the asset
                    const fid = failId(a), fdate = failDate(a)
                    // With ONE outstanding failure a quick action deep-links to it;
                    // with several, no single target is right — go to the asset's
                    // failure list, where each failure is actioned individually.
                    const single = nOut === 1 && fid
                    const ackHref = single ? `#/log?d=${fdate}&edit=${fid}&resp=acknowledgement` : `#/asset/${a.code}`
                    const rectHref = single ? `#/log?d=${fdate}&edit=${fid}&resp=rectification` : `#/asset/${a.code}`
                    return (
                      <tr key={a.code} tabIndex={0}
                          className={nOpen ? 'row-faulty' : nAck ? 'row-ack' : nJob ? 'row-job' : ''}
                          onClick={() => go(`/asset/${a.code}`)}
                          onKeyDown={(e) => e.key === 'Enter' && go(`/asset/${a.code}`)}>
                        <td className="code" data-l="Code">{a.code}</td>
                        <td data-l="Asset">{a.name}
                          {nOpen > 0 && <span className="fault-badge" title={`${nOpen} open breakdown${nOpen > 1 ? 's' : ''} — unresolved, no response logged yet`}>⚠ {nOpen} open</span>}
                          {nAck > 0 && <span className="fault-badge amber" title={`${nAck} acknowledged — noted (demand/mail) but STILL to be rectified`}>{nAck} acknowledged · to rectify</span>}
                          {nJob > 0 && <span className="fault-badge yellow" title={`${nJob} job card${nJob > 1 ? 's' : ''} raised — STILL to be rectified`}>{nJob} job card · to rectify</span>}
                          {canWrite && nOut > 0 && (
                            <span className="fault-actions" onClick={(e) => e.stopPropagation()}>
                              {/* Acknowledge only makes sense for a not-yet-acknowledged (open) failure */}
                              {nOpen > 0 && (
                                <a className="fa-btn fa-ack" href={ackHref}
                                   title={single ? 'Acknowledge this failure (demand raised / mail sent)' : 'Several failures — open the asset to acknowledge each'}
                                   aria-label="Acknowledge">◐ Acknowledge</a>
                              )}
                              <a className="fa-btn fa-rect" href={rectHref}
                                 title={single ? 'Rectify — log the fix that resolves this failure' : 'Several failures — open the asset to rectify each'}
                                 aria-label="Rectify">✓ Rectify{nOut > 1 ? ` (${nOut})` : ''}</a>
                            </span>
                          )}</td>
                        <td className="dim" data-l="Class">{a.cls}</td>
                        <td className="dim" data-l="Station">{a.location}</td>
                        <td className="dim wrap-cell" data-l="Location">{a.locationDetail || '—'}</td>
                        <td className="dim" data-l="System">{a.sys ?? '—'}</td>
                        <td data-l="Status"><StatusChip status={a.status} />
                          {codalExceeded(a) && <span className="codal-dot" title={`Past its ${a.codalLifeYears}-year codal life`} />}</td>
                        <td className="dim dt" data-l="Next PM">{s?.next_due || '—'}</td>
                        <td data-l="PM state">{s
                          ? (() => {
                              // a routine-overdue asset that was never once maintained shows the
                              // "Never done" tag (like the asset-detail page) instead of "Overdue"
                              const ds = s.never_done ? 'never' : s.state
                              return <span className={schedChip(ds)} title={SCHED_TIP[ds]}><span className="dot" />{SCHED_LABEL[ds]}{s.overdue_count > 1 ? ` · ${s.overdue_count}` : ''}</span>
                            })()
                          : <span className="dim">—</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {shown.length > REG_PAGE && (
            <div className="log-pager">
              <button type="button" className="btn ghost" disabled={pageSafe === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Prev</button>
              <span className="dim">{pageSafe * REG_PAGE + 1}–{Math.min((pageSafe + 1) * REG_PAGE, shown.length)} of {shown.length.toLocaleString()}</span>
              <button type="button" className="btn ghost" disabled={pageSafe >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </>
  )
}

const daysUntil = (iso) => Math.round((new Date(iso) - new Date()) / 86400000)

/* an asset is past its codal (prescribed) service life when commissioned-date +
   codal-life-years is in the past. Returns the expiry year, or null if unknown. */
const codalExpiry = (a) => {
  if (!a || !a.commissionedOn || a.codalLifeYears == null) return null
  const d = new Date(a.commissionedOn + 'T00:00:00')
  if (isNaN(d)) return null
  d.setFullYear(d.getFullYear() + Number(a.codalLifeYears))
  return d
}
const codalExceeded = (a) => { const e = codalExpiry(a); return e != null && e < new Date() }

/* Lines named after colours get their colour as the chip dot — free for any
   org that names lines that way; everyone else gets a neutral dot. */
const LINE_COLORS = {
  green: '#1c7a44', blue: '#2b5c99', purple: '#5b3fbf', yellow: '#b98a00',
  red: '#a32e2e', orange: '#c2571a', pink: '#b83280', grey: '#52525b', gray: '#52525b',
}
const lineColor = (name) => {
  const word = (name || '').toLowerCase().split(/\s+/).find((w) => LINE_COLORS[w])
  return word ? LINE_COLORS[word] : '#a1a1aa'
}

const LivePmChip = ({ item }) => {
  const s = item.overdue_days > 0
    ? { key: 'overdue', label: `Overdue ${item.overdue_days}d` }
    : daysUntil(item.next_due) <= 7
      ? { key: 'due_soon', label: `Due in ${Math.max(daysUntil(item.next_due), 0)}d` }
      : { key: 'ok', label: 'On schedule' }
  return <span className={`chip d-${s.key}`}><span className="dot" />{s.label}</span>
}

/* ---------- dashboard ---------- */

function Dashboard({ go }) {
  const k = kpis()
  const nextPM = (code) =>
    PM_SCHEDULES.filter((p) => p.asset === code).sort((a, b) => a.nextDue - b.nextDue)[0] ?? null
  return (
    <>
      <div className="kpis">
        <div className="tile"><div className="v">{k.assets}</div><div className="k">Assets registered</div></div>
        <div className="tile"><div className="v">{k.compliance}%</div><div className="k">PM compliance</div></div>
        <div className={k.dueSoon ? 'tile warn' : 'tile'}><div className="v">{k.dueSoon}</div><div className="k">PM due within 7 days</div></div>
        <div className={k.overdue ? 'tile alert' : 'tile'}><div className="v">{k.overdue}</div><div className="k">PM overdue</div></div>
        <div className="tile"><div className="v">{k.openJC}</div><div className="k">Open job cards</div></div>
      </div>

      <h2>Assets</h2>
      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr><th>Code</th><th>Asset</th><th>Class</th><th>Location</th><th>Status</th><th>Next PM</th><th>PM state</th><th>Records</th></tr>
          </thead>
          <tbody>
            {ASSETS.map((a) => {
              const pm = nextPM(a.code)
              return (
                <tr key={a.code} tabIndex={0} onClick={() => go(`/asset/${a.code}`)}
                    onKeyDown={(e) => e.key === 'Enter' && go(`/asset/${a.code}`)}>
                  <td className="code" data-l="Code">{a.code}</td>
                  <td data-l="Asset">{a.name}</td>
                  <td className="dim" data-l="Class">{a.cls}</td>
                  <td className="dim" data-l="Location">{a.location}</td>
                  <td data-l="Status"><StatusChip status={a.status} /></td>
                  <td className="dim dt" data-l="Next PM">{pm ? fmtDate(pm.nextDue) : '—'}</td>
                  <td data-l="PM state">{pm ? <DueChip nextDue={pm.nextDue} /> : <span className="dim">—</span>}</td>
                  <td data-l="Records">{(() => {
                    const n = completedChecksheets(a.code).length
                    return n ? <span className="rec-count" title={`${n} completed checksheet${n > 1 ? 's' : ''}`}>✓ {n}</span> : <span className="dim">—</span>
                  })()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

    </>
  )
}

/* ---------- asset detail (live) ---------- */

/* Historical rows carry import scaffolding that duplicates the chips beside
   them — a "[YEARLY MAINTENANCE]" / "[failure]" prefix, a "· equipment: <name>"
   tail, and an import note. Strip that noise for display only; the stored text
   (and the edit form) keep the record verbatim. */
const tidyLog = (t = '') => t
  .replace(/^\s*\[[^\]]*\]\s*/, '')
  .replace(/\s*·\s*equipment:\s*[^·]+/i, '')
  .replace(/\s*·\s*\[historical import[^\]]*\]/i, '')
  .trim()

/* One entry row, shared by both history sections. The asset class is constant
   for this asset (it's in the facts grid), so it's not repeated on every row. */
/* uploaded checksheet scans / photos / PDFs on a log entry — thumbnails/links */
const ATT_URL = (id) => `${import.meta.env.VITE_AMPS_API ?? ''}/api/logbook/attachments/${id}`
function AttachmentView({ items }) {
  if (!items?.length) return null
  return (
    <div className="att-view" onClick={(e) => e.stopPropagation()}>
      {items.map((a) => (
        <a key={a.id} href={a.url || ATT_URL(a.id)} target="_blank" rel="noreferrer" className="att-chip" title={a.filename}>
          {a.url
            ? <span className="att-chip-pdf att-chip-link">🔗</span>
            : (a.mime || '').startsWith('image/')
              ? <img src={ATT_URL(a.id)} alt={a.filename} loading="lazy" />
              : <embed className="att-chip-pdf" src={`${ATT_URL(a.id)}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`} type="application/pdf" />}
          <span className="att-chip-name">{a.url ? '🔗 ' : (a.mime || '').includes('pdf') ? '⇲ ' : '▤ '}{a.filename}</span>
        </a>
      ))}
    </div>
  )
}

/* a filled structured checksheet, shown collapsed with a pass/total summary */
const CS_GLYPH = { pass: '✓', fail: '✕', na: '–' }
function ChecksheetView({ cs }) {
  const [open, setOpen] = useState(false)
  if (!cs?.results?.length) return null
  const pass = cs.results.filter((r) => r.status === 'pass').length
  const fail = cs.results.filter((r) => r.status === 'fail').length
  return (
    <div className={`cs-view${fail ? ' has-fail' : ''}`}>
      <button type="button" className="cs-head" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}>
        <span className="cs-caret">{open ? '▾' : '▸'}</span>
        <span className="cs-name">▤ {cs.name || 'Checksheet'}</span>
        <span className="cs-sum">{pass}/{cs.results.length} pass{fail ? ` · ${fail} fail` : ''}</span>
      </button>
      {open && (
        <ul className="cs-list">
          {cs.results.map((r, i) => (
            <li key={i} className={`cs-row cs-${r.status}`}>
              <span className={`cs-mark cs-m-${r.status}`}>{CS_GLYPH[r.status] || '–'}</span>
              <span className="cs-l">{r.label}</span>
              {r.reading && <span className="cs-r">{r.reading}{r.unit ? ` ${r.unit}` : ''}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// failure lifecycle chip: open (red) · acknowledged (amber) · job card (yellow) · resolved (green)
const FAIL_STATE_CHIP = { open: 'd-overdue', acknowledged: 'd-ack', job_card: 'd-job', resolved: 'd-ok' }
const FAIL_STATE_LABEL = { open: 'open', acknowledged: 'acknowledged', job_card: 'job card issued', resolved: 'resolved' }

const RESP_META = {
  rectification: { cls: 'resolved', tag: '✓ Rectification' },
  job_card: { cls: 'job', tag: '▤ Job card issued' },
  acknowledgement: { cls: 'ack', tag: '◐ Acknowledged' },
}
function LogRow({ en, staff }) {
  // a failure shows ALL its response logs as a timeline — acknowledged, job card
  // and rectification are independent and coexist (an acknowledged-then-fixed
  // failure keeps both). Ordered oldest-intent → fix.
  // a job card raised to an agency but rectified by US (not via the agency) is
  // UNFULFILLED — a penalty against the agency (they were tasked, we did the fix)
  const jobIgnored = !!(en.job_card_by && en.resolved_by && !en.resolved_by.via_job_card)
  const responses = en.type === 'failure' ? [
    en.acknowledged_by && { kind: 'acknowledgement', ref: en.acknowledged_by },
    en.job_card_by && { kind: 'job_card', ref: en.job_card_by, ignored: jobIgnored },
    en.resolved_by && { kind: 'rectification', ref: en.resolved_by },
    // withdrawn responses stay in the book for the audit trail, shown struck
    ...(en.retracted_responses || []).map((ref) => ({ kind: ref.type, ref, retracted: true })),
  ].filter(Boolean) : []
  // per-failure quick actions on the asset page — each outstanding failure is
  // actioned individually (handles the several-failures-on-one-asset case).
  // Acknowledge shows only for a not-yet-acknowledged (open) failure.
  const outstanding = en.type === 'failure' && en.state && en.state !== 'resolved'
  const faLink = (kind) => `#/log?d=${en.log_date}&edit=${en.id}&resp=${kind}`
  return (
    <div className="wo">
      <div className="row1">
        <span className={`chip ${en.type === 'failure' ? 'd-overdue' : ''}`}>
          <span className="dot" />{en.type}{en.subtype ? ` · ${en.subtype}` : ''}
        </span>
        {en.fault_type && <span className="chip"><span className="dot" />{en.fault_type}</span>}
        <span className="sub dt">{en.log_date}</span>
        {en.down_hours != null && <span className="sub">down <b>{en.down_hours}h</b></span>}
        {en.state && <span className={`chip ${FAIL_STATE_CHIP[en.state]}`}>{FAIL_STATE_LABEL[en.state]}</span>}
        {staff && outstanding && (
          <span className="fault-actions">
            {en.state === 'open' && <a className="fa-btn fa-ack" href={faLink('acknowledgement')}>◐ Acknowledge</a>}
            <a className="fa-btn fa-rect" href={faLink('rectification')}>✓ Rectify</a>
          </span>
        )}
        {staff && <span className="wo-edit"><EditLink id={en.id} date={en.log_date} /></span>}
      </div>
      <div className="findings">{tidyLog(en.text)}</div>
      {en.consumables && <div className="le-consumables"><span className="lc-tag">Consumed</span> {en.consumables}</div>}
      {en.checksheet && <ChecksheetView cs={en.checksheet} />}
      <AttachmentView items={en.attachments} />
      {(en.attended_by || en.entered_by) && (
        <div className="sub">by <b>{en.attended_by || en.entered_by}</b>
          {en.attended_by && en.attended_by !== en.entered_by && <> · recorded by {en.entered_by}</>}
        </div>
      )}
      {responses.map(({ kind, ref, retracted, ignored }) => {
        const rm = RESP_META[kind] || RESP_META.acknowledgement
        return (
        <div key={retracted ? `rt-${ref.id}` : kind} className={`fail-resp ${rm.cls}${retracted ? ' retracted' : ''}${ignored ? ' ignored' : ''}`}>
          <span className="fr-tag">{rm.tag}</span>
          {retracted && <span className="fr-retracted">retracted</span>}
          {ignored && <span className="fr-ignored" title="Job card raised to the agency but we did the fix — penalty against the agency">⚠ unfulfilled · penalty</span>}
          {ref.via_job_card && <span className="fr-via">▤ via job card</span>}
          <span className="fr-date dt">{ref.log_date}</span>
          <div className="fr-text">{tidyLog(ref.text)}</div>
          {ref.consumables && <div className="le-consumables"><span className="lc-tag">Consumed</span> {ref.consumables}</div>}
          {ref.checksheet && <ChecksheetView cs={ref.checksheet} />}
          <AttachmentView items={ref.attachments} />
          {ref.attended_by && <div className="sub">by <b>{ref.attended_by}</b></div>}
        </div>
        )
      })}
    </div>
  )
}

/* Maintenance and failures are the two things a section is judged on, so the
   asset card states them separately rather than as one blended stream — the
   same ledger, split by what the reader came to check. */
/* Long histories are the norm (some assets carry 60+ maintenance entries), and
   a full list would push the failure section off the bottom of the page — the
   very thing that made maintenance look missing before. Show a window, with
   the rest one click away. */
const LOG_WINDOW = 8

function LogList({ rows, staff }) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, LOG_WINDOW)
  return (
    <>
      {shown.map((en) => <LogRow key={en.id} en={en} staff={staff} />)}
      {rows.length > LOG_WINDOW && (
        <button type="button" className="btn preset" onClick={() => setAll(!all)}>
          {all ? `Show latest ${LOG_WINDOW}` : `Show all ${rows.length}`}
        </button>
      )}
    </>
  )
}

function AssetLogSections({ log, staff, code, canWrite }) {
  const maint = log.filter((e) => e.type === 'maintenance')
  const allFails = log.filter((e) => e.type === 'failure')
  // a failure's rectification/acknowledgement is shown INLINE with the failure
  // (LogRow), so it is not repeated in the loose "other" stream
  const other = log.filter((e) => !['maintenance', 'failure', 'rectification', 'acknowledgement', 'job_card'].includes(e.type))
  // A public walk-up (QR scan) sees only settled history — outstanding
  // breakdowns are operational and stay behind sign-in. Staff see them, pulled
  // to the top and marked. The maintenance record is public either way.
  const openFail = allFails.filter((e) => e.state === 'open')
  const ackFail = allFails.filter((e) => e.state === 'acknowledged')
  const jobFail = allFails.filter((e) => e.state === 'job_card')
  const resolvedFail = allFails.filter((e) => e.state === 'resolved')
  const timed = resolvedFail.filter((e) => e.down_hours != null)
  const downtime = timed.reduce((s, e) => s + e.down_hours, 0)
  const attnRows = [...openFail, ...ackFail, ...jobFail]
  const attnBits = [openFail.length && `${openFail.length} open`,
    ackFail.length && `${ackFail.length} acknowledged`,
    jobFail.length && `${jobFail.length} job card`].filter(Boolean).join(' · ')
  // unified sub-group: a coloured heading + its entries, shown only when non-empty
  const SubGroup = ({ tone, label, rows }) => rows.length === 0 ? null : (
    <div className={`logsub logsub-${tone}`}>
      <h4 className="logsub-h"><span className="logsub-dot" />{label} <span className="dim">· {rows.length}</span></h4>
      <LogList rows={rows} staff={staff} />
    </div>
  )
  const totalFail = allFails.length
  return (
    <>
      <div className="sect">
        <h3 className="sect-h-row">
          <span>Maintenance history — {maint.length ? `${maint.length} entr${maint.length === 1 ? 'y' : 'ies'}, newest first` : 'none recorded'}</span>
          {canWrite && code && (
            <a className="btn preset sm add-log-btn" href={`#/log?asset=${encodeURIComponent(code)}`}
               title="Log maintenance / failure for this asset">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M8 3.4v9.2M3.4 8h9.2" /></svg>
              Add log
            </a>
          )}
        </h3>
        {maint.length === 0
          ? <p className="dim">No maintenance logged against this asset yet.</p>
          : <LogList rows={maint} staff={staff} />}
      </div>

      {/* one Failure section, organised into state sub-groups. Outstanding
          breakdowns (open / acknowledged / job card) are operational, so a public
          walk-up sees only the resolved history and is invited to sign in. */}
      <div className="sect">
        <h3>
          Failure history — {totalFail
            ? <>{totalFail} total{attnRows.length > 0 && <> · <b className="attn-count">{attnRows.length} outstanding</b></>}{timed.length > 0 && <> · {downtime.toFixed(1)}h downtime</>}</>
            : 'none recorded'}
          {!staff && attnRows.length > 0 && <span className="dim"> · sign in for outstanding breakdowns</span>}
        </h3>
        {totalFail === 0 && <p className="dim">No failures recorded against this asset.</p>}
        {staff && <SubGroup tone="open" label="Open — unresolved, no response yet" rows={openFail} />}
        {staff && <SubGroup tone="ack" label="Acknowledged — noted, still to rectify" rows={ackFail} />}
        {staff && <SubGroup tone="job" label="Job card issued — awaiting close-out" rows={jobFail} />}
        <SubGroup tone="ok" label="Resolved" rows={resolvedFail} />
        {!staff && resolvedFail.length === 0 && totalFail > 0 && (
          <p className="dim">No resolved failures — the outstanding ones are visible after sign-in.</p>
        )}
      </div>

      {other.length > 0 && (
        <div className="sect">
          <h3>Other log entries — notes, newest first</h3>
          <LogList rows={other} staff={staff} />
        </div>
      )}
    </>
  )
}

/* ---------- maintenance schedule (backend-derived) ---------- */

/* The section's "grid scheduler". The backend rolls each cycle's next PM forward
   from the last time that cycle — or any more comprehensive one — was recorded
   (a Yearly service fulfils the Quarterly under it). Applicability comes from the
   asset's plan when set, else it's inferred from what the log already holds. */
const SCHED_FREQS = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly', '5-Yearly']
const SCHED_LABEL = { overdue: 'Overdue', due_soon: 'Due soon', long_overdue: '5-Yearly due', ok: 'On schedule', never: 'Never done' }
// short labels for the print caption when filter chips are active
const FILTER_LABEL = { faulty: 'faulty', overdue: 'overdue (lapsed)', never: 'awaiting 1st service', due_soon: 'due soon', long_overdue: '5-Yearly', not_scheduled: 'unscheduled' }

const FunnelIcon = ({ on }) => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill={on ? 'currentColor' : 'none'} stroke="currentColor"
       strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 3h12l-4.6 5.4v3.9L6.6 14V8.4z" />
  </svg>
)

/* A column-header filter. Two modes:
   - checkbox (values/toggle/clear/opts): multi-select, with an in-menu search
     box once the option list is long, so high-cardinality columns stay usable.
   - text (text/setText): a "contains" box for free-text columns (Code, Asset).
   The parent owns which column's menu is open (single-open); it closes on
   outside click / scroll. The menu is fixed-positioned (portal) so it escapes
   the table's overflow clip. */
function ColFilter({ open, onToggle, onClose, values, toggle, clear, opts, fmt, allLabel, text, setText }) {
  const btnRef = useRef(null)
  const [pos, setPos] = useState(null)
  const [find, setFind] = useState('')
  const isText = text !== undefined
  useEffect(() => {
    if (!open) { setPos(null); setFind(''); return undefined }
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 5, left: Math.min(r.left, window.innerWidth - 234) })
    }
    place()
    const close = () => onClose()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const t = setTimeout(() => window.addEventListener('click', close), 0)   // don't catch the opening click
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('click', close)
    }
  }, [open, onClose])
  const n = isText ? (text ? 1 : 0) : values.length
  const fl = find.trim().toLowerCase()
  const shownOpts = isText ? [] : (fl ? opts.filter((o) => (fmt ? fmt(o) : o).toLowerCase().includes(fl)) : opts)
  const menu = open && pos && createPortal(
    <div className="col-filter-menu" role="menu" onClick={(e) => e.stopPropagation()}
         style={{ position: 'fixed', top: pos.top, left: pos.left }}>
      {isText ? (
        <input className="cfm-text" autoFocus type="search" value={text} placeholder="contains…"
               onChange={(e) => setText(e.target.value)} />
      ) : (
        <>
          {opts.length > 8 && (
            <input className="cfm-text" autoFocus type="search" value={find} placeholder="search…"
                   onChange={(e) => setFind(e.target.value)} />
          )}
          <button type="button" className={`cfm-all${n === 0 ? ' active' : ''}`} onClick={() => clear()}>{allLabel}</button>
          {shownOpts.map((o) => {
            const sel = values.includes(o)
            return (
              <button type="button" key={o} className={`cfm-opt${sel ? ' active' : ''}`} onClick={() => toggle(o)}>
                <span className="cfm-box">{sel ? '✓' : ''}</span>{fmt ? fmt(o) : o}
              </button>
            )
          })}
          {shownOpts.length === 0 && <div className="cfm-empty">no match</div>}
        </>
      )}
    </div>, document.body)
  return (
    <span className="col-filter" onClick={(e) => e.stopPropagation()}>
      <button ref={btnRef} type="button" className={`col-filter-btn${n ? ' on' : ''}`} onClick={onToggle}
              aria-label="Filter column" title={n ? `Filtered${isText ? `: "${text}"` : ` (${n})`}` : 'Filter'}>
        <FunnelIcon on={n > 0} />{!isText && n > 0 && <span className="col-filter-badge">{n}</span>}
      </button>
      {menu}
    </span>
  )
}
// per-tag hover explanation for the PM state chips
const SCHED_TIP = {
  overdue: 'A routine (short-cycle) maintenance is past due — the asset was serviced before but has since lapsed.',
  never: 'Routine maintenance is due and this asset has never once been maintained on any cycle (no history at all).',
  due_soon: 'A routine maintenance falls due within the next few days.',
  long_overdue: 'A 5-Yearly (long-cycle) overhaul is due or was never started — tracked apart from the routine backlog.',
  ok: 'All maintenance cycles are up to date.',
}
// hover explanation for the register filter chips
const FILTER_TIP = (k, c) => k === 'all' ? `All ${c.base} assets in view`
  : k === 'faulty' ? `${c.faulty} asset(s) with an open or acknowledged failure`
  : k === 'overdue' ? `${c.overdue} asset(s) overdue after lapsing — serviced before but now past due (excludes never-done)`
  : k === 'never' ? `${c.never} asset(s) awaiting their first scheduled service — have a plan but no PM done yet (onboarding backlog, not a lapse)`
  : k === 'not_scheduled' ? `${c.notScheduled} asset(s) with no maintenance schedule at all — outside the PM scope`
  : k === 'due_soon' ? `${c.dueSoon} asset(s) due for maintenance within the next few days`
  : k === 'long_overdue' ? `${c.longOverdue} asset(s) with a 5-Yearly overhaul due or never started`
  : undefined
const schedChip = (state) => `chip d-${state === 'long_overdue' ? 'long' : state}`

function useAssetSchedule(code) {
  const [schedule, setSchedule] = useState(null)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let alive = true
    getJSON(`/api/assets/${encodeURIComponent(code)}/schedule`)
      .then((s) => alive && setSchedule(s)).catch(() => alive && setSchedule(null))
    return () => { alive = false }
  }, [code, nonce])
  return { schedule, reloadSchedule: () => setNonce((n) => n + 1) }
}

function MaintenanceSchedule({ schedule }) {
  const rows = schedule?.rows || []
  const s = schedule?.summary
  return (
    <div className="sect">
      <h3>
        Maintenance schedule
        {schedule && !schedule.has_plan && rows.length > 0 && (
          <span className="sched-tag" title="No plan set — cycles inferred from the log">inferred</span>
        )}
        {s && (
          <span className="sched-sum">
            {s.overdue_count > 0
              ? <span className="ss-red">⚠ {s.overdue_count} overdue</span>
              : s.next_due
                ? <>next: <b>{s.next_frequency}</b> in {s.days_left}d · <span className="dt">{s.next_due}</span></>
                : null}
          </span>
        )}
      </h3>
      {rows.length === 0 ? (
        <p className="dim">No maintenance plan or recurring history yet — set a plan in “Edit details”, or log a Monthly / Quarterly / Half-Yearly / Yearly / 5-Yearly entry.</p>
      ) : (
        <div className="tbl-wrap">
          <table className="sched-tbl">
            <thead><tr><th>Frequency</th><th>Last done</th><th>Next due</th><th>Days left</th><th>State</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.frequency}>
                  <td data-l="Frequency"><b>{r.frequency}</b></td>
                  <td className="dim dt" data-l="Last done">{r.last_done || '—'}{r.via && <span className="sched-via"> · via {r.via}</span>}</td>
                  <td className="dt" data-l="Next due">{r.next_due || '—'}</td>
                  <td data-l="Days left">{r.days_left == null ? '—' : r.days_left < 0 ? `${-r.days_left}d ago` : `in ${r.days_left}d`}</td>
                  <td data-l="State"><span className={schedChip(r.state)} title={SCHED_TIP[r.state]}><span className="dot" />{SCHED_LABEL[r.state]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* The editable maintenance plan — tick the cycles this asset needs (with an
   optional last-done seed for history that predates the logbook). Once a plan is
   set it is authoritative; clearing every tick returns to log-inference. */
function PlanEditor({ code, schedule, onSaved }) {
  const lastByFreq = Object.fromEntries((schedule?.rows || []).map((r) => [r.frequency, r]))
  const initial = schedule?.has_plan ? schedule.planned : (schedule?.rows || []).map((r) => r.frequency)
  const [checked, setChecked] = useState(new Set(initial))
  const [seeds, setSeeds] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)
  const toggle = (f) => setChecked((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n })

  const save = async () => {
    setBusy(true); setErr(''); setOk(false)
    try {
      const seedPayload = {}
      for (const f of checked) if (seeds[f]) seedPayload[f] = seeds[f]
      const res = await fetch(`/api/assets/${encodeURIComponent(code)}/plan`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequencies: [...checked], seeds: seedPayload }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || `HTTP ${res.status}`)
      setOk(true); onSaved?.()
    } catch (ex) {
      setErr(String(ex.message || ex).replace(/^Error: /, ''))
    } finally { setBusy(false) }
  }

  return (
    <div className="plan-editor">
      <p className="dim plan-hint">Tick the cycles this asset is due for. Last-done is read from the log — seed a date only for history from before the logbook.</p>
      <div className="plan-rows">
        {SCHED_FREQS.map((f) => {
          const on = checked.has(f)
          const r = lastByFreq[f]
          return (
            <label key={f} className={`plan-row${on ? ' on' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(f)} />
              <span className="plan-freq">{f}</span>
              {on && (
                <span className="plan-meta">
                  <span className="dim">last: {r?.last_done || '—'}{r?.via && ` · via ${r.via}`}</span>
                  <input type="date" className="plan-seed" value={seeds[f] || ''}
                         onChange={(e) => setSeeds({ ...seeds, [f]: e.target.value })}
                         title="Optional last-done baseline" placeholder="seed" />
                </span>
              )}
            </label>
          )
        })}
      </div>
      <div className="plan-actions">
        <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save plan'}</button>
        {ok && <span className="plan-ok">Saved</span>}
        {err && <span className="import-msg err">{err}</span>}
      </div>
    </div>
  )
}

/* The technical-detail editor, shared by "new asset" and "edit asset". A
   create POSTs the whole record; an edit PATCHes only the fields that moved,
   so the audit trail records real changes, not a rewrite of every field. */
const CRITICALITY = ['A', 'B', 'C']
const STATUSES = ['in_service', 'under_maintenance', 'out_of_service', 'decommissioned']

function AssetForm({ initial, mode, onDone, onCancel }) {
  const empty = {
    code: '', name: '', asset_class: '', location: '', line: '',
    system: '', make_model: '', criticality: 'B', status: 'in_service',
    commissioned_on: '', description: '', remarks: '', codal_life_years: '',
  }
  // edit maps the full asset view; create starts empty but honours a couple of
  // sensible defaults (the line the register is currently showing)
  const start = mode === 'edit' ? {
    code: initial.code, name: initial.name, asset_class: initial.cls,
    location: initial.location, line: initial.line || '', system: initial.sys || '',
    make_model: initial.makeModel || '', criticality: initial.criticality,
    status: initial.status, commissioned_on: initial.commissionedOn || '',
    description: initial.description || '', remarks: initial.remarks || '',
    codal_life_years: initial.codalLifeYears ?? '',
  } : { ...empty, line: initial?.line || '' }
  const [f, setF] = useState(start)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [classes, setClasses] = useState([])
  useEffect(() => {
    getJSON('/api/assets').then((rows) =>
      setClasses([...new Set(rows.map((r) => r.asset_class).filter(Boolean))].sort())
    ).catch(() => {})
  }, [])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const codeChanged = mode === 'edit' && f.code !== start.code

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr('')
    try {
      const payload = { ...f }
      Object.keys(payload).forEach((k) => { if (payload[k] === '') payload[k] = null })
      const url = mode === 'edit'
        ? `/api/assets/${encodeURIComponent(start.code)}`
        : '/api/assets'
      const res = await fetch(url, {
        method: mode === 'edit' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.detail || `HTTP ${res.status}`)
      }
      const saved = await res.json()
      onDone(saved.code)
    } catch (ex) {
      setErr(String(ex.message || ex).replace(/^Error: /, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="asset-form card" onSubmit={submit}>
      <datalist id="af-classes">{classes.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="af-grid">
        <label>Code<input value={f.code} onChange={set('code')} required
                          placeholder="printed on the QR tag" /></label>
        <label>Name<input value={f.name} onChange={set('name')} required /></label>
        <label>Asset class<input value={f.asset_class} onChange={set('asset_class')} required
                                 list="af-classes" /></label>
        <label>Location / station<input value={f.location} onChange={set('location')} required /></label>
        <label>Line<input value={f.line} onChange={set('line')} placeholder="e.g. Green Line" /></label>
        <label>System<input value={f.system} onChange={set('system')} placeholder="reporting rollup" /></label>
        <label>Make / model<input value={f.make_model} onChange={set('make_model')} /></label>
        <label>Commissioned on<input type="date" value={f.commissioned_on} onChange={set('commissioned_on')} /></label>
        <label>Codal life (years)<input type="number" min="0" value={f.codal_life_years}
                                        onChange={set('codal_life_years')} placeholder="e.g. 25" /></label>
        <label>Criticality<select value={f.criticality} onChange={set('criticality')}>
          {CRITICALITY.map((c) => <option key={c} value={c}>{c}</option>)}
        </select></label>
        <label>Status<select value={f.status} onChange={set('status')}>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select></label>
        <label className="af-full">Description<textarea value={f.description} rows={2}
                                    onChange={set('description')} placeholder="a fuller description of the asset" /></label>
        <label className="af-full">Remarks<textarea value={f.remarks} rows={2}
                                    onChange={set('remarks')} placeholder="free-form remarks" /></label>
      </div>
      {codeChanged && (
        <p className="af-warn">Changing the code re-keys the asset — the printed QR tag will need reprinting. History is preserved.</p>
      )}
      <div className="af-actions">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create asset'}
        </button>
        <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
        {err && <span className="import-msg err">{err}</span>}
      </div>
    </form>
  )
}

/* The register's answer to "who changed this, and from what" — the asset's
   audit trail, writers only. */
function AssetAudit({ code }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let alive = true
    getJSON(`/api/assets/${encodeURIComponent(code)}/audit`)
      .then((r) => alive && setRows(r)).catch(() => alive && setRows([]))
    return () => { alive = false }
  }, [code])
  if (!rows || rows.length === 0) return null
  return (
    <div className="sect">
      <h3>Change history — who edited this record</h3>
      {rows.map((r, i) => (
        <div className="wo" key={i}>
          <div className="row1">
            <span className={`chip ${r.action === 'created' ? 'w-done' : ''}`}>
              <span className="dot" />{r.action}
            </span>
            <span className="dim">by <b>{r.actor}</b></span>
            <span className="sub dt">{new Date(r.at).toLocaleString()}</span>
          </div>
          {r.detail && <div className="findings">{r.detail}</div>}
        </div>
      ))}
    </div>
  )
}

function LiveAssetDetail({ code }) {
  const { asset: a, history, log, loading, error, reload } = useLiveAsset(code)
  const { schedule, reloadSchedule } = useAssetSchedule(code)
  const { canWrite } = useMe()
  const [editing, setEditing] = useState(false)
  if (loading) return <p className="dim">Loading {code}…</p>
  if (error || !a) {
    return (
      <>
        <a className="crumb" href="#/">← Assets</a>
        <div className="card offline-note">
          {error && !String(error).includes('404')
            ? <>Backend unreachable — {error}.</>
            : <>No asset with code <span className="code">{code}</span> in the register.</>}
        </div>
      </>
    )
  }
  const accent = lineColor(a.line)
  const maint = log.filter((e) => e.type === 'maintenance')
  const resolvedFails = log.filter((e) => e.type === 'failure' && e.ended_at)
  const lastServiced = maint.length ? maint[0].log_date : null
  return (
    <>
      <a className="crumb" href="#/">← Assets</a>
      <div className="asset-passport" style={{ '--line-c': accent }}>
        {/* hero: the asset's identity, health and QR in one glance — the face
            of the QR-scan page a visitor or manager lands on */}
        <div className="card asset-hero">
          <span className="hero-bar" />
          <div className="hero-body">
            <div className="hero-id">
              <span className="hero-code">{a.code}</span>
              <h1 className="hero-name">{a.name}</h1>
              <div className="hero-sub">{a.cls}{a.sys ? ` · ${a.sys}` : ''}</div>
              <div className="hero-loc">
                <span className="ln-dot" style={{ background: accent }} />
                {a.line ? <b>{a.line}</b> : null}{a.line ? ' · ' : ''}{a.location} · {ORG}
              </div>
              <div className="hero-badges">
                <span className={`status-pill s-${a.status}`}><span className="dot" />{STATUS_LABEL[a.status]}</span>
                {codalExceeded(a) && (
                  <span className="codal-badge" title={`Past its ${a.codalLifeYears}-year codal life (since ${codalExpiry(a).getFullYear()})`}>
                    <span className="dot" />Exceeded service life
                  </span>
                )}
                <span className={`crit-badge c-${a.criticality}`} title="Criticality">Criticality {a.criticality}</span>
                {canWrite && !editing && (
                  <button className="btn ghost sm" type="button" onClick={() => setEditing(true)}>Edit details</button>
                )}
                <button className="btn ghost sm no-print" type="button" onClick={() => window.print()}>Print</button>
              </div>
            </div>
            <div className="hero-qr">
              <QR value={assetUrl(a.code)} size={148} />
              <div className="hint">Scan to open<br />this record</div>
            </div>
          </div>
        </div>

        {/* the passport facts — one clean labelled grid, not a crammed line */}
        <div className="asset-facts card">
          {[
            ['Location', a.location],
            ['Line', a.line || '—'],
            ['System', a.sys || '—'],
            ['Asset class', a.cls],
            ['Make / model', a.makeModel || '—'],
            ['Commissioned', a.commissionedOn || '—'],
            ['Codal life', a.codalLifeYears != null ? `${a.codalLifeYears} years${codalExceeded(a) ? ` · exceeded ${codalExpiry(a).getFullYear()}` : ''}` : '—'],
            ['Last serviced', lastServiced || '—'],
            ['Maintenance records', String(maint.length)],
          ].map(([k, v]) => (
            <div className="fact" key={k}>
              <span className="fk">{k}</span>
              <span className="fv">{v}</span>
            </div>
          ))}
          {(a.description || a.remarks) && (
            <div className="fact fact-wide">
              {a.description && <><span className="fk">Description</span><span className="fv">{a.description}</span></>}
              {a.remarks && <><span className="fk" style={{ marginTop: a.description ? 8 : 0 }}>Remarks</span><span className="fv">{a.remarks}</span></>}
            </div>
          )}
        </div>

        <div className="card"><MaintenanceSchedule schedule={schedule} /></div>

        {editing && (
          <div className="card">
            <div className="sect">
              <h3>Edit technical details</h3>
              <AssetForm initial={a} mode="edit"
                         onCancel={() => setEditing(false)}
                         onDone={(newCode) => {
                           setEditing(false)
                           if (newCode !== a.code) location.hash = `/asset/${newCode}`
                           else reload()
                         }} />
            </div>
            <div className="sect">
              <h3>Maintenance plan</h3>
              <PlanEditor code={a.code} schedule={schedule} onSaved={reloadSchedule} />
            </div>
          </div>
        )}

        <div className="card">
          <AssetLogSections log={log} staff={canWrite} code={a.code} canWrite={canWrite} />

          {history.length > 0 && (
            <div className="sect">
              <h3>Work-order history — completed jobs, newest first</h3>
              {history.map((w) => (
                <div className="wo" key={w.work_order_id}>
                  <div className="row1">
                    <span className="code">#{w.work_order_id}</span>
                    <span className="t">{w.title}</span>
                    <WoChip status={w.status} />
                  </div>
                  {w.findings && <div className="findings">{w.findings}</div>}
                  <div className="sub">
                    {w.type}
                    {w.done_by && <> · by <b>{w.done_by}</b></>}
                    {w.closed_at && <> · closed <span className="dt">{w.closed_at.slice(0, 10)}</span></>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {canWrite && <AssetAudit code={a.code} />}
        </div>
      </div>
    </>
  )
}

/* ---------- asset detail ---------- */

function AssetDetail({ code }) {
  const a = ASSETS.find((x) => x.code === code)
  if (!a) return <p>Asset not found. <a className="crumb" href="#/">← Back to assets</a></p>
  const pms = PM_SCHEDULES.filter((p) => p.asset === code)
  const wos = JOB_CARDS.filter((w) => w.asset === code)
  const specs = SPECS[code] ?? []
  return (
    <>
      <a className="crumb" href="#/">← Assets</a>
      <div className="detail-grid">
        <div className="card">
          <div className="detail-head">
            <h1><span className="code">{a.code}</span> · {a.name}</h1>
            <div className="meta">
              <span><b>{a.cls}</b></span>
              <span>{a.location} · {ORG}</span>
              <span>{a.makeModel}</span>
              <span>Commissioned <b className="dt">{a.commissioned}</b></span>
              <StatusChip status={a.status} />
            </div>
          </div>

          {specs.length > 0 && (
            <div className="sect">
              <h3>Specifications</h3>
              <dl className="specs">
                {specs.map(([k, v]) => (
                  <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
            </div>
          )}

          <div className="sect">
            <h3>Preventive maintenance</h3>
            {pms.length === 0 ? <p className="dim">No PM schedules.</p> : (
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Task</th><th>Frequency</th><th>Last done</th><th>Next due</th><th>State</th><th></th></tr></thead>
                  <tbody>
                    {pms.map((p) => (
                      <tr key={p.task} style={{ cursor: 'default' }}>
                        <td data-l="Task">{p.task}</td>
                        <td className="dim" data-l="Frequency">{p.frequency}</td>
                        <td className="dim dt" data-l="Last done">{fmtDate(p.lastDone)}</td>
                        <td className="dt" data-l="Next due">{fmtDate(p.nextDue)}</td>
                        <td data-l="State"><DueChip nextDue={p.nextDue} /></td>
                        <td className="cs-cell">
                          {(() => {
                            const rec = completedChecksheets(a.code).find((r) => r.task === p.task)
                            return rec
                              ? <a className="mini-btn" href={`#/checksheet/wo/${rec.woId}`}>Record ✓</a>
                              : <a className="mini-btn muted" href={`#/checksheet/pm/${a.code}/${encodeURIComponent(p.task)}`}>Blank sheet</a>
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="sect">
            <h3>Job cards — issued to departments / agencies</h3>
            {wos.length === 0 ? <p className="dim">No job cards.</p> : wos.map((w) => (
              <div className="wo" key={w.id}>
                <div className="row1">
                  <a className="code jc-link" href={`#/jobcard/${w.id}`}>{w.id}</a>
                  <span className="t">{w.title}</span>
                  <WoChip status={w.status} />
                  <a className="mini-btn muted" href={`#/jobcard/${w.id}`}>Job card</a>
                  {CHECKSHEET_RESULTS[w.id] && (
                    <a className="mini-btn" href={`#/checksheet/wo/${w.id}`}>Checksheet ✓</a>
                  )}
                </div>
                {w.findings && <div className="findings">{w.findings}</div>}
                <div className="sub">
                  {w.type} · opened {fmtDate(w.openedAt)}
                  {w.closedAt && <> · closed {fmtDate(w.closedAt)}</>}
                  {w.issuedTo && <> · issued to <b>{w.issuedTo}</b></>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card qr-card">
          <QR value={assetUrl(a.code)} size={180} />
          <span className="code">{a.code}</span>
          <div className="hint">Scan with any phone camera to open this asset record in the field.</div>
        </div>
      </div>
    </>
  )
}

/* ---------- monthly planner ---------- */

const FREQ_BADGE = { monthly: 'M', quarterly: 'Q', 'half-yearly': 'HY', yearly: 'Y' }

function Planner() {
  const now = new Date()
  const [ym, setYm] = useState([now.getFullYear(), now.getMonth()])
  const [year, month] = ym
  const occ = pmOccurrencesInMonth(year, month)
  const first = new Date(year, month, 1)
  const startPad = (first.getDay() + 6) % 7 // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = [...Array(startPad).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const monthName = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const isThisMonth = year === now.getFullYear() && month === now.getMonth()
  const shift = (n) => setYm(([y, m]) => { const d2 = new Date(y, m + n, 1); return [d2.getFullYear(), d2.getMonth()] })

  // the list a planner opens this page for: overdue work carried forward
  const carried = PM_SCHEDULES
    .map((p) => ({ ...p, over: -Math.ceil((p.nextDue - now) / 86400000) }))
    .filter((p) => p.over > 0)
    .sort((a, b) => b.over - a.over)

  const monthItems = Object.values(occ).flat()
  const busiest = Object.entries(occ).sort((a, b) => b[1].length - a[1].length)[0]

  return (
    <>
      <div className="plan-bar">
        <h2 style={{ margin: 0 }}>Maintenance planner</h2>
        <div className="plan-nav">
          <button className="pbtn" onClick={() => shift(-1)} aria-label="Previous month">←</button>
          <span className="plan-month dt">{monthName}</span>
          <button className="pbtn" onClick={() => shift(1)} aria-label="Next month">→</button>
        </div>
      </div>

      {carried.length > 0 && (
        <div className="plan-carry">
          <span className="plan-carry-t">⚠ Carried forward — overdue</span>
          {carried.map((p) => (
            <a key={p.asset + p.task} href={`#/asset/${p.asset}`} className="plan-carry-item">
              <b className="code">{p.asset}</b> {p.task} <span className="pc-days">{p.over}d</span>
            </a>
          ))}
        </div>
      )}

      <p className="plan-sum">
        <b>{monthItems.length}</b> scheduled task{monthItems.length !== 1 ? 's' : ''} in {monthName.split(' ')[0]}
        {busiest && busiest[1].length > 1 && <> · busiest day <b className="dt">{String(busiest[0]).padStart(2, '0')} {monthName.split(' ')[0]}</b> ({busiest[1].length} tasks)</>}
        {isThisMonth && carried.length > 0 && <> · <span className="pc-red">{carried.length} overdue carried forward</span></>}
      </p>
      <div className="card cal">
        <div className="cal-head">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d2) => <div key={d2}>{d2}</div>)}
        </div>
        <div className="cal-grid">
          {cells.map((dayNum, i) => {
            if (dayNum === null) return <div key={`p${i}`} className="cal-cell pad" />
            const items = occ[dayNum] ?? []
            const isToday = isThisMonth && dayNum === now.getDate()
            return (
              <div key={dayNum} className={`cal-cell${isToday ? ' today' : ''}`}>
                <span className="cal-day dt">{dayNum}</span>
                {items.map((p, j) => {
                  const overdue = p.due < now && !(p.due.toDateString() === now.toDateString())
                  return (
                    <a key={j} href={`#/asset/${p.asset}`} className={`cal-item${overdue ? ' late' : ''}`}
                       title={`${p.asset} — ${p.task} (${p.frequency})`}>
                      <i className="cal-freq">{FREQ_BADGE[p.frequency]}</i> <b>{p.asset}</b> <span className="cal-task">{p.task}</span>
                    </a>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <p className="roadmap">Planned dates are projected from each task's frequency (M / Q / HY / Y). Red = overdue. Click a task to open the asset.</p>
    </>
  )
}

/* ---------- failures & recovery: analysis dashboard ---------- */

function TrendChart({ data, compact }) {
  // compact (single-row analytics) uses a taller aspect so the bars fill the
  // card instead of hugging the top; the wide 2-col demo keeps the short aspect.
  const W = 560, H = compact ? 320 : 170, PAD = { t: 18, r: 8, b: 24, l: 8 }
  const max = Math.max(...data.map((m) => m.count), 1)
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const bw = Math.min(34, (iw / data.length) * 0.5)
  const x = (i) => PAD.l + (iw / data.length) * (i + 0.5)
  const y = (v) => PAD.t + ih * (1 - v / max)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz" role="img" aria-label="Failures per month">
      {[...Array(max + 1)].map((_, g) => (
        <line key={g} x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} className="viz-grid" />
      ))}
      {data.map((m, i) => (
        <g key={m.label}>
          {m.count > 0 && (
            <>
              <rect x={x(i) - bw / 2} y={y(m.count)} width={bw} height={ih - (y(m.count) - PAD.t) + 0.5}
                    rx={0} className="viz-bar-base" />
              <rect x={x(i) - bw / 2} y={y(m.count)} width={bw} height={Math.min(8, ih * (m.count / max))}
                    rx={4} className="viz-bar-cap" />
              <text x={x(i)} y={y(m.count) - 6} className="viz-val" textAnchor="middle">{m.count}</text>
            </>
          )}
          {m.count === 0 && <circle cx={x(i)} cy={y(0)} r={2} className="viz-zero" />}
          <text x={x(i)} y={H - 6} className="viz-cat" textAnchor="middle">{m.label}</text>
        </g>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="viz-axis" />
    </svg>
  )
}

function HBar({ rows, unit, seq }) {
  const max = rows[0]?.[1] ?? 1
  return (
    <div className="hbars">
      {rows.map(([label, v], i) => (
        <div className="bar-row" key={label}>
          <span className="bar-label" title={label}>{label}</span>
          <span className="bar-track">
            <span className={`bar-fill${seq ? ` seq-${Math.min(3, i)}` : ''}`} style={{ width: `${Math.max((v / max) * 100, 2)}%` }} />
          </span>
          <span className="bar-val dt">{v}{unit}</span>
        </div>
      ))}
    </div>
  )
}

function Failures() {
  const s = failureStats(90)
  const trend = failuresByMonth(6)
  const classes = classCountsAll()
  const downtime = downtimeByAsset().slice(0, 5)
  const rec = recoveryStatus()
  const recPct = Math.round((rec.restored / (rec.restored + rec.ongoing)) * 100)

  // computed insights, not decoration
  const worstClass = classes[0]
  const worstAsset = downtime[0]
  const prev3 = trend.slice(0, 3).reduce((a, m) => a + m.count, 0)
  const last3 = trend.slice(3).reduce((a, m) => a + m.count, 0)
  const dir = last3 < prev3 ? 'down' : last3 > prev3 ? 'up' : 'flat'

  return (
    <>
      <div className="kpis">
        <div className="tile"><div className="v">{s.total}</div><div className="k">Failures — last 90 days</div></div>
        <div className={s.ongoing ? 'tile alert' : 'tile'}><div className="v">{s.ongoing}</div><div className="k">Ongoing breakdowns</div></div>
        <div className="tile"><div className="v">{s.downtime} h</div><div className="k">Downtime — 90 days</div></div>
        <div className="tile"><div className="v">{s.mttr} h</div><div className="k">Mean time to recover</div></div>
        <div className="tile"><div className="v">{recPct}%</div><div className="k">Recovery rate — 6 months</div></div>
      </div>

      <div className="viz-grid2">
        <section className="card viz-card">
          <h2 className="viz-h">Failures per month <span className="viz-note">last 6 months</span></h2>
          <TrendChart data={trend} />
          <p className="viz-insight">
            {dir === 'down' && <>Trend improving — {last3} failures in the last 3 months vs {prev3} in the previous 3.</>}
            {dir === 'up' && <>Trend worsening — {last3} failures in the last 3 months vs {prev3} in the previous 3.</>}
            {dir === 'flat' && <>Steady — {last3} failures in each of the last two quarters.</>}
          </p>
        </section>

        <section className="card viz-card">
          <h2 className="viz-h">Recovery status <span className="viz-note">6 months</span></h2>
          <div className="meter" role="img" aria-label={`${rec.restored} restored, ${rec.ongoing} ongoing`}>
            <span className="meter-fill" style={{ width: `${recPct}%` }} />
          </div>
          <div className="meter-legend">
            <span><span className="lg-dot lg-restored" />Restored · {rec.restored}</span>
            <span><span className="lg-dot lg-ongoing" />Ongoing · {rec.ongoing}</span>
          </div>
          <p className="viz-insight">
            {rec.ongoing === 0
              ? 'All recorded failures stand restored.'
              : `${rec.ongoing} breakdown${rec.ongoing > 1 ? 's' : ''} still open — oldest: ${FAILURES.filter((f) => !f.restored).map((f) => f.asset).join(', ')}.`}
          </p>
        </section>

        <section className="card viz-card">
          <h2 className="viz-h">Failures by system <span className="viz-note">6 months</span></h2>
          <HBar rows={classes} unit="" />
          <p className="viz-insight">{worstClass[0]} leads with {worstClass[1]} failures — focus area for the next PM review.</p>
        </section>

        <section className="card viz-card">
          <h2 className="viz-h">Downtime by asset <span className="viz-note">top 5 · hours</span></h2>
          <HBar rows={downtime} unit=" h" seq />
          <p className="viz-insight">{worstAsset[0]} accounts for {worstAsset[1]} h — the availability bottleneck.</p>
        </section>
      </div>

      <h2>Failure &amp; recovery log</h2>
      <div className="card tbl-wrap">
        <table>
          <thead><tr><th>ID</th><th>Asset</th><th>Occurred</th><th>Restored</th><th>Downtime</th><th>State</th><th>Cause → remedy</th></tr></thead>
          <tbody>
            {FAILURES.map((f) => (
              <tr key={f.id} tabIndex={0} onClick={() => { location.hash = `/asset/${f.asset}` }}
                  onKeyDown={(e) => e.key === 'Enter' && (location.hash = `/asset/${f.asset}`)}>
                <td className="code" data-l="ID">{f.id}</td>
                <td className="code" data-l="Asset">{f.asset}</td>
                <td className="dim dt" data-l="Occurred">{fmtDate(f.started)} {fmtTime(f.started)}</td>
                <td className="dim dt" data-l="Restored">{f.restored ? `${fmtDate(f.restored)} ${fmtTime(f.restored)}` : '—'}</td>
                <td className="dt" data-l="Downtime">{durationHrs(f)} h</td>
                <td data-l="State">{f.restored
                  ? <span className="chip w-done"><span className="dot" />Restored</span>
                  : <span className="chip d-overdue"><span className="dot" />Ongoing</span>}</td>
                <td className="wrap-cell" data-l="Cause">{f.cause} <span className="dim">→ {f.remedy}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ---------- failures: live KPI surface over the one ledger ---------- */

/* Reads failure entries straight from the logbook — no second table, no
   pre-aggregation. The tiles answer the three questions a section head asks
   at a glance: how often, how long down, and what is still open. */
/* Imported history runs to Feb 2026 while the calendar says July, so a 90-day
   default would open the page on an empty window and read as broken. Default
   to the whole record and let the user narrow. */
const FAIL_PERIODS = [
  ['All time', 36500, 12],
  ['Last 12 months', 365, 12],
  ['Last 90 days', 90, 6],
  ['Last 30 days', 30, 3],
]

function LiveFailures({ line = '' }) {
  const { canWrite, me, loading: meLoading } = useMe()
  // anonymous (walk-up) sees the summary + charts only; the row-level table
  // (crew, fault text) stays behind sign-in.
  const anon = LIVE && me?.auth_enabled && me?.username === 'viewer'
  const [stats, setStats] = useState(null)
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const [cls, setCls] = usePersistedState('fail.class', '')
  const [q, setQ] = useState('')
  const [state, setState] = usePersistedState('fail.state', 'open')   // tab: 'open' | 'resolved'
  const [period, setPeriod] = usePersistedState('fail.period', 0)
  const [showViz, setShowViz] = usePersistedState('fail.showViz', true)  // analytics charts, collapsible
  const toolbarRef = useRef(null)
  useEffect(() => {
    const setVars = () => { const tb = document.querySelector('.topbar'); if (tb) document.documentElement.style.setProperty('--topbar-h', `${tb.offsetHeight}px`) }
    setVars(); window.addEventListener('resize', setVars); return () => window.removeEventListener('resize', setVars)
  })

  const [periodLabel, days, months] = FAIL_PERIODS[period]

  useEffect(() => {
    // wait for the session to resolve — firing while `me` is still loading
    // would read anon=false and hit the signed-in-only list, 401-ing a walk-up
    if (meLoading) return undefined
    let alive = true
    setStats(null); setError(null)
    const lq = line ? `&line=${encodeURIComponent(line)}` : ''
    // stats are public; the row-level list is signed-in only
    const jobs = [getJSON(`/api/logbook/failure-stats?days=${days}&months=${months}${lq}`)]
    if (!anon) jobs.push(getJSON(`/api/logbook?entry_type=failure&limit=5000${lq}`))
    Promise.all(jobs)
      .then(([s, l]) => { if (alive) { setStats(s); setRows(l || []) } })
      .catch((e) => alive && setError(String(e)))
    return () => { alive = false }
  }, [days, months, anon, line, meLoading])

  if (error) return <div className="card offline-note">Backend unreachable — {error}.</div>
  if (!stats) return <p className="dim">Loading failure record…</p>

  const trend = stats.per_month.map((m) => ({
    label: new Date(`${m.month}-01T00:00:00`).toLocaleString(undefined, { month: 'short' }),
    count: m.count,
  }))
  const prev3 = trend.slice(0, 3).reduce((a, m) => a + m.count, 0)
  const last3 = trend.slice(3).reduce((a, m) => a + m.count, 0)
  const dir = last3 < prev3 ? 'down' : last3 > prev3 ? 'up' : 'flat'
  const asRows = (a) => a.map((c) => [c.name, c.count])

  // three tabs by lifecycle: open (nothing done) · acknowledged (noted, not
  // fixed) · resolved (rectified). The row's `state` comes from the API.
  const ql = q.trim().toLowerCase()
  const match = (r) => (!cls || (r.category || 'Unclassified') === cls)
    && (!ql || [r.asset_code, r.text, r.fault_type, r.attended_by, r.category].some((v) => (v || '').toLowerCase().includes(ql)))
  const openRows = rows.filter((r) => r.state === 'open' && match(r))
  const ackRows = rows.filter((r) => r.state === 'acknowledged' && match(r))
  const jobRows = rows.filter((r) => r.state === 'job_card' && match(r))
  const resolvedRows = rows.filter((r) => r.state === 'resolved' && match(r))
  const shown = state === 'open' ? openRows : state === 'acknowledged' ? ackRows
    : state === 'job_card' ? jobRows : resolvedRows

  const exportCsv = () => {
    const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const head = ['asset', 'class', 'occurred', 'restored', 'down_hours', 'state', 'team', 'fault_type', 'what_happened']
    const body = shown.map((f) => [f.asset_code || '', f.category || '', f.log_date,
      f.ended_at ? (f.ended_at.slice(11, 16) === '00:00' ? f.ended_at.slice(0, 10) : f.ended_at.slice(0, 16).replace('T', ' ')) : '',
      f.down_hours ?? '', !f.asset_code ? 'unlinked' : f.ended_at ? 'restored' : 'open',
      f.attended_by || f.entered_by || '', f.fault_type || '', tidyLog(f.text)].map(cell).join(','))
    const csv = [head.join(','), ...body].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url
    a.download = `amps-failures-${state}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="asset-toolbar" ref={toolbarRef}>
        {!anon && <input className="asset-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Search failures — asset, fault, crew…" aria-label="Search failures" />}
        {!anon && (
          <div className="asset-filter" role="tablist" aria-label="Failure state">
            <button type="button" className={`btn preset ${state === 'open' ? 'active' : ''}${openRows.length ? ' has-od' : ''}`}
                    onClick={() => setState('open')}>Open {openRows.length}</button>
            <button type="button" className={`btn preset ${state === 'acknowledged' ? 'active' : ''}${ackRows.length ? ' has-ack' : ''}`}
                    onClick={() => setState('acknowledged')}>Acknowledged {ackRows.length}</button>
            <button type="button" className={`btn preset ${state === 'job_card' ? 'active' : ''}${jobRows.length ? ' has-job' : ''}`}
                    onClick={() => setState('job_card')}>Job card {jobRows.length}</button>
            <button type="button" className={`btn preset ${state === 'resolved' ? 'active' : ''}`}
                    onClick={() => setState('resolved')}>Resolved {resolvedRows.length}</button>
          </div>
        )}
        <select value={period} onChange={(e) => setPeriod(Number(e.target.value))} aria-label="Period">
          {FAIL_PERIODS.map(([lbl], i) => <option key={lbl} value={i}>{lbl}</option>)}
        </select>
        <select value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Filter by class">
          <option value="">All classes</option>
          {stats.by_class.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        {!anon && (q || cls) && <button type="button" className="btn ghost sm" onClick={() => { setQ(''); setCls('') }}>Clear</button>}
        {!anon && <span className="asset-count">{shown.length} shown</span>}
        {anon && <span className="asset-count">Public summary · sign in for records</span>}
        {!anon && (
          <div className="asset-actions">
            <button type="button" className="icon-btn" title="Download the failures in view (CSV)"
                    aria-label="Download failures" onClick={exportCsv} disabled={!shown.length}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2.4v7.2M4.8 6.6 8 9.8l3.2-3.2M3 12.8h10" /></svg>
            </button>
            <button type="button" className="icon-btn" title="Print" aria-label="Print" onClick={() => window.print()}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 6V2.5h7V6M4.5 12H3.2V6.4h9.6V12H11.5M4.5 9.6h7V13.5h-7z" /></svg>
            </button>
          </div>
        )}
      </div>

      <div className="kpis kpis-slim">
        <div className="tile"><div className="v">{stats.total}</div>
          <div className="k">Failures — {periodLabel.toLowerCase()}</div></div>
        <div className={stats.open ? 'tile alert' : 'tile'}><div className="v">{stats.open}</div>
          <div className="k">Open breakdowns</div></div>
        <div className="tile"><div className="v">{stats.measured ? `${stats.downtime_hours} h` : '—'}</div>
          <div className="k">Downtime{stats.measured ? ` · ${stats.measured} timed` : ' — none timed'}</div></div>
        <div className="tile"><div className="v">{stats.mttr_hours != null ? `${stats.mttr_hours} h` : '—'}</div>
          <div className="k">{stats.mttr_hours != null ? `MTTR · ${stats.measured} of ${stats.closed}` : 'MTTR — needs clock times'}</div></div>
        <div className={stats.unlinked ? 'tile warn' : 'tile'}><div className="v">{stats.unlinked}</div>
          <div className="k">Unlinked records</div></div>
      </div>

      <button type="button" className="viz-toggle" onClick={() => setShowViz((v) => !v)} aria-expanded={showViz}>
        <span className={`chev${showViz ? ' open' : ''}`}>▸</span> Analytics
        <span className="dim">· trend, by class, fault types, repeat offenders</span>
      </button>

      {showViz && (
        <div className="viz-grid2 viz-compact">
          <section className="card viz-card">
            <h2 className="viz-h">Failures per month <span className="viz-note">last {months} months</span></h2>
            <TrendChart data={trend} compact />
            <p className="viz-insight">
              {dir === 'down' && <>Improving — {last3} in the last 3 months vs {prev3} in the previous 3.</>}
              {dir === 'up' && <>Worsening — {last3} in the last 3 months vs {prev3} in the previous 3.</>}
              {dir === 'flat' && <>Steady — {last3} in each of the last two quarters.</>}
            </p>
          </section>

          <section className="card viz-card">
            <h2 className="viz-h">By asset class <span className="viz-note">{periodLabel.toLowerCase()}</span></h2>
            {stats.by_class.length === 0 ? <p className="dim">Nothing in this window.</p> : <>
              <HBar rows={asRows(stats.by_class)} unit="" />
              <p className="viz-insight">{stats.by_class[0].name} leads with {stats.by_class[0].count} — focus for the next PM review.</p>
            </>}
          </section>

          <section className="card viz-card">
            <h2 className="viz-h">Fault types <span className="viz-note">{periodLabel.toLowerCase()}</span></h2>
            {stats.by_fault.length === 0
              ? <p className="dim">No fault types classified in this window.</p>
              : <HBar rows={asRows(stats.by_fault)} unit="" seq />}
          </section>

          <section className="card viz-card">
            <h2 className="viz-h">Repeat offenders <span className="viz-note">most failures</span></h2>
            {stats.by_asset.length === 0
              ? <p className="dim">Nothing in this window.</p>
              : <>
                  <HBar rows={asRows(stats.by_asset)} unit="" seq />
                  <p className="viz-insight">{stats.by_asset[0].name} has failed {stats.by_asset[0].count} times — worth a condition review.</p>
                </>}
          </section>
        </div>
      )}

      {anon ? (
        <div className="card"><p className="dim" style={{ margin: 0 }}>
          The failure summary above is public. <a className="crumb" href="#/login">Sign in</a> to view the individual failure records (asset, fault, crew and recovery detail).
        </p></div>
      ) : (
      <>
      <h2 className="fail-log-h">{{ open: 'Open failures', acknowledged: 'Acknowledged failures', job_card: 'Job card issued', resolved: 'Resolved failures' }[state]} <span className="dim" style={{ fontWeight: 400, fontSize: 15 }}>· {shown.length}</span></h2>
      <div className="card tbl-wrap">
        <table>
          <thead><tr><th>Asset</th><th>Class</th><th>Occurred</th><th>Restored</th><th>Down</th><th>State</th><th>Team</th><th>Fault → what happened</th>{canWrite && <th aria-label="Edit"></th>}</tr></thead>
          <tbody>
            {shown.map((f) => (
              <tr key={f.id} tabIndex={0}
                  onClick={() => f.asset_code && (location.hash = `/asset/${f.asset_code}`)}
                  onKeyDown={(e) => e.key === 'Enter' && f.asset_code && (location.hash = `/asset/${f.asset_code}`)}>
                <td className="code" data-l="Asset">{f.asset_code || '—'}</td>
                <td className="dim" data-l="Class">{f.category || '—'}</td>
                <td className="dim dt" data-l="Occurred">{f.log_date}</td>
                {/* midnight means no clock time was recorded — show the date alone
                    rather than an invented 00:00 (same rule as the log book) */}
                <td className="dim dt" data-l="Restored">{f.ended_at
                  ? (f.ended_at.slice(11, 16) === '00:00'
                      ? f.ended_at.slice(0, 10)
                      : f.ended_at.slice(0, 16).replace('T', ' '))
                  : '—'}</td>
                <td className="dt" data-l="Down">{f.down_hours != null ? `${f.down_hours} h` : '—'}</td>
                <td data-l="State">{!f.asset_code
                  ? <span className="chip"><span className="dot" />Unlinked</span>
                  : <span className={`chip ${FAIL_STATE_CHIP[f.state] || 'd-overdue'}`}><span className="dot" />{FAIL_STATE_LABEL[f.state] || 'open'}</span>}</td>
                <td className="dim" data-l="Team">{f.attended_by || f.entered_by || '—'}</td>
                <td className="wrap-cell" data-l="Fault">
                  {f.fault_type && <b>{f.fault_type} </b>}{f.text}
                </td>
                {canWrite && (
                  <td className="td-edit" data-l="Edit">
                    <EditLink id={f.id} date={f.log_date}
                              label={f.ended_at ? 'Edit in log book' : 'Resolve / link in log book'} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="dim" style={{ padding: '1rem' }}>Nothing matches this filter.</p>}
      </div>
      </>
      )}
    </>
  )
}

/* ---------- spares & stock ---------- */

function Spares() {
  const s = spareStats()
  const prStage = (id) => PROCUREMENTS.find((p) => p.id === id)?.stage
  return (
    <>
      <div className="kpis">
        <div className="tile"><div className="v">{s.items}</div><div className="k">Spare line items</div></div>
        <div className={s.below ? 'tile alert' : 'tile'}><div className="v">{s.below}</div><div className="k">Below minimum stock</div></div>
        <div className={s.uncovered ? 'tile warn' : 'tile'}><div className="v">{s.uncovered}</div><div className="k">Below min, no PR raised</div></div>
      </div>

      <h2>Important spares</h2>
      <div className="card tbl-wrap">
        <table>
          <thead><tr><th>Code</th><th>Spare</th><th>For class</th><th>Store / bin</th><th>Stock</th><th>Min</th><th>Status</th><th>Linked PR</th></tr></thead>
          <tbody>
            {SPARES.map((sp) => {
              const low = sp.qty < sp.min
              return (
                <tr key={sp.code} style={{ cursor: 'default' }} className={low ? 'row-low' : ''}>
                  <td className="code" data-l="Code">{sp.code}</td>
                  <td data-l="Spare">{sp.name}</td>
                  <td className="dim" data-l="For class">{sp.cls}</td>
                  <td className="dim" data-l="Store / bin">{sp.bin}</td>
                  <td className="dt" data-l="Stock"><b>{sp.qty}</b> {sp.unit}</td>
                  <td className="dim dt" data-l="Min">{sp.min} {sp.unit}</td>
                  <td data-l="Status">{low
                    ? <span className="chip d-overdue"><span className="dot" />Below min</span>
                    : <span className="chip w-done"><span className="dot" />In stock</span>}</td>
                  <td data-l="Linked PR">{sp.pr
                    ? <a className="pr-link" href="#/procurement"><span className="code">{sp.pr}</span> <StageChip stage={prStage(sp.pr)} /></a>
                    : <span className="dim">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="roadmap">
        Minimum levels per OEM recommended-spares lists. Items below minimum with no PR are the
        action list — raise a proposal from the Procurement tab.
      </p>
    </>
  )
}

/* ---------- procurement ---------- */

function Procurement() {
  return (
    <>
      <h2>Procurement tracker</h2>
      <div className="card tbl-wrap">
        <table>
          <thead><tr><th>PR no.</th><th>Item</th><th>Qty</th><th>For asset</th><th>Stage</th><th>Est. cost</th><th>Requested</th><th></th></tr></thead>
          <tbody>
            {PROCUREMENTS.map((p) => (
              <tr key={p.id} style={{ cursor: 'default' }}>
                <td className="code" data-l="PR no.">{p.id}</td>
                <td className="wrap-cell" data-l="Item">{p.item}<div className="sub-note">{p.note}</div></td>
                <td className="dim" data-l="Qty">{p.qty}</td>
                <td className="code" data-l="For asset">{p.asset}</td>
                <td data-l="Stage"><StageChip stage={p.stage} /></td>
                <td className="dim dt" data-l="Est. cost">{p.cost}</td>
                <td className="dim dt" data-l="Requested">{fmtDate(p.requested)}</td>
                <td><a className="mini-btn" href={`#/procurement/${p.id}/letter`}>Draft letter</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="stage-legend">
        {PROC_STAGES.map((st) => <StageChip key={st} stage={st} />)}
      </div>
      <p className="roadmap">Tracking + proposal drafting only — approvals and purchase orders stay with the existing office process.</p>
    </>
  )
}

function ProposalLetter({ prId }) {
  const p = PROCUREMENTS.find((x) => x.id === prId)
  if (!p) return <p>Not found. <a className="crumb" href="#/procurement">← Procurement</a></p>
  const a = ASSETS.find((x) => x.code === p.asset)
  const f = p.failure ? FAILURES.find((x) => x.id === p.failure) : null
  return (
    <>
      <div className="sheet-bar">
        <a className="crumb" style={{ margin: 0 }} href="#/procurement">← Procurement</a>
        <button className="btn" onClick={() => window.print()}>Print letter</button>
        <p>Auto-drafted from the asset record — edit after export as needed.</p>
      </div>
      <div className="card letter">
        <p className="l-right dt">Ref: AMPS/{p.id}<br />Date: {fmtDate(new Date())}</p>
        <p>To,<br />The Senior Manager (Procurement)<br />{ORG}</p>
        <p className="l-sub"><b>Subject: Proposal for procurement of {p.item} — {p.qty}</b></p>
        <p>Respected Sir,</p>
        <p>
          It is proposed to procure <b>{p.item}</b> ({p.qty}) for <b>{p.asset} — {a?.name}</b> installed
          at {a?.location}, {ORG}.
        </p>
        {f && (
          <p>
            The requirement arises from breakdown <b>{f.id}</b> dated {fmtDate(f.started)} ({f.cause.toLowerCase()}),
            with downtime of {durationHrs(f)} hours{f.restored ? '' : ' and still continuing'}. Early procurement is
            requested to restore normal operation and to hold one unit as critical spare.
          </p>
        )}
        {!f && <p>{p.note} The item is required to maintain preventive-maintenance readiness for this equipment.</p>}
        {p.cost !== '—' && <p>Estimated cost: <b>{p.cost}</b>.</p>}
        <p>Submitted for your kind approval, please.</p>
        <p className="l-sign">Yours faithfully,<br /><br />Power Supply &amp; E&amp;M Maintenance<br />{ORG}</p>
      </div>
    </>
  )
}

/* ---------- job card (official document) ---------- */

function JobCard({ jcId }) {
  const w = JOB_CARDS.find((x) => x.id === jcId)
  if (!w) return <p>Job card not found. <a className="crumb" href="#/">← Assets</a></p>
  const asset = ASSETS.find((x) => x.code === w.asset)
  const done = w.status === 'done' || w.status === 'verified'
  const cs = CHECKSHEET_RESULTS[w.id]
  return (
    <>
      <div className="sheet-bar">
        <a className="crumb" style={{ margin: 0 }} href={`#/asset/${asset.code}`}>← {asset.code}</a>
        <button className="btn" onClick={() => window.print()}>Print job card</button>
        <p>{done ? 'Completed — returned with technician acknowledgement.' : 'Issued copy — hand over to the executing department / agency.'}</p>
      </div>

      <div className="osheet">
        <div className="os-top">
          <div className="os-brand">
            <div className="os-org"><span className="brand-name">AMPS</span></div>
            <div className="os-dept">Power Supply &amp; E&amp;M Maintenance<br />{ORG}</div>
          </div>
          <div className="os-title">
            <div className="os-t1">Job Card</div>
            <div className="os-t2">{w.title}</div>
          </div>
          <div className="os-qr">
            <QR value={assetUrl(asset.code)} size={72} />
            <div className="os-qr-cap">Scan for asset history</div>
          </div>
        </div>

        <div className="os-doc">
          <span>Job card no.: <b className="code">{w.id}</b> · Format AMPS/JC-01 · Rev 00</span>
          <span>{done ? <b className="os-locked">Status: COMPLETED · LOCKED 🔒</b> : `Status: ${w.status.toUpperCase()}`}</span>
          <span>Page 1 of 1</span>
        </div>

        <table className="os-details">
          <tbody>
            <tr>
              <td><label>Asset code</label><b className="code">{w.asset}</b></td>
              <td><label>Asset</label>{asset.name}</td>
              <td><label>Location</label>{asset.location}</td>
              <td><label>Job type</label>{cap(w.type)}</td>
            </tr>
            <tr>
              <td><label>Issued to</label>{w.issuedTo}</td>
              <td><label>Date of issue</label>{fmtDate(w.openedAt)}</td>
              <td><label>Date of completion</label>{w.closedAt ? fmtDate(w.closedAt) : ''}</td>
              <td><label>Enclosures</label>{(() => {
                const docs = w.docs ?? []
                if (!cs && docs.length === 0) return <span className="dim">— none on file —</span>
                return <span>
                  {cs && <a href={`#/checksheet/wo/${w.id}`} className="jc-encl">Dept. checksheet ✓</a>}
                  {docs.map((d2, i) => <span key={i}>{(cs || i > 0) && ' · '}{d2}</span>)}
                </span>
              })()}</td>
            </tr>
          </tbody>
        </table>

        <div className="os-remarks">
          <label>Job details / work required</label>
          <p>{w.desc}</p>
        </div>

        <div className="os-remarks" style={{ borderTop: '1px solid #a8a29e' }}>
          <label>Completion report / findings</label>
          {w.findings ? <p>{w.findings}</p> : <><span className="os-rule" /><span className="os-rule" /></>}
        </div>

        <table className="os-signs">
          <tbody>
            <tr>
              <td>
                <span className="os-sign-space">Sr. Engineer (E)</span>
                <label>Issued by</label>
                <span className="os-date">Date: {fmtDate(w.openedAt)}</span>
              </td>
              <td>
                <span className="os-sign-space">{done ? w.ackBy : ''}</span>
                <label>Executed &amp; acknowledged by (agency)</label>
                <span className="os-date">Date: {w.closedAt ? fmtDate(w.closedAt) : '__________'}</span>
              </td>
              <td>
                <span className="os-sign-space">{w.status === 'verified' ? 'R. Das (Supervisor)' : ''}</span>
                <label>Verified by</label>
                <span className="os-date">Date: {w.status === 'verified' ? fmtDate(w.closedAt) : '__________'}</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="os-foot">
          Generated by AMPS — Asset Maintenance &amp; Preventive Scheduling · Format AMPS/JC-01 Rev 00
        </div>
      </div>

      {done && <p className="roadmap">🔒 Completed job cards are locked with their enclosures. Agency reports and bills come in the agency's own format and are filed as submitted — only the departmental checksheet follows the AMPS format.</p>}
    </>
  )
}

/* ---------- maintenance checksheet ---------- */

function Checksheet({ kind, a1, a2 }) {
  const [draft, setDraft] = useState({})
  const setReading = (i, v) => setDraft((d) => ({ ...d, [i]: { ...d[i], v } }))
  const toggleOk = (i) => setDraft((d) => ({ ...d, [i]: { ...d[i], ok: !d[i]?.ok } }))
  // kind 'wo': a1 = WO id (filled) · kind 'pm': a1 = asset code, a2 = task (blank)
  let asset, task, filled = null, wo = null
  if (kind === 'wo') {
    filled = CHECKSHEET_RESULTS[a1]
    wo = JOB_CARDS.find((w) => w.id === a1)
    if (!filled || !wo) return <p>Checksheet not found. <a className="crumb" href="#/">← Assets</a></p>
    task = filled.task
    asset = ASSETS.find((x) => x.code === wo.asset)
  } else {
    asset = ASSETS.find((x) => x.code === a1)
    task = decodeURIComponent(a2)
    if (!asset) return <p>Asset not found. <a className="crumb" href="#/">← Assets</a></p>
  }
  const items = checksheetFor(task)
  const pm = PM_SCHEDULES.find((p) => p.asset === asset.code && p.task === task)
  const fmtNo = String(Object.keys(CHECKSHEET_TEMPLATES).indexOf(task) + 1 || 0).padStart(2, '0')

  return (
    <>
      <div className="sheet-bar">
        <a className="crumb" style={{ margin: 0 }} href={`#/asset/${asset.code}`}>← {asset.code}</a>
        <button className="btn" onClick={() => window.print()}>Print checksheet</button>
        <p>{filled ? 'Completed record — as verified on the job card.' : 'Blank sheet — print, fill in the field, and file against the job card.'}</p>
      </div>

      <div className="osheet">
        <div className="os-top">
          <div className="os-brand">
            <div className="os-org"><span className="brand-name">AMPS</span></div>
            <div className="os-dept">Power Supply &amp; E&amp;M Maintenance<br />{ORG}</div>
          </div>
          <div className="os-title">
            <div className="os-t1">Preventive Maintenance Checksheet</div>
            <div className="os-t2">{task}</div>
          </div>
          <div className="os-qr">
            <QR value={assetUrl(asset.code)} size={72} />
            <div className="os-qr-cap">Scan for asset history</div>
          </div>
        </div>

        <div className="os-doc">
          <span>Format No.: AMPS/CS-{fmtNo} · Rev 00</span>
          <span>{filled ? <b className="os-locked">Record: COMPLETED · LOCKED 🔒</b> : 'Record: TO BE FILLED'}</span>
          <span>Page 1 of 1</span>
        </div>

        <table className="os-details">
          <tbody>
            <tr>
              <td><label>Asset code</label><b className="code">{asset.code}</b></td>
              <td><label>Asset</label>{asset.name}</td>
              <td><label>Location</label>{asset.location}</td>
              <td><label>Make / model</label>{asset.makeModel}</td>
            </tr>
            <tr>
              <td><label>Frequency</label>{pm ? pm.frequency : '—'}</td>
              <td><label>Job card ref.</label>{filled && wo ? wo.id : ''}</td>
              <td><label>Date of maintenance</label>{filled && wo ? fmtDate(wo.closedAt) : ''}</td>
              <td><label>Next due</label>{pm ? fmtDate(pm.nextDue) : '—'}</td>
            </tr>
          </tbody>
        </table>

        <table className="os-items">
          <thead>
            <tr><th style={{ width: 34 }}>Sl.</th><th>Check item</th><th style={{ width: 160 }}>Acceptance limit</th><th style={{ width: 150 }}>Reading / result</th><th style={{ width: 52 }}>OK</th></tr>
          </thead>
          <tbody>
            {items.map(([item, limit], i) => (
              <tr key={i}>
                <td className="dt os-c">{i + 1}</td>
                <td>{item}</td>
                <td>{limit}</td>
                <td className="dt os-c">{filled
                  ? <b>{filled.readings[i] ?? '—'}</b>
                  : <input className="os-input" value={draft[i]?.v ?? ''} onChange={(e) => setReading(i, e.target.value)} aria-label={`Reading for ${item}`} />}</td>
                <td className="os-c">{filled
                  ? <span className="cs-ok">✓</span>
                  : <button type="button" className={`cs-box${draft[i]?.ok ? ' ticked' : ''}`} onClick={() => toggleOk(i)} aria-label={`Mark ${item} OK`}>{draft[i]?.ok ? '✓' : ''}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="os-remarks">
          <label>Remarks</label>
          {filled && wo?.findings ? <p>{wo.findings}</p> : <><span className="os-rule" /><span className="os-rule" /></>}
        </div>

        <table className="os-signs">
          <tbody>
            <tr>
              <td>
                <span className="os-sign-space">{filled?.doneBy}</span>
                <label>Done by (Technician)</label>
                <span className="os-date">Date: {filled && wo ? fmtDate(wo.closedAt) : '__________'}</span>
              </td>
              <td>
                <span className="os-sign-space">{filled?.checkedBy}</span>
                <label>Checked by (Supervisor)</label>
                <span className="os-date">Date: {filled && wo ? fmtDate(wo.closedAt) : '__________'}</span>
              </td>
              <td>
                <span className="os-sign-space">{filled?.approvedBy}</span>
                <label>Approved by</label>
                <span className="os-date">Date: {filled && wo ? fmtDate(wo.closedAt) : '__________'}</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="os-foot">
          Generated by AMPS — Asset Maintenance &amp; Preventive Scheduling · Format AMPS/CS-{fmtNo} Rev 00
        </div>
      </div>

      {filled ? (
        <p className="roadmap">🔒 This record is locked — verified and approved. Corrections require a fresh job card; the original stays on file.</p>
      ) : (
        <div className="cs-actions">
          <button className="btn muted" type="button" disabled title="Sign-off requires login — coming with user accounts">
            Submit for verification
          </button>
          <span className="roadmap" style={{ margin: 0 }}>Fill digitally here, or print blank and fill at site. Sign-off requires login.</span>
        </div>
      )}
    </>
  )
}

/* ---------- QR tag sheet ---------- */

/* The credits page — the story behind the tool, reachable from the footer.
   Full attribution lives here (a page you choose to open), while the always-
   visible footer stays a quiet signed mark. */
function AboutPage() {
  return (
    <div className="about">
      <a className="crumb" href="#/">← Back</a>
      <div className="about-hero">
        <h1>AMPS</h1>
        <p className="about-tag">Asset Maintenance &amp; Preventive Scheduling</p>
        {LIVE && <p className="about-org">{ORG}</p>}
      </div>

      <div className="card about-note">
        <p>
          AMPS grew out of the daily work of a power-supply section — the shift
          logbook, the failure register and the maintenance schedule a team
          keeps by hand. It sets out to give that discipline a digital home:
          every asset a QR tag, every job a record, every failure a lesson kept.
        </p>
        <p>
          It is built to stay simple enough for everyone, from the field to the
          front office — a tool that earns trust by never losing what was
          written, and by showing the equipment's story at a glance.
        </p>
        <div className="about-sign">
          <SignatureMark />
          <span className="about-by-wrap">
            <a className="about-by" href="https://github.com/arupbiswas1994-byte"
               target="_blank" rel="noopener noreferrer">@arupbiswas1994-byte</a>
            <span className="about-role">lead developer</span>
          </span>
        </div>
      </div>

      {/* the department's standing — its infrastructure, its data. On the live
          deployment this states Metro Railway's ownership (per the departmental
          order); on the demo it names Metro Railway as where AMPS runs for real. */}
      <div className="card about-dept">
        {LIVE ? (
          <>
            <h3>Departmental deployment</h3>
            <p>
              Deployed under Metro Railway office order
              No.&nbsp;MRK/CPD/E&amp;M/Co-Ord/6746, dated 22&nbsp;July&nbsp;2026:
            </p>
            <blockquote className="about-extract">
              “The licence files and notices of the open-source components shall
              remain intact within the source code. All user-facing screens shall
              display the name of Metro Railway, Kolkata, and all departmental
              data, records and configuration entered in the application shall
              remain the property of Metro Railway.”
              <cite>— office order No.&nbsp;6746, 22.07.2026</cite>
            </blockquote>
          </>
        ) : (
          <>
            <h3>In production</h3>
            <p>
              AMPS runs in production at <b>Metro Railway, Kolkata</b>, monitoring
              asset maintenance across the metro network — the open-source
              framework, adopted as a departmental system.
            </p>
            {/* value proof-points — demo/showcase only; the office deployment
                stays modest and institutional (no self-congratulatory savings) */}
            <div className="about-kpis">
              <span><b>3,050</b> assets</span>
              <span><b>18,000+</b> maintenance records</span>
              <span><b>₹0</b> software licence cost</span>
              <span><b>~₹1–3 Cr</b> est. 5-year cost avoided</span>
            </div>
          </>
        )}
      </div>

      <div className="card about-credits">
        <div className="ac-row">
          <span className="ac-k">Framework</span>
          <span className="ac-v">AMPS · open source, free to use and adapt</span>
        </div>
        <div className="ac-row">
          <span className="ac-k">Licence</span>
          <span className="ac-v">MIT</span>
        </div>
        <div className="ac-row">
          <span className="ac-k">Source</span>
          <span className="ac-v">
            <a href="https://github.com/arupbiswas1994-byte/amps" target="_blank" rel="noopener noreferrer">
              github.com/arupbiswas1994-byte/amps</a>
          </span>
        </div>
        <div className="ac-row">
          <span className="ac-k">Built with</span>
          <span className="ac-v">FastAPI · React · PostgreSQL · client-side QR</span>
        </div>
      </div>
    </div>
  )
}

/* Printables lives under a nav dropdown (QR tags / Checksheets), so the page
   itself just renders the chosen surface — no in-page tab bar. */
function Printables({ initial = 'qr' }) {
  const tab = initial === 'checksheets' ? 'checksheets' : 'qr'
  return tab === 'qr' ? <TagSheet /> : <ChecksheetFormats />
}

/* the Printables nav item: a dropdown submenu instead of a page-level tab bar */
function PrintablesNav({ active }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return undefined
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])
  const go = (t) => { location.hash = `/printables?t=${t}`; setOpen(false) }
  return (
    <span className="showcase" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={`nav-drop${active ? ' active' : ''}${open ? ' open' : ''}`}
              onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true">
        Printables <span className="caret">▾</span>
      </button>
      {open && (
        <div className="showcase-menu" role="menu">
          <a className="sc-item" role="menuitem" href="#/printables?t=qr" onClick={() => go('qr')}>
            <span className="sc-name">QR asset tags</span><span className="sc-sub">printable QR labels for every asset</span>
          </a>
          <a className="sc-item" role="menuitem" href="#/printables?t=checksheets" onClick={() => go('checksheets')}>
            <span className="sc-name">Checksheets</span><span className="sc-sub">maintenance checksheet formats — print & manage</span>
          </a>
        </div>
      )}
    </span>
  )
}

/* Checksheet FORMAT library — governed create/edit with IC (in-charge) approval,
   plus the print-ready blank. Coordinators can't keep predefined DIGITAL
   checksheets, so they print the right blank format, fill it by hand, then
   scan/upload it back against the log entry. */
const CS_STATUS_LABEL = { draft: 'Draft', pending: 'Pending approval', published: 'Published', archived: 'Archived' }
// the standard maintenance cycles a checksheet groups its activities under
const CS_CYCLES = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly', '5-Yearly']

function normFmt(f) {
  // API format → the shape the printable/editor use; tolerate the bundled fallback
  const items = (f.items || []).map((it) => typeof it === 'string' ? { activity: it, prescribed: '', freqs: [] } : { freqs: [], prescribed: '', ...it })
  return { frequencies: [], ...f, items }
}

function ChecksheetFormats() {
  const { me, canWrite } = useMe()
  const isApprover = me && (me.role === 'incharge' || me.role === 'admin')
  const [formats, setFormats] = useState(null)
  const [mode, setMode] = useState('print')   // print | manage
  const [editing, setEditing] = useState(null) // format being edited/created
  const [err, setErr] = useState('')
  const load = () => getJSON('/api/checksheets/formats')
    .then((r) => setFormats((r || []).map(normFmt)))
    .catch(() => setFormats(CHECKSHEET_FORMATS.map(normFmt)))  // offline fallback
  useEffect(() => { load() }, [])
  if (formats === null) return <p className="dim">Loading checksheet formats…</p>
  const published = formats.filter((f) => f.status === 'published' || !f.status)

  return (
    <div>
      {canWrite && (
        <div className="asset-filter no-print" role="tablist" aria-label="Checksheet mode" style={{ marginBottom: 12 }}>
          <button type="button" className={`btn preset ${mode === 'print' ? 'active' : ''}`} onClick={() => setMode('print')}>Print blanks</button>
          <button type="button" className={`btn preset ${mode === 'manage' ? 'active' : ''}`} onClick={() => setMode('manage')}>
            Manage formats{formats.some((f) => f.status === 'pending') ? ` · ${formats.filter((f) => f.status === 'pending').length} pending` : ''}
          </button>
        </div>
      )}
      {err && <div className="card offline-note no-print">{err}</div>}
      {editing ? (
        <ChecksheetEditor initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} setErr={setErr} />
      ) : mode === 'manage' && canWrite ? (
        <ChecksheetManage formats={formats} isApprover={isApprover} onEdit={setEditing} reload={load} setErr={setErr} />
      ) : (
        <ChecksheetPrint published={published} />
      )}
    </div>
  )
}

/* the print-ready blank picker + A4 sheet */
function ChecksheetPrint({ published }) {
  const [sel, setSel] = useState(published[0]?.id ?? published[0]?.key ?? '')
  const [copies, setCopies] = useState(1)
  const [printFreq, setPrintFreq] = useState('')   // '' = all (grouped); else one frequency
  const fmt = published.find((f) => (f.id ?? f.key) === sel) || published[0]
  useEffect(() => { setPrintFreq('') }, [sel])     // reset the frequency when the format changes
  if (!fmt) return <div className="card"><p className="dim" style={{ margin: 0 }}>No published checksheet formats yet.</p></div>
  const sheets = Array.from({ length: Math.min(Math.max(copies, 1), 20) }, (_, i) => i)
  return (
    <div className="cs-formats">
      <aside className="cs-picker no-print card">
        <div className="cs-picker-h">Formats <span className="dim">· {published.length}</span></div>
        <ul>
          {published.map((f) => (
            <li key={f.id ?? f.key}>
              <button type="button" className={(f.id ?? f.key) === sel ? 'active' : ''} onClick={() => setSel(f.id ?? f.key)}>
                <span className="cs-pick-label">{f.label}</span>
                <span className="cs-pick-n">{f.items.length}</span>
              </button>
            </li>
          ))}
        </ul>
        {(fmt.frequencies?.length > 0) && (
          <label className="cs-copies cs-freq-print">Frequency
            <select value={printFreq} onChange={(e) => setPrintFreq(e.target.value)}>
              <option value="">All (grouped)</option>
              {fmt.frequencies.map((c) => <option key={c} value={c}>Up to {c}</option>)}
            </select>
          </label>
        )}
        <div className="cs-picker-actions">
          <label className="cs-copies">Copies
            <input type="number" min="1" max="20" value={copies} onChange={(e) => setCopies(Number(e.target.value) || 1)} />
          </label>
          <button className="btn" type="button" onClick={() => window.print()}>Print</button>
        </div>
        <p className="dim cs-hint">Print a blank, fill it by hand during maintenance, then upload the scan against the log entry.</p>
      </aside>
      <div className="cs-print-area">
        {sheets.map((i) => <ChecksheetSheet key={i} fmt={fmt} printFreq={printFreq} />)}
      </div>
    </div>
  )
}

/* a plain activity table (S.N · activity · prescribed · actual reading) */
function CsFlatTable({ items }) {
  return (
    <table className="cs-table">
      <thead><tr>
        <th className="cs-sn">#</th><th>Activity / check point</th>
        <th className="cs-presc">Standard value</th>
        <th className="cs-done">Observation</th>
      </tr></thead>
      <tbody>
        {items.map((it, j) => (
          <tr key={j}><td className="cs-sn">{j + 1}</td><td>{it.activity}</td>
            <td className="cs-presc">{it.prescribed || ''}</td><td className="cs-done"></td></tr>
        ))}
      </tbody>
    </table>
  )
}

/* one AMPS-branded A4 blank: metro logo, QR to the format, then the activities
   GROUPED into frequency sections (Monthly / Quarterly / … ), or a single
   frequency's list. Prescribed-value + actual-reading columns; signatures. */
const CYCLE_RANK = { Monthly: 1, Quarterly: 2, 'Half-Yearly': 3, Yearly: 4, '5-Yearly': 5 }
const cycleRank = (c) => CYCLE_RANK[c] ?? 99

function ChecksheetSheet({ fmt, printFreq = '' }) {
  const qrVal = `${location.origin}/#/printables?t=checksheets&f=${fmt.id ?? ''}`
  const cols = (fmt.frequencies || []).slice().sort((a, b) => cycleRank(a) - cycleRank(b))
  const hasFreq = cols.length > 0
  // Cycles are CUMULATIVE: a Yearly service also performs the Monthly/Quarterly
  // checks. So picking a cycle prints every cycle up to and including it (its
  // lower cycles never drop out) — there is no "Yearly only".
  const selRank = printFreq ? cycleRank(printFreq) : Infinity
  const sections = cols.filter((c) => cycleRank(c) <= selRank)
  const grouped = hasFreq
  // Dynamic compression: size the sheet to its own content so a small checksheet
  // stays large/readable and a big one shrinks just enough to fit one page. Rows
  // shown = the activities that will print + one heading per section.
  const shownItems = grouped
    ? sections.reduce((n, c) => n + fmt.items.filter((it) => (it.freqs || []).includes(c)).length, 0)
    : (printFreq ? fmt.items.filter((it) => (it.freqs || []).includes(printFreq)).length : fmt.items.length)
  const rowLoad = shownItems + (grouped ? sections.length : 0)
  const lvl = rowLoad <= 12 ? 'lg' : rowLoad <= 20 ? 'md' : rowLoad <= 30 ? 'sm' : 'xs'
  return (
    <article className={`cs-sheet cs-lvl-${lvl}`}>
      <header className="cs-sheet-head">
        <img className="cs-logo" src="/metro-logo.svg" alt="" aria-hidden="true" />
        <div className="cs-head-mid">
          <b>{ORG}</b>
          <span className="cs-head-sub">AMPS · Maintenance Checksheet{fmt.version ? ` · v${fmt.version}` : ''}</span>
          <span className="cs-title">{fmt.title || fmt.label}</span>
        </div>
        <QR value={qrVal} size={62} />
      </header>
      <div className="cs-meta">
        <span>Location: <u>&nbsp;</u></span>
        <span>Asset name / ID: <u>&nbsp;</u></span>
        <span>Sheet no: <u>&nbsp;</u></span>
        <span>Date: <u>&nbsp;</u></span>
        {printFreq ? <span>For: <b>up to {printFreq}</b></span> : (fmt.frequency ? <span>Frequency: <b>{fmt.frequency}</b></span> : null)}
      </div>

      {grouped ? (
        // activities grouped under each frequency heading (cumulative sections)
        sections.map((c) => {
          const gi = fmt.items.filter((it) => (it.freqs || []).includes(c))
          if (!gi.length) return null
          return (
            <div className="cs-group" key={c}>
              <div className="cs-group-h">{c}<span className="dim"> · {gi.length} {gi.length === 1 ? 'activity' : 'activities'}</span></div>
              <CsFlatTable items={gi} />
            </div>
          )
        })
      ) : (
        <CsFlatTable items={fmt.items} />
      )}

      <div className="cs-remarks"><span>Maintenance remarks:</span><div className="cs-remark-box"></div></div>
      <footer className="cs-sign">
        <div>Staff (name &amp; signature):<br /><span className="cs-sign-line"></span></div>
        <div>Supervisor (name &amp; signature):<br /><span className="cs-sign-line"></span></div>
      </footer>
    </article>
  )
}

/* the governance surface: list every format by status, act on it */
function ChecksheetManage({ formats, isApprover, onEdit, reload, setErr }) {
  const [histFor, setHistFor] = useState(null)
  const act = async (id, path, body) => {
    setErr('')
    try {
      const r = await fetch(`${import.meta.env.VITE_AMPS_API ?? ''}/api/checksheets/formats/${id}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail || `HTTP ${r.status}`)
      reload()
    } catch (e) { setErr(String(e.message || e)) }
  }
  const del = async (id) => {
    if (!window.confirm('Discard this draft?')) return
    const r = await fetch(`${import.meta.env.VITE_AMPS_API ?? ''}/api/checksheets/formats/${id}`, { method: 'DELETE' })
    if (r.ok || r.status === 204) reload(); else setErr('Could not delete')
  }
  const reject = (id) => { const reason = window.prompt('Reason for rejection (sent back to the author):'); if (reason && reason.trim()) act(id, 'reject', { reason: reason.trim() }) }
  const [q, setQ] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fGroup, setFGroup] = useState('')
  const order = { pending: 0, draft: 1, published: 2, archived: 3 }
  const groups = [...new Set(formats.map((f) => f.grp).filter(Boolean))].sort()
  const counts = formats.reduce((m, f) => { m[f.status] = (m[f.status] || 0) + 1; return m }, {})
  const ql = q.trim().toLowerCase()
  const rows = [...formats]
    .filter((f) => !fStatus || f.status === fStatus)
    .filter((f) => !fGroup || f.grp === fGroup)
    .filter((f) => !ql || [f.label, f.title, f.grp, f.asset_code, f.asset_class, ...f.items.map((i) => i.activity)].some((v) => (v || '').toLowerCase().includes(ql)))
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.label.localeCompare(b.label))
  const STAT_TABS = [['', `All ${formats.length}`], ['pending', `Pending ${counts.pending || 0}`], ['draft', `Draft ${counts.draft || 0}`], ['published', `Published ${counts.published || 0}`]]
  return (
    <div>
      <div className="asset-toolbar no-print">
        <input className="asset-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Search formats — name, group, activity…" aria-label="Search checksheet formats" />
        <div className="asset-filter" role="tablist" aria-label="Status filter">
          {STAT_TABS.filter(([k]) => k !== 'pending' || counts.pending).map(([k, lbl]) => (
            <button key={k} type="button" className={`btn preset ${fStatus === k ? 'active' : ''}${k === 'pending' && counts.pending ? ' has-od' : ''}`}
                    onClick={() => setFStatus(k)}>{lbl}</button>
          ))}
        </div>
        {groups.length > 1 && (
          <select value={fGroup} onChange={(e) => setFGroup(e.target.value)} aria-label="Filter by group">
            <option value="">All groups</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        )}
        {(q || fStatus || fGroup) && <button type="button" className="btn ghost sm" onClick={() => { setQ(''); setFStatus(''); setFGroup('') }}>Clear</button>}
        <span className="asset-count">{rows.length} shown</span>
        <div className="asset-actions">
          <button type="button" className="icon-btn" title="New checksheet format" aria-label="New format"
                  onClick={() => onEdit({ label: '', title: '', grp: 'HT', frequencies: [], items: [{ activity: '', prescribed: '', freqs: [] }] })}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8 3.2v9.6M3.2 8h9.6" /></svg>
          </button>
        </div>
      </div>
      <div className="card tbl-wrap">
        <table className="cs-manage-tbl">
          <thead><tr><th>Format</th><th>Asset / class</th><th>Group</th><th>Cycles</th><th>Ver</th><th>Items</th><th>Status</th><th>By</th><th aria-label="Actions"></th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="dim" style={{ textAlign: 'center', padding: 20 }}>No formats match.</td></tr>
            ) : rows.map((f) => (
              <tr key={f.id}>
                <td><b>{f.label}</b>{f.reject_reason && f.status === 'draft' ? <div className="cs-reject">✗ {f.reject_reason}</div> : null}</td>
                <td className="dim">{f.asset_code || f.asset_class || '—'}</td>
                <td className="dim">{f.grp}</td>
                <td className="dim">{f.frequencies?.length ? f.frequencies.join(' · ') : '—'}</td>
                <td className="dim">v{f.version}</td>
                <td className="dim">{f.items.length}</td>
                <td><span className={`cs-badge cs-b-${f.status}`}>{CS_STATUS_LABEL[f.status] || f.status}</span></td>
                <td className="dim">{f.status === 'published' ? (f.approved_by || '—') : f.created_by}</td>
                <td className="td-edit cs-acts">
                  {(f.status === 'draft' || f.status === 'published' || f.status === 'archived') && <button className="mini-btn" type="button" onClick={() => onEdit(f)}>{f.status === 'draft' ? 'Edit' : 'Revise'}</button>}
                  {f.status === 'draft' && <button className="mini-btn" type="button" onClick={() => act(f.id, 'submit')}>Submit</button>}
                  {f.status === 'draft' && <button className="mini-btn muted" type="button" onClick={() => del(f.id)}>Delete</button>}
                  {f.status === 'pending' && isApprover && <button className="mini-btn ok" type="button" onClick={() => act(f.id, 'approve')}>Approve</button>}
                  {f.status === 'pending' && isApprover && <button className="mini-btn danger" type="button" onClick={() => reject(f.id)}>Reject</button>}
                  {f.status === 'pending' && !isApprover && <button className="mini-btn muted" type="button" onClick={() => act(f.id, 'withdraw')}>Withdraw</button>}
                  <button className="mini-btn muted" type="button" onClick={() => setHistFor(f)}>History</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {histFor && <ChecksheetHistory fmt={histFor} onClose={() => setHistFor(null)} />}
    </div>
  )
}

function ChecksheetHistory({ fmt, onClose }) {
  const [rows, setRows] = useState(null)
  useEffect(() => { getJSON(`/api/checksheets/formats/${fmt.id}/history`).then(setRows).catch(() => setRows([])) }, [fmt.id])
  return (
    <div className="cs-modal" onClick={onClose}>
      <div className="cs-modal-card card" onClick={(e) => e.stopPropagation()}>
        <div className="cs-modal-h"><b>Audit trail — {fmt.label}</b><button className="mini-btn" onClick={onClose}>Close</button></div>
        {rows === null ? <p className="dim">Loading…</p> : rows.length === 0 ? <p className="dim">No history.</p> : (
          <ul className="cs-audit">
            {rows.map((r, i) => (
              <li key={i}><span className="cs-audit-act">{r.action}</span> <span className="dim">{r.detail || ''}</span><br />
                <span className="dim cs-audit-meta">{r.actor} · {new Date(r.at).toLocaleString()}</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* create / edit a format: title, group, applicability, and the ordered item list
   each with its activity + prescribed (acceptance-limit) value */
function ChecksheetEditor({ initial, onClose, onSaved, setErr }) {
  const [label, setLabel] = useState(initial.label || '')
  const [title, setTitle] = useState(initial.title || '')
  const [grp, setGrp] = useState(initial.grp || 'HT')
  const [freq, setFreq] = useState(initial.frequency || '')
  const [assetCode, setAssetCode] = useState(initial.asset_code || '')
  const [cls, setCls] = useState(initial.asset_class || '')
  const [cols, setCols] = useState(initial.frequencies || [])   // frequency-matrix columns
  const [newCol, setNewCol] = useState('')
  const [items, setItems] = useState(initial.items?.length ? initial.items.map((i) => ({ freqs: [], prescribed: '', ...i })) : [{ activity: '', prescribed: '', freqs: [] }])
  const [busy, setBusy] = useState(false)
  const editingPublished = initial.status === 'published' || initial.status === 'archived'
  const setItem = (i, k, v) => setItems((xs) => xs.map((it, j) => j === i ? { ...it, [k]: v } : it))
  const addItem = () => setItems((xs) => [...xs, { activity: '', prescribed: '', freqs: [] }])
  const rmItem = (i) => setItems((xs) => xs.filter((_, j) => j !== i))
  const move = (i, d) => setItems((xs) => { const n = [...xs]; const j = i + d; if (j < 0 || j >= n.length) return xs;[n[i], n[j]] = [n[j], n[i]]; return n })
  const addCol = () => { const c = newCol.trim(); if (c && !cols.includes(c)) setCols([...cols, c]); setNewCol('') }
  const rmCol = (c) => { setCols(cols.filter((x) => x !== c)); setItems((xs) => xs.map((it) => ({ ...it, freqs: (it.freqs || []).filter((f) => f !== c) }))) }
  const toggleFreq = (i, c) => setItems((xs) => xs.map((it, j) => j === i ? { ...it, freqs: (it.freqs || []).includes(c) ? it.freqs.filter((f) => f !== c) : [...(it.freqs || []), c] } : it))
  const save = async () => {
    const clean = items.filter((it) => it.activity.trim())
    if (!label.trim() || !clean.length) { setErr('A format needs a name and at least one activity.'); return }
    setBusy(true); setErr('')
    try {
      const body = { label: label.trim(), title: title.trim(), grp: grp.trim() || 'HT', frequency: freq.trim() || null, asset_code: assetCode.trim() || null, asset_class: cls.trim() || null, frequencies: cols, items: clean }
      const base = import.meta.env.VITE_AMPS_API ?? ''
      // new (no id) → POST; existing → PUT (a published one forks a new draft)
      const r = initial.id
        ? await fetch(`${base}/api/checksheets/formats/${initial.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch(`${base}/api/checksheets/formats`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail || `HTTP ${r.status}`)
      onSaved()
    } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }
  return (
    <div className="card cs-editor no-print">
      <div className="cs-editor-h">
        <b>{initial.id ? (editingPublished ? `Revise: ${initial.label} (new version)` : `Edit: ${initial.label}`) : 'New checksheet format'}</b>
        <button className="mini-btn" type="button" onClick={onClose}>Cancel</button>
      </div>
      {editingPublished && <p className="ef-hint">Editing a published format creates a new version — it goes back through approval before it replaces the current one.</p>}
      <div className="fg-fields cs-editor-meta">
        <label className="fg-span-2">Format name<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. 33KV VCB" /></label>
        <label>Group<input value={grp} onChange={(e) => setGrp(e.target.value)} placeholder="HT / LT / ECS" /></label>
        <label>Frequency <span className="ef-opt">(opt)</span><input value={freq} onChange={(e) => setFreq(e.target.value)} placeholder="e.g. Yearly" /></label>
        <label className="fg-span-2">Printed title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="METRO RAILWAY, KOLKATA — 33KV VCB MAINTENANCE" /></label>
        <label>Asset / equipment <span className="ef-opt">(opt)</span><input value={assetCode} onChange={(e) => setAssetCode(e.target.value)} placeholder="e.g. Third Rail, BET, VCB" /></label>
        <label>Asset class <span className="ef-opt">(opt)</span><input value={cls} onChange={(e) => setCls(e.target.value)} placeholder="class this format matches" /></label>
      </div>
      <div className="cs-freq-manage">
        <span className="fg-lbl">Frequency groups <span className="ef-opt">(the maintenance cycles this checksheet covers — tick each activity below under the cycles it's due at)</span></span>
        <div className="cs-freq-quick">
          {CS_CYCLES.map((c) => (
            <button type="button" key={c} className={`btn ghost sm${cols.includes(c) ? ' active' : ''}`}
                    onClick={() => cols.includes(c) ? rmCol(c) : setCols([...cols, c])}>{cols.includes(c) ? '✓ ' : '＋ '}{c}</button>
          ))}
        </div>
        <div className="cs-freq-chips">
          {cols.map((c) => <span className="cs-freq-chip" key={c}>{c}<button type="button" onClick={() => rmCol(c)} aria-label="Remove">×</button></span>)}
          <input className="cs-freq-add" value={newCol} onChange={(e) => setNewCol(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCol() } }} placeholder="+ custom cycle…" />
          <button type="button" className="mini-btn" onClick={addCol}>＋</button>
        </div>
      </div>
      <div className="cs-items-hd" style={{ gridTemplateColumns: `30px 1fr 1fr ${cols.length ? `repeat(${cols.length}, 34px) ` : ''}96px` }}>
        <span>#</span><span>Maintenance activity</span><span>Prescribed / acceptance limit</span>
        {cols.map((c) => <span key={c} className="cs-freq-h">{c}</span>)}
        <span></span>
      </div>
      {items.map((it, i) => (
        <div className="cs-item-row" key={i} style={{ gridTemplateColumns: `30px 1fr 1fr ${cols.length ? `repeat(${cols.length}, 34px) ` : ''}96px` }}>
          <span className="cs-item-n">{i + 1}</span>
          <input value={it.activity} onChange={(e) => setItem(i, 'activity', e.target.value)} placeholder="activity to check" />
          <input value={it.prescribed} onChange={(e) => setItem(i, 'prescribed', e.target.value)} placeholder="e.g. ≥ 100 MΩ / firm / clean" />
          {cols.map((c) => (
            <button type="button" key={c} className={`cs-freq-tick ${(it.freqs || []).includes(c) ? 'on' : ''}`}
                    onClick={() => toggleFreq(i, c)} title={`${c} required?`} aria-label={`${c} required`}>{(it.freqs || []).includes(c) ? '✓' : ''}</button>
          ))}
          <span className="cs-item-acts">
            <button type="button" className="mini-btn muted" onClick={() => move(i, -1)} aria-label="Up">↑</button>
            <button type="button" className="mini-btn muted" onClick={() => move(i, 1)} aria-label="Down">↓</button>
            <button type="button" className="mini-btn danger" onClick={() => rmItem(i)} aria-label="Remove">×</button>
          </span>
        </div>
      ))}
      <div className="cs-editor-actions">
        <button type="button" className="btn ghost sm" onClick={addItem}>＋ Add activity</button>
        <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : initial.id ? 'Save' : 'Create draft'}</button>
      </div>
    </div>
  )
}

const TAG_CAP = 500   // cap the QRs rendered at once — keeps the page responsive

function TagSheet() {
  const live = useLiveAssets()
  const all = LIVE ? live.assets : ASSETS
  // same filters as the register (System / Class / Location / Status), so it
  // generalises across lines. No default — the last-used filter is retained
  // (persisted), so you return to the set you were printing.
  const [fSystem, setFSystem] = usePersistedState('tags.system', '')
  const [q, setQ] = useState('')
  const [fClass, setFClass] = usePersistedState('tags.class', '')
  const [fLocation, setFLocation] = usePersistedState('tags.location', '')
  const [fStatus, setFStatus] = usePersistedState('tags.status', '')
  const toolbarRef = useRef(null)
  useEffect(() => {
    const setVars = () => { const tb = document.querySelector('.topbar'); if (tb) document.documentElement.style.setProperty('--topbar-h', `${tb.offsetHeight}px`) }
    setVars(); window.addEventListener('resize', setVars); return () => window.removeEventListener('resize', setVars)
  })

  const ql = q.trim().toLowerCase()
  const matchQ = (a) => !ql || [a.code, a.name, a.location, a.cls].some((v) => (v || '').toLowerCase().includes(ql))
  // CASCADING filters — each dropdown lists only values still present under the
  // other active filters, and keeps its own current value.
  const TAG_FIELDS = [['sys', fSystem], ['cls', fClass], ['location', fLocation], ['status', fStatus]]
  const passesExcept = (a, exceptKey) => TAG_FIELDS.every(([k, v]) => !v || k === exceptKey || a[k] === v)
  const optsFor = (k, cur) => {
    const s = new Set(all.filter((a) => matchQ(a) && passesExcept(a, k)).map((a) => a[k]).filter(Boolean))
    if (cur) s.add(cur)
    return [...s].sort()
  }
  const systems = optsFor('sys', fSystem); const classes = optsFor('cls', fClass)
  const locations = optsFor('location', fLocation); const statuses = optsFor('status', fStatus)
  const shown = all.filter((a) =>
    (!fSystem || a.sys === fSystem) && (!fClass || a.cls === fClass)
    && (!fLocation || a.location === fLocation) && (!fStatus || a.status === fStatus)
    && matchQ(a))

  if (LIVE && live.loading) return <p className="dim">Loading the asset register…</p>
  if (all.length === 0) return <div className="card"><p className="dim" style={{ margin: 0 }}>No assets in the register yet — tags appear as assets are added.</p></div>
  return (
    <>
      <div className="asset-toolbar" ref={toolbarRef}>
        <input className="asset-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Search code, asset, class or location…" aria-label="Search assets" />
        <select value={fSystem} onChange={(e) => setFSystem(e.target.value)} aria-label="Filter by system">
          <option value="">All systems</option>
          {systems.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fClass} onChange={(e) => setFClass(e.target.value)} aria-label="Filter by class">
          <option value="">All classes</option>
          {classes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fLocation} onChange={(e) => setFLocation(e.target.value)} aria-label="Filter by location">
          <option value="">All locations</option>
          {locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter by status">
          <option value="">Any status</option>
          {statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
        </select>
        {(q || fSystem || fClass || fLocation || fStatus) && <button type="button" className="btn ghost sm" onClick={() => { setQ(''); setFSystem(''); setFClass(''); setFLocation(''); setFStatus('') }}>Clear</button>}
        <span className="asset-count">{shown.length} tag{shown.length === 1 ? '' : 's'}</span>
        <div className="asset-actions">
          <button type="button" className="icon-btn" title="Print these tags" aria-label="Print tags" onClick={() => window.print()}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 6V2.5h7V6M4.5 12H3.2V6.4h9.6V12H11.5M4.5 9.6h7V13.5h-7z" /></svg>
          </button>
        </div>
      </div>
      <p className="dim tags-note no-print" style={{ margin: '0 0 12px' }}>
        {shown.length} tag{shown.length === 1 ? '' : 's'}{fSystem ? ` · ${fSystem}` : ''} — filter to the set you need, then print. One tag per asset; scanning opens the asset's live record.
        {shown.length > TAG_CAP && <> <b>Showing the first {TAG_CAP}</b> — refine the filter to reach the rest.</>}
      </p>
      {shown.length === 0
        ? <div className="card"><p className="dim" style={{ margin: 0 }}>No assets match — adjust the filters.</p></div>
        : (
          <div className="tags">
            {shown.slice(0, TAG_CAP).map((a) => (
              <div className="tag" key={a.code}>
                <QR value={assetUrl(a.code)} size={140} />
                <div className="scan-cap">Scan for history</div>
                <div className="nm">{a.name}</div>
                <span className="code">{a.code}</span>
                <div className="org">AMPS · {ORG.toUpperCase()}</div>
              </div>
            ))}
          </div>
        )}
    </>
  )
}

/* ---------- home dashboard (signed-in landing) ---------- */

function LineDashboard({ go }) {
  const { assets: allAssets, sched, openFail, loading } = useLiveAssets()
  const assets = allAssets.filter((a) => a.status !== 'decommissioned' && a.status !== 'spare') // not in active service — not counted
  const { me } = useMe()
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState([])
  useEffect(() => {
    getJSON('/api/logbook/failure-stats?days=180&months=6').then(setStats).catch(() => {})
    getJSON('/api/logbook?limit=6').then(setRecent).catch(() => {})
  }, [])
  if (loading) return <p className="dim">Loading the dashboard…</p>
  const pm = (a) => sched[assetKey(a)]
  const stateOf = (a) => pm(a)?.state
  // PM-compliance breakdown across every asset. Routine (short-cycle) overdue is
  // the actionable headline; the 5-Yearly overhaul backlog is counted apart so
  // it does not swamp the number the PCEE acts on. Un-scheduled assets (no plan,
  // no logged maintenance) are their own bucket.
  const total = assets.length
  const bucket = { ok: 0, due_soon: 0, overdue: 0, long_overdue: 0, none: 0 }
  assets.forEach((a) => { bucket[stateOf(a) || 'none'] += 1 })
  // Separate the routine-overdue bucket into "never serviced" (has a plan but no
  // first PM yet — a scheduling backlog, common on a young system) and genuinely
  // "lapsed" (was serviced, fell behind). Reported apart so the headline reflects
  // what actually slipped, not thousands of first-time entries.
  const neverN = assets.filter((a) => pm(a)?.never_done).length
  const lapsed = bucket.overdue - neverN
  const scheduled = total - bucket.none
  // compliance measured over assets already in the maintenance cycle (serviced at
  // least once) — never-serviced assets are a separate onboarding backlog
  const inCycle = scheduled - neverN
  const compliance = inCycle > 0 ? Math.round((bucket.ok / inCycle) * 100) : (scheduled ? 100 : 0)
  // routine overdue broken up by the overdue cycle (Monthly / Quarterly / …)
  // and by asset class — so the PCEE sees WHERE the backlog is concentrated
  const overdueByFreq = {}
  const overdueBySystem = {}
  assets.forEach((a) => {
    const s = pm(a)
    if (s?.state === 'overdue' && !s.never_done) {   // lapsed only — matches the headline Overdue
      if (s.next_frequency) overdueByFreq[s.next_frequency] = (overdueByFreq[s.next_frequency] || 0) + 1
      const sy = a.sys || 'Unclassified'; overdueBySystem[sy] = (overdueBySystem[sy] || 0) + 1
    }
  })
  const topSystems = Object.entries(overdueBySystem).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const exceeded = assets.filter(codalExceeded).length
  const stations = new Set(assets.map((a) => a.location)).size
  const depots = new Set(assets.map((a) => a.depot).filter(Boolean)).size
  const openF = assets.reduce((n, a) => n + (openFail[assetKey(a)]?.open || 0) + (openFail[assetKey(a)]?.ack || 0) + (openFail[assetKey(a)]?.jobcard || 0), 0)
  const trend = stats ? stats.per_month.map((m) => ({ label: new Date(`${m.month}-01T00:00:00`).toLocaleString(undefined, { month: 'short' }), count: m.count })) : []
  const line = me?.line || ORG
  const failLine = me?.line || (assets[0] && assets[0].line)
  const failHref = failLine ? `#/line/${encodeURIComponent(failLine)}/failures` : '#/'

  // stacked compliance bar segments (ordered best → worst); never-serviced and
  // unscheduled shown as neutral onboarding backlog, not as breakdowns
  const segs = [
    ['ok', 'On schedule', bucket.ok, 'seg-ok'],
    ['due_soon', 'Due soon', bucket.due_soon, 'seg-due'],
    ['overdue', 'Overdue', lapsed, 'seg-od'],
    ['never', 'Awaiting 1st service', neverN, 'seg-never'],
    ['long_overdue', '5-Yearly due', bucket.long_overdue, 'seg-long'],
    ['none', 'Unscheduled', bucket.none, 'seg-none'],
  ].filter(([, , n]) => n > 0)

  const tile = (v, k, cls, to, sub) => (
    <a className={`tile dash-tile${cls ? ' ' + cls : ''}`} href={to} role="button">
      <div className="v">{v}</div><div className="k">{k}</div>{sub && <div className="note">{sub}</div>}
    </a>
  )
  return (
    <>
      <div className="page-head dash-head">
        <h1>{line} · Maintenance Overview</h1>
        <span className="dash-asof">as of {new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}</span>
      </div>

      {/* headline compliance summary */}
      <section className="card compliance-card">
        <div className="cc-top">
          <div className="cc-hero">
            <div className={`cc-pct ${compliance >= 90 ? 'good' : compliance >= 70 ? 'warn' : 'bad'}`}>{compliance}%</div>
            <div className="cc-hero-k">PM compliance<span className="dim"> · {bucket.ok.toLocaleString()} of {inCycle.toLocaleString()} in-cycle assets on schedule</span></div>
          </div>
          <div className="cc-figures">
            <div className="cc-fig"><b>{total.toLocaleString()}</b><span>Total assets</span></div>
            <div className="cc-fig"><b className="good">{bucket.ok.toLocaleString()}</b><span>On schedule</span></div>
            <div className="cc-fig"><b className={lapsed ? 'warn' : 'good'}>{lapsed.toLocaleString()}</b><span>Overdue (lapsed)</span></div>
            <div className="cc-fig"><b className="neutral">{neverN.toLocaleString()}</b><span>Awaiting 1st service</span></div>
          </div>
        </div>
        <div className="cc-bar" role="img" aria-label="PM compliance breakdown">
          {segs.map(([k, , n, cls]) => (
            <div key={k} className={`cc-seg ${cls}`} style={{ flexGrow: n }} title={`${n} ${SCHED_LABEL[k] || k}`} />
          ))}
        </div>
        <div className="cc-legend">
          {segs.map(([k, label, n, cls]) => (
            <span key={k} className="cc-leg"><span className={`cc-dot ${cls}`} />{label} <b>{n.toLocaleString()}</b></span>
          ))}
        </div>
      </section>

      {/* KPI tiles — overdue split routine vs 5-yearly */}
      <div className="kpis dash-kpis">
        {tile(total.toLocaleString(), 'Assets', '', '#/assets', `${stations} locations · ${depots || 1} depot${depots > 1 ? 's' : ''}`)}
        {tile(bucket.ok.toLocaleString(), 'On schedule', bucket.ok ? 'ok' : '', '#/assets', `${compliance}% of scheduled`)}
        {tile(bucket.due_soon.toLocaleString(), 'Due soon', bucket.due_soon ? 'warn' : '', '#/assets', 'within 30 days')}
        {tile(lapsed.toLocaleString(), 'Overdue', lapsed ? 'warn' : 'ok', '#/assets', 'lapsed routine PM')}
        {tile(neverN.toLocaleString(), 'Awaiting 1st service', neverN ? 'neutral' : '', '#/assets', 'never yet serviced')}
        {tile(bucket.long_overdue.toLocaleString(), '5-Yearly', bucket.long_overdue ? 'neutral' : '', '#/assets', 'overhaul / not started')}
        {tile(openF.toLocaleString(), 'Open failures', openF ? 'alert' : '', failHref, 'awaiting rectification')}
      </div>

      <div className="dash-grid">
        {/* overdue breakup by cycle */}
        <section className="card viz-card">
          <h2 className="viz-h">Overdue breakup <span className="viz-note">lapsed routine cycles</span></h2>
          {lapsed === 0 ? <p className="dim">No lapsed routine PM — every in-cycle asset is up to date. 👍</p> : (
            <div className="breakup">
              {SCHED_FREQS.filter((f) => overdueByFreq[f]).map((f) => {
                const n = overdueByFreq[f]; const w = Math.round((n / lapsed) * 100)
                return (
                  <div className="bk-row" key={f}>
                    <span className="bk-lbl">{f}</span>
                    <span className="bk-bar"><span className="bk-fill" style={{ width: `${Math.max(w, 3)}%` }} /></span>
                    <span className="bk-n">{n}</span>
                  </div>
                )
              })}
              {bucket.long_overdue > 0 && (
                <div className="bk-row bk-long">
                  <span className="bk-lbl">5-Yearly <span className="dim">(separate)</span></span>
                  <span className="bk-bar"><span className="bk-fill long" style={{ width: '100%' }} /></span>
                  <span className="bk-n">{bucket.long_overdue}</span>
                </div>
              )}
            </div>
          )}
          <p className="viz-insight"><a className="crumb" href="#/assets">Open the register →</a></p>
        </section>

        {/* overdue by system (HT · 33kV, LT · ECS, …) */}
        <section className="card viz-card">
          <h2 className="viz-h">Overdue by system <span className="viz-note">top {topSystems.length}</span></h2>
          {topSystems.length === 0 ? <p className="dim">No routine PM overdue.</p> : (
            <div className="breakup">
              {topSystems.map(([c, n]) => {
                const w = Math.round((n / topSystems[0][1]) * 100)
                return (
                  <div className="bk-row" key={c}>
                    <span className="bk-lbl bk-cls" title={c}>{c}</span>
                    <span className="bk-bar"><span className="bk-fill" style={{ width: `${Math.max(w, 3)}%` }} /></span>
                    <span className="bk-n">{n}</span>
                  </div>
                )
              })}
            </div>
          )}
          <p className="viz-insight"><a className="crumb" href="#/assets">Open the register →</a></p>
        </section>
      </div>

      <div className="dash-grid">
        {/* failures per month */}
        <section className="card viz-card">
          <h2 className="viz-h">Failures per month <span className="viz-note">last 6 months</span></h2>
          {trend.length ? <TrendChart data={trend} /> : <p className="dim">No failure data.</p>}
          <p className="viz-insight"><a className="crumb" href={failHref}>Open the failures dashboard →</a></p>
        </section>
        <section className="card viz-card">
          <h2 className="viz-h">Recent logbook <span className="viz-note">latest entries</span></h2>
          {recent.length === 0 ? <p className="dim">No entries yet.</p> : (
            <div className="dash-recent">
              {recent.map((e) => (
                <a key={e.id} className="dr-row" href={e.asset_code ? `#/asset/${encodeURIComponent(e.asset_code)}` : '#/log'}>
                  <span className={`chip ${e.type === 'failure' ? 'd-overdue' : ''}`}><span className="dot" />{e.type}</span>
                  <span className="dr-txt">{tidyLog(e.text).slice(0, 64)}</span>
                  <span className="dim dt dr-date">{e.log_date}</span>
                </a>
              ))}
            </div>
          )}
          <p className="viz-insight"><a className="crumb" href="#/log">Open the log book →</a></p>
        </section>
        <section className="card viz-card asset-health">
          <h2 className="viz-h">Asset health <span className="viz-note">condition flags</span></h2>
          <div className="ah-list">
            <a className="ah-row" href="#/assets"><span className="ah-dot bad" />Exceeded codal life<span className="ah-n">{exceeded}</span></a>
            <a className="ah-row" href={failHref}><span className="ah-dot bad" />Open failures<span className="ah-n">{openF}</span></a>
            <a className="ah-row" href="#/assets"><span className="ah-dot warn" />5-Yearly overhaul due<span className="ah-n">{bucket.long_overdue}</span></a>
            <a className="ah-row" href="#/assets"><span className="ah-dot none" />Not yet scheduled<span className="ah-n">{bucket.none}</span></a>
          </div>
          <p className="viz-insight"><a className="crumb" href="#/assets">Open the register →</a></p>
        </section>
      </div>

      <div className="dash-links">
        {[['#/assets', 'Assets', 'register, QR & schedules'], ['#/log', 'Log book', 'daily shift log'],
          [failHref, 'Failures', 'breakdowns & recovery'], ['#/tags', 'QR tags', 'print asset tags']].map(([to, t, s]) => (
          <a key={to} className="dash-link card" href={to}><b>{t}</b><span className="dim">{s}</span></a>
        ))}
      </div>
    </>
  )
}

/* Job-cards board — every failure with a job card raised to an agency/dept
   that is not yet closed, so the section can chase them. Oldest (most overdue)
   first, with days-pending front and centre. Signed-in only (operational). */
function exportJobCards(cards) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['Raised', 'Status', 'Asset', 'Station', 'Location', 'Fault', 'Issued to', 'Job card detail', 'Closed', 'Age (d)', 'Action taken']
  const stat = { open: 'Open', closed: 'Closed by agency', penalty: 'Penalty — we fixed' }
  const rows = cards.map(({ f, jc, rb, status, age }) => [
    jc.log_date, stat[status] || status, f.asset_code || '', f.station || jc.station || '', f.category || '',
    f.fault_type || tidyLog(f.text), jc.attended_by || '', tidyLog(jc.text),
    rb ? rb.log_date : '', age, rb ? (rb.action_taken || tidyLog(rb.text)) : ''].map(esc).join(','))
  const blob = new Blob([[head.map(esc).join(','), ...rows].join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = `amps-job-cards-${new Date().toISOString().slice(0, 10)}.csv`
  a.click(); URL.revokeObjectURL(a.href)
}

function JobCardsView({ line = '' }) {
  const { me, canWrite } = useMe()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('open')   // open | closed | penalty | all
  const [q, setQ] = useState('')
  const [fAgency, setFAgency] = useState([])   // multi-select "Issued to" filter
  const [openCol, setOpenCol] = useState(null)
  useEffect(() => {
    const lq = line ? `&line=${encodeURIComponent(line)}` : ''
    getJSON(`/api/logbook?entry_type=failure&limit=5000${lq}`)
      .then((r) => setRows(r || [])).catch((e) => setError(String(e)))
  }, [line])
  if (error) return <div className="card offline-note">Backend unreachable — {error}.</div>
  if (rows === null) return <p className="dim">Loading job cards…</p>
  const days = (a, b) => Math.max(0, Math.round(((b ? new Date(`${b}T00:00:00`) : Date.now()) - new Date(`${a}T00:00:00`)) / 86400000))
  // Every failure that EVER had a job card raised (the card is kept even after
  // rectification). Two parts tracked per card: ISSUED (job_card_by) and CLOSED
  // (resolved_by, if any). Closure is by the agency (via_job_card) or by us — the
  // latter meaning the card went UNFULFILLED → a penalty against the agency.
  const cardsAll = rows.filter((f) => f.job_card_by).map((f) => {
    const jc = f.job_card_by, rb = f.resolved_by
    const status = !rb ? 'open' : (rb.via_job_card ? 'closed' : 'penalty')
    return { f, jc, rb, status, age: days(jc.log_date, rb ? rb.log_date : null) }
  })
  const agencies = [...new Set(cardsAll.map((c) => c.jc.attended_by).filter(Boolean))].sort()
  const ql = q.trim().toLowerCase()
  const matchQ = (c) => !ql || [c.f.asset_code, c.f.fault_type, c.f.text, c.f.station, c.f.category, c.jc.attended_by, c.jc.text].some((v) => (v || '').toLowerCase().includes(ql))
  // search + agency filter apply first, so the tab counts reflect the current view
  const cards = cardsAll.filter((c) => matchQ(c) && (!fAgency.length || fAgency.includes(c.jc.attended_by)))
  const open = cards.filter((c) => c.status === 'open')
  const closed = cards.filter((c) => c.status === 'closed')
  const penalty = cards.filter((c) => c.status === 'penalty')
  const TABS = [['open', 'Open', open], ['penalty', 'Penalty', penalty], ['closed', 'Closed', closed], ['all', 'All', cards]]
  const shown = (TABS.find(([k]) => k === tab)?.[2] || cards)
    .slice().sort((a, b) => tab === 'open' ? b.age - a.age : (b.jc.log_date < a.jc.log_date ? -1 : 1))
  // avg turnaround of closed cards (raised→closed), for the chase metric
  const doneCards = [...closed, ...penalty]
  const avgTurn = doneCards.length ? Math.round(doneCards.reduce((s, c) => s + c.age, 0) / doneCards.length) : null
  const line_ = me?.line || ''
  const STL = { open: ['jc-open', 'Open'], closed: ['jc-closed', 'Closed by agency'], penalty: ['jc-penalty', 'Penalty — we fixed it'] }
  return (
    <>
      <div className="page-head"><h1>Job cards {line_ && <span className="dim">· {line_}</span>}</h1></div>
      <p className="dim" style={{ marginTop: -6 }}>Job cards raised to an agency/department, tracked from issue to close-out.</p>

      <div className="kpis dash-kpis" style={{ marginBottom: 14 }}>
        <div className={`tile${open.length ? ' alert' : ''}`}><div className="v">{open.length}</div><div className="k">Open</div><div className="note">awaiting close-out</div></div>
        <div className={`tile${penalty.length ? ' warn' : ''}`}><div className="v">{penalty.length}</div><div className="k">Penalty</div><div className="note">we fixed — agency default</div></div>
        <div className="tile ok"><div className="v">{closed.length}</div><div className="k">Closed by agency</div><div className="note">fulfilled</div></div>
        <div className="tile"><div className="v">{avgTurn != null ? `${avgTurn}d` : '—'}</div><div className="k">Avg turnaround</div><div className="note">raised → closed</div></div>
      </div>

      <div className="asset-toolbar">
        <input className="asset-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Search asset, fault, agency, detail…" aria-label="Search job cards" />
        <div className="asset-filter" role="tablist" aria-label="Job card status">
          {TABS.map(([k, lbl, list]) => (
            <button key={k} type="button" className={`btn preset ${tab === k ? 'active' : ''}${k === 'open' && open.length ? ' has-od' : ''}`}
                    onClick={() => setTab(k)}>{lbl} {list.length}</button>
          ))}
        </div>
        {(q || fAgency.length) && <button type="button" className="btn ghost sm" onClick={() => { setQ(''); setFAgency([]) }}>Clear</button>}
        <span className="asset-count">{shown.length} shown</span>
        <div className="asset-actions">
          <button type="button" className="icon-btn" title="Download these job cards (CSV)" aria-label="Download job cards"
                  onClick={() => exportJobCards(shown)}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2.4v7.2M4.8 6.6 8 9.8l3.2-3.2M3 12.8h10" /></svg>
          </button>
          <button type="button" className="icon-btn" title="Print these job cards" aria-label="Print job cards" onClick={() => window.print()}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 6V2.5h7V6M4.5 12H3.2V6.4h9.6V12H11.5M4.5 9.6h7V13.5h-7z" /></svg>
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card"><p className="dim" style={{ margin: 0 }}>{tab === 'open' ? 'No open job cards — nothing to chase. 👍' : 'None in this view.'}</p></div>
      ) : (
        <div className="card tbl-wrap">
          <table className="jc-table">
            <colgroup>
              <col style={{ width: 56 }} /><col style={{ width: 104 }} />
              <col style={{ width: 130 }} /><col style={{ width: 72 }} /><col style={{ width: 110 }} /><col style={{ width: 160 }} />
              <col style={{ width: 130 }} /><col style={{ width: 82 }} />
              <col style={{ width: 82 }} /><col />{canWrite && <col style={{ width: 112 }} />}
            </colgroup>
            <thead><tr><th>{tab === 'open' ? 'Pending' : 'Turnaround'}</th><th>Status</th><th>Asset</th><th>Station</th><th>Location</th><th>Fault</th>
              <th className={fAgency.length ? 'th-filtered' : ''}>Issued to
                <ColFilter open={openCol === 'ag'} onToggle={() => setOpenCol(openCol === 'ag' ? null : 'ag')}
                           onClose={() => setOpenCol(null)} values={fAgency}
                           toggle={(v) => setFAgency((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])}
                           clear={() => setFAgency([])} opts={agencies} allLabel="All agencies" />
              </th>
              <th>Raised</th><th>Closed</th><th>Job card detail</th>{canWrite && <th aria-label="Action"></th>}</tr></thead>
            <tbody>
              {shown.map(({ f, jc, rb, status, age }) => (
                <tr key={f.id} tabIndex={0}
                    onClick={() => f.asset_code && (location.hash = `/asset/${f.asset_code}`)}
                    onKeyDown={(e) => e.key === 'Enter' && f.asset_code && (location.hash = `/asset/${f.asset_code}`)}>
                  <td data-l="Age"><span className={`jc-age${status === 'open' && age >= 30 ? ' hot' : status === 'open' && age >= 14 ? ' warm' : ''}`}>{age}d</span></td>
                  <td data-l="Status"><span className={`jc-pill ${STL[status][0]}`}>{STL[status][1]}</span></td>
                  <td className="code" data-l="Asset">{f.asset_code || '—'}</td>
                  <td className="dim" data-l="Station">{f.station || jc.station || '—'}</td>
                  <td className="dim" data-l="Location">{f.category || '—'}</td>
                  <td className="wrap-cell" data-l="Fault">{f.fault_type ? <b>{f.fault_type}</b> : tidyLog(f.text)}</td>
                  <td className="dim" data-l="Issued to">{jc.attended_by || '—'}</td>
                  <td className="dim dt" data-l="Raised">{jc.log_date}</td>
                  <td className="dim dt" data-l="Closed">{rb ? rb.log_date : '—'}</td>
                  <td className="wrap-cell" data-l="Detail">
                    {tidyLog(jc.text)}
                    <div className="jc-scan" onClick={(e) => e.stopPropagation()}>
                      {canWrite
                        ? <AttachmentUpload entryId={jc.id} existing={jc.attachments || []} label="Job card scan — photo or PDF" />
                        : <AttachmentView items={jc.attachments} />}
                    </div>
                    {rb && (rb.attachments?.length > 0) && (
                      <div className="jc-scan jc-scan-close" onClick={(e) => e.stopPropagation()}>
                        <span className="fg-lbl">Closure proof</span>
                        <AttachmentView items={rb.attachments} />
                      </div>
                    )}
                  </td>
                  {canWrite && (
                    <td className="td-edit" data-l="Action">
                      {status === 'open'
                        ? <a className="fa-btn fa-rect" href={`#/log?d=${f.log_date}&edit=${f.id}&resp=rectification`} onClick={(e) => e.stopPropagation()}>✓ Rectify / close</a>
                        : <EditLink id={f.id} date={f.log_date} label="Open in log book" />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/* ---------- shell + hash router ---------- */

const routeFromHash = () => location.hash.replace(/^#/, '') || '/'

/* Live deployments only show modules whose backend exists; the rest join the
   nav release by release. The demo build keeps the full walkthrough. */
const NAV = LIVE ? [
  ['/', 'Home'],
  ['/assets', 'Assets'],
  ['/log', 'Log book'],
  ['/failures', 'Failures'],
  ['/job-cards', 'Job cards'],
  ['/printables', 'Printables'],
] : [
  ['/', 'Assets'],
  ['/planner', 'Planner'],
  ['/roster', 'Duty roster'],
  ['/log', 'Log book'],
  ['/failures', 'Failures'],
  ['/spares', 'Spares'],
  ['/procurement', 'Procurement'],
  ['/printables', 'Printables'],
]

const NotYet = () => (
  <div className="card"><p className="dim" style={{ margin: 0 }}>
    This module isn't part of the installed release yet — it arrives with a
    later version. <a className="crumb" href="#/">← Back to assets</a>
  </p></div>
)

/* ---------- sign in (line-scoped operations) ---------- */

function LoginForm({ autoFocus = false }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await apiLogin(username.trim(), password)
      location.hash = '/'
      location.reload() // fresh session everywhere: nav, scope, authorship
    } catch (ex) {
      setErr(String(ex.message || 'login failed'))
      setBusy(false)
    }
  }
  return (
    <form className="login-form-fields" onSubmit={submit}>
      <input autoFocus={autoFocus} autoComplete="username" placeholder="Username"
             value={username} onChange={(e) => setUsername(e.target.value)} />
      <input type="password" autoComplete="current-password" placeholder="Password"
             value={password} onChange={(e) => setPassword(e.target.value)} />
      {err && <div className="login-err">{err}</div>}
      <button className="btn" type="submit" disabled={busy || !username.trim() || !password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

/* ---------- landing: four line squares + sign-in (anonymous home) ---------- */

/* Abstract alpona — the Bengali dot-and-petal floor motif, geometrized:
   a centre dot, two dotted rings, eight petal arcs. Watermark, not ornament. */
function Alpona({ size = 120 }) {
  const dots = (r, n, key) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return <circle key={`${key}${i}`} cx={60 + r * Math.cos(a)} cy={60 + r * Math.sin(a)} r="1.6" />
  })
  const petals = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * 360
    return <path key={`p${i}`} d="M 60 22 Q 66 34 60 44 Q 54 34 60 22 Z"
                 transform={`rotate(${a} 60 60)`} fill="currentColor" opacity="0.5" stroke="none" />
  })
  return (
    <svg className="alpona" width={size} height={size} viewBox="0 0 120 120" aria-hidden="true"
         fill="currentColor" stroke="currentColor" strokeWidth="1">
      <circle cx="60" cy="60" r="4" stroke="none" />
      <circle cx="60" cy="60" r="12" fill="none" opacity="0.7" />
      {petals}
      {dots(30, 16, 'a')}
      <circle cx="60" cy="60" r="50" fill="none" strokeDasharray="2 6" opacity="0.6" />
      {dots(57, 24, 'b')}
    </svg>
  )
}

function useLines() {
  const [lines, setLines] = useState(null)
  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.VITE_AMPS_API ?? ''}/api/lines`)
      .then((r) => (r.ok ? r.json() : []))
      .then((l) => alive && setLines(l))
      .catch(() => alive && setLines([]))
    return () => { alive = false }
  }, [])
  return lines
}

/* the metro-map ribbon: every line's colour in running order, blended
   into one continuous band — no joints, colours flow into each other */
const Ribbon = ({ lines }) => {
  if (!lines?.length) return null
  const n = lines.length
  const blend = Math.min(4, 20 / n) // soft crossfade zone between neighbours
  const stops = lines.map((l, i) => {
    const c = lineColor(l.name)
    return `${c} ${(i / n) * 100 + blend}%, ${c} ${((i + 1) / n) * 100 - blend}%`
  }).join(', ')
  return <div className="metro-ribbon" aria-hidden="true"
              style={{ background: `linear-gradient(90deg, ${stops})` }} />
}

/* Walk-up network glance: per-line health rolled up from the public reads
   (assets + maintenance schedule) plus the public per-line open-failure count.
   Everything here is an aggregate figure — no fault text, no crew — so it needs
   no sign-in. */
function useNetworkGlance() {
  const { assets: allAssets, sched, loading } = useLiveAssets()
  const assets = allAssets.filter((a) => a.status !== 'decommissioned' && a.status !== 'spare') // not in active service — not counted
  const [fail, setFail] = useState(null)
  useEffect(() => {
    getJSON('/api/logbook/failure-stats?days=180&months=6').then(setFail).catch(() => setFail({}))
  }, [])
  const stateOf = (a) => sched[assetKey(a)]?.state
  const perLine = {}
  for (const a of assets) {
    const ln = a.line || '—'
    const p = (perLine[ln] ||= { assets: 0, overdue: 0, dueSoon: 0, exceeded: 0 })
    p.assets += 1
    const s = stateOf(a)
    if (s === 'overdue') p.overdue += 1
    else if (s === 'due_soon') p.dueSoon += 1
    if (codalExceeded(a)) p.exceeded += 1
  }
  const openByLine = (fail && fail.by_line_open) || {}
  const net = {
    assets: assets.length,
    overdue: assets.filter((a) => stateOf(a) === 'overdue').length,
    dueSoon: assets.filter((a) => stateOf(a) === 'due_soon').length,
    exceeded: assets.filter(codalExceeded).length,
    open: fail ? (fail.open ?? 0) : null,
  }
  return { perLine, openByLine, net, loading, failReady: fail !== null }
}

function Landing() {
  const lines = useLines()
  const { perLine, openByLine, net, loading, failReady } = useNetworkGlance()
  const locations = lines ? lines.reduce((a, l) => a + l.stations, 0) : 0
  const nf = (v) => (v == null ? '—' : v.toLocaleString())
  const kpi = (v, k, cls) => (
    <div className={`land-kpi${cls ? ' ' + cls : ''}`}><div className="v">{v}</div><div className="k">{k}</div></div>
  )
  return (
    <div className="gate land">
      <div className="land-wrap">
        <header className="land-head">
          <img className="land-emblem" src={`${import.meta.env.BASE_URL}ir-railways.png`}
               alt="Indian Railways" />
          <div className="land-head-rule" aria-hidden="true" />
          <div>
            <div className="gate-badge">⚡ AMPS <span className="gate-live">● LIVE</span></div>
            <h1 className="gate-title">{ORG}</h1>
            <p className="gate-sub">Asset Maintenance &amp; Preventive Scheduling — every line at a glance</p>
          </div>
          <a className="btn gate-signin-btn" href="#/login">Sign in</a>
        </header>
        <Ribbon lines={lines} />

        <div className="land-body">
          <div className="land-tiles">
            {lines === null ? <p className="gate-dim">Loading…</p> : lines.length === 0 ? (
              <p className="gate-dim">No lines registered yet — the administrator adds them with the first assets.</p>
            ) : lines.map((l) => {
              const p = perLine[l.name] || {}
              const open = openByLine[l.name] || 0
              const chips = []
              if (open) chips.push(['alert', `${open} open`])
              if (p.overdue) chips.push(['warn', `${p.overdue} overdue`])
              if (p.exceeded) chips.push(['warn', `${p.exceeded} past life`])
              const clear = failReady && !loading && chips.length === 0
              return (
                <a key={l.name} className={`land-tile${l.initiator ? ' initiator' : ''}`}
                   href={`#/line/${encodeURIComponent(l.name)}`}
                   style={{ '--line-c': lineColor(l.name) }}>
                  {l.initiator && <Alpona />}
                  <span className="gate-line-dot" />
                  <span className="land-tile-name">{l.name}
                    {l.initiator && <span className="gate-initiator-chip">সূচনা · initiator</span>}
                  </span>
                  <span className="land-tile-sub">{l.assets} assets · {l.stations} locations</span>
                  <span className="land-tile-health">
                    {chips.map(([c, t]) => <span key={t} className={`land-hchip ${c}`}>{t}</span>)}
                    {clear && <span className="land-hchip ok">All clear</span>}
                  </span>
                  <span className="land-tile-go">View →</span>
                </a>
              )
            })}
          </div>

          {/* right rail: the network-wide figures, tucked over the train art so
              the right side reads as a balanced "at a glance" panel */}
          <aside className="land-glance">
            <div className="land-glance-h">Network at a glance</div>
            <div className="land-kpis">
              {kpi(lines ? lines.length : '—', 'Lines')}
              {kpi(loading ? '—' : nf(net.assets), 'Assets')}
              {kpi(nf(locations), 'Locations')}
              {kpi(net.open == null ? '—' : nf(net.open), 'Open failures', net.open ? 'alert' : '')}
              {kpi(loading ? '—' : nf(net.overdue), 'PM overdue', net.overdue ? 'warn' : '')}
              {kpi(loading ? '—' : nf(net.exceeded), 'Exceeded life', net.exceeded ? 'warn' : '')}
            </div>
          </aside>
        </div>
        <div className="gate-foot"><AmpsLink /> · MIT © 2026 <SignatureMark /></div>
      </div>
    </div>
  )
}

/* ---------- standalone sign-in page ---------- */

function LoginPage() {
  const lines = useLines()
  return (
    <div className="gate">
      <div className="gate-panel solo">
        <div className="gate-auth">
          <Ribbon lines={lines} />
          <div className="gate-auth-brand">Sign in to <span className="brand-name">AMPS</span></div>
          <p className="gate-auth-sub">{ORG} — operational access for your line: report failures, write the log, register assets. Viewing needs no account.</p>
          <LoginForm autoFocus />
          <a className="gate-back" href="#/">← Back to lines</a>
          <div className="gate-foot"><AmpsLink /> · MIT © 2026 <SignatureMark /></div>
        </div>
      </div>
    </div>
  )
}

/* ---------- one line, view-only (from a landing square) ---------- */

function LineView({ name }) {
  const { me } = useMe()
  // anon has the topbar tabs (Lines · Assets · Failures); only the signed-in
  // admin, whose global nav has no per-line failures, needs the in-view link
  const anon = LIVE && me?.auth_enabled && me?.username === 'viewer'
  return (
    <>
      {!anon && (
        <div className="line-subnav">
          {!me?.line && <a className="crumb" href="#/">← All lines</a>}
          <a className="btn ghost sm" href={`#/line/${encodeURIComponent(name)}/failures`}>Failures →</a>
        </div>
      )}
      <LiveDashboard go={(r) => { location.hash = r }} initialLine={name} />
    </>
  )
}

/* one line's failures board — reached at /line/<name>/failures */
function LineFailures({ name }) {
  return <LiveFailures line={name} />
}

/* legacy /failures — send the coordinator to their line's board, and anyone
   line-less (admin) to the first line's board */
function FailuresRedirect({ me }) {
  const lines = useLines()
  useEffect(() => {
    const to = me?.line || (lines && lines[0] && lines[0].name)
    if (to) location.replace(`#/line/${encodeURIComponent(to)}/failures`)
  }, [me, lines])
  return <p className="dim">Opening the failures board…</p>
}

export default function App() {
  const [route, setRoute] = useState(routeFromHash)
  const { me, loading: meLoading } = useMe()
  useEffect(() => {
    const onHash = () => { setRoute(routeFromHash()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = (r) => { location.hash = r }
  const authOn = LIVE && me?.auth_enabled
  const signedIn = authOn && me.username !== 'viewer'
  const anonymous = authOn && !signedIn

  // split the path from its query (e.g. /log?d=2026-01-13&edit=13863) so a
  // row anywhere can deep-link straight into the logbook to edit an entry
  const routePath = route.split('?')[0]
  const routeQuery = new URLSearchParams(route.split('?')[1] || '')
  const assetMatch = routePath.match(/^\/asset\/(.+)$/)
  // codes carry spaces/parens — the hash percent-encodes them, so decode once
  // here (encodeURIComponent is re-applied at fetch time). Guarded: a stray
  // '%' in a code would otherwise throw.
  const safeDecode = (s) => { try { return decodeURIComponent(s) } catch { return s } }
  const assetCode = assetMatch ? safeDecode(assetMatch[1]) : null
  // a line's own failures board lives under the line: /line/<name>/failures.
  // Match that first so the plain line route doesn't swallow the suffix.
  const lineFailMatch = routePath.match(/^\/line\/(.+)\/failures$/)
  const lineMatch = !lineFailMatch && routePath.match(/^\/line\/(.+)$/)
  const failLine = lineFailMatch ? safeDecode(lineFailMatch[1]) : null
  const letterMatch = routePath.match(/^\/procurement\/([^/]+)\/letter$/)
  const csMatch = routePath.match(/^\/checksheet\/(wo|pm)\/([^/]+)(?:\/(.+))?$/)
  const jcMatch = routePath.match(/^\/jobcard\/(.+)$/)

  if (LIVE && meLoading) return null // one clean paint: landing or app, never both

  // The train artwork is mounted once, outside the page switch — it never
  // reloads on navigation; only its opacity changes (full on the landing,
  // muted behind every other page).
  const onLanding = anonymous && routePath !== '/login' && !assetMatch && !lineMatch && !lineFailMatch
  const siteArt = (
    <img className={`site-art${onLanding ? '' : ' muted'}`} alt="" aria-hidden="true"
         src={`${import.meta.env.BASE_URL}landing-art.webp`} />
  )

  // Anonymous surface = landing (line squares + sign-in), a chosen line
  // view-only, and QR-scanned asset pages. Everything else routes home.
  if (anonymous) {
    if (routePath === '/login') return <>{siteArt}<LoginPage /></>
    if (onLanding) return <>{siteArt}<Landing /></> // full-screen, own chrome
    const navLine = failLine || (lineMatch ? decodeURIComponent(lineMatch[1]) : null)
    return (
      <>{siteArt}
      <div className="shell" style={navLine ? { '--nav-c': lineColor(navLine) } : undefined}>
        <header className="topbar">
  <Brand />
          <nav className="nav">
            <a href="#/" className={!navLine ? 'active' : ''}>Lines</a>
            {navLine && !assetMatch && (
              <>
                <a href={`#/line/${encodeURIComponent(navLine)}`} className={lineMatch ? 'active' : ''}>Assets</a>
                <a href={`#/line/${encodeURIComponent(navLine)}/failures`} className={failLine ? 'active' : ''}>Failures</a>
              </>
            )}
            <a href="#/login" className="btn login-btn">Sign in</a>
          </nav>
        </header>
        {failLine ? <LineFailures name={failLine} />
          : assetMatch ? <LiveAssetDetail code={assetCode} />
          : <LineView name={decodeURIComponent(lineMatch[1])} />}
        <footer className="foot">{ORG} · maintenance records · <AmpsLink />, MIT © 2026 <FootSig /></footer>
      </div>
      </>
    )
  }

  const navLine = lineMatch ? decodeURIComponent(lineMatch[1]) : (signedIn && me.line) || null
  return (
    <>{siteArt}
    <div className="shell" style={navLine ? { '--nav-c': lineColor(navLine) } : undefined}>
      <header className="topbar">
<Brand />
        <nav className="nav">
          {NAV.map(([path, label]) => {
            // Failures is per-line now: send a coordinator to their own line's
            // board, an admin to the line in view (or the redirect picker).
            if (LIVE && path === '/failures') {
              const fl = me?.line || navLine
              const href = fl ? `#/line/${encodeURIComponent(fl)}/failures` : '#/failures'
              return <a key={path} href={href} className={lineFailMatch ? 'active' : ''}>{label}</a>
            }
            if (path === '/printables') return <PrintablesNav key={path} active={routePath === '/printables'} />
            return <a key={path} href={`#${path}`} className={routePath === path ? 'active' : ''}>{label}</a>
          })}
          {!LIVE && <ShowcaseDropdown />}
          {signedIn && (
            <span className="who">
              <span className="dot" style={{ background: lineColor(me.line || '') }} />
              {me.full_name}{me.line ? ` · ${me.line}` : ''}
              <button className="mini-btn muted" type="button" onClick={apiLogout}>Sign out</button>
            </span>
          )}
        </nav>
      </header>

      {assetMatch ? (LIVE ? <LiveAssetDetail code={assetCode} /> : <AssetDetail code={assetCode} />)
        : lineFailMatch ? (LIVE ? <LineFailures name={failLine} /> : <Failures />)
        : lineMatch ? (LIVE ? <LineView name={decodeURIComponent(lineMatch[1])} /> : <NotYet />)
        : letterMatch ? (LIVE ? <NotYet /> : <ProposalLetter prId={letterMatch[1]} />)
        : csMatch ? (LIVE ? <NotYet /> : <Checksheet kind={csMatch[1]} a1={csMatch[2]} a2={csMatch[3]} />)
        : jcMatch ? (LIVE ? <NotYet /> : <JobCard jcId={jcMatch[1]} />)
        : routePath === '/planner' ? (LIVE ? <NotYet /> : <Planner />)
        : routePath === '/roster' ? (LIVE ? <NotYet /> : <DutyRoster />)
        : routePath === '/log' ? <LogBook editId={routeQuery.get('edit')} focusDate={routeQuery.get('d')} initialResp={routeQuery.get('resp')} initialAsset={routeQuery.get('asset')} />
        /* legacy top-level /failures now redirects to the signed-in line's board */
        : routePath === '/failures' ? (LIVE ? <FailuresRedirect me={me} go={go} /> : <Failures />)
        : routePath === '/job-cards' ? (LIVE ? <JobCardsView line={signedIn && me.line ? me.line : ''} /> : <NotYet />)
        : routePath === '/spares' ? (LIVE ? <NotYet /> : <Spares />)
        : routePath === '/procurement' ? (LIVE ? <NotYet /> : <Procurement />)
        : routePath === '/printables' ? <Printables initial={routeQuery.get('t') || 'qr'} />
        : routePath === '/tags' ? <Printables initial="qr" />
        : routePath === '/about' ? <AboutPage />
        : routePath === '/assets' ? (LIVE ? <LiveDashboard go={go} /> : <Dashboard go={go} />)
        : (LIVE ? <LineDashboard go={go} /> : <Dashboard go={go} />)}

      <footer className="foot">
        {LIVE
          ? <>{ORG} · maintenance records · <AmpsLink />, MIT © 2026 </>
          : <>Demonstration environment · synthetic data only · <AmpsLink />, MIT © 2026 </>}
        <FootSig />
      </footer>
    </div>
    </>
  )
}
