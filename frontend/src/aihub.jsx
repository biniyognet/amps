// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arup Biswas
// AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

/* AI hub (#/ai): every AI feature on one page, each opening on a seeded
   example in one or two clicks and naming the Google product that does the
   work. Seven are live; two are planned and say so. Voice chat sits on top:
   ask in English, Bengali or Hindi by speaking, hear the answer back.
   The two-layer strip on top says which technique each feature uses and why
   it is the cheapest one that does the job. */
import { useEffect, useState } from 'react'
import { API, useMe } from './api.js'
import { rememberNext } from './snap.jsx'
import { useLiveStatus } from './live.jsx'

const SNAP_DEMO = 'MTD-CEN-HSC-01'
const SIMILAR_DEMO = 'CWT-AM-MTR-01'
// Register opens filtered to red + amber, riskiest first (the register keeps these in amps.filter.*).
const openAtRisk = () => {
  try {
    localStorage.setItem('amps.filter.reg.risk', JSON.stringify('hot'))
    localStorage.setItem('amps.filter.reg.sortKey', JSON.stringify('risk'))
    localStorage.setItem('amps.filter.reg.sortDir', JSON.stringify('asc'))
  } catch { /* private mode: register opens unfiltered */ }
}
const ask = (q) => window.dispatchEvent(new CustomEvent('amps:ask', { detail: { q } }))

// the six read-only tools Ask AMPS and the MCP server share (backend/app/api/ai.py TOOLS)
const TOOLS = [
  ['list_sites', 'every site with its asset count'],
  ['search_assets', 'by site, class, text, criticality, past design life'],
  ['overdue_pm', 'preventive maintenance overdue, worst first'],
  ['failure_summary', 'breakdowns in the last N days, open vs restored'],
  ['asset_history', 'one asset and its recent logbook entries'],
  ['draft_pm_plan', 'a DRAFT plan; nothing is saved'],
]
const MCP_CONFIG = `{
  "mcpServers": {
    "amps": { "serverUrl": "https://amps-api.binihost.com/mcp" }
  }
}`

const ASK_CHIPS = [
  'Which assets are overdue for preventive maintenance?',
  'पंप मोटर 1 (CWT-AM-MTR-01) का इतिहास बताइए',
  'Open failures at City Water Treatment Plant',
]

// say-it starters for the voice band: one per language, each a seeded story
const VOICE_CHIPS = [
  ['EN', 'Which asset fails the most?'],
  ['বাং', 'কোন পাম্পের রক্ষণাবেক্ষণ বাকি আছে?'],
  ['हिं', 'सिटी वॉटर में कौन से ब्रेकडाउन खुले हैं?'],
]
const GC = ['blue', 'red', 'yellow', 'green']

const Ico = ({ d }) => (
  <svg className="aih-ico" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>)

// Layer 1 runs on every click, so it must be fast and cheap; Layer 2 runs in
// batch and gets better as the log book grows.
const LAYERS = [
  { n: 1, name: 'Every click', sub: 'fast · cheap · explainable',
    tech: ['RAG', 'Deterministic rules', 'Small model (Flash-Lite)', 'Voice in + out', 'OCR / vision'],
    rows: [
      ['Voice chat', 'Speak en / bn / hi, answer read back; speech stays in the browser'],
      ['Snap & Report', 'OCR / vision + voice + Flash-Lite'],
      ['Ask AMPS', 'RAG over our own records + Flash-Lite function calling'],
      ['Similar past failures', 'RAG: Gemini / EmbeddingGemma embeddings, cosine match'],
      ['PM plan', 'Deterministic scheduler; Gemini only explains it'],
      ['Risk badge', 'Deterministic rule score, three reasons'],
    ],
    econ: 'Rules wherever rules are enough. The smallest Gemini model only where reading a photo or a language is needed. No GPU server.' },
  { n: 2, name: 'Learns over time', sub: 'batch · predictive · matures',
    tech: ['Data cleansing', 'Random forest / XGBoost', 'Neural nets / deep learning', 'ML pipelines'],
    rows: [
      ['Failure risk, next 30 days', 'BigQuery ML boosted tree, trained in SQL'],
      ['Failure analysis', 'Patterns by asset class, site and age'],
      ['Fault fields', 'BigQuery AI.EXTRACT turns remarks into columns'],
    ],
    econ: 'Runs in batch inside BigQuery, with no separate ML server. The more the log book holds, the better the model gets.' },
]

