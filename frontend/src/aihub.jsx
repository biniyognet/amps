// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arup Biswas
// AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

/* AI hub (#/ai): every AI feature on one page, each opening on a seeded
   example in one or two clicks and naming the Google product that does the
   work. Four are live; four are planned for the buildathon and say so.
   The two-layer strip on top says which technique each feature uses and why
   it is the cheapest one that does the job. */
import { useEffect, useState } from 'react'
import { API, useMe } from './api.js'
import { rememberNext } from './snap.jsx'

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

const Ico = ({ d }) => (
  <svg className="aih-ico" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>)

// Layer 1 runs on every click, so it must be fast and cheap; Layer 2 runs in
// batch and gets better as the log book grows.
const LAYERS = [
  { n: 1, name: 'Every click', sub: 'fast · cheap · explainable',
    tech: ['RAG', 'Deterministic rules', 'Small model (Flash-Lite)', 'Voice to text', 'OCR / vision'],
    rows: [
      ['Snap & Report', 'OCR / vision + voice + Flash-Lite'],
      ['Ask AMPS', 'RAG over our own records + Flash-Lite function calling'],
      ['Similar past failures', 'RAG: Gemini embeddings, cosine match'],
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

function Card({ icon, title, product, line, status, layer, children }) {
  return (
    <article className={`aih-card${status === 'coming' ? ' coming' : ''}`}>
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
          <span className="aih-kick">✦ Built on Google AI</span>
          <h1>AI in AMPS</h1>
          <p>Pick any feature. Each one opens on a real example from this demo, and says which Google product does the work.</p>
        </div>
        <div className={`aih-model${on ? '' : ' off'}`} role="status">
          <small>Model on this server</small>
          <b>{ai === undefined ? 'checking…' : on ? ai.model : 'AI is off'}</b>
          {ai !== undefined && !on && <span>No Gemini key set here. Live cards open their screens, but nothing is drafted.</span>}
        </div>
      </header>

      <Layers />

      <section className="aih-grid" aria-label="AI features">
        <Card status="live" layer={1} title="Snap & Report" product="Flash-Lite · OCR / vision + voice"
              icon="M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
              line="Photo and a rough note in; a drafted failure report and job card out. A person submits.">
          <a className="aih-btn pri" href={`#/snap/${SNAP_DEMO}`}>Try on HSCB Panel 1 →</a>
        </Card>
        <Card status="live" layer={1} title="Ask AMPS" product="RAG + function calling · 6 read-only tools"
              icon="M4 5h16v11H9l-5 4zM8 9h8M8 12h5"
              line="Plain questions in English, हिन्दी or বাংলা. It looks the records up and shows which ones it used.">
          <div className="aih-chips">
            {ASK_CHIPS.map((q) => <button key={q} type="button" className="aih-chip" disabled={!on} onClick={() => ask(q)}>{q}</button>)}
          </div>
        </Card>
        <Card status="live" layer={1} title="PM plan" product="Deterministic scheduler · Gemini explains"
              icon="M4 5h16v15H4zM4 9h16M9 3v4M15 3v4M8 14l2 2 4-4"
              line="Lays due and overdue PM onto the week and finds the gaps. The supervisor approves each change.">
          <a className="aih-btn pri" href={planHref} onClick={() => { if (!signedIn) rememberNext('/planner?auto=1') }}>
            {signedIn ? 'Draft this week →' : 'Sign in to draft →'}</a>
        </Card>
        <Card status="live" layer={1} title="MCP server" product="Model Context Protocol · Agent Skills"
              icon="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"
              line="Any agent, Antigravity or others, can use AMPS through the same six tools, read-only.">
          <button type="button" className="aih-btn pri" aria-expanded={mcp} onClick={() => setMcp((v) => !v)}>
            {mcp ? 'Hide the tools' : 'See the 6 tools'}</button>
        </Card>

        <Card status="live" layer={1} title="Similar past failures" product="RAG · gemini-embedding-001"
              icon="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4"
              line="Before the panel is opened, AMPS shows what fixed the same fault last time. Example: Pump Motor 1.">
          <a className="aih-btn pri" href={`#/asset/${SIMILAR_DEMO}`}>Seen before on Pump Motor 1 →</a>
        </Card>
        <Card status="coming" layer={2} title="Fault fields" product="BigQuery AI.EXTRACT · Flash-Lite"
              icon="M4 7h10M4 12h16M4 17h7M17 4l3 3-3 3"
              line="Free-text remarks in three languages become columns you can count: component, symptom, cause, action.">
          <span className="aih-btn ghost" aria-disabled="true">10 remarks · coming</span>
        </Card>
        <Card status="coming" layer={2} title="Estate agent" product="BigQuery Conversational Analytics"
              icon="M4 20V10M10 20V4M16 20v-7M22 20H2"
              line="Managers ask the whole estate in English and get charts back, from the amps_demo dataset.">
          <span className="aih-btn ghost" aria-disabled="true">Open agent ↗ · coming</span>
        </Card>
        <Card status="live" layer={1} title="Risk badge" product="Deterministic rule score · BigQuery ML next"
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
@media (max-width: 1100px) { .aih-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .aih-layers { grid-template-columns: 1fr; } .aih-layer li { grid-template-columns: 1fr; gap: 0; } .aih-mcp { grid-template-columns: 1fr; } .aih-flow { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 500px) {
  .aih-grid, .aih-flow { grid-template-columns: 1fr; }
  .aih-head h1 { font-size: 24px; }
  .aih-model { max-width: none; width: 100%; }
}
`
