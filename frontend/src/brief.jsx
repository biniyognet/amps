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
  ['AI', 'Add-on modules, if any', 'Gemini answers, photo → job card, AI plans · Gemma on-prem fallback'],
]

// The pitch deck as slide images (public/pitch/), stepped in the page.
// Titles double as alt text.
const SLIDES = [
  'AMPS — Asset Maintenance & Performance System',
  'Team AMPS and the problem we solve',
  'Brief about the idea',
  'Opportunities: how AMPS is different',
  'Features: Snap & Report, Ask AMPS, voice, ampsTalk IoT',
  'Process flow: the machine speaks',
  'Wireframes: from the QR tag to a job card',
  'Architecture: who speaks, who listens, who decides',
  'Technologies: Gemini, Gemma and Google Cloud',
  'Estimated implementation cost',
  'Snapshots of the prototype',
  'Prototype performance: 9 of 9 live AI tests pass',
  'Future development',
  'One night, told twice',
  'Try it in 60 seconds',
  'Thank you',
]
// Live demo entry points — every link opens the real app on synthetic data.
const TRY = [
  ['#/snap/MTD-CEN-HSC-01', 'Snap & Report', 'Photo + a rough note → Gemini drafts the failure report and job card (sign-in to submit)'],
  ['#/', 'Network dashboard', 'Every site’s PM compliance, overdue work and failures on one screen'],
  ['#/line/City%20Traction%20%26%20Depot', 'A site, close up', 'One line’s schedule: on time, due soon, overdue, by system'],
  ['#/assets', 'Asset register', 'Filter by site, class, criticality; every row opens its history'],
  ['#/asset/MTD-CEN-TTR-01', 'What a QR tag opens', 'One transformer: details, PM history, failures, job cards'],
  ['#/log', 'Log book', 'Preventive maintenance entries by date and cycle'],
  ['#/failures', 'Failures', 'Breakdowns, rectification, downtime and MTTR'],
  ['#/job-cards', 'Job cards', 'Agency work tracked from issue to closure'],
  ['#/printables', 'Printables', 'QR tags and per-class checksheets, ready to print'],
]

const FAQ = [
  ['Do we need new hardware?', 'No. AMPS runs on one ordinary server or a small VM; staff use the phones and PCs they already have. Viewing needs no login.'],
  ['What happens to our old registers?', 'They are imported. Excel and scanned registers are migrated in during onboarding, so history starts on day one, not from zero.'],
  ['Where does our data live?', 'In your own PostgreSQL database, on your premises or your cloud. Nothing is locked in a vendor format; export is a SQL dump away.'],
  ['Is the AI optional?', 'Yes. Every register, schedule and report works without it. Gemini runs it in the cloud; Gemma runs on our own servers as a free fallback and for private search, so a site where no record may leave the building can keep the AI on-premises.'],
  ['How long does a rollout take?', 'Weeks, not months: import the old registers, tag the assets, start logging. No implementation partner needed.'],
  ['What does it cost?', 'The software is free (MIT). You pay only for what you choose: hosting, onboarding and tagging, support or custom features.'],
]

const SHOW_DECK = true
const PITCH = `${import.meta.env.BASE_URL}pitch/`
const src = (i) => `${PITCH}d16/${String(i + 1).padStart(2, '0')}.webp?v=1121`

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
        <button type="button" onClick={() => ref.current?.requestFullscreen?.()} title="Full screen · ← → or n / p to step">Present</button>
      </figcaption>
    </figure>
  )
}

// Wide screens fit the brief to the viewport: no page scroll, the page's own top
// offset (topbar + shell padding) is measured so the card ends at the window's edge.
function useViewportFit() {
  const ref = useRef(null)
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('brief-fit')
    const set = () => { if (ref.current) root.style.setProperty('--brief-top', `${Math.round(ref.current.getBoundingClientRect().top + window.scrollY)}px`) }
    set()
    window.addEventListener('resize', set)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set)
    const tb = document.querySelector('.topbar'); if (ro && tb) ro.observe(tb)
    return () => { root.classList.remove('brief-fit'); window.removeEventListener('resize', set); ro?.disconnect() }
  }, [])
  return ref
}