function Layers() {
  return (
    <section className="aih-layers" aria-label="Two AI layers">
      {LAYERS.map((l) => (
        <article key={l.n} className={`aih-layer l${l.n}`}>
          <header><span className="aih-ln">AI layer {l.n}</span><h2>{l.name}</h2><small>{l.sub}</small></header>
          <div className="aih-tech">{l.tech.map((t) => <span key={t}>{t}</span>)}</div>
          <ul>{l.rows.map(([f, t]) => <li key={f}><b>{f}</b><span>{t}</span></li>)}</ul>
          <p className="aih-econ"><b>Economy:</b> {l.econ}</p>
        </article>
      ))}
    </section>
  )
}

// How it's built: binihost runs everything, Google is the brain (BUILDATHON_NOTES §5, final).
// The proof tiles read this server, not a script: socket state and the cache header.
const PROBE = '/api/lines'

function useCacheProbe() {
  const [r, setR] = useState(null)
  useEffect(() => {
    let dead = false
    const once = async () => {
      const t = performance.now()
      const res = await fetch(`${API}${PROBE}`, { credentials: 'include' })
      await res.arrayBuffer()
      return { ms: Math.round(performance.now() - t), hdr: res.headers.get('X-AMPS-Cache') }
    }
    // two reads: the second is the one a busy screen gets
    once().then(() => once()).then((v) => { if (!dead) setR(v) }).catch(() => { if (!dead) setR({ err: true }) })
    return () => { dead = true }
  }, [])
  return r
}

function Arch() {
  const live = useLiveStatus()
  const probe = useCacheProbe()
  return (
    <section className="aih-arch" aria-label="How AMPS is built">
      <header>
        <span className="aih-ln">Architecture</span>
        <h2>Our Kubernetes runs the plant. Google is the brain.</h2>
      </header>
      <div className="aih-arch-map">
        <div className="aih-zone home">
          <small>binihost · 3-node Kubernetes, high availability · fixed cost · Gemma on-prem fallback</small>
          <div className="aih-row"><span>CDN · screens</span></div>
          <div className="aih-row"><span>api ×N <em>stateless</em></span><span className="bus">Redis · cache · queue · events</span><span>worker ×N <em>AI jobs</em></span></div>
          <div className="aih-row"><span>Postgres + pgvector <em>primary + replicas</em></span></div>
        </div>
        <div className="aih-links">
          <span><b>every click</b> →</span>
          <span><b>nightly learn</b> ⇄ <i>scores back live</i></span>
        </div>
        <div className="aih-zone ggl">
          <small>Google · pay per use</small>
          <div className="aih-row"><span>Gemini 3.5 Flash-Lite <em>Gemini API · function calling · vision · drafts</em></span></div>
          <div className="aih-row"><span>Cloud Run + Cloud SQL <em>this prototype · Secret Manager · Cloud Build</em></span></div>
          <div className="aih-row"><span>BigQuery + BQML <em>cleansed history · failure-risk model</em></span></div>
        </div>
      </div>
      <div className="aih-proof">
        <div className={live ? 'on' : ''}><small>Live events</small><b>{live ? 'Websocket on' : 'Websocket off'}</b><span>Screens update without polling</span></div>
        <div className={probe?.hdr === 'hit' ? 'on' : ''}><small>Read cache</small>
          <b>{!probe ? 'measuring…' : probe.err ? 'unreachable' : `${probe.hdr || 'n/a'} · ${probe.ms} ms`}</b>
          <span>Second read of {PROBE}, from Redis</span></div>
        <div><small>Learning layer</small><b>BigQuery ML</b><span>Trains weekly, scores nightly, pushed back to every screen</span></div>
      </div>
      <p className="aih-econ"><b>No lock-in:</b> the same containers move to GKE, and pgvector moves to AlloyDB, with no code change.</p>
    </section>
  )
}

function Card({ icon, title, product, line, status, layer, tone = 'blue', children }) {
  return (
    <article className={`aih-card g-${tone}${status === 'coming' ? ' coming' : ''}`}>
      <header>
        <Ico d={icon} />
        {layer && <span className="aih-lt">L{layer}</span>}
        <span className={`aih-st ${status}`}>{status === 'live' ? 'Live' : 'Coming'}</span>
      </header>
      <h3>{title}</h3>
      <p className="aih-prod">{product}</p>
      <p className="aih-line">{line}</p>
      <div className="aih-act">{children}</div>
    </article>
  )
}

