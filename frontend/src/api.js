/* Live data layer.

   Built with VITE_AMPS_DATA=live, the asset-driven screens read the running
   backend instead of the bundled demo dataset, and modules whose backend
   hasn't landed yet leave the navigation — a deployment only shows what is
   real. Default build (demo) keeps the full synthetic walkthrough.

   VITE_AMPS_ORG names the organisation on headers, tags and printouts. */
import { useEffect, useState } from 'react'

export const LIVE = import.meta.env.VITE_AMPS_DATA === 'live'
export const ORG = import.meta.env.VITE_AMPS_ORG || 'Demo Metro Line'

const API = import.meta.env.VITE_AMPS_API ?? '' // same-origin by default

export async function getJSON(path) {
  const r = await fetch(`${API}${path}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/* API asset → the shape the screens already use for demo data. */
const toView = (a) => ({
  code: a.code,
  name: a.name,
  cls: a.asset_class,
  sys: a.system || null,
  location: a.location,            // the STATION (location tree)
  locationDetail: a.location_detail || null,   // fine equipment location within the station
  line: a.line || null,
  makeModel: a.make_model || null,
  status: a.status,
  criticality: a.criticality,
  commissionedOn: a.commissioned_on || null,
  description: a.description || null,
  remarks: a.remarks || null,
  codalLifeYears: a.codal_life_years ?? null,
  depot: a.depot || null,
})

/** Session identity. Reads are open to everyone (the QR-scan surface);
    `canWrite` is true when auth is off (demo/dev) or a real user is signed in.
    Anonymous visitors on an authenticated deployment browse as 'viewer'. */
export function useMe() {
  const [state, set] = useState({ me: null, canWrite: !LIVE, loading: LIVE })
  useEffect(() => {
    if (!LIVE) return undefined
    let alive = true
    fetch(`${API}/api/auth/me`)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then((me) => alive && set({
        me,
        // a viewer account (the anonymous walk-up, or a named view-only login
        // like a line-wide 'blue' id) reads but never writes
        canWrite: !me.auth_enabled || (me.username !== 'viewer' && me.role !== 'viewer'),
        loading: false,
      }))
      .catch(() => alive && set({ me: null, canWrite: false, loading: false }))
    return () => { alive = false }
  }, [])
  return state
}

export async function apiLogin(username, password) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail || 'login failed')
  return r.json()
}

export async function apiLogout() {
  await fetch(`${API}/api/auth/logout`, { method: 'POST' }).catch(() => {})
  location.reload()
}

/** Register + dashboard source: every asset, plus PM items due within 60 days. */
export function useLiveAssets() {
  // Progressive (lazy) load: the asset list is the register's first paint, so it
  // resolves on its own and flips `loading` off immediately. The heavier PM
  // schedule (~1.5 MB) and open-failure map hydrate in the background and only
  // gate `schedLoading` — the list is browsable/searchable/sortable at once,
  // and PM-state columns + counts fill in a moment later. Aggregate views
  // (dashboards) wait on `schedLoading` since their numbers need the schedule.
  const [state, set] = useState({ assets: [], sched: {}, openFail: {}, loading: LIVE, schedLoading: LIVE, error: null })
  useEffect(() => {
    if (!LIVE) return undefined
    let alive = true
    // 1) assets first — the register renders the instant these land
    getJSON('/api/assets')
      .then((assets) => alive && set((s) => ({ ...s, assets: assets.map(toView), loading: false, error: null })))
      .catch((e) => alive && set((s) => ({ ...s, loading: false, schedLoading: false, error: String(e) })))
    // 2) schedule + open failures hydrate after, without blocking the list.
    // codes repeat across lines, so both are keyed by `line|code` (the backend
    // keys open-failures the same way) — a Green asset never picks up a Blue
    // asset's schedule/job card of the same code.
    Promise.all([
      getJSON('/api/maintenance/schedule').catch(() => []),
      getJSON('/api/logbook/open-failures-by-asset').catch(() => ({})),
    ]).then(([sched, openFail]) => alive && set((s) => ({
      ...s,
      sched: Object.fromEntries(sched.map((x) => [`${x.line || ''}|${x.asset_code}`, x])),
      openFail: openFail || {},
      schedLoading: false,
    })))
    return () => { alive = false }
  }, [])
  return state
}

/** Asset page source: the record, its work-order history, and its logbook
    (the QR scan target — everything ever recorded against the asset). The
    logbook is the single ledger now: failures, maintenance and notes all
    live there, filtered to this asset. */
export function useLiveAsset(code) {
  const [state, set] = useState({ asset: null, history: [], log: [], loading: true, error: null })
  const [nonce, setNonce] = useState(0)
  const reload = () => setNonce((n) => n + 1)
  useEffect(() => {
    let alive = true
    set({ asset: null, history: [], log: [], loading: true, error: null })
    Promise.all([
      getJSON(`/api/assets/${encodeURIComponent(code)}`),
      getJSON(`/api/assets/${encodeURIComponent(code)}/history`).catch(() => []),
      getJSON(`/api/logbook?asset_code=${encodeURIComponent(code)}&limit=500`).catch(() => []),
    ])
      .then(([a, history, log]) => alive && set({ asset: toView(a), history, log, loading: false, error: null }))
      .catch((e) => alive && set({ asset: null, history: [], log: [], loading: false, error: String(e) }))
    return () => { alive = false }
  }, [code, nonce])
  return { ...state, reload }
}