// Credits: on wide screens the details roll up slowly on their own, hold while the
// viewer reads (hover, focus, wheel, touch, a drag of the scrollbar) or presses Pause,
// wait at the end, then rewind. Reduced-motion viewers start paused.
function useCredits() {
  const ref = useRef(null)
  const calm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [paused, setPaused] = useState(!!calm)
  const stop = useRef(paused); stop.current = paused
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const wide = window.matchMedia('screen and (min-width:1100px) and (min-height:560px)')
    const SPEED = 26   // px per second
    let raf = 0, last = 0, pos = el.scrollTop, hold = performance.now() + 2500, reading = false, atEnd = false
    const wait = (ms) => { hold = Math.max(hold, performance.now() + ms) }
    const tick = (t) => {
      raf = requestAnimationFrame(tick)
      const dt = last ? Math.min(t - last, 100) : 0; last = t
      if (!wide.matches || stop.current || reading || document.hidden || t < hold) { pos = el.scrollTop; return }
      const end = el.scrollHeight - el.clientHeight
      if (end <= 0) return
      if (pos >= end - 1) {
        if (!atEnd) { atEnd = true; hold = t + 4000; return }
        atEnd = false; el.scrollTo({ top: 0, behavior: 'smooth' }); hold = t + 3000; return
      }
      pos = Math.min(end, pos + (SPEED * dt) / 1000); el.scrollTop = pos
    }
    raf = requestAnimationFrame(tick)
    const on = (e) => { if (e.pointerType !== 'touch') reading = true }
    const off = () => { reading = false; wait(1500) }
    const nudge = () => wait(6000)
    const moved = () => { if (performance.now() >= hold && Math.abs(el.scrollTop - pos) > 2) wait(6000) }
    const ev = [['pointerenter', on], ['pointerleave', off], ['focusin', () => { reading = true }], ['focusout', off],
      ['wheel', nudge], ['touchstart', nudge], ['keydown', nudge], ['scroll', moved]]
    ev.forEach(([k, f]) => el.addEventListener(k, f, { passive: true }))
    return () => { cancelAnimationFrame(raf); ev.forEach(([k, f]) => el.removeEventListener(k, f)) }
  }, [])
  return [ref, paused, setPaused]
}

