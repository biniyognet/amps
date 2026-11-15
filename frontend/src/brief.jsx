/* Public-demo guide: a brief AMPS document with the pitch deck embedded.
   Neutral builds only (VITE_AMPS_BRAND=neutral) — the operator build keeps the
   sidebar guide. Bracketed text is a placeholder to fill before presenting. */
import { useEffect, useRef, useState } from 'react'
import { getJSON } from './api.js'
import './brief.css'

const FONTS = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,650&family=JetBrains+Mono:wght@400;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap'

function useFonts() {
  useEffect(() => {
    if (document.getElementById('brief-fonts')) return
    const l = Object.assign(document.createElement('link'), { id: 'brief-fonts', rel: 'stylesheet', href: FONTS })
    document.head.appendChild(l)
  }, [])
}

function useNetwork() {
  const [d, set] = useState(null)
  useEffect(() => {
    Promise.all([getJSON('/api/lines'), getJSON('/api/failures/stats').catch(() => null)])
      .then(([lines, fs]) => set({ lines, fs })).catch(() => set({ lines: [], fs: null }))
  }, [])
  return d
}

const n = (x) => (x || 0).toLocaleString('en-IN')

const COMPARE = [
  ['Rollout', 'Months to years, with an implementation partner', 'Weeks — import the asset register and start logging'],
  ['Licence', '[₹__ per user per year]', '₹0 — MIT open source'],
  ['Field use', 'Desktop-first; mobile is an add-on', 'Phone-first browser app; scan a QR on the equipment'],
  ['Records', 'Editable transactions', 'Append-only log book — a clean audit trail'],
  ['Data', 'Vendor format and tooling', 'Open PostgreSQL — your data, your server or ours'],
  ['Fit', 'Generic EAM, configured per customer', 'Built by engineers who run a live metro power system'],
]

