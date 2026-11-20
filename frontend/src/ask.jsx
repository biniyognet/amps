// SPDX-License-Identifier: MIT
// Ask AMPS — plain-language questions answered from the live register.
// The backend (/api/ai) gives the model read-only lookups; this is only the chat
// surface. Hidden entirely when the deployment has no model configured.
import { useEffect, useRef, useState } from 'react'
import { API, useMe } from './api'
import { useDictation, useSpeaker, useVoiceLang, LangPick } from './voice.jsx'

// Three starters, each lands on a seeded demo story. The tools filter by site (not
// by location) and need a code for one asset's history, so the chips name both.
const SUGGEST = [
  'Which assets are overdue for preventive maintenance?',
  'पंप मोटर 1 (CWT-AM-MTR-01) का इतिहास बताइए',
  'Open failures at City Water Treatment Plant',
]

const TOOL_LABEL = {
  list_sites: 'sites', search_assets: 'asset register', overdue_pm: 'PM schedule',
  failure_summary: 'failure log', asset_history: 'asset history',
  draft_pm_plan: 'maintenance plan',
}

// asset codes like EGS-CB-BAT-01 become links to the asset page
const CODE_RE = /\b([A-Z]{2,5}(?:-[A-Z0-9]{1,6}){2,4})\b/g

function inline(text, key) {
  const out = []
  let last = 0
  const src = text.replace(/\*\*(.+?)\*\*/g, '\u0001$1\u0002')
  src.replace(CODE_RE, (m, code, i) => {
    out.push(src.slice(last, i))
    out.push(<a key={key + i} href={`#/asset/${encodeURIComponent(code)}`}>{code}</a>)
    last = i + m.length
    return m
  })
  out.push(src.slice(last))
  return out.map((p, i) => typeof p !== 'string' ? p
    : p.split(/(\u0001.*?\u0002)/).map((s, j) => s.startsWith('\u0001')
      ? <b key={`${key}b${i}${j}`}>{s.slice(1, -1)}</b> : s))
}

function Answer({ text }) {
  const lines = text.split('\n').filter(l => l.trim())
  const bullets = [], blocks = []
  const flush = () => { if (bullets.length) blocks.push(<ul key={'u' + blocks.length}>{bullets.splice(0)}</ul>) }
  lines.forEach((l, i) => {
    const m = l.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/)
    if (m) bullets.push(<li key={i}>{inline(m[1], 'l' + i)}</li>)
    else { flush(); blocks.push(<p key={'p' + i}>{inline(l, 'p' + i)}</p>) }
  })
  flush()
  return <>{blocks}</>
}

// An AI-drafted maintenance plan: shown for review, saved only when a signed-in
// supervisor approves it. The server re-checks scope and skips any asset whose
// plan changed since the draft.
function PlanCard({ plan, canWrite }) {
  const [state, setState] = useState(null) // null | 'busy' | {applied, skipped} | {error}
  async function approve() {
    setState('busy')
    try {
      const r = await fetch(`${API}/api/ai/plan/${plan.id}/apply`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.detail || 'Could not save the plan.')
      setState(j)
    } catch (e) { setState({ error: e.message }) }
  }
  const more = plan.count - plan.changes.length
  return (
    <div className="ask-plan">
      <div className="ask-plan-head">
        <b>Draft plan · {plan.scope}</b>
        <span>{plan.count} asset{plan.count === 1 ? '' : 's'} to change</span>
      </div>
      <div className="ask-plan-rows">
        {plan.changes.map(c => (
          <div key={c.code} className="ask-plan-row">
            <a href={`#/asset/${encodeURIComponent(c.code)}`}>{c.code}</a>
            <span className="ask-plan-cyc">
              <s>{c.before.join(', ') || 'none'}</s> → <b>{c.after.join(', ')}</b>
            </span>
            <small>{c.reason}</small>
          </div>
        ))}
        {more > 0 && <small className="ask-plan-more">and {more} more</small>}
      </div>
      {state?.applied !== undefined ? (
        <p className="ask-plan-done">Approved · {state.applied} saved
          {state.skipped ? ` · ${state.skipped} skipped (changed since the draft)` : ''}</p>
      ) : !plan.count ? null : canWrite ? (
        <>
          <button className="ask-plan-ok" disabled={state === 'busy'} onClick={approve}>
            {state === 'busy' ? 'Saving…' : `Approve ${plan.count} change${plan.count === 1 ? '' : 's'}`}
          </button>
          {state?.error && <p className="ask-plan-err">{state.error}</p>}
        </>
      ) : (
        <p className="ask-plan-note">Nothing is saved yet. Sign in as a supervisor to approve.</p>
      )}
    </div>
  )
}

// "gemini-3.5-flash-lite" → "Gemini 3.5 Flash-Lite" · "gemma3:4b" → "Gemma 3 4B"
function modelName(id = '') {
  const m = id.split('/').pop()
  const g = m.match(/^gemma-?(\d+(?:\.\d+)?)[:-]?(\d+)b/i)
  if (g) return `Gemma ${g[1]} ${g[2]}B`
  return m.split('-').map((w, i, a) => w === 'lite' && i > 0 ? null
    : w === 'flash' && a[i + 1] === 'lite' ? 'Flash-Lite'
    : /^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)).filter(Boolean).join(' ')
}

