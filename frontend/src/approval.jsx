/* t06 — "AI draft → approved by <name> at <time>" on job cards and planned rows.
   No new backend field: both proofs are already written by the server.
   · a Snap job card's text ends "AI-drafted (<model>[, confidence 0.82]), confirmed by <user>";
     the time is the entry's own `at` (UTC, shown in IST).
   · an auto-plan row's source is "AMPS auto-plan · approved by <user> 19 Nov 2026[ 14:05]"
     (time IST; rows filed before t06 carry the date only). */

const fmtIST = (ts) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(String(ts)) ? ts : `${ts}Z`)
  .toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

// a Snap narrative → { model, confidence, by } or null
export function snapApproval(text) {
  const m = String(text || '').match(/AI-drafted \(([^,)]+)(?:, confidence ([\d.]+))?\), confirmed by (\S+)/)
  return m ? { model: m[1].trim(), confidence: m[2] ? Number(m[2]) : null, by: m[3] } : null
}

// an auto-plan source stamp → { by, when } or null
export function planApproval(source) {
  const m = String(source || '').match(/^AMPS auto-plan · approved by (\S+) (\d\d \w{3} \d{4})(?: (\d\d:\d\d))?/)
  return m ? { by: m[1], when: m[3] ? `${m[2].slice(0, 6)}, ${m[3]}` : m[2] } : null
}

export function AiApproved({ by, when, title }) {
  return (
    <span className="ai-ok" title={title}>
      <i>AI draft</i> → approved by <b>{by}</b>{when && <> at {when}</>}
    </span>
  )
}

// job card: the card's text first, the failure's (same narrative) as fallback
export function JobCardApproval({ jc, f }) {
  const a = snapApproval(jc?.text) || snapApproval(f?.text)
  if (!a) return null
  const conf = a.confidence != null ? ` · confidence ${a.confidence.toFixed(2)}` : ''
  return <div><AiApproved by={a.by} when={jc?.at ? fmtIST(jc.at) : ''} title={`Drafted by ${a.model}${conf}, confirmed by ${a.by}`} /></div>
}

export function PlanApproval({ source }) {
  const a = planApproval(source)
  return a ? <AiApproved by={a.by} when={a.when} title={source} /> : null
}
