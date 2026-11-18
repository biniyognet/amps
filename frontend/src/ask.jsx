// SPDX-License-Identifier: MIT
// Ask AMPS — plain-language questions answered from the live register.
// The backend (/api/ai) gives the model read-only lookups; this is only the chat
// surface. Hidden entirely when the deployment has no model configured.
import { useEffect, useRef, useState } from 'react'
import { API, useMe } from './api'

const SUGGEST = [
  'Which site has the most overdue maintenance?',
  'Which assets keep failing?',
  'What is the MTTR at Eastern Grid?',
  'Vital assets past their design life',
  'Draft a maintenance plan for Eastern Grid',
  'কোন সাইটে সবচেয়ে বেশি ব্রেকডাউন?',
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

export default function AskAmps() {
  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [msgs, setMsgs] = useState([])
  const [busy, setBusy] = useState(false)
  const { canWrite } = useMe()
  const end = useRef(null)
  const input = useRef(null)

  useEffect(() => {
    fetch(`${API}/api/ai/status`).then(r => r.ok ? r.json() : null)
      .then(setStatus).catch(() => setStatus(null))
  }, [])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs, busy])
  useEffect(() => { if (open) input.current?.focus() }, [open])

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
      setMsgs(m => [...m, { role: 'assistant', text: j.answer, tools: j.tools, model: j.model, plan: j.plan }])
    } catch (e) {
      setMsgs(m => [...m, { role: 'assistant', text: e.message, error: true }])
    } finally {
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
            <button onClick={() => setOpen(false)} aria-label="Close">×</button>
          </header>
          <div className="ask-body">
            {!msgs.length && (
              <div className="ask-intro">
                <p>Ask about your assets in plain words — English, हिन्दी or বাংলা. Every answer is
                  looked up in the register, PM schedule and failure log; nothing is made up.</p>
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
              </div>
            ))}
            {busy && <div className="ask-msg assistant busy"><span /><span /><span /></div>}
            <div ref={end} />
          </div>
          <form className="ask-input" onSubmit={e => { e.preventDefault(); ask() }}>
            <input ref={input} value={q} onChange={e => setQ(e.target.value)} maxLength={500}
              placeholder="e.g. Which pumps are overdue at City Water?" />
            <button disabled={busy || !q.trim()}>Ask</button>
          </form>
        </section>
      )}
    </>
  )
}