function Slides({ net }) {
  const tot = (k) => (net?.lines || []).reduce((s, l) => s + (l[k] || 0), 0)
  return [
    <div className="bs bs-dark bs-cover" key="cover">
      <p className="bs-eye">STARTUP CONCLAVE · BINIYOG</p>
      <h2 className="bs-huge">AMPS</h2>
      <p className="bs-lead">Asset Maintenance &amp; Preventive Scheduling — open-source maintenance software for any plant — metros, utilities, factories, campuses.</p>
      <p className="bs-mono">Proven on a live metro railway · ₹0 licence · amps.binihost.com</p>
    </div>,
    <div className="bs" key="problem">
      <p className="bs-eye">THE PROBLEM</p>
      <h2>Critical equipment is still maintained from paper registers</h2>
      <div className="bs-g3">
        <div><b>Logbooks nobody can search</b><span>Years of failure history sit in bound registers. A repeating fault shows no pattern.</span></div>
        <div><b>Schedules live in heads</b><span>Preventive maintenance slips when the one person who tracks it is away.</span></div>
        <div><b>Enterprise EAM is out of reach</b><span>Commercial suites cost crores and years. Most depots and plants never get one.</span></div>
      </div>
    </div>,
    <div className="bs bs-mist" key="product">
      <p className="bs-eye">WHAT AMPS DOES</p>
      <h2>One register for every asset, every record, every device</h2>
      <div className="bs-g3">
        <div><b>QR asset register</b><span>Scan the tag, open the full history.</span></div>
        <div><b>Append-only log book</b><span>Entries can't be rewritten after the fact.</span></div>
        <div><b>Failure analytics</b><span>Failures, downtime, MTTR by system and asset.</span></div>
        <div><b>PM scheduling</b><span>Due and overdue work surfaces on its own.</span></div>
        <div><b>Multi-site, role-based</b><span>Sites, areas, units — each with the right access.</span></div>
        <div><b>Any device</b><span>Phone, tablet or desktop browser.</span></div>
      </div>
    </div>,
    <div className="bs" key="demo">
      <p className="bs-eye">LIVE DEMO · THIS SITE</p>
      <h2>Four synthetic plant sites, running now</h2>
      {!net ? <p className="bs-lead">Loading…</p> : (<>
        <div className="bs-kpi">
          <div><b>{net.lines.length}</b><span>sites</span></div>
          <div><b>{n(tot('stations'))}</b><span>areas</span></div>
          <div><b>{n(tot('assets'))}</b><span>assets</span></div>
          <div><b>{n(net.fs?.outstanding ?? net.fs?.open)}</b><span>failures outstanding</span></div>
        </div>
        <p className="bs-mono">Metro · power substation · water works · factory — synthetic data, open any site</p>
      </>)}
    </div>,
    <div className="bs bs-dark" key="proof">
      <p className="bs-eye">PROVEN IN PRODUCTION</p>
      <h2>Running today on the power system of a metro railway in India</h2>
      <div className="bs-kpi">
        <div><b>3,050</b><span>assets registered and tagged</span></div>
        <div><b>18,000+</b><span>records, 2020–2026, migrated and live</span></div>
        <div><b>₹0</b><span>licence cost to the operator</span></div>
      </div>
    </div>,
    <div className="bs" key="sap">
      <p className="bs-eye">NEXT-GENERATION EAM</p>
      <h2>Legacy EAM (SAP PM-class) vs AMPS</h2>
      <table className="bs-cmp"><thead><tr><th /><th>Legacy EAM</th><th>AMPS</th></tr></thead>
        <tbody>{COMPARE.slice(0, 5).map(([k, a, b]) => <tr key={k}><td>{k}</td><td>{a}</td><td>{b}</td></tr>)}</tbody></table>
    </div>,
    <div className="bs" key="cost">
      <p className="bs-eye">COST OF OWNERSHIP</p>
      <h2>Pay for outcomes, not licences</h2>
      <div className="bs-g2">
        <div><b>Typical commercial CMMS</b><span>Per-user licence [₹__ per year] · implementation partner [₹__] · rollout [__ months] · data in the vendor's format</span></div>
        <div className="bs-hi"><b>AMPS</b><span>Licence ₹0, MIT · pay only for the hosting, onboarding and support you choose · your server or ours · open PostgreSQL</span></div>
      </div>
    </div>,
    <div className="bs bs-mist" key="model">
      <p className="bs-eye">BUSINESS MODEL · OPEN CORE</p>
      <h2>The framework is free forever. Services pay the bills.</h2>
      <div className="bs-g4">
        <div><i>FREE</i><b>Framework</b><span>MIT. Self-host, fork, keep it.</span></div>
        <div><i>PAID</i><b>Hosted</b><span>Managed cloud, backups, updates.</span></div>
        <div><i>PAID</i><b>Onboarding</b><span>Asset tagging, register migration.</span></div>
        <div><i>PAID</i><b>Support &amp; custom</b><span>Plans and features to order.</span></div>
      </div>
    </div>,
    <div className="bs" key="who">
      <p className="bs-eye">WHO IT IS FOR</p>
      <h2>Anyone who keeps critical equipment running</h2>
      <div className="bs-g4">
        <div><b>Transit</b><span>Metros, rail depots, traction substations</span></div>
        <div><b>Utilities</b><span>Power, water, distribution networks</span></div>
        <div><b>Factories</b><span>Plant machinery, production lines</span></div>
        <div><b>Campuses</b><span>Hospitals, universities, large buildings</span></div>
      </div>
    </div>,
    <div className="bs bs-dark" key="stack">
      <p className="bs-eye">UNDER THE HOOD</p>
      <h2>Plain, proven, open technology</h2>
      <div className="bs-g3">
        <div><b>FastAPI + PostgreSQL</b><span>Open data model. No lock-in.</span></div>
        <div><b>React</b><span>Fast browser app. QR made on the device.</span></div>
        <div><b>Cloudflare Tunnel</b><span>Secure remote access, no open ports.</span></div>
      </div>
      <p className="bs-mono">github.com/arupbiswas1994-byte/amps · MIT</p>
    </div>,
    <div className="bs bs-dark bs-cover" key="ask">
      <p className="bs-eye">TEAM &amp; ASK</p>
      <h2>Built by biniyog · delivered by biniDev</h2>
      <p className="bs-lead">Team: [Name, role] · [Name, role] · [Name, role]</p>
      <div className="bs-g3">
        <div><i>PILOTS</i><span>[Two or three depots or plants]</span></div>
        <div><i>PARTNERS</i><span>[Integrators and OEMs]</span></div>
        <div><i>FUNDING</i><span>[₹__ for onboarding and support]</span></div>
      </div>
      <p className="bs-mono">Try it now: amps.binihost.com</p>
    </div>,
  ]
}