export default function Brief() {
  useFonts()
  const net = useNetwork()
  const page = useViewportFit()
  const [roll, paused, setPaused] = useCredits()
  return (
    <article className="brief" ref={page}>
      {/* 60:40 on wide screens: compact headline + the largest deck that fits on the left, the details roll like credits in the right sidebar */}
      <div className="br-split">
      <section className="br-main">
      <header className="br-head">
      <p className="br-kick">BRIEF · AMPS · OPEN-SOURCE EAM · {new Date().getFullYear()}</p>
      <h1>AMPS — scan, snap, and Gemini drafts the job card</h1>
      <p className="br-dek"><span className="br-dek-x">A failure nobody logs comes back as downtime. </span>Scan the asset’s QR, take a photo, and Gemini drafts the
        failure report and job card for a person to confirm.<span className="br-dek-x"> Open-source EAM for any plant, ₹0 licence.</span></p>
      </header>

      {/* the submitted deck, exported from Google Slides as 16 images (public/pitch/d16/) */}
      {SHOW_DECK && <>
      <h2 className="br-deck-h"><span>Deck</span>The pitch, in sixteen slides</h2>
      <Deck />
      <p className="br-note">← → or n / p to step · Full screen to present</p>
      </>}
      </section>

      <aside className="br-side">
      <div className="br-roll-h"><span><i className="br-gbar" aria-hidden="true" />The details</span>
        <button type="button" onClick={() => setPaused((x) => !x)} aria-pressed={paused}>{paused ? '▶ Roll' : '❚❚ Pause'}</button></div>
      <div className="br-roll" ref={roll}>
      <div className="br-delta">
        <div><b>1,870+</b><span>assets live, 4 sites · 40 stations</span></div>
        <div><b>14,600+</b><span>maintenance records, 2025–2026</span></div>
        <div><b>₹0</b><span>licence cost</span></div>
      </div>

      <h2><span>Try</span>Open the live demo</h2>
      <p className="br-note">Same code as production · synthetic data · sign in with <b>admin</b> / <b>admin</b> to look around</p>
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
        <li><b>Snap &amp; Report</b> — scan the asset QR, take a photo, add a rough note: Gemini reads the photo and the asset’s
          history and drafts the failure report and job card; the technician ticks what to raise and picks the agency.</li>
      </ul>

      <h2><span>§3</span>Hybrid AI</h2>
      <p><b><i>Our Kubernetes runs the plant. Google is the brain. Gemma keeps it running on-prem.</i></b></p>
      <ul>
        <li><b>Gemini 3.5 Flash-Lite</b> (cloud) — reasoning, photo reading and function calls over the live records, at about $0.0003 a click.</li>
        <li><b>Gemma 3 4B</b> (on-prem, Ollama on our own k3s GPU) — takes over free when Gemini errors or runs out of quota, so the AI never goes dark.</li>
        <li><b>EmbeddingGemma</b> (on-prem) — 768-dim private search for similar past failures, in 100+ languages including Bengali; no record leaves the site.</li>
      </ul>

      <h2><span>§4</span>Proof</h2>
      <p>AMPS is not a prototype. It runs in production on a pilot power system in India: 1,874 assets across 4 sites and
        40 stations registered and tagged, and 18 months of maintenance and failure records (14,660) in the log.
        Overdue work and assets past design life are visible network-wide, the day they happen. The operator paid nothing for licences.
        This site runs the same code against four synthetic plant sites — City Traction &amp; Depot, Eastern Grid 132 kV Substation, City Water Treatment Plant and Bengal Steel &amp; Rolling Mill
        {net?.lines?.length ? <> ({n(net.lines.reduce((s, l) => s + (l.assets || 0), 0))} assets)</> : null}.</p>

      <h2><span>§5</span>Legacy EAM (SAP PM-class) vs AMPS</h2>
      <table className="br-cmp"><thead><tr><th /><th>Legacy EAM</th><th>AMPS</th></tr></thead>
        <tbody>{COMPARE.map(([k, a, b]) => <tr key={k}><td>{k}</td><td>{a}</td><td>{b}</td></tr>)}</tbody></table>
      <p className="br-note">A comparison of product approach, not of any vendor’s pricing.</p>

      <h2><span>§6</span>Open-core model</h2>
      <p><b>Free licence. Paid hosting, support and Gemini AI, per site.</b> The framework is free forever under MIT — self-host it, fork it, keep it. Revenue comes from hosting,
        onboarding (asset tagging, migration of old registers), and support or custom features, delivered by biniDev.</p>

      <h2><span>§7</span>Who it's for</h2>
      <p>Transit (urban rail, rail depots, traction substations) · utilities (power, water, distribution) · factories ·
        large campuses — anyone with equipment that must not fail.</p>

      <h2><span>§8</span>Questions buyers ask</h2>
      <dl className="br-faq">{FAQ.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}</dl>

      <h2><span>§9</span>Team &amp; ask</h2>
      <p>Built by <b>Arup Biswas</b>, delivered by biniDev: <b>Arup Biswas</b>, Founder · <b>Nilanjan Chakraborty</b>, Co-founder ·
        Full-stack Developer. Supported by biniyog (partner).</p>
      <ul>
        <li><b>Pilots</b> — depots, substations and plants ready to run AMPS on their own assets.</li>
        <li><b>Partners</b> — integrators and OEMs in transit, utilities and manufacturing.</li>
        <li><b>Google</b> — cloud credits and mentorship to ship the Gemini layer at scale.</li>
      </ul>
      <p className="br-foot">Source: github.com/arupbiswas1994-byte/amps · MIT · Demo data on this site is synthetic.</p>
      </div>
      </aside>
      </div>
    </article>
  )
}
