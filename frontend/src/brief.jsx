/* Public-demo pitch page: a brief AMPS document with the pitch deck embedded.
   Neutral builds only (VITE_AMPS_BRAND=neutral) — the operator build keeps the
   sidebar guide. */
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
  ['Licence', 'Per-user, per-year licences', '₹0 · MIT open source'],
  ['Rollout', 'Months, with an implementation partner', 'Weeks · import the old registers'],
  ['Field use', 'Desktop-first, built for planners', 'QR-first, any phone, built for technicians'],
  ['Your data', "In the vendor's format", 'Yours, in open PostgreSQL'],
  ['AI', 'Add-on modules, if any', 'Gemini answers, job cards, early warnings'],
]

// The pitch deck, rendered from the same source as the PDF (public/pitch/) —
// one deck, two forms. Titles double as alt text.
const SLIDES = [
  'AMPS', 'Critical equipment is still maintained from paper registers',
  'One register for every asset, every record, every device', 'Every site’s PM compliance, at a glance',
  'From a register to a maintenance cockpit', 'Scattered breakdowns become one clear bottleneck',
  'Gemini turns the logbook into answers, job cards and early warnings',
  'AI drafts the maintenance plan. A supervisor approves it.',
  'Running today on the power system of a metro railway in India',
  'Next-generation EAM, without the legacy weight', 'The framework is free forever. Services pay the bills.',
  'Anyone who keeps critical equipment running', 'MVP on our own cluster today, built to scale on Google Cloud',
  'Built by biniyog · delivered by biniDev',
]
// Live demo entry points — every link opens the real app on synthetic data.
const TRY = [
  ['#/', 'Network dashboard', 'Every site’s PM compliance, overdue work and failures on one screen'],
  ['#/line/Riverside%20Metro', 'A site, close up', 'One line’s schedule: on time, due soon, overdue, by system'],
  ['#/assets', 'Asset register', 'Filter by site, class, criticality; every row opens its history'],
  ['#/asset/RVM-RIV-TTR-01', 'What a QR tag opens', 'One transformer: details, PM history, failures, job cards'],
  ['#/log', 'Log book', 'Preventive maintenance entries by date and cycle'],
  ['#/failures', 'Failures', 'Breakdowns, rectification, downtime and MTTR'],
  ['#/job-cards', 'Job cards', 'Agency work tracked from issue to closure'],
  ['#/printables', 'Printables', 'QR tags and per-class checksheets, ready to print'],
]

const FAQ = [
  ['Do we need new hardware?', 'No. AMPS runs on one ordinary server or a small VM; staff use the phones and PCs they already have. Viewing needs no login.'],
  ['What happens to our old registers?', 'They are imported. Excel and scanned registers are migrated in during onboarding, so history starts on day one, not from zero.'],
  ['Where does our data live?', 'In your own PostgreSQL database, on your premises or your cloud. Nothing is locked in a vendor format; export is a SQL dump away.'],
  ['Is the AI optional?', 'Yes. Every register, schedule and report works without it. Ask AMPS uses Gemini today; an on-premises model is an option for sites where no record may leave the building.'],
  ['How long does a rollout take?', 'Weeks, not months: import the old registers, tag the assets, start logging. No implementation partner needed.'],
  ['What does it cost?', 'The software is free (MIT). You pay only for what you choose: hosting, onboarding and tagging, support or custom features.'],
]

const PITCH = `${import.meta.env.BASE_URL}pitch/`
const src = (i) => `${PITCH}${String(i + 1).padStart(2, '0')}.webp?v=1115b`

