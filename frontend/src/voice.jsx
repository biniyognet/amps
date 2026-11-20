// SPDX-License-Identifier: MIT
// Voice for AMPS: speak a question or a remark, hear the answer.
// Browser-native Web Speech API (speech-to-text + speechSynthesis), so nothing
// leaves the phone but the text. Where the browser has no recogniser the mic
// is simply not shown; typing always works.
import { useEffect, useRef, useState } from 'react'

export const LANGS = [
  ['en-IN', 'EN'],
  ['bn-IN', 'বাং'],
  ['hi-IN', 'हिं'],
]
const KEY = 'amps.voice.lang'
const getLang = () => { try { return localStorage.getItem(KEY) || 'en-IN' } catch { return 'en-IN' } }

export function useVoiceLang() {
  const [lang, set] = useState(getLang)
  const setLang = (l) => { set(l); try { localStorage.setItem(KEY, l) } catch { /* private mode */ } }
  return [lang, setLang]
}

// Speech-to-text. onText gets the final transcript, onPartial the live guess.
export function useDictation(onText, lang = 'en-IN', onPartial) {
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
  const [on, setOn] = useState(false)
  const rec = useRef(null)
  useEffect(() => () => rec.current?.abort?.(), [])
  const toggle = () => {
    if (on) { rec.current?.stop(); return }
    const r = new SR()
    r.lang = lang; r.interimResults = !!onPartial; r.continuous = false
    r.onresult = (e) => {
      const res = [...e.results]
      const text = res.map((x) => x[0].transcript).join(' ').trim()
      if (res.every((x) => x.isFinal)) onText(text)
      else onPartial?.(text)
    }
    r.onend = () => setOn(false)
    r.onerror = () => setOn(false)
    rec.current = r; r.start(); setOn(true)
  }
  return SR ? { on, toggle } : null
}

// Text-to-speech for answers. Picks a voice for the answer's script, not the UI language.
const scriptLang = (t) => /[ঀ-৿]/.test(t) ? 'bn-IN' : /[ऀ-ॿ]/.test(t) ? 'hi-IN' : 'en-IN'
const plain = (t) => t.replace(/\*\*/g, '').replace(/^\s*(?:[-*•]|\d+\.)\s+/gm, '').replace(/\s+/g, ' ').trim()

export function useSpeaker() {
  const ok = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [speaking, setSpeaking] = useState(null) // id being read, or null
  useEffect(() => () => { if (ok) window.speechSynthesis.cancel() }, [ok])
  const stop = () => { if (ok) window.speechSynthesis.cancel(); setSpeaking(null) }
  const speak = (text, id = 'x') => {
    if (!ok) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(plain(text).slice(0, 1200))
    u.lang = scriptLang(text)
    const v = window.speechSynthesis.getVoices().find((x) => x.lang?.replace('_', '-') === u.lang)
      || window.speechSynthesis.getVoices().find((x) => x.lang?.startsWith(u.lang.slice(0, 2)))
    if (v) u.voice = v
    u.onend = u.onerror = () => setSpeaking((s) => (s === id ? null : s))
    setSpeaking(id)
    window.speechSynthesis.speak(u)
  }
  return ok ? { speaking, speak, stop } : null
}

export function LangPick({ lang, setLang, className = 'voice-lang' }) {
  return (
    <span className={className} role="group" aria-label="Voice language">
      {LANGS.map(([l, t]) => (
        <button key={l} type="button" aria-pressed={lang === l} className={lang === l ? 'on' : ''}
                onClick={() => setLang(l)}>{t}</button>
      ))}
    </span>
  )
}
