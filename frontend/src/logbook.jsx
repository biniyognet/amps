// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arup Biswas and AMPS contributors (binidev)
// AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

/* Digital shift logbook — the v0.3 module, live on /api/logbook.

   Replaces the earlier local-state demo page: entries now persist through the
   backend's append-only log (a mistake is corrected by a NEW entry pointing at
   the old one — the bound-paper-logbook discipline, enforced by software).

   API base: same-origin by default; demo hosting builds with VITE_AMPS_API. */
import { useEffect, useRef, useState } from 'react'
import { LIVE, ORG, useMe } from './api.js'

/* Optional time — the plain native picker. Blank = no time. */
function TimeInput({ value, onChange, className = '', label = 'Time (optional)' }) {
  return (
    <input type="time" value={value} title={label} aria-label={label}
           className={className} onChange={(e) => onChange(e.target.value)} />
  )
}

const API = import.meta.env.VITE_AMPS_API ?? ''

/* Compress a photo before upload: downscale to maxDim, grayscale, JPEG q — a
   legible A4 checksheet drops from ~3 MB to ~150 KB, so the free off-box backup
   holds years of scans. PDFs pass through (already a document). */
async function compressImage(file, maxDim = 1700, quality = 0.72) {
  if (!file.type.startsWith('image/')) return file
  try {
    const img = await createImageBitmap(file)
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.filter = 'grayscale(1)'
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file   // no gain → keep original
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch { return file }
}

const humanSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`
const attUrl = (id) => `${API}/api/logbook/attachments/${id}`

/* Checksheet uploads — photos / PDFs attached to a log entry (maintenance, job
   card, rectification). Two modes:
   - entryId given (edit form): uploads immediately to that entry.
   - no entryId (add form): stages the (already-compressed) files; the parent
     uploads them after the entry is created, via `staged`/`onStaged`. */
export function AttachmentUpload({ entryId, existing = [], staged = [], onStaged, label = 'Checksheet — photo or PDF' }) {
  const [items, setItems] = useState(existing)   // uploaded AttachmentRefs (edit mode)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)

  const pick = async (e) => {
    const files = [...e.target.files]; e.target.value = ''
    if (!files.length) return
    setErr(''); setBusy(true)
    try {
      const prepared = []
      for (const f of files) {
        if (!/^image\/|application\/pdf$/.test(f.type)) { setErr('Only photos (JPEG/PNG) or PDF.'); continue }
        const c = await compressImage(f)
        if (c.size > 8 * 1024 * 1024) { setErr(`${f.name} is too large even compressed — photograph the sheet instead.`); continue }
        prepared.push(c)
      }
      if (entryId) {
        for (const c of prepared) {
          const fd = new FormData(); fd.append('file', c)
          const r = await fetch(`${API}/api/logbook/${entryId}/attachments`, { method: 'POST', body: fd })
          if (!r.ok) { setErr((await r.json().catch(() => ({})))?.detail || `upload failed (${r.status})`); continue }
          const ref = await r.json(); setItems((xs) => [ref, ...xs])
        }
      } else {
        onStaged?.([...staged, ...prepared])
      }
    } finally { setBusy(false) }
  }
  const addLink = async () => {
    const raw = window.prompt('Paste the checksheet link (Google Drive / Docs URL):', '')
    if (!raw) return
    const url = raw.trim()
    if (!/^https?:\/\//.test(url)) { setErr('A link must start with http:// or https://'); return }
    setErr('')
    if (entryId) {
      setBusy(true)
      try {
        const r = await fetch(`${API}/api/logbook/${entryId}/attachments/link`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
        if (!r.ok) { setErr((await r.json().catch(() => ({})))?.detail || `failed (${r.status})`); return }
        const ref = await r.json(); setItems((xs) => [ref, ...xs])
      } finally { setBusy(false) }
    } else {
      onStaged?.([...staged, { __link: true, url, name: url.replace(/^https?:\/\//, '').slice(0, 40) }])
    }
  }
  const removeUploaded = async (id) => {
    if (!window.confirm('Remove this checksheet?')) return
    const r = await fetch(`${API}/api/logbook/attachments/${id}`, { method: 'DELETE' })
    if (r.ok || r.status === 204) setItems((xs) => xs.filter((x) => x.id !== id))
  }
  const isImg = (m) => (m || '').startsWith('image/')

  return (
    <section className="fg att-fill">
      <span className="fg-lbl">{label}</span>
      <div className="att-list">
        {items.map((a) => (
          <div className="att-item" key={a.id}>
            <a href={a.url || attUrl(a.id)} target="_blank" rel="noreferrer" className="att-thumb" title={a.filename}>
              {a.url
                ? <span className="att-link-ic">🔗</span>
                : isImg(a.mime)
                  ? <img src={attUrl(a.id)} alt={a.filename} />
                  : <embed className="att-pdf-prev" src={`${attUrl(a.id)}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`} type="application/pdf" />}
            </a>
            <span className="att-meta">{a.filename}<br /><span className="dim">{a.url ? 'linked' : humanSize(a.size)}</span></span>
            <button type="button" className="att-x" onClick={() => removeUploaded(a.id)} aria-label="Remove">×</button>
          </div>
        ))}
        {staged.map((f, i) => (
          <div className="att-item staged" key={`s${i}`}>
            <span className="att-thumb"><span className="att-pdf">{f.__link ? '🔗' : f.type === 'application/pdf' ? 'PDF' : 'IMG'}</span></span>
            <span className="att-meta">{f.name}<br /><span className="dim">{f.__link ? 'link · saved on save' : `${humanSize(f.size)} · will upload on save`}</span></span>
            <button type="button" className="att-x" onClick={() => onStaged?.(staged.filter((_, j) => j !== i))} aria-label="Remove">×</button>
          </div>
        ))}
      </div>
      <div className="att-actions">
        <label className="btn ghost sm att-add">
          {busy ? 'Uploading…' : '＋ Add photo / PDF'}
          <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" multiple hidden onChange={pick} disabled={busy} />
        </label>
        <button type="button" className="btn ghost sm" onClick={addLink} disabled={busy}>🔗 Add Drive link</button>
      </div>
      {err && <span className="import-msg err">{err}</span>}
    </section>
  )
}

/* Structured checksheet — pick a predefined template (per asset class) and tick
   each item pass / fail / N-A with an optional reading. The filled result rides
   on the log entry (checksheet field). Templates come from the backend registry;
   until the section's formats are loaded a class may have none, and the section
   simply doesn't appear. */
const CS_STATUS = [['pass', '✓', 'pass'], ['fail', '✕', 'fail'], ['na', '–', 'n/a']]

function ChecksheetFill({ appliesTo, assetClass, subtype, value, onChange }) {
  const [templates, setTemplates] = useState(null)
  useEffect(() => {
    const p = new URLSearchParams({ applies_to: appliesTo })
    if (assetClass) p.set('asset_class', assetClass)
    if (subtype) p.set('subtype', subtype)
    fetch(`${API}/api/logbook/checksheet-templates?${p}`)
      .then((r) => (r.ok ? r.json() : [])).then(setTemplates).catch(() => setTemplates([]))
  }, [appliesTo, assetClass, subtype])

  if (templates === null) return null
  if (templates.length === 0) return null   // no checksheet defined for this class yet

  const pick = (key) => {
    const t = templates.find((x) => x.key === key)
    if (!t) { onChange(null); return }
    onChange({ template: t.key, name: t.name,
      results: t.items.map((it) => ({ label: it.label, unit: it.unit || null, status: 'na', reading: '' })) })
  }
  const setItem = (i, patch) => {
    const results = value.results.map((r, j) => j === i ? { ...r, ...patch } : r)
    onChange({ ...value, results })
  }

  return (
    <section className="fg cs-fill">
      <span className="fg-lbl">Checksheet</span>
      <div className="fg-fields">
        <label className="fg-span">Template
          <select value={value?.template || ''} onChange={(e) => pick(e.target.value)}>
            <option value="">— none —</option>
            {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
        </label>
        {value?.results && (
          <div className="fg-span cs-items">
            {value.results.map((r, i) => (
              <div className="cs-item" key={i}>
                <span className="cs-label">{r.label}</span>
                <span className="cs-status">
                  {CS_STATUS.map(([s, glyph, lbl]) => (
                    <button type="button" key={s} title={lbl}
                            className={`cs-btn cs-${s}${r.status === s ? ' on' : ''}`}
                            onClick={() => setItem(i, { status: s })}>{glyph}</button>
                  ))}
                </span>
                <input className="cs-reading" value={r.reading || ''} placeholder={r.unit ? `reading (${r.unit})` : 'reading'}
                       onChange={(e) => setItem(i, { reading: e.target.value })} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

const SHIFT_LABEL = { M: 'Morning', E: 'Evening', N: 'Night', G: 'General', R: 'Rest' }
const ENTRY_SHIFTS = ['M', 'E', 'N', 'G']  // R = roster-only, never a log shift
const ENTRY_TYPES = ['maintenance', 'failure', 'acknowledgement', 'job_card', 'rectification', 'general']
// entry types that respond to (and link to) an existing failure
const RESPONSE_TYPES = ['acknowledgement', 'job_card', 'rectification']
// entry types that can carry a structured checksheet (physical work)
const CS_KINDS = ['maintenance', 'job_card', 'rectification']
// the checksheet's "applies_to" bucket for a given entry type
const CS_APPLIES = { maintenance: 'maintenance', job_card: 'job_card', rectification: 'job_card' }
const TYPE_LABEL = { maintenance: 'Maintenance', failure: 'Failure',
  acknowledgement: 'Acknowledgement', job_card: 'Job card', rectification: 'Rectification', general: 'General' }
const MAINT_SUBTYPES = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly', '5-Yearly', 'Unscheduled']
/* local-calendar ISO — toISOString() is UTC and shifts IST dates a day back */
const isoLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => isoLocal(new Date())
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return isoLocal(d)
}

/* Week/month/year windows, anchored on the newest RECORDED date rather than
   on today — imported history can end months back, and anchoring on the
   calendar would open the book on an empty window. */
const PAGE_SIZE = 100

const PERIODS = [
  ['Week', 'week'], ['Month', 'month'], ['Year', 'year'], ['All time', 'all'],
]
const periodRange = (period, anchorIso) => {
  if (period === 'all' || !anchorIso) return [null, null]
  const a = new Date(anchorIso + 'T00:00:00')
  if (period === 'year') return [`${a.getFullYear()}-01-01`, `${a.getFullYear()}-12-31`]
  if (period === 'month') {
    const m = String(a.getMonth() + 1).padStart(2, '0')
    const last = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate()
    return [`${a.getFullYear()}-${m}-01`, `${a.getFullYear()}-${m}-${last}`]
  }
  // week: Monday..Sunday containing the anchor
  const dow = (a.getDay() + 6) % 7
  const start = addDays(anchorIso, -dow)
  return [start, addDays(start, 6)]
}

const fmtDate = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
// entry `at`/`time` are stored as the IST clock time the user typed (naive), so
// show them literally — no tz conversion (that would double-shift by +5:30).
const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
/* "HH:MM" from an ISO timestamp, or "" when it's midnight (= no time given) */
const hhmm = (iso) => (iso && iso.slice(11, 16) !== '00:00' ? iso.slice(11, 16) : '')
/* drop the leading "[TYPE]" tag from the body — the type is already a chip */
const bodyText = (t) => (t || '').replace(/^\[[^\]]*\]\s*/, '')

const PencilIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none"
       stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.4 2.3a1.35 1.35 0 0 1 1.9 1.9L5 12.6l-2.6.6.6-2.6 8.4-8.3z" />
  </svg>
)
const ResolveIcon = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none"
       stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6.3" /><path d="M5.3 8.2l1.9 1.9 3.5-4" />
  </svg>
)
const HistoryIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none"
       stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 8a5.5 5.5 0 1 1 1.6 3.9" /><path d="M2.3 12v-2.6h2.6" /><path d="M8 5v3l2 1.2" />
  </svg>
)


function LiveBadge({ ok }) {
  return (
    <span className={`chip ${ok ? 'live-ok' : 'live-off'}`}>
      <span className="dot" />{ok ? 'Live API' : 'API offline'}
    </span>
  )
}

/* the date ruler — one strip picks the day for BOTH writing and reading.
   Back-dating an entry = tap its day (or the picker for anything older). */
function DateRuler({ value, onChange, days = 10 }) {
  const t = today()
  const strip = Array.from({ length: days }, (_, i) => addDays(t, i - (days - 1)))
  const fmt = (iso) => {
    const d = new Date(iso + 'T00:00:00')
    return { dow: d.toLocaleDateString(undefined, { weekday: 'short' }), day: d.getDate() }
  }
  const inStrip = strip.includes(value)
  return (
    <div className="date-ruler" role="tablist" aria-label="Log date">
      <input type="date" className={`ruler-pick${!inStrip && value ? ' active' : ''}`}
             value={value} max={t} onChange={(e) => e.target.value && onChange(e.target.value)}
             aria-label="Older date" />
      {strip.map((iso) => {
        const { dow, day } = fmt(iso)
        return (
          <button key={iso} type="button"
                  className={`ruler-day${iso === value ? ' active' : ''}${iso === t ? ' today' : ''}`}
                  onClick={() => onChange(iso)}>
            <span className="rd-dow">{iso === t ? 'Today' : dow}</span>
            <span className="rd-num">{day}</span>
          </button>
        )
      })}
    </div>
  )
}

/* Inline close-out for a failure already on the book. Its own date, time and
   shift — the shift that did the work owns the entry. */
function RectifyForm({ failure, busy, onCancel, onSubmit }) {
  const [date, setDate] = useState(failure.log_date)
  const [time, setTime] = useState('')
  const [shift, setShift] = useState('G')
  const [text, setText] = useState('')
  const [team, setTeam] = useState('')
  return (
    <div className="log-row2">
      <span className="log-row2-tag">Rectification</span>
      <input type="date" value={date} min={failure.log_date}
             onChange={(e) => setDate(e.target.value)} aria-label="Rectified on" />
      <TimeInput value={time} onChange={setTime} className="log-time" label="Rectified at" />
      <select value={shift} onChange={(e) => setShift(e.target.value)} aria-label="Shift">
        {ENTRY_SHIFTS.map((s) => <option key={s} value={s}>{s} — {SHIFT_LABEL[s]}</option>)}
      </select>
      <input value={team} onChange={(e) => setTeam(e.target.value)}
             placeholder="Team…" className="log-team" aria-label="Team" />
      <input value={text} onChange={(e) => setText(e.target.value)}
             placeholder="What was done to rectify it…" />
      <button type="button" className="btn" disabled={busy}
              onClick={() => onSubmit({ date, time, shift, text, team })}>
        {busy ? 'Saving…' : 'Log fix'}
      </button>
      <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
    </div>
  )
}

/* Edit a log entry the append-only way: submitting writes a NEW entry that
   corrects the old one, so nothing is lost. Handles the two jobs Arup asked
   for on the imported open failures too — linking the right equipment (asset
   code) and filling the resolve row (recovery date/time). */
function EditEntryForm({ entry, assets, systems, classSystem, initialResp = null, onCancel, onSaved }) {
  const isFail = entry.type === 'failure'
  // a deep-link (register quick action) may ask to jump straight to a response
  const RESP_REF = { acknowledgement: 'acknowledged_by', job_card: 'job_card_by', rectification: 'resolved_by' }
  // the response to pre-fill: if a deep-link named a kind, use ONLY that kind's
  // own entry (so "Rectify" on an acknowledged failure starts a fresh fix rather
  // than inheriting the ack note); otherwise the current response by dominance
  const rb = !isFail ? null
    : initialResp ? (entry[RESP_REF[initialResp]] || null)
    : (entry.resolved_by || entry.job_card_by || entry.acknowledged_by)
  const [text, setText] = useState(entry.text)
  const [csEdit, setCsEdit] = useState(entry.checksheet || null)  // this entry's own checksheet
  const [assetCode, setAssetCode] = useState(entry.asset_code || '')
  const [system, setSystem] = useState(entry.system || '')
  const [category, setCategory] = useState(entry.category || '')
  const [team, setTeam] = useState(entry.attended_by || '')
  const [consumables, setConsumables] = useState(entry.consumables || '')
  const [tim, setTim] = useState(hhmm(entry.at))
  const [faultType, setFaultType] = useState(entry.fault_type || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // TWO AXES. `acknowledged` is an independent checkbox (noted / demand raised).
  // `progress` is how far the FIX has got: open · job_card · rectified. RECTIFIED
  // is terminal — it resolves the failure and moots the acknowledgement.
  const initProgress = entry.resolved_by ? 'rectified' : entry.job_card_by ? 'job_card' : 'open'
  const [progress, setProgress] = useState(() => {
    if (!isFail) return 'open'
    if (initialResp === 'rectification') return 'rectified'
    if (initialResp === 'job_card') return 'job_card'
    return initProgress
  })
  const [acknowledged, setAcknowledged] = useState(() =>
    isFail && (!!entry.acknowledged_by || initialResp === 'acknowledgement'))
  const isResolved = progress === 'rectified'
  const isOpen = progress === 'open' && !acknowledged
  // ── progress (job card / rectification) detail fields ──
  const pSrc = entry.resolved_by || entry.job_card_by || null
  const [rDate, setRDate] = useState(pSrc ? pSrc.log_date : entry.log_date)
  const [rTime, setRTime] = useState(pSrc ? hhmm(pSrc.at) : '')
  const [rText, setRText] = useState(pSrc ? bodyText(pSrc.text) : '')
  const [rFault, setRFault] = useState(pSrc?.fault_type || entry.fault_type || '')
  const [rTeam, setRTeam] = useState(pSrc?.attended_by || '')
  const [rConsum, setRConsum] = useState(pSrc?.consumables || '')
  // a rectification may be carried out by us or by the agency under a job card
  const [rViaJobCard, setRViaJobCard] = useState(!!entry.resolved_by?.via_job_card || !!entry.job_card_by)
  // the progress response (job card / rectification) may carry a checksheet
  const [rCs, setRCs] = useState(entry.resolved_by?.checksheet || entry.job_card_by?.checksheet || null)
  // ── acknowledgement note fields (independent) ──
  const aSrc = entry.acknowledged_by || null
  const [aDate, setADate] = useState(aSrc ? aSrc.log_date : entry.log_date)
  const [aText, setAText] = useState(aSrc ? bodyText(aSrc.text) : '')
  const [aTeam, setATeam] = useState(aSrc?.attended_by || '')
  const KIND_LABEL = { rectified: 'rectification', job_card: 'job card' }
  // when the progress axis changes, repopulate its detail from the stored entry
  const loadProgress = (p) => {
    const src = p === 'rectified' ? entry.resolved_by : p === 'job_card' ? entry.job_card_by : null
    setRDate(src ? src.log_date : entry.log_date)
    setRTime(src ? hhmm(src.at) : '')
    setRText(src ? bodyText(src.text) : '')
    setRFault(src?.fault_type || entry.fault_type || '')
    setRTeam(src?.attended_by || '')
    setRConsum(src?.consumables || '')
  }

  const textRef = useRef(null)
  useEffect(() => { textRef.current?.focus({ preventScroll: true }) }, [])

  const classesFor = system
    ? [...new Set(assets.filter((a) => a.system === system).map((a) => a.asset_class).filter(Boolean))].sort()
    : [...new Set(assets.map((a) => a.asset_class).filter(Boolean))].sort()

  // the progress axis needs its own detail (job card scope, or the fix)
  const progressActive = progress === 'job_card' || progress === 'rectified'
  // IMMUTABILITY: an acknowledgement, once logged, cannot be un-ticked; a
  // rectification is terminal (can't be changed/reverted); an issued job card
  // can only move forward to rectified, never back to open.
  const ackLocked = !!entry.acknowledged_by || !!entry.resolved_by
  const rectLocked = !!entry.resolved_by
  const jobIssued = !!entry.job_card_by
  // Issuing a job card IS an acknowledgement (it is raised to the OEM/dept), so
  // once a job card is in play the separate Acknowledged flag is redundant —
  // hide it, UNLESS a real acknowledgement was logged before the card.
  const jobInPlay = progress === 'job_card' || jobIssued
  const showAck = !jobInPlay || !!entry.acknowledged_by

  const save = async () => {
    if (!text.trim() || busy) return
    if (isFail && progressActive && !rText.trim()) {
      setErr(`This ${KIND_LABEL[progress]} needs a note — what was done or requested.`); return
    }
    if (isFail && acknowledged && !aText.trim()) {
      setErr('The acknowledgement needs a note — what was raised / requested.'); return
    }
    setBusy(true); setErr('')
    try {
      // 1) correct the entry's own fields (append-only correction)
      const res = await fetch(`${API}/api/logbook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          corrects_id: entry.id,
          log_date: entry.log_date, shift: entry.shift, type: entry.type,
          subtype: entry.subtype || null,
          system: system || null, category: category || null,
          asset_code: assetCode.trim() || null,
          time: tim || null, text: text.trim(), attended_by: team.trim() || null,
          consumables: isFail ? null : (consumables.trim() || null),
          checksheet: isFail ? null : (csEdit || null),  // preserve/edit the entry's checksheet
          fault_type: isFail ? (faultType.trim() || null) : null,
          end_date: null, end_time: null,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || `HTTP ${res.status}`)
      // 2) reconcile the failure's whole response state in one call
      if (isFail) {
        const body = {
          acknowledged,
          ack: acknowledged ? {
            date: aDate, text: aText.trim(), attended_by: aTeam.trim() || null,
          } : null,
          progress,
          detail: progressActive ? {
            date: rDate, time: rTime || null, text: rText.trim(),
            fault_type: rFault.trim() || null, attended_by: rTeam.trim() || null,
            consumables: isResolved ? (rConsum.trim() || null) : null,
            via_job_card: isResolved ? rViaJobCard : false,
            checksheet: rCs || null,
          } : null,
        }
        const r2 = await fetch(`${API}/api/logbook/${entry.id}/resolution`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!r2.ok) throw new Error((await r2.json().catch(() => null))?.detail || `HTTP ${r2.status}`)
      }
      onSaved()
    } catch (ex) {
      setErr(String(ex.message || ex).replace(/^Error: /, ''))
    } finally { setBusy(false) }
  }

  // change the progress axis; repopulate its detail from the stored entry
  const onSetProgress = (p) => {
    // rectified is terminal and an issued job card can't revert — the control is
    // disabled in those cases, so only forward moves reach here
    setProgress(p)
    loadProgress(p)
  }

  return (
    <div className="edit-panel">
      <div className="ep-head">
        <span className="ep-title">✎ Editing entry</span>
        <span className="ep-ctx">{fmtDate(entry.log_date)} · {SHIFT_LABEL[entry.shift] || entry.shift} · {entry.type}{entry.subtype ? ` · ${entry.subtype}` : ''}</span>
      </div>

      {/* a rectification always shows the failure it closes, as read-only context */}
      {['rectification', 'acknowledgement', 'job_card'].includes(entry.type) && entry.rectifies && (
        <div className="master-fail">
          <span className="mf-tag">Closes failure</span>
          <span className="mf-body">
            <b className="dt">{entry.rectifies.log_date}</b>
            {entry.rectifies.fault_type && <> · <b>{entry.rectifies.fault_type}</b></>}
            {entry.rectifies.asset_code && <> · {entry.rectifies.asset_code}</>}
            <div className="mf-text">{bodyText(entry.rectifies.text)}</div>
          </span>
        </div>
      )}

      <div className="fg-set">
        {/* row 1 — system › class › asset id (type & shift are fixed context, shown in the header) */}
        <section className="fg">
          <div className="fg-fields">
            <label>System
              <select value={system} onChange={(e) => { setSystem(e.target.value); setCategory('') }}>
                <option value="">System…</option>
                {systems.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>Class
              <select value={category}
                      onChange={(e) => { const c = e.target.value; setCategory(c); if (c && classSystem[c]) setSystem(classSystem[c]) }}>
                <option value="">Class…</option>
                {classesFor.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>Equipment (Asset ID)
              <input value={assetCode} list="register-codes" placeholder="scan/type code — links the asset"
                     onChange={(e) => {
                       const v = e.target.value; setAssetCode(v)
                       const hit = assets.find((a) => a.code === v)
                       if (hit?.system) setSystem(hit.system)
                       if (hit?.asset_class) setCategory(hit.asset_class)
                     }} />
            </label>
          </div>
        </section>

        {/* row 2 — time › attended by › (failure fault & recovery) › record */}
        <section className="fg">
          <div className="fg-fields">
            <label>Time
              <input type="time" value={tim} onChange={(e) => setTim(e.target.value)} />
            </label>
            <label className={isFail ? '' : 'fg-span-2'}>Team / attended by
              <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="crew that did the work" />
            </label>
            {isFail && (
              <label className="fg-span-2">Fault type
                <input value={faultType} onChange={(e) => setFaultType(e.target.value)} placeholder="e.g. DC earth fault" />
              </label>
            )}
            {/* No Resolved-on/at here by design: a failure is closed only by a
                rectification entry (Rectify it, or log a rectification). If it is
                already resolved, the linked fix shows in the green banner above. */}
            {/* a failure logs no consumables — the spares belong to its fix */}
            {!isFail && (
              <label className="fg-span">Consumables / consumed
                <input value={consumables} onChange={(e) => setConsumables(e.target.value)}
                       placeholder="spares / materials used — e.g. 2× PT fuse, 1L transformer oil" />
              </label>
            )}
            <label className="fg-span">Entry
              <textarea ref={textRef} value={text} rows={2}
                        onChange={(e) => setText(e.target.value)} placeholder="What was done, readings, event…" />
            </label>
          </div>
        </section>

        {/* checksheet scans/photos — maintenance, job card, rectification.
            Uploads straight to this entry (it already exists). */}
        {CS_KINDS.includes(entry.type) && (
          <AttachmentUpload entryId={entry.id} existing={entry.attachments || []} />
        )}

        {/* a failure has TWO independent logs, each in its OWN grouped block:
            (1) the Acknowledgement — a tick plus its note; (2) the Progress —
            the job-card / rectification. Both are kept; one never becomes the
            other. */}
        {isFail && showAck && (
          <section className="fg fg-fail resp-group">
            <span className="fg-lbl">Acknowledgement <span className="ef-opt">— its own log{ackLocked && acknowledged ? ' · logged, locked' : ''}</span></span>
            <div className="fg-fields">
              <label className={`flag-check fg-span${ackLocked ? ' muted' : ''}`}
                     title={ackLocked ? 'An acknowledgement is a logged fact — it cannot be un-ticked' : undefined}>
                <input type="checkbox" checked={acknowledged} disabled={ackLocked}
                       onChange={(e) => setAcknowledged(e.target.checked)} />
                Acknowledged <span className="ef-opt">— noted (demand raised / mail sent), not yet fixed</span>
              </label>
              {acknowledged && <>
                <label>Acknowledged on
                  <input type="date" value={aDate} min={entry.log_date} readOnly={ackLocked} onChange={(e) => setADate(e.target.value)} />
                </label>
                <label>By
                  <input value={aTeam} readOnly={ackLocked} onChange={(e) => setATeam(e.target.value)} placeholder="who acknowledged it" />
                </label>
                <label className="fg-span">Acknowledgement note
                  <input value={aText} readOnly={ackLocked} onChange={(e) => setAText(e.target.value)}
                         placeholder="e.g. Relay not available. Demand raised, mail sent 30-06" />
                </label>
              </>}
            </div>
          </section>
        )}

        {isFail && (
          <section className="fg fg-fail resp-group">
            <span className="fg-lbl">Progress / rectification <span className="ef-opt">— its own log{rectLocked ? ' · rectified, locked' : ''}</span></span>
            <div className="fg-fields">
              <label className={`fg-span${rectLocked ? ' muted' : ''}`}>Progress
                <select value={progress} disabled={rectLocked} onChange={(e) => onSetProgress(e.target.value)}
                        title={rectLocked ? 'A rectified failure is final — it cannot be changed' : undefined}>
                  {/* an issued job card can only move forward to rectified */}
                  {!jobIssued && <option value="open">Open — not yet fixed</option>}
                  <option value="job_card">Job card issued — raised to OEM/dept</option>
                  <option value="rectified">Rectified — fixed</option>
                </select>
              </label>
              {/* when rectifying a job-carded failure, keep the ISSUED job card
                  visible as read-only context so it never appears to vanish —
                  the rectification below is the second part that closes it */}
              {jobIssued && progress === 'rectified' && (
                <div className="master-fail fg-span">
                  <span className="mf-tag">▤ Job card issued</span>
                  <span className="mf-body">
                    <b className="dt">{entry.job_card_by.log_date}</b>
                    {entry.job_card_by.attended_by && <> · to <b>{entry.job_card_by.attended_by}</b></>}
                    <div className="mf-text">{bodyText(entry.job_card_by.text)}</div>
                  </span>
                </div>
              )}
              {progressActive && <>
                <label>{isResolved ? 'Rectified on' : 'Job card dated'}
                  <input type="date" value={rDate} min={entry.log_date} readOnly={rectLocked} onChange={(e) => setRDate(e.target.value)} />
                </label>
                <label>At
                  <TimeInput value={rTime} onChange={rectLocked ? () => {} : setRTime} label="At" />
                </label>
                <label>{isResolved ? 'Team' : 'Issued to'}
                  <input value={rTeam} readOnly={rectLocked} onChange={(e) => setRTeam(e.target.value)}
                         placeholder={isResolved ? 'crew / agency that fixed it' : 'agency / dept the card went to'} />
                </label>
                <label className="fg-span-2">Fault addressed
                  <input value={rFault} readOnly={rectLocked} onChange={(e) => setRFault(e.target.value)} placeholder={faultType || 'e.g. DC earth fault'} />
                </label>
                {isResolved && jobIssued && (
                  <label className="flag-check fg-span">
                    <input type="checkbox" checked={rViaJobCard} disabled={rectLocked}
                           onChange={(e) => setRViaJobCard(e.target.checked)} />
                    Closed by the job-card agency
                    <span className="ef-opt">{rViaJobCard
                      ? ' — the agency/OEM carried out the fix under the card'
                      : ' — WE rectified it; the job card is UNFULFILLED by the agency → penalty'}</span>
                  </label>
                )}
                {isResolved && jobIssued && !rViaJobCard && (
                  <p className="ef-hint fg-span-2" style={{ color: '#a32e2e' }}>⚠ Penalty flagged against the job-card agency — the card was raised but we had to do the fix ourselves.</p>
                )}
                {isResolved && (
                  <label className="fg-span">Consumables / consumed
                    <input value={rConsum} readOnly={rectLocked} onChange={(e) => setRConsum(e.target.value)}
                           placeholder="spares used in the fix — e.g. 2× PT fuse" />
                  </label>
                )}
                <label className="fg-span">
                  {isResolved ? 'What was done (rectification)' : 'Job card detail (agency, card no., scope)'}
                  <input value={rText} readOnly={rectLocked} onChange={(e) => setRText(e.target.value)}
                         placeholder={isResolved ? 'what was done to rectify it…'
                           : 'e.g. Job card issued to M/s Siemens to replace WAGO'} />
                </label>
                {progress === 'job_card' && <p className="ef-hint fg-span-2">A job card keeps the failure open (yellow). Set Progress to <b>Rectified</b> once the fix is done — by the agency, or by us if they are delayed.</p>}
                {/* checksheet scans on the job card / rectification entry. It has
                    to exist first, so attach once the response is saved. */}
                {(() => {
                  const resp = isResolved ? entry.resolved_by : entry.job_card_by
                  return resp
                    ? <div className="fg-span"><AttachmentUpload entryId={resp.id} existing={resp.attachments || []}
                          label={`${isResolved ? 'Rectification' : 'Job card'} — photo or PDF`} /></div>
                    : <p className="ef-hint fg-span-2">Save this {isResolved ? 'rectification' : 'job card'} first, then re-open to attach its checksheet / photo.</p>
                })()}
              </>}
            </div>
          </section>
        )}
      </div>

      <div className="ep-actions">
        <button type="button" className="btn" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save edit'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <span className="ep-note">Saving files a correction — the original is kept in this entry's history.</span>
        {err && <span className="import-msg err">{err}</span>}
      </div>
    </div>
  )
}

/* The WhatsApp-style edit trail: original + every correction, oldest first. */
function VersionHistory({ id }) {
  const [vers, setVers] = useState(null)
  useEffect(() => {
    let alive = true
    fetch(`${API}/api/logbook/${id}/versions`).then((r) => (r.ok ? r.json() : []))
      .then((v) => alive && setVers(v)).catch(() => alive && setVers([]))
    return () => { alive = false }
  }, [id])
  if (!vers) return <div className="ver-hist"><span className="dim">Loading history…</span></div>
  return (
    <div className="ver-hist">
      {vers.map((v, i) => (
        <div className="ver-row" key={v.id}>
          <span className="ver-tag">{i === 0 ? 'Original' : `Edit ${i}`}</span>
          <span className="sub dt">{v.log_date}{hhmm(v.at) ? ` · ${fmtTime(v.at)}` : ''}</span>
          <span className="dim">{v.attended_by || v.entered_by}</span>
          <div className="ver-text">{v.text}</div>
        </div>
      ))}
    </div>
  )
}

export default function LogBook({ editId = null, focusDate = null, initialResp = null, initialAsset = null } = {}) {
  const { me, canWrite } = useMe()
  const authOn = me?.auth_enabled
  const [entries, setEntries] = useState([])
  // Initialise straight from a deep link (#/log?d=…&edit=…) so only ONE load
  // fires — the focused day. Setting these in an effect instead raced the
  // default all-dates load, and the bigger response could land last and hide
  // the entry. This component remounts when reached from failures/asset pages.
  const [logDate, setLogDate] = useState(focusDate || today())  // ruler: write + read date
  // Open on a period window, not on today. A quiet day left the page blank,
  // which reads as "the logbook is broken" rather than "nothing happened
  // today". The ruler still drives both reading and writing once a day is
  // picked; clearing it returns to the period window.
  const [allDates, setAllDates] = useState(!focusDate)  // deep link opens its day, not the window
  const [period, setPeriod] = useState('month')
  const [anchor, setAnchor] = useState(null)   // newest recorded date
  // A year of this book is thousands of entries — page it rather than pull a
  // truncated slice and imply it is the whole thing.
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [fCat, setFCat] = useState('')             // '' = all categories (classes)
  const [fType, setFType] = useState('')           // '' = all types
  const [fDepot, setFDepot] = useState('')         // '' = all depots (line-wide)
  const [fSystem, setFSystem] = useState('')       // '' = all systems
  const [fLocation, setFLocation] = useState('')   // '' = all locations (stations)
  const [search, setSearch] = useState('')         // free-text box value
  const [qParam, setQParam] = useState('')         // debounced -> ?q= server search
  const [impBusy, setImpBusy] = useState(false)
  const [impResult, setImpResult] = useState(null)
  const [newOpen, setNewOpen] = useState(!!initialAsset)   // the add-entry form, toggled by ＋ (or opened from an asset page)
  const fileRef = useRef(null)
  const toolbarRef = useRef(null)
  const [apiOk, setApiOk] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // add-entry form
  const [text, setText] = useState('')
  const [consumables, setConsumables] = useState('')
  const [attachFiles, setAttachFiles] = useState([])   // staged checksheet scans/photos (uploaded after create)
  const [openFails, setOpenFails] = useState([])   // asset's open failures (for rectification)
  const [rectifiesId, setRectifiesId] = useState('')  // the failure this rectification closes
  const [shift, setShift] = useState('M')
  const [type, setType] = useState('general')
  const [subtype, setSubtype] = useState('Monthly')
  const [system, setSystem] = useState('')         // coarse rollup (short list)
  const [category, setCategory] = useState('')     // asset class (kept, inferred from asset; no longer a form field)
  const [station, setStation] = useState('')       // station (asset.location) — narrows the asset picker
  const [tim, setTim] = useState('')               // optional HH:MM
  const [faultType, setFaultType] = useState('')   // failures: fault class
  const [team, setTeam] = useState('')             // crew that did the work
  // ONE failure form spans the whole lifecycle so the separate acknowledgement /
  // job-card / rectification logs need not be filed by hand. Two independent axes,
  // exactly like the edit screen: an acknowledged flag+note, and a fix `aProgress`
  // (open · job_card · rectified) with its own dated log. All chosen here are
  // filed together via the resolution endpoint. Defaults to OPEN on purpose: a
  // form that assumes the fix has happened invites logging work that hasn't.
  const [aProgress, setAProgress] = useState('open')   // open | job_card | rectified
  const [acked, setAcked] = useState(false)            // acknowledged flag
  const [ackText, setAckText] = useState('')           // acknowledgement note
  const [rDate, setRDate] = useState('')
  const [rTim, setRTim] = useState('')
  const [rShift, setRShift] = useState('G')
  const [rText, setRText] = useState('')
  const [rTeam, setRTeam] = useState('')
  const [rConsumables, setRConsumables] = useState('')   // spares used in the fix
  const [rFaultType, setRFaultType] = useState('')       // fault the fix addressed
  // closing a failure that was logged open earlier — the two-row form can't
  // reach it, that entry already exists
  const [rectifying, setRectifying] = useState(null)
  const [editingId, setEditingId] = useState(editId ? Number(editId) : null)   // entry being edited
  const [historyFor, setHistoryFor] = useState(null) // entry whose trail is open
  const [assetCode, setAssetCode] = useState(initialAsset || '')   // cross-reference to the register (pre-filled from an asset page)
  const [author, setAuthor] = useState('demo.visitor')
  const [assets, setAssets] = useState([])         // register rows for the datalist

  useEffect(() => {
    fetch(`${API}/api/assets`).then((r) => (r.ok ? r.json() : []))
      .then(setAssets).catch(() => {})
  }, [])
  // opened from an asset page (?asset=…): once the register loads, pre-fill the
  // System + Station (and class) from that asset so the add form is ready.
  useEffect(() => {
    if (!initialAsset || !assets.length) return
    const hit = assets.find((a) => a.code === initialAsset)
    if (hit) { setSystem(hit.system || ''); setStation(hit.location || ''); setCategory(hit.asset_class || '') }
  }, [initialAsset, assets])
  // distinct asset classes, sorted — the entry-form's class options (unfiltered)
  const classes = [...new Set(assets.map((a) => a.asset_class).filter(Boolean))].sort()
  const depots = [...new Set(assets.map((a) => a.depot).filter(Boolean))].sort()
  // CASCADING toolbar filters: the class list narrows to the chosen depot and the
  // depot list to the chosen class, each keeping its own current selection.
  const filterClasses = [...new Set([...assets
    .filter((a) => !fDepot || a.depot === fDepot).map((a) => a.asset_class).filter(Boolean),
    ...(fCat ? [fCat] : [])])].sort()
  const filterDepots = [...new Set([...assets
    .filter((a) => !fCat || a.asset_class === fCat).map((a) => a.depot).filter(Boolean),
    ...(fDepot ? [fDepot] : [])])].sort()
  // the systems (short) and, per system, the classes under it — so the class
  // picker only ever shows what belongs to the chosen system
  const systems = [...new Set(assets.map((a) => a.system).filter(Boolean))].sort()
  const locations = [...new Set(assets.map((a) => a.location).filter(Boolean))].sort()
  // add-form pickers: stations under the chosen system, and the asset list shrunk
  // to the chosen system + station so "Equipment" only offers what fits.
  const stationsForSystem = (system
    ? [...new Set(assets.filter((a) => a.system === system).map((a) => a.location).filter(Boolean))]
    : locations).sort()
  const pickerAssets = assets.filter((a) => (!system || a.system === system) && (!station || a.location === station))
  // toolbar: stations under the chosen filter-system (cascading)
  const filterStations = [...new Set([...assets
    .filter((a) => !fSystem || a.system === fSystem).map((a) => a.location).filter(Boolean),
    ...(fLocation ? [fLocation] : [])])].sort()
  const classesForSystem = system
    ? [...new Set(assets.filter((a) => a.system === system).map((a) => a.asset_class).filter(Boolean))].sort()
    : classes
  // reverse link: each class's most common system, so picking a class fills
  // the system too (a class almost always sits under one system)
  const classSystem = {}
  {
    const tally = {}
    assets.forEach((a) => {
      if (a.asset_class && a.system) {
        (tally[a.asset_class] ??= {})[a.system] = (tally[a.asset_class][a.system] || 0) + 1
      }
    })
    Object.entries(tally).forEach(([c, sys]) => {
      classSystem[c] = Object.entries(sys).sort((x, y) => y[1] - x[1])[0][0]
    })
  }

  // anchor the period windows on the newest date the book actually holds
  useEffect(() => {
    fetch(`${API}/api/logbook/bounds`).then((r) => (r.ok ? r.json() : null))
      .then((b) => b?.last && setAnchor(b.last)).catch(() => {})
  }, [])

  const [from, to] = periodRange(period, anchor)

  const load = async () => {
    try {
      const q = new URLSearchParams()
      // a text search spans the whole book, so it ignores the single-day scope
      const searching = qParam.trim().length > 0
      if (!allDates && !searching) q.set('log_date', logDate)
      if (fCat) q.set('category', fCat)
      if (fType) q.set('entry_type', fType)
      if (fDepot) q.set('depot', fDepot)
      if (fSystem) q.set('system', fSystem)
      if (fLocation) q.set('location', fLocation)
      if (searching) q.set('q', qParam.trim())
      if (allDates || searching) {
        if (from) q.set('date_from', from)
        if (to) q.set('date_to', to)
      }
      q.set('limit', String(PAGE_SIZE))
      q.set('offset', String(page * PAGE_SIZE))
      const res = await fetch(`${API}/api/logbook?${q}`)
      if (!res.ok) throw new Error(res.status)
      const n = Number(res.headers.get('X-Total-Count'))
      setTotal(Number.isFinite(n) ? n : 0)
      setEntries(await res.json())
      setApiOk(true)
    } catch {
      setApiOk(false)
    }
  }

  useEffect(() => { load() }, [logDate, allDates, fCat, fType, fDepot, fSystem, fLocation, qParam, from, to, page])  // eslint-disable-line react-hooks/exhaustive-deps
  // any change of what we are looking at starts again at the first page
  useEffect(() => { setPage(0) }, [logDate, allDates, fCat, fType, fDepot, fSystem, fLocation, qParam, from, to])
  // debounce the search box so we don't hit the API on every keystroke
  useEffect(() => { const t = setTimeout(() => setQParam(search), 300); return () => clearTimeout(t) }, [search])
  // logging a rectification against an asset → show that asset's OPEN failures so
  // the fix can be linked to the exact breakdown it closes (sets rectifies_id).
  useEffect(() => {
    setRectifiesId('')
    if (!RESPONSE_TYPES.includes(type) || !assetCode.trim()) { setOpenFails([]); return }
    let alive = true
    fetch(`${API}/api/logbook?asset_code=${encodeURIComponent(assetCode.trim())}&entry_type=failure&limit=200`)
      .then((r) => (r.ok ? r.json() : []))
      // outstanding = not yet rectified (a failure stays open through ack/job-card)
      .then((rows) => alive && setOpenFails(rows.filter((e) => e.state !== 'resolved')))
      .catch(() => alive && setOpenFails([]))
    return () => { alive = false }
  }, [type, assetCode])
  // freeze the toolbar: measure the sticky topbar so it parks just beneath it
  useEffect(() => {
    const setVars = () => {
      const tb = document.querySelector('.topbar')
      if (tb) document.documentElement.style.setProperty('--topbar-h', `${tb.offsetHeight}px`)
    }
    setVars(); window.addEventListener('resize', setVars)
    return () => window.removeEventListener('resize', setVars)
  })

  // download the entries currently in view as CSV
  const exportCsv = () => {
    const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const head = ['date', 'shift', 'time', 'type', 'subtype', 'system', 'class', 'asset', 'entry', 'consumables', 'attended_by']
    const body = entries.map((e) => [
      e.log_date, e.shift, hhmm(e.at), e.type, e.subtype || '', e.system || '', e.category || '',
      e.asset_code || '', bodyText(e.text), e.consumables || '', e.attended_by || e.entered_by || '',
    ].map(cell).join(','))
    const csv = [head.join(','), ...body].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `amps-logbook-${allDates ? 'period' : logDate}-${today()}.csv`
    a.click(); URL.revokeObjectURL(url)
  }
  // bulk-import scattered sheet history (the unified logbook CSV)
  const onImportFile = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setImpBusy(true); setImpResult(null)
    try {
      const r = await fetch(`${API}/api/logbook/import`, {
        method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: await file.text(),
      })
      const body = await r.json().catch(() => null)
      setImpResult(r.ok ? body : { error: body?.detail || `HTTP ${r.status}` })
      if (r.ok) load()
    } catch (err) {
      setImpResult({ error: String(err) })
    }
    setImpBusy(false)
  }

  // deep-link (#/log?d=…&edit=…): a failure or asset-page row jumps here to
  // edit an entry — open its day and put it straight into edit mode
  useEffect(() => {
    if (!editId) return
    if (focusDate) { setLogDate(focusDate); setAllDates(false) }
    setEditingId(Number(editId))
    setHistoryFor(null)
  }, [editId, focusDate])

  // whenever an entry enters edit mode — a deep-link from another page, or a
  // click here — bring it into the middle of the viewport so the form is seen.
  // Keyed on entries too: on a deep-link the row only exists once the day loads.
  useEffect(() => {
    if (!editingId) return
    const el = document.getElementById(`le-${editingId}`)
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }, [editingId, entries])

  // close the edit form and, if we arrived via a deep-link (?edit=…), strip
  // that param so a page refresh doesn't reopen the form on the same row.
  const closeEdit = () => {
    setEditingId(null)
    if (editId) location.hash = `/log${focusDate ? `?d=${focusDate}` : ''}`
  }

  const add = async (e) => {
    e.preventDefault()
    if (!text.trim() || busy) return
    // combined failure form: an acknowledgement needs its note
    if (type === 'failure' && acked && !ackText.trim()) { setErr('Add the acknowledgement note (or untick Acknowledged).'); return }
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${API}/api/logbook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_date: logDate, shift, type,
          subtype: type === 'maintenance' ? subtype : null,
          system: system || null,
          category: category || null,
          time: tim || null,
          fault_type: type === 'failure' ? (faultType.trim() || null) : null,
          asset_code: assetCode.trim() || null,
          text: text.trim(), entered_by: author.trim() || 'demo.visitor',
          attended_by: team.trim() || null,
          // only a rectification (or maintenance/general) consumes spares — a
          // failure, acknowledgement or job card does not
          consumables: (type === 'failure' || type === 'acknowledgement' || type === 'job_card')
            ? null : (consumables.trim() || null),
          // a response (rectification / acknowledgement / job card) links to a
          // specific open failure of the asset
          rectifies_id: RESPONSE_TYPES.includes(type) && rectifiesId ? Number(rectifiesId) : null,
          // the failure's response (ack / job card / rectification) is reconciled
          // in a SECOND call below via the resolution endpoint — not nested here
          rectification: null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `HTTP ${res.status}`)
      }
      const created = await res.json().catch(() => null)
      // Combined failure form → file the acknowledgement and/or fix as linked
      // logs in one reconciling call. The scan then attaches to the response
      // it belongs to (job card / rectification) so it shows on those boards.
      let attachTarget = created?.id
      if (type === 'failure' && created?.id && (acked || aProgress !== 'open')) {
        const rr = await fetch(`${API}/api/logbook/${created.id}/resolution`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            acknowledged: acked,
            ack: acked ? { date: logDate, time: tim || null, text: ackText.trim(),
                           attended_by: team.trim() || null } : null,
            progress: aProgress,
            detail: aProgress !== 'open' ? {
              date: rDate || logDate, time: rTim || null,
              text: rText.trim() || (aProgress === 'rectified' ? 'Rectified' : 'Job card issued'),
              fault_type: rFaultType.trim() || faultType.trim() || null,
              attended_by: rTeam.trim() || team.trim() || null,
              consumables: aProgress === 'rectified' ? (rConsumables.trim() || null) : null,
            } : null,
          }),
        })
        if (!rr.ok) {
          const body = await rr.json().catch(() => null)
          throw new Error(body?.detail || `response HTTP ${rr.status}`)
        }
        const failOut = await rr.json().catch(() => null)
        const resp = aProgress === 'rectified' ? failOut?.resolved_by
          : aProgress === 'job_card' ? failOut?.job_card_by : null
        if (resp?.id) attachTarget = resp.id
      }
      // upload any staged checksheet scans/photos (or save links) to the right entry
      if (attachFiles.length && attachTarget) {
        for (const f of attachFiles) {
          if (f.__link) {
            await fetch(`${API}/api/logbook/${attachTarget}/attachments/link`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: f.url }) }).catch(() => {})
          } else {
            const fd = new FormData(); fd.append('file', f)
            await fetch(`${API}/api/logbook/${attachTarget}/attachments`, { method: 'POST', body: fd }).catch(() => {})
          }
        }
      }
      setText(''); setConsumables(''); setAttachFiles([]); setAssetCode(''); setTim(''); setFaultType(''); setSystem(''); setStation(''); setCategory('')
      setRectifiesId(''); setOpenFails([])
      setAProgress('open'); setAcked(false); setAckText('')
      setRDate(''); setRTim(''); setRText(''); setRTeam(''); setRConsumables(''); setRFaultType('')
      setTeam('')
      setAllDates(false)  // show the day just written to
      await load()
    } catch (ex) {
      setErr(String(ex.message || ex).replace(/^Error: /, ''))
    } finally {
      setBusy(false)
    }
  }

  /* Close a failure that was logged open. A separate entry, never an edit —
     the failure keeps saying what it said, the fix says what it did. */
  const submitRectify = async (failure, form) => {
    setBusy(true); setErr('')
    try {
      const res = await fetch(`${API}/api/logbook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_date: form.date, time: form.time || null, shift: form.shift,
          type: 'rectification', rectifies_id: failure.id,
          category: failure.category || null,
          asset_code: failure.asset_code || null,
          text: form.text.trim() || 'Rectified',
          entered_by: author.trim() || 'demo.visitor',
          attended_by: form.team.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `HTTP ${res.status}`)
      }
      setRectifying(null)
      await load()
    } catch (ex) {
      setErr(String(ex.message || ex).replace(/^Error: /, ''))
    } finally {
      setBusy(false)
    }
  }

  const byDay = entries.reduce((m, en) => {
    ;(m[en.log_date] ??= []).push(en)
    return m
  }, {})

  return (
    <>
      {apiOk === false && (
        <div className="card offline-note">
          <p className="dim">The AMPS API is not reachable — the logbook will come back with it.</p>
        </div>
      )}

      {/* one ribbon, one row: calendar + search/filter + actions — unified like the asset page */}
      <div className="log-ribbon" ref={toolbarRef}>
        <DateRuler value={allDates ? '' : logDate} days={7}
                   onChange={(d) => { setLogDate(d); setAllDates(false); setNewOpen(false) }} />
        <div className="log-tools">
          {/* merged scope: "all dates" + the period window in one control. A day
              picked on the calendar shows the neutral state; choosing a period
              switches to that window (what the separate "All dates" button did). */}
          <select className="log-scope" value={allDates ? period : ''}
                  onChange={(e) => { setPeriod(e.target.value); setAllDates(true) }} aria-label="Date scope">
            <option value="" disabled hidden>Single day ▸</option>
            {PERIODS.map(([lbl, v]) => <option key={v} value={v}>{v === 'all' ? 'All dates' : `This ${lbl.toLowerCase()}`}</option>)}
          </select>
          <input className="asset-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                 placeholder="Search the log — text, asset, crew, fault…" aria-label="Search the log" />
          {depots.length > 0 && !me?.depot && (
            <select value={fDepot} onChange={(e) => setFDepot(e.target.value)} aria-label="Filter by depot">
              <option value="">All depots</option>
              {filterDepots.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          <select value={fType} onChange={(e) => setFType(e.target.value)} aria-label="Filter by type">
            <option value="">All types</option>
            {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
          </select>
          <select value={fSystem} onChange={(e) => { setFSystem(e.target.value); setFLocation('') }} aria-label="Filter by system">
            <option value="">All systems</option>
            {systems.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={fLocation} onChange={(e) => setFLocation(e.target.value)} aria-label="Filter by station">
            <option value="">All stations</option>
            {filterStations.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          {(search || fType || fSystem || fLocation || !allDates) && (
            <button type="button" className="btn ghost sm" onClick={() => {
              setSearch(''); setFType(''); setFSystem(''); setFLocation(''); setAllDates(true)
            }}>Clear</button>
          )}
          <span className="asset-count">
            {qParam.trim() || allDates ? `${total.toLocaleString()} entr${total === 1 ? 'y' : 'ies'}` : fmtDate(logDate)}
          </span>
          <div className="asset-actions">
            {canWrite && (
              <button type="button" className={`icon-btn${newOpen ? ' on' : ''}`} title="New log entry"
                      aria-label="New log entry" onClick={() => setNewOpen((v) => !v)}>
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M8 3.2v9.6M3.2 8h9.6" /></svg>
              </button>
            )}
            <button type="button" className="icon-btn" title="Download the entries in view (CSV)"
                    aria-label="Download entries" onClick={exportCsv} disabled={!entries.length}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2.4v7.2M4.8 6.6 8 9.8l3.2-3.2M3 12.8h10" /></svg>
            </button>
            <button type="button" className="icon-btn" title="Print the log in view"
                    aria-label="Print log" onClick={() => window.print()}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 6V2.5h7V6M4.5 12H3.2V6.4h9.6V12H11.5M4.5 9.6h7V13.5h-7z" /></svg>
            </button>
            {canWrite && (
              <button type="button" className={`icon-btn${impBusy ? ' disabled' : ''}`} title="Import history CSV"
                      aria-label="Import history" onClick={() => fileRef.current?.click()} disabled={impBusy}>
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 9.8V2.6M4.8 5.8 8 2.6l3.2 3.2M3 12.8h10" /></svg>
              </button>
            )}
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onImportFile} />
          </div>
        </div>
      </div>

      {canWrite && newOpen && (
        <form className="entry-form card" onSubmit={add}>
          <div className="ef-head">
            <span className="ep-title">＋ New log entry</span>
            <span className="ep-ctx">{fmtDate(logDate)}</span>
          </div>

          <div className="fg-set">
            {/* row 1 — shift › type › (frequency|state) › system › class › asset id */}
            <section className="fg">
              <div className="fg-fields">
                {/* maintenance is always a night-shift job — lock the shift to N */}
                <label>Shift
                  <select value={type === 'maintenance' ? 'N' : shift} disabled={type === 'maintenance'}
                          onChange={(e) => setShift(e.target.value)}
                          title={type === 'maintenance' ? 'Maintenance runs on the night shift' : 'Shift'}>
                    {ENTRY_SHIFTS.map((s) => <option key={s} value={s}>{s} — {SHIFT_LABEL[s]}</option>)}
                  </select>
                </label>
                {/* the failure form now spans the whole lifecycle, so the standalone
                    acknowledgement / job-card / rectification types are gone from the
                    add form — a new failure's response is filed right here; an
                    existing failure's response is filed by editing that failure. */}
                <label>Type
                  <select value={type}
                          onChange={(e) => { setType(e.target.value); if (e.target.value === 'maintenance') setShift('N') }}>
                    {['maintenance', 'failure', 'general'].map((t) => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
                  </select>
                </label>
                {type === 'maintenance' && (
                  <label>Frequency
                    <select value={subtype} onChange={(e) => setSubtype(e.target.value)}>
                      {MAINT_SUBTYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                )}
                {type === 'failure' && (
                  <label>Progress
                    <select value={aProgress}
                            onChange={(e) => { const v = e.target.value; setAProgress(v); if (v !== 'open' && !rDate) setRDate(logDate) }}>
                      <option value="open">Still open</option>
                      <option value="job_card">Job card issued</option>
                      <option value="rectified">Rectified</option>
                    </select>
                  </label>
                )}
                {/* System, then Station under it — both narrow the Equipment picker.
                    Picking an asset fills System + Station automatically. */}
                <label>System
                  <select value={system} onChange={(e) => { setSystem(e.target.value); setStation('') }}>
                    <option value="">System…</option>
                    {systems.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label>Station
                  <select value={station} onChange={(e) => setStation(e.target.value)}>
                    <option value="">Station…</option>
                    {stationsForSystem.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label>Equipment (Asset ID)
                  <input value={assetCode} list="register-codes" placeholder="scan/type code…"
                         onChange={(e) => {
                           const v = e.target.value; setAssetCode(v)
                           const hit = assets.find((a) => a.code === v)
                           if (hit) { if (hit.system) setSystem(hit.system); if (hit.location) setStation(hit.location); setCategory(hit.asset_class || '') }
                         }} />
                </label>
                <datalist id="register-codes">
                  {pickerAssets.map((a) => <option key={a.code} value={a.code}>{`${a.code} — ${a.name} · ${a.location}`}</option>)}
                </datalist>
              </div>
            </section>

            {/* row 2 — time › attended by › (entered by) › (fault type) › record */}
            <section className="fg">
              <div className="fg-fields">
                <label>Time <span className="ef-opt">(optional)</span>
                  <TimeInput value={tim} onChange={setTim} />
                </label>
                <label className={authOn && type !== 'failure' ? 'fg-span-2' : ''}>Team / attended by
                  <input value={team} onChange={(e) => setTeam(e.target.value)} maxLength={200}
                         placeholder="crew that did the work" />
                </label>
                {!authOn && (
                  <label>Entered by
                    <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={40} placeholder="you" />
                  </label>
                )}
                {type === 'failure' && (
                  <label>Fault type
                    <input value={faultType} onChange={(e) => setFaultType(e.target.value)}
                           placeholder="e.g. DC earth fault" maxLength={120} />
                  </label>
                )}
                {RESPONSE_TYPES.includes(type) && (
                  <label className="fg-span">{type === 'rectification' ? 'Closes open failure' : 'Responds to failure'}
                    {!assetCode.trim()
                      ? <input disabled placeholder="enter the Asset ID above to list its open failures" />
                      : <select value={rectifiesId} onChange={(e) => setRectifiesId(e.target.value)}>
                          <option value="">{openFails.length
                            ? (type === 'rectification' ? '— select the breakdown this fixes —' : '— select the breakdown this responds to —')
                            : (['job_card', 'rectification'].includes(type) ? '— none open · a failure will be auto-raised —' : 'no open failures on this asset')}</option>
                          {openFails.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.log_date}{f.fault_type ? ` · ${f.fault_type}` : ''} — {bodyText(f.text).slice(0, 60)}
                            </option>
                          ))}
                        </select>}
                    {['job_card', 'rectification'].includes(type) && assetCode.trim() && !openFails.length && (
                      <span className="ef-hint">No open failure on this asset — {type === 'rectification' ? 'logging this fix' : 'issuing the job card'} raises one automatically and tags this entry to it.</span>
                    )}
                  </label>
                )}
                {/* a failure/acknowledgement/job-card consumes nothing — the
                    spares are used in the FIX (rectification / maintenance) */}
                {!['failure', 'acknowledgement', 'job_card'].includes(type) && (
                  <label className="fg-span">Consumables / consumed <span className="ef-opt">(optional)</span>
                    <input value={consumables} onChange={(e) => setConsumables(e.target.value)}
                           placeholder="spares / materials used — e.g. 2× PT fuse, 1L transformer oil" />
                  </label>
                )}
                <label className="fg-span">Entry
                  <textarea value={text} rows={2} onChange={(e) => setText(e.target.value)}
                            placeholder={`Log entry for ${fmtDate(logDate)} — work done, readings, events…`} />
                </label>
              </div>
            </section>
            {/* checksheet scans/photos — staged now, uploaded after the entry is created */}
            {CS_KINDS.includes(type) && (
              <AttachmentUpload staged={attachFiles} onStaged={setAttachFiles} />
            )}
          </div>

          {/* combined failure response: acknowledgement (independent flag) and the
              fix progress (job card / rectification), each filed as its own linked
              log via the resolution endpoint — no separate entry types to juggle. */}
          {type === 'failure' && (
            <div className="ef-rect">
              <span className="ef-sublbl">Response <span className="ef-opt">— acknowledgement &amp; fix, each filed as its own linked log</span></span>
              <div className="fg-fields">
                <label className="fg-span ef-check">
                  <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
                  Acknowledged — demand raised / noted (does not resolve the failure)
                </label>
                {acked && (
                  <label className="fg-span">Acknowledgement note
                    <input value={ackText} onChange={(e) => setAckText(e.target.value)}
                           placeholder="e.g. spare not in stock; demand raised to stores, mail sent" />
                  </label>
                )}
                {aProgress !== 'open' && (<>
                  <label>{aProgress === 'rectified' ? 'Rectified on' : 'Job card date'}
                    <input type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} />
                  </label>
                  <label>{aProgress === 'rectified' ? 'Rectified at' : 'Issued at'} <span className="ef-opt">(optional)</span>
                    <TimeInput value={rTim} onChange={setRTim} label={aProgress === 'rectified' ? 'Rectified at' : 'Issued at'} />
                  </label>
                  <label>{aProgress === 'rectified' ? 'Team' : 'Issued to'}
                    <input value={rTeam} onChange={(e) => setRTeam(e.target.value)}
                           placeholder={aProgress === 'rectified' ? 'crew that fixed it' : 'agency / department'} />
                  </label>
                  {aProgress === 'rectified' && (
                    <label className="fg-span-2">Consumables / consumed <span className="ef-opt">(optional)</span>
                      <input value={rConsumables} onChange={(e) => setRConsumables(e.target.value)}
                             placeholder="spares / materials used in the fix — e.g. 2× PT fuse" />
                    </label>
                  )}
                  <label className="fg-span">{aProgress === 'rectified' ? 'What was done' : 'Job card detail'}
                    <input value={rText} onChange={(e) => setRText(e.target.value)}
                           placeholder={aProgress === 'rectified' ? 'what was done to rectify it…' : 'e.g. issued to M/s Siemens to replace the comm card'} />
                  </label>
                </>)}
              </div>
            </div>
          )}

          <div className="ef-actions">
            <button className="btn" type="submit" disabled={busy || apiOk === false || !text.trim()}>
              {busy ? 'Adding…' : type === 'failure' && (acked || aProgress !== 'open') ? 'Add failure + response' : 'Add entry'}
            </button>
            {err && <span className="import-msg err">{err}</span>}
          </div>
        </form>
      )}

      <div className="print-caption">
        AMPS · {ORG} — shift logbook · {qParam.trim() ? `“${qParam.trim()}”` : allDates && from ? `${fmtDate(from)} — ${fmtDate(to)}` : fmtDate(logDate)}
        {fType ? ` · ${fType}` : ''}{fCat ? ` · ${fCat}` : ''} · {total.toLocaleString()} entries · {today()}
      </div>
      {(impBusy || impResult) && (
        <div className="import-status">
          {impBusy ? <span className="dim">Importing…</span>
            : impResult.error ? <span className="import-msg err">{impResult.error}</span>
            : <span className="import-msg">
                {impResult.log_entries} log · {impResult.failures} failures · {impResult.skipped} skipped · {impResult.failed} failed
                {impResult.errors?.length ? ` — ${impResult.errors[0]}` : ''}
                {' '}<a className="mini-btn" href={`${API}/api/logbook/import/sample`} download>sample CSV</a>
              </span>}
        </div>
      )}
      {allDates && from && !qParam.trim() && <p className="dim log-range">{fmtDate(from)} — {fmtDate(to)}</p>}

      {Object.entries(byDay).map(([day, list]) => (
        <div key={day} className="log-day">
          <h3 className="log-date dt">{fmtDate(day)}</h3>
          <div className="card">
            {/* All four shifts always appear, so an empty shift reads as
                "nothing was logged" rather than as missing data. Empty ones
                collapse to one line; the shift being written to is marked. */}
            {ENTRY_SHIFTS.map((sh) => {
              const rows = list.filter((en) => en.shift === sh)
              const isSel = sh === shift
              if (!rows.length) {
                return (
                  <div key={sh} className={`log-shift empty${isSel ? ' sel' : ''}`}>
                    <span className="log-shift-h">{sh} — {SHIFT_LABEL[sh]}</span>
                    <span className="dim">no entries</span>
                  </div>
                )
              }
              return (
                <div key={sh} className={`log-shift${isSel ? ' sel' : ''}`}>
                  <div className="log-shift-h">
                    {sh} — {SHIFT_LABEL[sh]} <span className="dim">· {rows.length}</span>
                  </div>
                  {rows.map((en) => {
                    const openFail = en.type === 'failure' && !en.ended_at
                    const editing = editingId === en.id
                    return (
                    <div className={`log-entry${editing ? ' editing' : ''}`} id={`le-${en.id}`} key={en.id}>
                      <div className="le-row">
                        <div className="le-main">
                          <div className="log-meta">
                            {!en.at.includes('T00:00:00') && <span className="dt le-time">{fmtTime(en.at)}</span>}
                            {en.system && <span className="chip sys"><span className="dot" />{en.system}</span>}
                            {en.category && <span className="chip grp"><span className="dot" />{en.category}</span>}
                            <span className={`chip ${['defect', 'failure'].includes(en.type) ? 'd-overdue' : ''}`}>
                              <span className="dot" />{en.type}{en.subtype ? ` · ${en.subtype}` : ''}
                            </span>
                            {en.asset_code
                              ? <a className="code" href={`#/asset/${en.asset_code}`}>{en.asset_code}</a>
                              : en.type === 'failure' && <span className="chip d-overdue"><span className="dot" />unlinked</span>}
                            {en.type === 'failure' && (en.ended_at
                              ? <span className="chip w-done"><span className="dot" />resolved{en.down_hours != null ? ` · ${en.down_hours}h` : ''}</span>
                              : <span className="chip d-overdue"><span className="dot" />open</span>)}
                            {en.rectifies_id && <span className="dim le-ref">rectifies #{en.rectifies_id}</span>}
                            {en.corrects_id && (
                              <button type="button" className="edited-btn"
                                      onClick={() => setHistoryFor(historyFor === en.id ? null : en.id)}
                                      title="Show edit history"><HistoryIcon /> edited</button>
                            )}
                          </div>
                          <div className="log-text">{bodyText(en.text)}</div>
                          {en.action_taken && <div className="le-action"><span className="lc-tag">Action taken</span> {en.action_taken}</div>}
                          {en.station && !en.asset_code && <div className="le-station"><span className="lc-tag">Station</span> {en.station}</div>}
                          {en.consumables && <div className="le-consumables"><span className="lc-tag">Consumed</span> {en.consumables}</div>}
                          <div className="le-by">
                            <b>{en.attended_by || en.entered_by}</b>
                            {en.attended_by && en.attended_by !== en.entered_by && <> · rec. {en.entered_by}</>}
                          </div>
                        </div>
                        {canWrite && editingId !== en.id && (
                          <div className="le-actions">
                            <button type="button" className="icon-btn" title="Edit entry" aria-label="Edit entry"
                                    onClick={() => { setEditingId(en.id); setRectifying(null) }}><PencilIcon /></button>
                            {openFail && rectifying !== en.id && (
                              <button type="button" className="icon-btn resolve" title="Rectify — log the fix" aria-label="Rectify"
                                      onClick={() => { setRectifying(en.id); setEditingId(null) }}><ResolveIcon /></button>
                            )}
                          </div>
                        )}
                      </div>
                      {historyFor === en.id && <VersionHistory id={en.id} />}
                      {canWrite && editingId === en.id && (
                        <EditEntryForm entry={en} assets={assets} systems={systems} classSystem={classSystem}
                                       initialResp={initialResp}
                                       onCancel={closeEdit}
                                       onSaved={() => { closeEdit(); load() }} />
                      )}
                      {canWrite && rectifying === en.id && openFail && (
                        <RectifyForm failure={en} busy={busy}
                                     onCancel={() => setRectifying(null)}
                                     onSubmit={(f) => submitRectify(en, f)} />
                      )}
                    </div>
                  )})}
                </div>
              )
            })}
          </div>
        </div>
      ))}
      {apiOk && !entries.length && <p className="dim">No entries for this filter.</p>}

      {total > PAGE_SIZE && (
        <div className="log-pager">
          <button type="button" className="btn ghost" disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}>← Newer</button>
          <span className="dim">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
          <button type="button" className="btn ghost"
                  disabled={(page + 1) * PAGE_SIZE >= total}
                  onClick={() => setPage((p) => p + 1)}>Older →</button>
        </div>
      )}

      {/* The demo build warns the visitor off logging anything real. On a live
          deployment that sentence sits under thousands of genuine records and
          tells the section not to use its own logbook — say the opposite. */}
      <p className="roadmap">
        {LIVE
          ? 'Entries are permanent and append-only: nothing is edited or deleted. A mistake is corrected by a new entry, and every entry keeps the shift, date and team that made it.'
          : 'Entries persist in the demo database (reseeded on each demo restart). Synthetic data only — do not log real operational information here.'}
      </p>
    </>
  )
}
