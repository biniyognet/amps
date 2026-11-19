/* Guide — a sidebar of guides, access levels, reference documents and a
   presentation deck for the GM. Sub-pages are /guide?s=<id>; the deck is
   /guide?s=gm (arrow keys / buttons step the slides). */
import { useEffect, useState } from 'react'
import { LIVE, ORG, OPERATOR, getJSON, useMe } from './api.js'
import Brief from './brief.jsx'

const SECTIONS = [
  ['Guides', [
    ['coordinator', "Coordinator's guide"],
    ['logbook', 'Log book & failures'],
    ['tenders', 'Tenders & contract reader'],
  ]],
  ['Access', [
    ['access', 'Access levels'],
    ['users', 'Users & their access'],
  ]],
  ['Documents', [
    ['order', 'Office order 6746 / 6747'],
    ['data', 'What AMPS records'],
  ]],
  ['Presentation', [
    ['gm', 'Pitch'],
  ]],
]

const ROLES = [
  ['Admin', 'Whole department', 'Everything, every line', 'All records · users · imports'],
  ['In-charge (IC)', 'Own line / depot', 'Everything', 'Logs, failures, job cards · approves checksheet formats'],
  ['Supervisor', 'Own line / depot', 'Everything', 'Logs, failures, job cards, letters'],
  ['Technician', 'Own line / depot', 'Everything', 'Log book entries, failures'],
  ['Viewer (line login)', 'Whole line', 'Everything', '— read only'],
  ['Public / QR scan', '—', 'Line dashboards, single-asset pages', '— read only'],
]

function Coordinator() {
  return (<>
    <h1 className="docs-h1">Coordinator's guide</h1>
    <p className="docs-lead">A short guide to bringing your depot's assets on to AMPS and keeping the
      maintenance logs current. Any difficulty, contact the AMPS coordination desk.</p>
    <section className="card docs-sec">
      <h2>1 · How AMPS is organised</h2>
      <ul>
        <li>AMPS is <b>depot-wise</b>. Each line has one or more depots; each depot has its own
          <b> Assets</b> and <b>Logs</b> tab pair in the coordination sheet.</li>
        <li>Your login is <b>scoped to your depot</b> — you see and edit only your own depot.</li>
        <li>The <b>Green Line (CPD)</b> register is the reference standard for format.</li>
      </ul>
    </section>
    <section className="card docs-sec">
      <h2>2 · Onboarding your assets</h2>
      <ol>
        <li>Open your depot's <b>Assets</b> tab in the coordination sheet.</li>
        <li>Fill <b>one row per asset</b>. The mandatory columns are
          <span className="docs-k">code</span>, <span className="docs-k">name</span>,
          <span className="docs-k">asset_class</span> and <span className="docs-k">location</span> (station) —
          a row missing any of these cannot be imported.</li>
        <li>Optional but useful: <span className="docs-k">system</span>, <span className="docs-k">make_model</span>,
          <span className="docs-k">criticality</span> (A/B/C), <span className="docs-k">status</span>,
          <span className="docs-k">commissioned_on</span>, <span className="docs-k">description</span>,
          <span className="docs-k">remarks</span>, <span className="docs-k">codal_life_years</span>, and the
          PM-cycle ticks (<span className="docs-k">Monthly … 5-Yearly</span>).</li>
        <li>Start with a <b>minimum working set</b> — you can add more rows any time; they are imported phase-wise.</li>
      </ol>
      <p className="docs-note">The coordination desk imports the sheet — you do not need to re-enter anything
        in the app. Existing rows are skipped on re-import, so it is always safe to add more.</p>
    </section>
    <section className="card docs-sec">
      <h2>3 · Getting help</h2>
      <p>The coordination desk will assist with onboarding, orientation and any format question. If a row
        won't import, it is almost always a blank <span className="docs-k">asset_class</span> or
        <span className="docs-k">location</span> — fill it and tell the desk, and it will be picked up the same day.</p>
    </section>
  </>)
}

