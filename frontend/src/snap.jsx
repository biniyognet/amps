// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arup Biswas and AMPS contributors (binidev)
// AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

/* Snap & Report — the one-tap fault report a technician makes at the asset.
   QR scan lands on the asset → photo + remark → Gemini drafts the analysis
   (reads the photo and the asset's own history) → the person edits it, ticks
   Failure report and/or Job card, picks the agency → linked log entries with
   the photo attached, and printable documents. The AI drafts; a human confirms. */
import { useEffect, useRef, useState } from 'react'
import { API, ORG, getJSON, useLiveAsset, useMe } from './api.js'
import { compressImage } from './logbook.jsx'
import QR, { assetUrl } from './qr.jsx'

const SEVERITIES = ['low', 'med', 'high', 'critical']
const SEV_LABEL = { low: 'Low', med: 'Medium', high: 'High', critical: 'Critical' }
const EMPTY = { fault_type: '', severity: 'med', likely_cause: '', suggested_action: '', safety_note: '', confidence: null, summary: '', safety_flags: null }
const GEAR_LABEL = { helmet: 'helmet', vest: 'hi-vis vest', lockout_tag: 'lockout/tag' }
const enc = encodeURIComponent
const fmtIST = (ts) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(String(ts)) ? ts : `${ts}Z`)
  .toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

async function postJSON(path, body) {
  const r = await fetch(`${API}${path}`, body instanceof FormData
    ? { method: 'POST', body }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `request failed (${r.status})`)
  return j
}

export const rememberNext = (hash) => { try { sessionStorage.setItem('amps-next', hash) } catch { /* private mode */ } }

/* Dictation through the browser's Web Speech API — Chrome on Android has it;
   where it doesn't exist the mic button simply isn't shown. */
function useDictation(onText) {
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
  const [on, setOn] = useState(false)
  const rec = useRef(null)
  const toggle = () => {
    if (on) { rec.current?.stop(); return }
    const r = new SR()
    r.lang = 'en-IN'; r.interimResults = false; r.continuous = false
    r.onresult = (e) => onText([...e.results].map((x) => x[0].transcript).join(' '))
    r.onend = () => setOn(false)
    r.onerror = () => setOn(false)
    rec.current = r; r.start(); setOn(true)
  }
  return SR ? { on, toggle } : null
}