function Deck({ net }) {
  const slides = Slides({ net })
  const [i, setI] = useState(0)
  const ref = useRef(null)
  const last = slides.length - 1
  useEffect(() => {
    const k = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return
      if (['ArrowRight', 'PageDown', 'n'].includes(e.key)) setI((x) => Math.min(last, x + 1))
      if (['ArrowLeft', 'PageUp', 'N', 'p'].includes(e.key)) setI((x) => Math.max(0, x - 1))
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [last])
  return (
    <figure className="br-deck" ref={ref}>
      <div className="br-stage">{slides[i]}</div>
      <figcaption className="br-ctl">
        <button type="button" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>‹ Prev</button>
        <span className="br-dots">{slides.map((_, j) => <i key={j} className={j === i ? 'on' : ''} onClick={() => setI(j)} />)}</span>
        <span className="br-count">{i + 1} / {slides.length}</span>
        <button type="button" onClick={() => setI(Math.min(last, i + 1))} disabled={i === last}>Next ›</button>
        <button type="button" onClick={() => ref.current?.requestFullscreen?.()}>Full screen</button>
      </figcaption>
    </figure>
  )
}

export default function Brief() {
  useFonts()
  const net = useNetwork()
  return (
    <article className="brief">
      <p className="br-kick">BRIEF · AMPS · OPEN-SOURCE EAM · {new Date().getFullYear()}</p>
      <h1>AMPS — maintenance records that run themselves</h1>
      <p className="br-dek">A next-generation alternative to SAP PM / Maximo-class EAM for any plant: QR-first, phone-first,
        live in weeks, ₹0 licence. Already running the power-system maintenance of a metro railway in India.</p>
      <div className="br-delta">
        <div><b>3,050</b><span>assets in production</span></div>
        <div><b>18,000+</b><span>records migrated, 2020–2026</span></div>
        <div><b>₹0</b><span>licence cost</span></div>
      </div>

      <h2><span>Deck</span>The pitch, in eleven slides</h2>
      <p className="br-note">← → or n / p to step · Full screen to present</p>
      <Deck net={net} />

      <h2><span>§1</span>Problem</h2>
      <p>Most maintenance teams in India still run critical equipment from paper registers. Failure history can't be
        searched, preventive schedules depend on individuals, and enterprise EAM suites are priced and paced for
        the largest organisations — most depots and plants never get one.</p>

      <h2><span>§2</span>What AMPS does</h2>
      <ul>
        <li><b>Asset register</b> — every asset by site, area and unit, with a QR tag that opens its history.</li>
        <li><b>Log book</b> — preventive maintenance by cycle (monthly to 5-yearly), append-only; bulk import from Excel.</li>
        <li><b>Dashboards</b> — on schedule · due soon · overdue, worked out from the logs, per site and estate-wide.</li>
        <li><b>Failures &amp; job cards</b> — failure → rectification, downtime and MTTR computed; agency work tracked to closure.</li>
        <li><b>Checksheets</b> — per-class formats, approved by an in-charge, printed on demand.</li>
      </ul>

      <h2><span>§3</span>Proof</h2>
      <p>AMPS is not a prototype. It runs in production on a metro railway power system: 3,050 assets registered and
        tagged, and six years of maintenance and failure records migrated in. The operator paid nothing for licences.
        This site runs the same code against four synthetic plant sites — a metro, a power substation, a water works and a factory
        {net?.lines?.length ? <> ({n(net.lines.reduce((s, l) => s + (l.assets || 0), 0))} assets)</> : null}.</p>

      <h2><span>§4</span>Legacy EAM (SAP PM-class) vs AMPS</h2>
      <table className="br-cmp"><thead><tr><th /><th>Legacy EAM</th><th>AMPS</th></tr></thead>
        <tbody>{COMPARE.map(([k, a, b]) => <tr key={k}><td>{k}</td><td>{a}</td><td>{b}</td></tr>)}</tbody></table>
      <p className="br-note">Factual comparison of product approach. Commercial figures stay bracketed until sourced from a citable quote.</p>

      <h2><span>§5</span>Open-core model</h2>
      <p>The framework is free forever under MIT — self-host it, fork it, keep it. Revenue comes from hosting,
        onboarding (asset tagging, migration of old registers), and support or custom features, delivered by biniDev.</p>

      <h2><span>§6</span>Who it's for</h2>
      <p>Transit (metros, rail depots, traction substations) · utilities (power, water, distribution) · factories ·
        large campuses — anyone with equipment that must not fail.</p>

      <h2><span>§7</span>Team &amp; ask</h2>
      <p>Built by biniyog · delivered by biniDev. Team: [Name, role] · [Name, role] · [Name, role].</p>
      <ul>
        <li><b>Pilots</b> — [two or three depots or plants]</li>
        <li><b>Partners</b> — [integrators and OEMs in transit and utilities]</li>
        <li><b>Funding</b> — [₹__ for onboarding and support team]</li>
      </ul>
      <p className="br-foot">Source: github.com/arupbiswas1994-byte/amps · MIT · Demo data on this site is synthetic.</p>
    </article>
  )
}
