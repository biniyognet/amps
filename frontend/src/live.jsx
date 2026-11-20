// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arup Biswas and AMPS contributors (binidev)
// AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

/* Shared live websocket client. One socket for the whole app (not one per
   hook/component), auto-reconnecting with backoff (1s → 30s). Messages are
   {kind, data, ts}; the server also sends {kind:'ping'} every 25s (ignored —
   the browser's own TCP keepalive is enough, this just tells us the pipe is
   still open) and {kind:'hello'} on connect.

   No-op everywhere this can't help: the public demo build (VITE_AMPS_DATA
   unset) ships no backend to talk to, so the socket is never opened at all —
   useLiveStatus() just reports false and useLiveEvents() never fires. On a
   live deployment where the socket simply can't connect (offline, proxy
   strips upgrade, …) it retries quietly in the background and the rest of the
   app behaves exactly as it does today; nothing here ever throws. */
import { useEffect, useRef, useState } from 'react'
import { LIVE, API } from './api.js'

const listeners = new Set()       // { kinds: Set|null, fn }
const statusListeners = new Set() // fn(connected)
const toastListeners = new Set()  // fn(toast)

let socket = null
let connected = false
let retryMs = 1000
let retryTimer = null
let loggedOnce = false

function wsURL() {
  // API is '' (same origin) or an absolute http(s) base the app already
  // talks to — reuse it and just flip the scheme, same host/path as the API.
  const base = API || `${location.protocol}//${location.host}`
  const u = new URL(base, location.href)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = `${u.pathname.replace(/\/+$/, '')}/api/ws`
  u.search = ''
  return u.toString()
}

function setConnected(v) {
  if (connected === v) return
  connected = v
  statusListeners.forEach((fn) => { try { fn(v) } catch { /* a bad listener shouldn't break the socket */ } })
}

function dispatch(msg) {
  listeners.forEach(({ kinds, fn }) => {
    if (!kinds || kinds.has(msg.kind)) { try { fn(msg) } catch { /* a bad handler shouldn't break the socket */ } }
  })
}

function scheduleRetry() {
  if (retryTimer || !LIVE) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    retryMs = Math.min(retryMs * 2, 30000)
    connect()
  }, retryMs)
}

function connect() {
  if (!LIVE || socket || typeof WebSocket === 'undefined') return
  let s
  try {
    s = new WebSocket(wsURL())
  } catch {
    scheduleRetry()
    return
  }
  socket = s
  s.onopen = () => { retryMs = 1000; setConnected(true) }
  s.onmessage = (ev) => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (!msg || msg.kind === 'ping') return
    if (msg.kind === 'hello') { setConnected(true); return }
    dispatch(msg)
  }
  const down = () => {
    if (socket === s) socket = null
    setConnected(false)
    scheduleRetry()
  }
  s.onclose = down
  s.onerror = () => {
    if (!loggedOnce) { loggedOnce = true; console.info('[live] websocket unavailable — retrying in the background') }
    down()
  }
}

// Open once, at module load — every component shares this one connection.
if (typeof window !== 'undefined') connect()

/** True while the shared socket is connected. False (and static) outside
    live mode — there's nothing to connect to. */
export function useLiveStatus() {
  const [on, setOn] = useState(connected)
  useEffect(() => {
    statusListeners.add(setOn)
    setOn(connected)
    return () => statusListeners.delete(setOn)
  }, [])
  return on
}

/** Subscribe to live events. `kinds` is a kind string, an array of kinds, or
    omitted/null for every kind. `handler(msg)` runs for each matching message
    while the component is mounted — always the latest `handler`, no stale
    closures. A no-op when the app isn't in live mode. */
export function useLiveEvents(kinds, handler) {
  const kindsKey = Array.isArray(kinds) ? kinds.join(',') : (kinds || '')
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    if (!LIVE) return undefined
    const set = kinds ? new Set(Array.isArray(kinds) ? kinds : [kinds]) : null
    const entry = { kinds: set, fn: (msg) => handlerRef.current(msg) }
    listeners.add(entry)
    return () => listeners.delete(entry)
    // kindsKey fully describes `kinds` for a dep array; handler is read via the ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindsKey])
}

let nextToastId = 1
/** Push a toast onto the minimal built-in stack below. Call this from
    anywhere (no provider/context needed) — used when the host page has no
    toast/snackbar system of its own. */
export function pushToast(text, ms = 6000) {
  const t = { id: nextToastId++, text }
  toastListeners.forEach((fn) => fn(t, ms))
}

/** Fixed-position toast stack. Mount once near the shell root. Renders
    nothing until something calls pushToast(). */
export function LiveToasts() {
  const [items, setItems] = useState([])
  useEffect(() => {
    const onToast = (t, ms) => {
      setItems((xs) => [...xs, t])
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), ms)
    }
    toastListeners.add(onToast)
    return () => toastListeners.delete(onToast)
  }, [])
  if (!items.length) return null
  return (
    <div className="live-toasts" aria-live="polite">
      {items.map((t) => <div key={t.id} className="live-toast">{t.text}</div>)}
    </div>
  )
}

/** "● Live" header dot — green while the socket is connected, grey while
    offline/reconnecting. Renders nothing outside live mode. */
export function LiveDot() {
  const on = useLiveStatus()
  if (!LIVE) return null
  return (
    <span className={`live-dot${on ? ' on' : ''}`} role="status"
          aria-label={on ? 'Live: connected' : 'Live: offline'}
          title={on ? 'Live — connected' : 'Live — reconnecting…'}>● Live</span>
  )
}