function LogbookGuide() {
  return (<>
    <h1 className="docs-h1">Log book &amp; failures</h1>
    <p className="docs-lead">The logs, not the asset list, are what the dashboards are built from.</p>
    <section className="card docs-sec">
      <h2>Recording maintenance</h2>
      <ul>
        <li>Open <b>Log book</b> and add an entry against the asset's <b>code</b>, choosing the cycle
          (Monthly / Quarterly / Half-Yearly / Yearly).</li>
        <li>To enter many at once, use the <b>grid (▦)</b> — you can paste rows straight from Excel.</li>
        <li>Each entry moves the asset's <b>next due</b> date; the line dashboard shows On schedule, Due soon,
          Overdue and Awaiting 1st service from it.</li>
      </ul>
    </section>
    <section className="card docs-sec">
      <h2>Failures &amp; job cards</h2>
      <ul>
        <li>Record a <b>failure</b> as it happens and close it with a <b>rectification</b>; downtime is then
          worked out automatically.</li>
        <li>Each line has its own failures board — <b>Failures</b> in the top bar opens your line's board.</li>
        <li>A <b>job card</b> to an agency is logged the same way and tracked till closure.</li>
      </ul>
    </section>
  </>)
}

function TendersGuide() {
  return (<>
    <h1 className="docs-h1">Tenders &amp; contract reader</h1>
    <section className="card docs-sec">
      <ul>
        <li><b>More ▸ Tenders</b> lists every contract with its volumes and indexing status.</li>
        <li>The <b>reader</b> opens a volume at a page and searches the clauses inside it.</li>
        <li>Notes and issues against a contract are editable by Green Line logins; every other line reads.</li>
      </ul>
      <p><a href="#/tenders?guide">Open the full tenders guide →</a></p>
    </section>
  </>)
}

function AccessLevels() {
  return (<>
    <h1 className="docs-h1">Access levels</h1>
    <p className="docs-lead">Reading is open so a QR sticker on any asset works without a login. Writing always
      needs a named login, and is limited to that login's line (and depot, when one is set).</p>
    <section className="card docs-sec gd-tablewrap">
      <table className="gd-table">
        <thead><tr><th>Role</th><th>Scope</th><th>Can read</th><th>Can write</th></tr></thead>
        <tbody>{ROLES.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{i === 0 ? <b>{c}</b> : c}</td>)}</tr>)}</tbody>
      </table>
    </section>
    <section className="card docs-sec">
      <h2>How scope works</h2>
      <ul>
        <li><b>Line</b> — a login tied to a line edits only that line's assets, logs and failures.</li>
        <li><b>Depot</b> — a narrower scope inside the line (e.g. one depot's assets only).</li>
        <li><b>No line</b> — department-wide (admin / HQ).</li>
        <li>Shared line logins are <b>view-only</b>; every person who records work gets their own login.</li>
        <li>Every write is stamped with the login that made it.</li>
      </ul>
    </section>
  </>)
}

const seen = (iso) => {
  if (!iso) return 'Never'
  const d = new Date(iso)
  const t = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate())
  const days = Math.round((day(new Date()) - day(d)) / 864e5)
  if (days === 0) return `Today ${t}`
  if (days === 1) return `Yesterday ${t}`
  if (days < 30) return `${days} days ago`
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Users() {
  const { me, loading } = useMe()
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const signedIn = me && me.username !== 'viewer'
  useEffect(() => {
    if (!LIVE || !signedIn) return
    getJSON('/api/auth/directory').then(setRows).catch((e) => setErr(String(e.message || e)))
  }, [signedIn])
  const roleLabel = { admin: 'Admin', incharge: 'In-charge', supervisor: 'Supervisor', technician: 'Technician', viewer: 'Viewer' }
  return (<>
    <h1 className="docs-h1">Users &amp; their access</h1>
    {loading ? <p className="dim">Loading…</p>
      : !signedIn ? <section className="card docs-sec"><p>Sign in to see the list of users. <a href="#/login">Sign in →</a></p></section>
      : err ? <p className="dim">Could not load the list ({err}).</p>
      : !rows ? <p className="dim">Loading…</p>
      : (
        <section className="card docs-sec gd-tablewrap">
          <p className="gd-count">{rows.length} logins</p>
          <table className="gd-table">
            <thead><tr><th>Name</th>{rows.some((r) => r.username) && <th>Login</th>}<th>Access</th><th>Line</th><th>Depot</th>{rows.some((x) => x.username) && <th>Last login</th>}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}>
                <td><b>{r.full_name}</b></td>
                {rows.some((x) => x.username) && <td className="gd-mono">{r.username}</td>}
                <td><span className={`gd-role r-${r.role}`}>{roleLabel[r.role] || r.role}</span></td>
                <td>{r.line || 'All lines'}</td>
                <td>{r.depot || '—'}</td>
                {rows.some((x) => x.username) && <td className="dim" title={r.last_login || ''}>{seen(r.last_login)}</td>}
              </tr>))}</tbody>
          </table>
        </section>)}
  </>)
}

