// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arup Biswas
// AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

/* Seen before (buildathon F1): on the asset page, the failures most like this
   asset's current one, anywhere on the estate, and what fixed each of them.
   Ranked by gemini-embedding-001 similarity on the backend (/api/similar);
   with no Gemini key it ranks by word overlap and says so. Read-only. */
import { useEffect, useState } from 'react'
import { getJSON } from './api.js'

const day = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '')

export default function SeenBefore({ code }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let live = true
    setData(null); setErr(null)
    getJSON(`/api/similar?asset_code=${encodeURIComponent(code)}&k=3`)
      .then((d) => live && setData(d))
      .catch((e) => live && setErr(String(e)))
    return () => { live = false }
  }, [code])

  if (err || !data || !data.query) return null   // no failure on this asset: nothing to compare
  const q = data.query
  return (
    <div className="card seen-before" id="seen-before">
      <div className="sb-head">
        <h3>🔁 Seen before</h3>
        <span className="sb-src" title={data.mode === 'embedding' ? `Ranked by meaning with ${data.model}` : 'Gemini is off: ranked by shared words'}>
          {data.mode === 'embedding' ? `✦ ${data.model}${data.onprem ? ' · on-prem' : ''}` : 'keyword match'}
        </span>
      </div>
      <div className="sb-query">
        <span className={`sb-state ${q.open ? 'open' : ''}`}>{q.open ? 'Open now' : 'Latest'}</span>
        <b>{q.fault_type || 'Failure'}</b> · <span className="dt">{day(q.started_at)}</span>
        <div className="sb-q-text">{q.description}</div>
      </div>
      {data.matches.length === 0
        ? <p className="dim sb-none">No earlier fixed failure like this one.</p>
        : (
          <ol className="sb-list">
            {data.matches.map((m) => (
              <li key={m.failure_id} className="sb-item">
                <div className="sb-row1">
                  <span className="sb-score" title="Similarity">{Math.round(m.score * 100)}%</span>
                  <a className="code" href={`#/asset/${encodeURIComponent(m.asset_code)}`}>{m.asset_code}</a>
                  <span className="sb-ft">{m.fault_type}</span>
                  <span className="dim dt sb-when">{day(m.started_at)}{m.downtime_hrs != null ? ` · ${m.downtime_hrs} h down` : ''}</span>
                </div>
                <div className="sb-desc">{m.description}</div>
                <div className="sb-fix"><span className="sb-fix-k">What fixed it</span>{m.fix}{m.attended_by ? <span className="dim"> · {m.attended_by}</span> : null}</div>
              </li>
            ))}
          </ol>
        )}
      <div className="sb-foot dim">Suggestions from past records — the crew decides.</div>
    </div>
  )
}
