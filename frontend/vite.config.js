// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arup Biswas and AMPS contributors (binidev)
// AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

// Dev server proxies the backend routes so `npm run dev` + `uvicorn --reload`
// just work side by side, same-origin, no CORS or VITE_AMPS_API needed.
// Point AMPS_DEV_API elsewhere (e.g. the office server) to develop the UI
// against a remote backend.
const api = process.env.AMPS_DEV_API ?? 'http://localhost:8000'

// Public demo build (no VITE_AMPS_DATA=live): no operator branding ships.
// The favicon becomes a neutral bolt and the departmental images (emblems,
// the maker's handwritten signature, the operator logo) are dropped from dist.
const LIVE = process.env.VITE_AMPS_DATA === 'live'
const NEUTRAL = !LIVE || process.env.VITE_AMPS_BRAND === 'neutral'
const ORG_UP = (process.env.VITE_AMPS_ORG || 'Demo Metro Line').toUpperCase()
const DEMO_DROP = ['signature.png', 'ir-railways.png', 'ir-logo.png', 'ir-emblem.svg', 'metro-logo.svg']
const demoUnbrand = {
  name: 'amps-demo-unbrand',
  apply: 'build',
  transformIndexHtml: (html) => (!NEUTRAL ? html : html.replace('/metro-logo.svg', '/amps-bolt.svg')),
  // neutral builds carry the org name, not the operator's, on checksheet titles
  transform(code, id) {
    if (!NEUTRAL || !/checksheets\.js$/.test(id)) return null
    return code.replace(/METRO RAILWAY,\s*KOLKATA/g, ORG_UP).replace(/Metro Railway Kolkata/g, 'a metro railway')
  },
  writeBundle(opts) {
    if (!NEUTRAL) return
    for (const f of DEMO_DROP) rmSync(resolve(opts.dir, f), { force: true })
  },
}

export default defineConfig({
  plugins: [react(), demoUnbrand],
  server: {
    proxy: {
      '/api': api,
      '/docs': api,
      '/openapi.json': api,
    },
  },
})