function OrderDoc() {
  return (<>
    <h1 className="docs-h1">Office order 6746 / 6747</h1>
    <section className="card docs-sec">
      <p>AMPS was adopted for the department by office order
        No.&nbsp;MRK/CPD/E&amp;M/Co-Ord/6746 (and 6747), dated 22&nbsp;July&nbsp;2026, which asks every line to bring
        its assets and maintenance records on to it.</p>
      <p><a href="#/about">Read the About page →</a></p>
    </section>
  </>)
}

function DataDoc() {
  const items = [
    ['Asset', 'code, name, class, station, system, make/model, criticality, commissioning date, codal life'],
    ['Maintenance log', 'asset, date, cycle (Monthly … 5-Yearly), done by, remarks'],
    ['Failure', 'asset, time noticed, description; closed by a rectification → downtime'],
    ['Job card', 'work given to an agency, its status and closure'],
    ['Checksheet format', 'the per-class check list, approved by an in-charge'],
    ['Letters', 'correspondence logged against a line'],
    ['Tenders', 'contract volumes, indexed pages, notes and issues'],
  ]
  return (<>
    <h1 className="docs-h1">What AMPS records</h1>
    <section className="card docs-sec gd-tablewrap">
      <table className="gd-table"><tbody>{items.map(([k, v]) => <tr key={k}><td><b>{k}</b></td><td>{v}</td></tr>)}</tbody></table>
    </section>
  </>)
}

/* ---------------- GM briefing deck ---------------- */
function Deck() {
  const [i, setI] = useState(0)
  // v3 deck (17.11.2026, 19 slides): slide images rendered from AMPS_GM_presentation.pdf
  const slides = Array.from({ length: 19 }, (_, k) => (
    <img className="gd-img" key={k} src={`/pitch-gm/${String(k + 1).padStart(2, '0')}.webp`} alt={`Slide ${k + 1}`} />))
  const n = slides.length
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setI((x) => Math.min(n - 1, x + 1))
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setI((x) => Math.max(0, x - 1))
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [n])
  const full = () => document.querySelector('.gd-deck')?.requestFullscreen?.()
  return (<>
    <h1 className="docs-h1">Pitch</h1>
    <div className="gd-deck">
      {slides[i]}
      <div className="gd-ctl">
        <button className="mini-btn" type="button" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>‹ Prev</button>
        <span>{i + 1} / {n}</span>
        <button className="mini-btn" type="button" onClick={() => setI(Math.min(n - 1, i + 1))} disabled={i === n - 1}>Next ›</button>
        <button className="mini-btn muted" type="button" onClick={full}>Full screen</button>
        <a className="mini-btn muted" href="/pitch-gm/AMPS_GM_presentation.pdf" download>PDF</a>
      </div>
    </div>
  </>)
}

const PAGES = { coordinator: Coordinator, logbook: LogbookGuide, tenders: TendersGuide, access: AccessLevels,
  users: Users, order: OrderDoc, data: DataDoc, gm: Deck }

export function GuideView({ section }) {
  if (!OPERATOR) return <Brief />
  const s = PAGES[section] ? section : 'coordinator'
  const Page = PAGES[s]
  const [group, label] = (() => { for (const [h, items] of SECTIONS) for (const [id, l] of items) if (id === s) return [h, l]; return ['', ''] })()
  return (
    <>
    <div className="asset-toolbar pg-dock gd-dock no-print">
      <h1 className="dash-title">Guide</h1>
      <span className="dash-crumb">{group} › {label}</span>
      <span className="pd-sp" />
      <div className="asset-actions">
        <button type="button" className="icon-btn" title="Print this page" aria-label="Print this page" onClick={() => window.print()}>
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 6V2.5h7V6M4.5 12H3.2V6.4h9.6V12H11.5M4.5 9.6h7V13.5h-7z" /></svg>
        </button>
      </div>
    </div>
    <div className="gd">
      <aside className="gd-side">
        {SECTIONS.map(([head, items]) => (
          <div key={head} className="gd-group">
            <div className="gd-head">{head}</div>
            {items.map(([id, label]) => (
              <a key={id} href={`#/guide?s=${id}`} className={`gd-link${s === id ? ' active' : ''}`}>{label}</a>
            ))}
          </div>
        ))}
      </aside>
      <div className="gd-main docs"><Page /></div>
    </div>
    </>
  )
}