export default function SnapReport({ code }) {
  const { asset: a, log, loading, error } = useLiveAsset(code)
  const { canWrite, loading: meLoading } = useMe()
  const [photo, setPhoto] = useState(null)          // compressed File
  const [preview, setPreview] = useState('')
  const [remarks, setRemarks] = useState('')
  const [stage, setStage] = useState('input')       // input | analysing | draft | saving | done
  const [draft, setDraft] = useState(null)
  const [meta, setMeta] = useState({})              // photo_token, model, vision, note
  const [mk, setMk] = useState({ failure: true, job: false })
  const [agencies, setAgencies] = useState([])
  const [agency, setAgency] = useState('')
  const [other, setOther] = useState('')
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)
  const fileRef = useRef(null)
  const mic = useDictation((t) => setRemarks((r) => (r ? `${r} ${t}` : t)))

  useEffect(() => {
    if (!canWrite) return
    getJSON('/api/snap/agencies').then(setAgencies).catch(() => setAgencies([]))
  }, [canWrite])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  if (loading || meLoading) return <p className="dim">Loading {code}…</p>
  if (error || !a) return <div className="card offline-note">No asset with code <span className="code">{code}</span> in the register.</div>

  const back = `#/asset/${enc(a.code)}`
  if (!canWrite) {
    return (
      <div className="snap">
        <a className="crumb" href={back}>← {a.code}</a>
        <div className="card snap-card">
          <h3 className="snap-h">Report a problem on {a.code}</h3>
          <p className="dim">Reading is open to everyone; reporting needs a signed-in technician or supervisor, so every report has a name on it.</p>
          <a className="btn" href="#/login" onClick={() => rememberNext(`/snap/${enc(a.code)}`)}>Sign in to report</a>
        </div>
      </div>
    )
  }

  const openFail = log.find((e) => e.type === 'failure' && !e.ended_at)

  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) { setErr('Please choose a photo.'); return }
    setErr('')
    const c = await compressImage(f, 1600, 0.78, false)
    if (c.size > 8 * 1024 * 1024) { setErr('That photo is too large even compressed — take it again closer.'); return }
    setPhoto(c); setPreview(URL.createObjectURL(c))
  }

  const analyse = async () => {
    setErr(''); setStage('analysing')
    const fd = new FormData()
    fd.append('asset_code', a.code); fd.append('remarks', remarks)
    if (photo) fd.append('photo', photo)
    try {
      const out = await postJSON('/api/snap/analyze', fd)
      setMeta({ photo_token: out.photo_token, model: out.model, vision: out.vision, note: out.note })
      const d = out.draft ? { ...EMPTY, ...out.draft } : { ...EMPTY, summary: remarks }
      setDraft(d)
      if (out.draft?.recommend) setMk({ failure: !!out.draft.recommend.failure || !out.draft.recommend.job_card, job: !!out.draft.recommend.job_card })
      setStage('draft')
    } catch (ex) { setErr(String(ex.message)); setStage('input') }
  }

  const chosenAgency = agency === '__other' ? other.trim() : agency
  const canSubmit = (mk.failure || mk.job) && (!mk.job || chosenAgency) && ((draft?.summary || '').trim() || remarks.trim())

  const submit = async () => {
    setErr(''); setStage('saving')
    try {
      const res = await postJSON('/api/snap/submit', {
        asset_code: a.code, remarks, draft,
        make_failure: mk.failure, make_job_card: mk.job,
        agency: mk.job ? chosenAgency : null,
        photo_token: meta.photo_token || null,
        ai_model: meta.model || null,
      })
      setResult(res); setStage('done')
    } catch (ex) { setErr(String(ex.message)); setStage('draft') }
  }

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }))
  const gearMissing = Object.entries(GEAR_LABEL).filter(([k]) => draft?.safety_flags?.[k] === 'missing').map(([, l]) => l)

  return (
    <div className="snap">
      <a className="crumb no-print" href={back}>← {a.code}</a>

      <div className="card snap-card snap-asset">
        <div>
          <span className="hero-code">{a.code}</span>
          <div className="snap-name">{a.name}</div>
          <div className="dim snap-sub">{a.cls} · {a.line ? `${a.line} · ` : ''}{a.location}</div>
        </div>
        {openFail && <span className="snap-open" title={openFail.text}>Open failure since {fmtIST(openFail.at)}</span>}
      </div>

      {stage === 'done' ? (
        <div className="card snap-card snap-done">
          <div className="snap-tick">✓</div>
          <h3 className="snap-h">Reported</h3>
          <ul className="snap-links">
            {result.failure_id && (
              <li>
                Failure report <b>#{result.failure_id}</b>{result.failure_existing ? ' (the open one — this job card was raised against it)' : ''}
              </li>
            )}
            {result.job_card_id && (
              <li>
                Job card <b>#{result.job_card_id}</b> issued to <b>{chosenAgency}</b>
              </li>
            )}
            <li>{result.photo_attached ? 'Photo attached to the record.' : 'No photo attached.'}</li>
          </ul>
          <div className="snap-row">
            {result.failure_id && <a className="btn" href={`#/print/failure/${result.failure_id}?asset=${enc(a.code)}`}>🖨 Failure report</a>}
            {result.job_card_id && <a className="btn" href={`#/print/jobcard/${result.job_card_id}?asset=${enc(a.code)}`}>🖨 Job card</a>}
          </div>
          <div className="snap-row">
            <a className="btn ghost" href={back}>Back to asset</a>
            {result.job_card_id && <a className="btn ghost" href="#/job-cards">Job-cards board</a>}
          </div>
        </div>
      ) : (
        <>
          <div className="card snap-card">
            <label className="snap-l">Photo</label>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
            {preview
              ? <div className="snap-photo"><img src={preview} alt="Fault photo" />
                  {stage === 'input' && <button type="button" className="btn ghost sm" onClick={() => fileRef.current?.click()}>Retake</button>}</div>
              : <button type="button" className="snap-shoot" onClick={() => fileRef.current?.click()}>
                  <span aria-hidden="true">📷</span> Take a photo of the fault</button>}

            <label className="snap-l" htmlFor="snap-rem">What do you see?</label>
            <div className="snap-rem">
              <textarea id="snap-rem" rows={3} value={remarks} disabled={stage !== 'input'}
                        placeholder="e.g. burning smell near the incomer, panel door hot to touch"
                        onChange={(e) => setRemarks(e.target.value)} />
              {mic && stage === 'input' && (
                <button type="button" className={`snap-mic${mic.on ? ' on' : ''}`} onClick={mic.toggle}
                        title={mic.on ? 'Stop dictation' : 'Dictate'} aria-label="Dictate remark">🎤</button>
              )}
            </div>

            {stage === 'input' && (
              <button type="button" className="btn snap-go" onClick={analyse}
                      disabled={!photo && remarks.trim().length < 3}>Analyse with Gemini</button>
            )}
            {stage === 'analysing' && <div className="snap-shimmer">Gemini is reading the photo and {a.code}'s history…</div>}
          </div>

          {draft && (stage === 'draft' || stage === 'saving') && (
            <div className="card snap-card">
              <div className="snap-draft-h">
                <h3 className="snap-h">{meta.model ? 'AI draft — check and edit' : 'Your report'}</h3>
                {meta.model && (
                  <span className="snap-model">{meta.model}{meta.vision ? ' · read the photo' : ' · text only'}
                    {draft.confidence != null ? ` · confidence ${Math.round(draft.confidence * 100)}%` : ''}</span>
                )}
              </div>
              {gearMissing.length > 0 && (
                <span className="chip snap-gear" role="alert" title={draft.safety_flags?.note || ''}>
                  <span className="dot" />Safety gear missing: {gearMissing.join(' · ')}</span>
              )}
              {meta.note && <p className="snap-note">{meta.note}</p>}

              <label className="snap-l">Summary</label>
              <input value={draft.summary} onChange={set('summary')} />
              <div className="snap-2">
                <div>
                  <label className="snap-l">Fault type</label>
                  <input value={draft.fault_type} onChange={set('fault_type')} />
                </div>
                <div>
                  <label className="snap-l">Severity</label>
                  <div className="snap-sev">
                    {SEVERITIES.map((s) => (
                      <button key={s} type="button" className={`sev-${s}${draft.severity === s ? ' on' : ''}`}
                              onClick={() => setDraft((d) => ({ ...d, severity: s }))}>{SEV_LABEL[s]}</button>
                    ))}
                  </div>
                </div>
              </div>
              <label className="snap-l">Likely cause</label>
              <textarea rows={2} value={draft.likely_cause} onChange={set('likely_cause')} />
              <label className="snap-l">Suggested action</label>
              <textarea rows={2} value={draft.suggested_action} onChange={set('suggested_action')} />
              <label className="snap-l">Safety</label>
              <input value={draft.safety_note} onChange={set('safety_note')} />

              <div className="snap-make">
                <label className="snap-chk"><input type="checkbox" checked={mk.failure}
                  onChange={(e) => setMk((m) => ({ ...m, failure: e.target.checked }))} /> Failure report</label>
                <label className="snap-chk"><input type="checkbox" checked={mk.job}
                  onChange={(e) => setMk((m) => ({ ...m, job: e.target.checked }))} /> Job card</label>
              </div>
              {mk.job && (
                <div className="snap-agency">
                  <label className="snap-l" htmlFor="snap-ag">Issue job card to</label>
                  <select id="snap-ag" value={agency} onChange={(e) => setAgency(e.target.value)}>
                    <option value="">Choose agency…</option>
                    {agencies.map((x) => <option key={x} value={x}>{x}</option>)}
                    <option value="__other">Other…</option>
                  </select>
                  {agency === '__other' && <input autoFocus placeholder="Agency / department name" value={other} onChange={(e) => setOther(e.target.value)} />}
                  {!mk.failure && !openFail && <p className="dim snap-hint">A failure report is raised automatically for the job card to close.</p>}
                  {openFail && <p className="dim snap-hint">The job card is raised against the open failure on this asset.</p>}
                </div>
              )}
              <div className="snap-row">
                <button type="button" className="btn" disabled={!canSubmit || stage === 'saving'} onClick={submit}>
                  {stage === 'saving' ? 'Saving…' : 'Submit'}</button>
                <button type="button" className="btn ghost" disabled={stage === 'saving'}
                        onClick={() => { setStage('input'); setDraft(null) }}>Start again</button>
              </div>
            </div>
          )}
        </>
      )}
      {err && <div className="import-msg err snap-err">{err}</div>}
    </div>
  )
}