function Deck() {
  const [i, setI] = useState(0)
  const ref = useRef(null)
  const last = SLIDES.length - 1
  useEffect(() => {
    const k = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return
      if (['ArrowRight', 'PageDown', 'n'].includes(e.key)) setI((x) => Math.min(last, x + 1))
      if (['ArrowLeft', 'PageUp', 'N', 'p'].includes(e.key)) setI((x) => Math.max(0, x - 1))
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [last])
  // warm the neighbours so stepping never shows a blank stage
  useEffect(() => { [i - 1, i + 1].forEach((j) => { if (j >= 0 && j <= last) new Image().src = src(j) }) }, [i, last])
  return (
    <figure className="br-deck" ref={ref}>
      <div className="br-stage"><img src={src(i)} alt={SLIDES[i]} width="1600" height="900" /></div>
      <figcaption className="br-ctl">
        <button type="button" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>‹ Prev</button>
        <span className="br-dots">{SLIDES.map((t, j) => <i key={j} title={t} className={j === i ? 'on' : ''} onClick={() => setI(j)} />)}</span>
        <span className="br-count">{i + 1} / {SLIDES.length}</span>
        <button type="button" onClick={() => setI(Math.min(last, i + 1))} disabled={i === last}>Next ›</button>
        <button type="button" onClick={() => ref.current?.requestFullscreen?.()}>Full screen</button>
        <a className="br-pdf" href={`${PITCH}AMPS_pitch_deck.pdf?v=1115b`} download>Download PDF</a>
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
        <div><b>7,900+</b><span>assets in production, 5 lines</span></div>
        <div><b>33,000+</b><span>maintenance records, 2020–2026</span></div>
        <div><b>₹0</b><span>licence cost</span></div>
      </div>

      <h2><span>Deck</span>The pitch, in fourteen slides</h2>
      <p className="br-note">← → or n / p to step · Full screen to present</p>
      <Deck />

      <h2><span>Try</span>Open the live demo</h2>
      <p className="br-note">Same code as production · synthetic data · no login to look around</p>
      <nav className="br-try">{TRY.map(([href, t, d]) => <a key={href} href={href}><b>{t} →</b><span>{d}</span></a>)}</nav>

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
        <li><b>Ask AMPS</b> — plain-language questions (English, हिन्दी, বাংলা) answered from the live records by Gemini;
          AI-drafted maintenance plans that a supervisor approves before anything is saved.</li>
      </ul>

      <h2><span>§3</span>Proof</h2>
      <p>AMPS is not a prototype. It runs in production on a metro railway power system in India: over 7,900 assets across five lines and
        230+ locations registered and tagged, and six years of maintenance and failure records (33,000+) migrated in.
        Overdue work and assets past design life are visible network-wide, the day they happen. The operator paid nothing for licences.
        This site runs the same code against four synthetic plant sites — a metro, a power substation, a water works and a factory
        {net?.lines?.length ? <> ({n(net.lines.reduce((s, l) => s + (l.assets || 0), 0))} assets)</> : null}.</p>

      <h2><span>§4</span>Legacy EAM (SAP PM-class) vs AMPS</h2>
      <table className="br-cmp"><thead><tr><th /><th>Legacy EAM</th><th>AMPS</th></tr></thead>
        <tbody>{COMPARE.map(([k, a, b]) => <tr key={k}><td>{k}</td><td>{a}</td><td>{b}</td></tr>)}</tbody></table>
      <p className="br-note">A comparison of product approach, not of any vendor’s pricing.</p>

      <h2><span>§5</span>Open-core model</h2>
      <p>The framework is free forever under MIT — self-host it, fork it, keep it. Revenue comes from hosting,
        onboarding (asset tagging, migration of old registers), and support or custom features, delivered by biniDev.</p>

      <h2><span>§6</span>Who it's for</h2>
      <p>Transit (metros, rail depots, traction substations) · utilities (power, water, distribution) · factories ·
        large campuses — anyone with equipment that must not fail.</p>

      <h2><span>§7</span>Questions buyers ask</h2>
      <dl className="br-faq">{FAQ.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}</dl>

      <h2><span>§8</span>Team &amp; ask</h2>
      <p>Built by biniyog · delivered by biniDev. <b>Arup Biswas</b>, Founder · <b>Nilanjan Chakraborty</b>, Co-founder ·
        Full-stack Developer.</p>
      <ul>
        <li><b>Pilots</b> — depots, substations and plants ready to run AMPS on their own assets.</li>
        <li><b>Partners</b> — integrators and OEMs in transit, utilities and manufacturing.</li>
        <li><b>Google</b> — cloud credits and mentorship to ship the Gemini layer at scale.</li>
      </ul>
      <p className="br-foot">Source: github.com/arupbiswas1994-byte/amps · MIT · Demo data on this site is synthetic.</p>
    </article>
  )
}