// which model answered — cloud Gemini, or the on-prem Gemma that stepped in when it failed
function ModelChip({ model, provider, fallback }) {
  const where = provider === 'gemma-onprem' ? `on-prem${fallback ? ' (fallback)' : ''}` : 'cloud'
  return (
    <small className="ask-src" title={model}
      style={{ display: 'inline-block', alignSelf: 'flex-start', marginTop: 4, padding: '1px 8px',
        borderRadius: 999, border: '1px solid currentColor', opacity: .75 }}>
      {modelName(model)} · {where}
    </small>
  )
}

export default function AskAmps() {
  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [msgs, setMsgs] = useState([])
  const [busy, setBusy] = useState(false)
  const { canWrite } = useMe()
  const end = useRef(null)
  const input = useRef(null)
  const [lang, setLang] = useVoiceLang()
  const voiced = useRef(false) // last question was spoken -> read the answer aloud
  const speaker = useSpeaker()
  const mic = useDictation((t) => { voiced.current = true; setQ(''); ask(t) }, lang, setQ)

  useEffect(() => {
    fetch(`${API}/api/ai/status`).then(r => r.ok ? r.json() : null)
      .then(setStatus).catch(() => setStatus(null))
  }, [])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs, busy])
  useEffect(() => { if (open) input.current?.focus() }, [open])
  // other screens (the landing's AI band) open the panel, optionally with a question typed in
  useEffect(() => {
    const h = (e) => { setOpen(true); if (e.detail?.q) setQ(e.detail.q) }
    window.addEventListener('amps:ask', h)
    return () => window.removeEventListener('amps:ask', h)
  }, [])

  if (!status?.enabled) return null

  async function ask(text) {
    const question = (text ?? q).trim()
    if (!question || busy) return
    setQ('')
    const history = msgs.filter(m => !m.error).map(m => ({ role: m.role, text: m.text })).slice(-6)
    setMsgs(m => [...m, { role: 'user', text: question }])
    setBusy(true)
    try {
      const r = await fetch(`${API}/api/ai/ask`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.detail || 'The assistant could not answer just now.')
      setMsgs(m => [...m, { role: 'assistant', text: j.answer, tools: j.tools, model: j.model, provider: j.provider, fallback: j.fallback, plan: j.plan }])
      if (voiced.current) speaker?.speak(j.answer, msgs.length + 1)
    } catch (e) {
      setMsgs(m => [...m, { role: 'assistant', text: e.message, error: true }])
    } finally {
      voiced.current = false
      setBusy(false)
    }
  }

  return (
    <>
      {!open && (
        <button className="ask-fab" onClick={() => setOpen(true)} aria-label="Ask AMPS">
          <span className="ask-spark" aria-hidden>✦</span> Ask AMPS
        </button>
      )}
      {open && (
        <section className="ask-panel" role="dialog" aria-label="Ask AMPS">
          <header>
            <div>
              <b>Ask AMPS</b>
              <small>Answers from the live records · {status.model}</small>
            </div>
            <button onClick={() => { speaker?.stop(); setOpen(false) }} aria-label="Close">×</button>
          </header>
          <div className="ask-body">
            {!msgs.length && (
              <div className="ask-intro">
                <p>Ask about your assets in plain words — English, हिन्दी or বাংলা. Every answer is
                  looked up in the register, PM schedule and failure log; nothing is made up.</p>
                {mic && <p className="ask-voice-tip">🎤 Or just say it: pick a language below, tap the mic, ask. The answer is read back to you.</p>}
                <div className="ask-chips">
                  {SUGGEST.map(s => <button key={s} onClick={() => ask(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`ask-msg ${m.role}${m.error ? ' err' : ''}`}>
                {m.role === 'assistant' ? <Answer text={m.text} /> : m.text}
                {m.plan && <PlanCard plan={m.plan} canWrite={canWrite} />}
                {m.tools?.length > 0 && (
                  <small className="ask-src">
                    Looked up: {[...new Set(m.tools.map(t => TOOL_LABEL[t.tool] || t.tool))].join(' · ')}
                  </small>
                )}
                {m.model && <ModelChip model={m.model} provider={m.provider} fallback={m.fallback} />}
                {speaker && m.role === 'assistant' && !m.error && (
                  <button type="button" className={`ask-say${speaker.speaking === i ? ' on' : ''}`}
                          onClick={() => speaker.speaking === i ? speaker.stop() : speaker.speak(m.text, i)}
                          aria-label={speaker.speaking === i ? 'Stop reading' : 'Read aloud'}>
                    {speaker.speaking === i ? '■ Stop' : '🔊 Listen'}</button>
                )}
              </div>
            ))}
            {busy && <div className="ask-msg assistant busy"><span /><span /><span /></div>}
            <div ref={end} />
          </div>
          {mic && <div className="ask-voicebar"><LangPick lang={lang} setLang={setLang} />
            <small>{mic.on ? 'Listening…' : 'Voice: speak in English, বাংলা or हिन्दी'}</small></div>}
          <form className="ask-input" onSubmit={e => { e.preventDefault(); ask() }}>
            {mic && <button type="button" className={`ask-mic${mic.on ? ' on' : ''}`} onClick={() => { speaker?.stop(); mic.toggle() }}
              disabled={busy} aria-label={mic.on ? 'Stop listening' : 'Speak your question'}>🎤</button>}
            <input ref={input} value={q} onChange={e => setQ(e.target.value)} maxLength={500}
              placeholder={mic?.on ? 'Listening…' : 'e.g. Which pumps are overdue at City Water?'} />
            <button disabled={busy || !q.trim()}>Ask</button>
          </form>
        </section>
      )}
    </>
  )
}