/* ---------- printable failure report / job card (live) ---------- */

const attSrc = (id) => `${API}/api/logbook/attachments/${id}`

export function SnapPrint({ kind, id, code }) {
  const { asset: a, log, loading, error } = useLiveAsset(code || '')
  if (!code) return <p className="dim">Open this from the asset page.</p>
  if (loading) return <p className="dim">Loading…</p>
  const e = log.find((x) => String(x.id) === String(id))
  if (error || !a || !e) return <div className="card offline-note">Record #{id} not found on {code}.</div>
  const isJob = kind === 'jobcard'
  // a job card prints its failure's photo when it has none of its own
  const fail = isJob ? log.find((x) => x.id === e.rectifies_id) : e
  const photos = (e.attachments || []).filter((p) => p.mime?.startsWith('image/'))
  const shown = photos.length ? photos : ((fail?.attachments) || []).filter((p) => p.mime?.startsWith('image/'))
  const card = isJob ? e : e.job_card_by
  return (
    <>
      <div className="sheet-bar">
        <a className="crumb" style={{ margin: 0 }} href={`#/asset/${enc(a.code)}`}>← {a.code}</a>
        <button className="btn" onClick={() => window.print()}>Print {isJob ? 'job card' : 'failure report'}</button>
        <p>{isJob ? 'Issued copy — hand over to the executing agency.' : 'Failure report — file copy.'}</p>
      </div>
      <div className="osheet snap-sheet">
        <div className="os-top">
          <div className="os-brand">
            <div className="os-org"><span className="brand-name">AMPS</span></div>
            <div className="os-dept">Maintenance<br />{ORG}</div>
          </div>
          <div className="os-title">
            <div className="os-t1">{isJob ? 'Job Card' : 'Failure Report'}</div>
            <div className="os-t2">{e.fault_type || fail?.fault_type || 'Fault reported at site'}</div>
          </div>
          <div className="os-qr">
            <QR value={assetUrl(a.code)} size={72} />
            <div className="os-qr-cap">Scan for asset history</div>
          </div>
        </div>
        <div className="os-doc">
          <span>{isJob ? 'Job card' : 'Failure'} no.: <b className="code">{e.id}</b> · Format AMPS/{isJob ? 'JC' : 'FR'}-01</span>
          <span>{isJob ? (fail ? `Against failure #${fail.id}` : '') : `State: ${(e.state || 'open').toUpperCase()}`}</span>
          <span>Page 1 of 1</span>
        </div>
        <table className="os-details">
          <tbody>
            <tr>
              <td><label>Asset code</label><b className="code">{a.code}</b></td>
              <td><label>Asset</label>{a.name}</td>
              <td><label>Location</label>{a.line ? `${a.line} · ` : ''}{a.location}</td>
              <td><label>Class</label>{a.cls}</td>
            </tr>
            <tr>
              <td><label>Reported</label>{fmtIST(e.at)}</td>
              <td><label>Reported by</label>{e.entered_by}</td>
              <td><label>{isJob ? 'Issued to' : 'Job card'}</label>{isJob ? e.attended_by : (card ? `#${card.id} → ${card.attended_by}` : '—')}</td>
              <td><label>Make / model</label>{a.makeModel || '—'}</td>
            </tr>
          </tbody>
        </table>
        <div className="os-remarks snap-body">
          <div>
            <label>{isJob ? 'Job details / work required' : 'Report'}</label>
            {String(e.text).split('\n').map((l, i) => <p key={i}>{l}</p>)}
            {e.action_taken && <><label style={{ marginTop: 8 }}>Suggested action</label><p>{e.action_taken}</p></>}
          </div>
          {shown[0] && <img className="snap-sheet-photo" src={attSrc(shown[0].id)} alt="Fault photo" />}
        </div>
        <div className="os-remarks" style={{ borderTop: '1px solid #a8a29e' }}>
          <label>{isJob ? 'Completion report / findings' : 'Rectification'}</label>
          {!isJob && e.resolved_by
            ? <p>{e.resolved_by.text} · {fmtIST(e.resolved_by.at)}</p>
            : <><span className="os-rule" /><span className="os-rule" /></>}
        </div>
        <table className="os-signs">
          <tbody>
            <tr>
              <td><span className="os-sign-space">{e.entered_by}</span><label>{isJob ? 'Issued by' : 'Reported by'}</label><span className="os-date">Date: {fmtIST(e.at).split(',')[0]}</span></td>
              <td><span className="os-sign-space" /><label>{isJob ? 'Executed & acknowledged by (agency)' : 'Attended by'}</label><span className="os-date">Date: __________</span></td>
              <td><span className="os-sign-space" /><label>Verified by</label><span className="os-date">Date: __________</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}