function VoiceBand({ on }) {
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
  return (
    <section className="aih-voice" aria-label="Voice chat">
      <div className="aih-voice-mic" aria-hidden="true"><span /><span /><span /><span /></div>
      <div className="aih-voice-txt">
        <span className="aih-ln">New · Voice chat</span>
        <h2>Talk to your plant. In your own language.</h2>
        <p>Tap 🎤 in Ask AMPS, pick EN, বাং or हिं and just say it. Gemini looks the answer up in the live records
          and AMPS reads it back. On the floor, with gloves on, nobody has to type. The Snap remark mic speaks all three too.</p>
        <div className="aih-voice-chips">
          {VOICE_CHIPS.map(([l, q]) => (
            <button key={q} type="button" className="aih-chip" disabled={!on} onClick={() => ask(q)}><b>{l}</b> {q}</button>
          ))}
        </div>
        <small className="aih-voice-note">
          {SR ? 'Speech-to-text and read-aloud run in this browser (Web Speech API); only the text goes to Gemini.'
            : 'This browser has no speech recogniser; open in Chrome on Android or desktop to speak. Typing works everywhere.'}
        </small>
      </div>
    </section>
  )
}

export default function AiHub() {
  const { me } = useMe()
  const [ai, setAi] = useState(undefined) // undefined = checking, null = unreachable
  const [mcp, setMcp] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    fetch(`${API}/api/ai/status`).then((r) => (r.ok ? r.json() : null)).then(setAi).catch(() => setAi(null))
  }, [])
  const on = !!ai?.enabled
  const signedIn = !!me && (!me.auth_enabled || me.username !== 'viewer')
  const planHref = signedIn ? '#/planner?auto=1' : '#/login'
  const copy = () => {
    navigator.clipboard?.writeText(MCP_CONFIG).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }

  return (
    <main className="aih">
      <style>{AIH_CSS}</style>
      <header className="aih-head">
        <div>
          <span className="aih-kick">✦ Built on Google AI · Gemini · Cloud Run</span>
          <h1>AI in AMPS</h1>
          <p>Pick any feature. Each one opens on a real example from this demo and names the Google product doing the work.
            AI drafts; a person signs.</p>
        </div>
        <div className={`aih-model${on ? '' : ' off'}`} role="status">
          <small>Model on this server</small>
          <b>{ai === undefined ? 'checking…' : on ? ai.model : 'AI is off'}</b>
          {ai !== undefined && !on && <span>No Gemini key set here. Live cards open their screens, but nothing is drafted.</span>}
        </div>
      </header>

      <VoiceBand on={on} />
      <Layers />

      <section className="aih-grid" aria-label="AI features">
        <Card tone="blue" status="live" layer={1} title="Snap & Report" product="Flash-Lite · OCR / vision + voice (EN · বাং · हिं)"
              icon="M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
              line="Photo and a rough note in; a drafted failure report and job card out. A person submits.">
          <a className="aih-btn pri" href={`#/snap/${SNAP_DEMO}`}>Try on HSCB Panel 1 →</a>
        </Card>
        <Card tone="red" status="live" layer={1} title="Ask AMPS" product="RAG + function calling · 6 tools · 🎤 voice"
              icon="M4 5h16v11H9l-5 4zM8 9h8M8 12h5"
              line="Type or speak plain questions in English, हिन्दी or বাংলা. It looks the records up, shows which ones it used, and can read the answer aloud.">
          <div className="aih-chips">
            {ASK_CHIPS.map((q) => <button key={q} type="button" className="aih-chip" disabled={!on} onClick={() => ask(q)}>{q}</button>)}
          </div>
        </Card>
        <Card tone="yellow" status="live" layer={1} title="PM plan" product="Deterministic scheduler · Gemini explains"
              icon="M4 5h16v15H4zM4 9h16M9 3v4M15 3v4M8 14l2 2 4-4"
              line="Lays due and overdue PM onto the week and finds the gaps. The supervisor approves each change.">
          <a className="aih-btn pri" href={planHref} onClick={() => { if (!signedIn) rememberNext('/planner?auto=1') }}>
            {signedIn ? 'Draft this week →' : 'Sign in to draft →'}</a>
        </Card>
        <Card tone="green" status="live" layer={1} title="MCP server" product="Model Context Protocol · Agent Skills"
              icon="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"
              line="Any agent, Antigravity or others, can use AMPS through the same six tools, read-only.">
          <button type="button" className="aih-btn pri" aria-expanded={mcp} onClick={() => setMcp((v) => !v)}>
            {mcp ? 'Hide the tools' : 'See the 6 tools'}</button>
        </Card>

        <Card tone="blue" status="live" layer={1} title="Similar past failures" product="RAG · gemini-embedding-001 · EmbeddingGemma on-prem"
              icon="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4"
              line="Before the panel is opened, AMPS shows what fixed the same fault last time. Example: Pump Motor 1.">
          <a className="aih-btn pri" href={`#/asset/${SIMILAR_DEMO}`}>Seen before on Pump Motor 1 →</a>
        </Card>
        <Card tone="red" status="coming" layer={2} title="Fault fields" product="BigQuery AI.EXTRACT · Flash-Lite"
              icon="M4 7h10M4 12h16M4 17h7M17 4l3 3-3 3"
              line="Free-text remarks in three languages become columns you can count: component, symptom, cause, action.">
          <span className="aih-btn ghost" aria-disabled="true">10 remarks · coming</span>
        </Card>
        <Card tone="yellow" status="coming" layer={2} title="Estate agent" product="BigQuery Conversational Analytics"
              icon="M4 20V10M10 20V4M16 20v-7M22 20H2"
              line="Managers ask the whole estate in English and get charts back, from the amps_demo dataset.">
          <span className="aih-btn ghost" aria-disabled="true">Open agent ↗ · coming</span>
        </Card>
        <Card tone="green" status="live" layer={1} title="Risk badge" product="Deterministic rule score · BigQuery ML next"
              icon="M12 3l9 16H3zM12 9v4M12 16v.5"
              line="Red means old, failing again and PM late, with the three reasons why. Example: Pump Motor 1 red, PTR 1 amber.">
          <a className="aih-btn pri" href="#/assets" onClick={openAtRisk}>See the assets at risk →</a>
        </Card>
      </section>

      {mcp && (
        <section className="aih-mcp" aria-label="AMPS MCP tools">
          <div>
            <h2>Six read-only tools</h2>
            <ul>{TOOLS.map(([n, d]) => <li key={n}><code>{n}</code><span>{d}</span></li>)}</ul>
          </div>
          <div>
            <h2>Try it in Antigravity</h2>
            <p>Add this to the agent's MCP config, then ask "Which assets are overdue?". The agent sees what a walk-up QR visitor sees, and never writes.</p>
            <pre><code>{MCP_CONFIG}</code></pre>
            <button type="button" className="aih-btn" onClick={copy}>{copied ? 'Copied' : 'Copy config'}</button>
            <p className="aih-note">Offline: <code>python -m app.mcp_server</code> over stdio. Rules for agents: skill <code>amps-guardrails</code>.</p>
          </div>
        </section>
      )}

      <ol className="aih-flow" aria-label="How a Snap travels">
        <li><small>Phone</small><b>Photo + rough note</b></li>
        <li className="gem"><small>Google AI</small><b>{on ? ai.model : 'Gemini'}</b></li>
        <li><small>Schema JSON</small><b>Report + job card</b></li>
        <li><small>Person</small><b>Checks and submits</b></li>
      </ol>
      <Arch />

      <p className="aih-guard">Guardrail: nothing is saved until a person approves it. Demo Industries data only, all synthetic.</p>
    </main>
  )
}

const AIH_CSS = `
.aih { max-width: 1240px; margin: 0 auto; padding-block: 20px 36px; display: flex; flex-direction: column; gap: 20px; }
.aih-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; flex-wrap: wrap; }
.aih-head h1 { margin: 4px 0 6px; font-size: 28px; color: var(--ink); text-wrap: balance; }
.aih-head p { margin: 0; color: var(--ink-2); max-width: 60ch; }
.aih-kick { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  background: linear-gradient(90deg, #4285F4, #9B72CB 55%, #D96570); -webkit-background-clip: text; background-clip: text; color: transparent; }
.aih-model { display: flex; flex-direction: column; gap: 2px; padding: 10px 14px; border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--card-bg); backdrop-filter: var(--card-blur); min-width: 220px; max-width: 340px; }
.aih-model small { font-size: 11px; color: var(--ink-3); text-transform: uppercase; letter-spacing: .06em; }
.aih-model b { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; color: var(--accent); }
.aih-model.off b { color: var(--warning); }
.aih-model span { font-size: 12px; color: var(--ink-2); }
.aih-layers { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.aih-layer { display: flex; flex-direction: column; gap: 10px; padding: 18px; border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--card-bg); backdrop-filter: var(--card-blur); -webkit-backdrop-filter: var(--card-blur); border-top: 4px solid var(--accent); }
.aih-layer.l2 { border-top-color: #9B72CB; }
.aih-layer header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.aih-layer h2 { margin: 0; font-size: 18px; color: var(--ink); }
.aih-layer header small { color: var(--ink-3); font-size: 12px; }
.aih-ln { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px;
  color: #fff; background: var(--accent); }
.aih-layer.l2 .aih-ln { background: #9B72CB; }
.aih-tech { display: flex; flex-wrap: wrap; gap: 6px; }
.aih-tech span { font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--accent-line); background: var(--accent-soft); color: var(--ink); }
.aih-layer.l2 .aih-tech span { border-color: rgba(155,114,203,.4); background: rgba(155,114,203,.1); }
.aih-layer ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.aih-layer li { display: grid; grid-template-columns: minmax(150px, 38%) 1fr; gap: 10px; font-size: 13px; color: var(--ink-2); }
.aih-layer li b { color: var(--ink); font-weight: 600; }
.aih-econ { margin: 0; font-size: 12.5px; color: var(--ink-2); padding-top: 8px; border-top: 1px dashed var(--border); }
.aih-econ b { color: var(--ink); }
.aih-lt { margin-left: auto; margin-right: 6px; font-size: 10.5px; font-weight: 700; color: var(--ink-3); border: 1px solid var(--border); border-radius: 6px; padding: 1px 6px; }
.aih-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.aih-card { display: flex; flex-direction: column; gap: 6px; padding: 18px; border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--card-bg); backdrop-filter: var(--card-blur); -webkit-backdrop-filter: var(--card-blur); box-shadow: inset 3px 0 0 var(--accent); }
.aih-card.coming { box-shadow: none; border-style: dashed; }
.aih-card.coming .aih-ico { color: var(--ink-3); background: rgba(147,167,181,.12); }
.aih-card header { display: flex; justify-content: space-between; align-items: center; }
.aih-ico { color: var(--accent); background: var(--accent-soft); border-radius: 10px; padding: 7px; box-sizing: content-box; }
.aih-st { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; }
.aih-st.live { color: var(--good); background: rgba(15,138,95,.1); }
.aih-st.coming { color: var(--ink-2); background: rgba(147,167,181,.18); }
.aih-card h3 { margin: 6px 0 0; font-size: 17px; color: var(--ink); }
.aih-prod { margin: 0; font-size: 12px; font-weight: 600; color: var(--accent); }
.aih-card.coming .aih-prod { color: var(--ink-2); }
.aih-line { margin: 0; font-size: 13.5px; color: var(--ink-2); line-height: 1.45; flex: 1; }
.aih-act { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.aih-btn { display: inline-flex; align-items: center; padding: 7px 12px; border-radius: var(--r-sm); border: 1px solid var(--border);
  background: var(--surface); color: var(--ink); font: inherit; font-size: 13px; font-weight: 600; text-decoration: none; cursor: pointer; }
.aih-btn.pri { background: var(--accent); border-color: var(--accent); color: #fff; }
.aih-btn.pri:hover { filter: brightness(1.08); color: #fff; }
.aih-btn.ghost { color: var(--ink-3); border-style: dashed; cursor: default; background: transparent; }
.aih-chips { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.aih-chip { text-align: left; padding: 6px 10px; border-radius: 999px; border: 1px solid var(--accent-line); background: var(--accent-soft);
  color: var(--ink); font: inherit; font-size: 12.5px; cursor: pointer; }
.aih-chip:disabled { opacity: .5; cursor: not-allowed; }
.aih-mcp { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 18px; border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--card-bg); backdrop-filter: var(--card-blur); }
.aih-mcp h2 { margin: 0 0 8px; font-size: 15px; color: var(--ink); }
.aih-mcp ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.aih-mcp li { display: flex; gap: 10px; flex-wrap: wrap; font-size: 13px; color: var(--ink-2); }
.aih-mcp li code { color: var(--accent); font-weight: 600; min-width: 130px; }
.aih-mcp p { margin: 0 0 8px; font-size: 13px; color: var(--ink-2); }
.aih-mcp pre { margin: 0 0 8px; padding: 10px 12px; background: #0B2A3F; color: #E6F4FB; border-radius: var(--r-sm); font-size: 12px; overflow-x: auto; }
.aih-note { margin-top: 8px !important; font-size: 12px !important; }
.aih-flow { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.aih-flow li { display: flex; flex-direction: column; padding: 10px 12px; border-radius: var(--r-md); background: var(--surface); border: 1px solid var(--border); position: relative; }
.aih-flow li small { font-size: 11px; color: var(--ink-3); text-transform: uppercase; letter-spacing: .06em; }
.aih-flow li b { font-size: 13.5px; color: var(--ink); overflow-wrap: anywhere; }
.aih-flow li.gem { border-color: #9B72CB; }
.aih-flow li.gem b { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #6B4FB0; }
.aih-guard { margin: 0; font-size: 13px; color: var(--ink-2); }
.aih-arch { display: flex; flex-direction: column; gap: 14px; padding: 18px; border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--card-bg); backdrop-filter: var(--card-blur); -webkit-backdrop-filter: var(--card-blur); border-top: 4px solid #4285F4; }
.aih-arch header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.aih-arch h2 { margin: 0; font-size: 18px; color: var(--ink); }
.aih-arch .aih-ln { background: #4285F4; }
.aih-arch-map { display: grid; grid-template-columns: 1.6fr auto 1fr; gap: 12px; align-items: stretch; }
.aih-zone { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface); }
.aih-zone.home { border-color: var(--accent-line); }
.aih-zone.ggl { border-color: rgba(155,114,203,.5); }
.aih-zone > small { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--ink-3); }
.aih-row { display: flex; gap: 8px; flex-wrap: wrap; }
.aih-row span { flex: 1 1 120px; padding: 8px 10px; border-radius: var(--r-sm); background: var(--accent-soft); border: 1px solid var(--accent-line);
  font-size: 13px; font-weight: 600; color: var(--ink); }
.aih-row span.bus { background: transparent; border-style: dashed; font-weight: 500; color: var(--ink-2); text-align: center; }
.aih-zone.ggl .aih-row span { background: rgba(155,114,203,.1); border-color: rgba(155,114,203,.4); }
.aih-row em { display: block; font-style: normal; font-weight: 400; font-size: 11.5px; color: var(--ink-2); }
.aih-links { display: flex; flex-direction: column; justify-content: space-around; gap: 8px; font-size: 12px; color: var(--ink-2); text-align: center; }
.aih-links b { color: var(--ink); }
.aih-links i { font-style: normal; color: var(--good); }
.aih-proof { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.aih-proof > div { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface); }
.aih-proof > div.on { border-color: var(--good); }
.aih-proof small { font-size: 11px; color: var(--ink-3); text-transform: uppercase; letter-spacing: .06em; }
.aih-proof b { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; color: var(--ink); }
.aih-proof .on b { color: var(--good); }
.aih-proof span { font-size: 12px; color: var(--ink-2); }
@media (max-width: 900px) { .aih-arch-map { grid-template-columns: 1fr; } .aih-links { flex-direction: row; justify-content: center; } .aih-proof { grid-template-columns: 1fr; } }
@media (max-width: 1100px) { .aih-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .aih-layers { grid-template-columns: 1fr; } .aih-layer li { grid-template-columns: 1fr; gap: 0; } .aih-mcp { grid-template-columns: 1fr; } .aih-flow { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 500px) {
  .aih-grid, .aih-flow { grid-template-columns: 1fr; }
  .aih-head h1 { font-size: 24px; }
  .aih-model { max-width: none; width: 100%; }
}
/* Google palette: each card / layer carries one of the four colours */
.aih { --g-blue: #1A73E8; --g-red: #EA4335; --g-yellow: #FBBC04; --g-green: #34A853;
  --g-blue-t: rgba(26,115,232,.10); --g-red-t: rgba(234,67,53,.10); --g-yellow-t: rgba(251,188,4,.14); --g-green-t: rgba(52,168,83,.11);
  --g-blue-i: #1967D2; --g-red-i: #C5221F; --g-yellow-i: #B06000; --g-green-i: #188038; }
.aih-kick { background: linear-gradient(90deg, var(--g-blue), var(--g-red) 35%, var(--g-yellow) 65%, var(--g-green)); -webkit-background-clip: text; background-clip: text; }
.aih-card.g-blue { --gc: var(--g-blue); --gt: var(--g-blue-t); --gi: var(--g-blue-i); }
.aih-card.g-red { --gc: var(--g-red); --gt: var(--g-red-t); --gi: var(--g-red-i); }
.aih-card.g-yellow { --gc: var(--g-yellow); --gt: var(--g-yellow-t); --gi: var(--g-yellow-i); }
.aih-card.g-green { --gc: var(--g-green); --gt: var(--g-green-t); --gi: var(--g-green-i); }
.aih-card { box-shadow: none; border-top: 4px solid var(--gc); }
.aih-card .aih-ico { color: var(--gi); background: var(--gt); }
.aih-card .aih-prod { color: var(--gi); }
.aih-card .aih-btn.pri { background: var(--gc); border-color: var(--gc); }
.aih-card.g-yellow .aih-btn.pri { color: #202124; }
.aih-card .aih-chip { border-color: var(--gt); background: var(--gt); }
.aih-card.coming { border-top-style: dashed; }
.aih-layer { border-top-color: var(--g-blue); }
.aih-ln { background: var(--g-blue); }
.aih-tech span { border-color: rgba(26,115,232,.3); background: var(--g-blue-t); }
.aih-layer.l2 { border-top-color: var(--g-green); }
.aih-layer.l2 .aih-ln { background: var(--g-green); }
.aih-layer.l2 .aih-tech span { border-color: rgba(52,168,83,.35); background: var(--g-green-t); }
.aih-arch { border-top: 0; position: relative; overflow: hidden; }
.aih-arch::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 4px;
  background: linear-gradient(90deg, var(--g-blue) 0 25%, var(--g-red) 25% 50%, var(--g-yellow) 50% 75%, var(--g-green) 75%); }
.aih-zone.ggl { border-color: rgba(26,115,232,.45); }
.aih-zone.ggl .aih-row span { background: var(--g-blue-t); border-color: rgba(26,115,232,.3); }
.aih-flow li.gem { border-color: var(--g-blue); }
.aih-flow li.gem b { color: var(--g-blue-i); }
.aih-voice { display: grid; grid-template-columns: auto 1fr; gap: 22px; align-items: center; padding: 22px; border-radius: var(--r-lg);
  border: 1px solid var(--border); background: var(--card-bg); backdrop-filter: var(--card-blur); position: relative; overflow: hidden; }
.aih-voice::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 4px;
  background: linear-gradient(90deg, var(--g-blue) 0 25%, var(--g-red) 25% 50%, var(--g-yellow) 50% 75%, var(--g-green) 75%); }
.aih-voice-mic { display: flex; align-items: center; gap: 6px; height: 64px; padding: 0 18px; border-radius: 999px; background: var(--g-blue-t); }
.aih-voice-mic span { width: 9px; border-radius: 9px; animation: aih-wave 1.1s ease-in-out infinite; }
.aih-voice-mic span:nth-child(1) { background: var(--g-blue); height: 22px; }
.aih-voice-mic span:nth-child(2) { background: var(--g-red); height: 40px; animation-delay: .15s; }
.aih-voice-mic span:nth-child(3) { background: var(--g-yellow); height: 30px; animation-delay: .3s; }
.aih-voice-mic span:nth-child(4) { background: var(--g-green); height: 18px; animation-delay: .45s; }
@keyframes aih-wave { 50% { transform: scaleY(.45); } }
@media (prefers-reduced-motion: reduce) { .aih-voice-mic span { animation: none; } }
.aih-voice-txt { display: flex; flex-direction: column; gap: 8px; }
.aih-voice h2 { margin: 0; font-size: 20px; color: var(--ink); text-wrap: balance; }
.aih-voice p { margin: 0; font-size: 13.5px; color: var(--ink-2); max-width: 80ch; line-height: 1.5; }
.aih-voice-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.aih-voice-chips .aih-chip b { color: var(--g-blue-i); margin-right: 4px; }
.aih-voice-note { font-size: 11.5px; color: var(--ink-3); }
@media (max-width: 760px) { .aih-voice { grid-template-columns: 1fr; } .aih-voice-mic { justify-self: start; height: 48px; } }
`
