// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arup Biswas and AMPS contributors (binidev)
// AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

// Synthetic demo dataset — ALL FICTIONAL, themed for an urban-rail
// power-supply & E&M context. No real organization's stations, assets or
// records appear here; names, codes and makers are invented. Due dates are
// computed relative to "today" so the demo never goes stale. Replaced by
// the live API when the SQLAlchemy layer lands (v0.2).

const day = 86400000
const today = new Date()
const d = (offset) => new Date(today.getTime() + offset * day)

export const LOCATIONS = [
  { name: 'Demo Rail Line', kind: 'site', parent: null },
  { name: 'TSS City Centre', kind: 'station', parent: 'Demo Rail Line' },
  { name: 'Stn City Centre — E&M', kind: 'station', parent: 'Demo Rail Line' },
  { name: 'Depot Workshop', kind: 'bay', parent: 'Demo Rail Line' },
]

// sys: Traction / PS · Station E&M · Depot — the rollup rail management thinks in
export const ASSETS = [
  { code: 'TRT-0001', name: 'Traction Rectifier Transformer', cls: 'Traction Transformer', sys: 'Traction / PS', location: 'TSS City Centre', makeModel: 'TransElec TR-2200 · 2.2 MVA', commissioned: '2019-03-12', status: 'in_service' },
  { code: 'RECT-0001', name: 'Silicon Rectifier, 750 V DC', cls: 'Rectifier', sys: 'Traction / PS', location: 'TSS City Centre', makeModel: 'RectiPower SR-3000', commissioned: '2019-03-12', status: 'in_service' },
  { code: 'HTP-0001', name: '33kV Incomer Panel', cls: 'HT Panel', sys: 'Traction / PS', location: 'TSS City Centre', makeModel: 'SwitchCraft VCB-33', commissioned: '2019-03-12', status: 'in_service' },
  { code: 'HSCB-0001', name: 'DC High-Speed Circuit Breaker', cls: 'DC HSCB', sys: 'Traction / PS', location: 'TSS City Centre', makeModel: 'RailBreak HS-3000', commissioned: '2019-04-02', status: 'in_service' },
  { code: 'AXT-0001', name: 'Auxiliary Transformer, 500 kVA', cls: 'Aux Transformer', sys: 'Traction / PS', location: 'TSS City Centre', makeModel: 'PowerVolt AT-500', commissioned: '2019-04-02', status: 'under_maintenance' },
  { code: 'ESC-0001', name: 'Escalator, Concourse–Platform', cls: 'Escalator', sys: 'Station E&M', location: 'Stn City Centre', makeModel: 'StepFlow ES-1000', commissioned: '2020-01-27', status: 'in_service' },
  { code: 'LFT-0001', name: 'Passenger Lift, Concourse', cls: 'Lift', sys: 'Station E&M', location: 'Stn City Centre', makeModel: 'LiftWell GL-1000', commissioned: '2020-01-27', status: 'in_service' },
  { code: 'TVF-0001', name: 'Tunnel Ventilation Fan, 45 kW', cls: 'TVS Fan', sys: 'Station E&M', location: 'Stn City Centre', makeModel: 'AirVent AXF-45', commissioned: '2020-06-15', status: 'out_of_service' },
  { code: 'SPM-0001', name: 'Sump Pump, Duty', cls: 'Pump', sys: 'Station E&M', location: 'Stn City Centre', makeModel: 'HydroFlow SP-15', commissioned: '2020-06-15', status: 'in_service' },
  { code: 'UPS-0001', name: 'Station UPS, 60 kVA', cls: 'UPS', sys: 'Station E&M', location: 'Stn City Centre', makeModel: 'PowerSure U-60', commissioned: '2021-08-19', status: 'in_service' },
  { code: 'CRN-0001', name: '10T EOT Crane Hoist', cls: 'Crane Hoist', sys: 'Depot', location: 'Depot Workshop', makeModel: 'LiftPro EOT-10', commissioned: '2018-11-05', status: 'in_service' },
]

export const PM_SCHEDULES = [
  { asset: 'TRT-0001', task: 'Oil BDV test', frequency: 'half-yearly', lastDone: d(-170), nextDue: d(12) },
  { asset: 'TRT-0001', task: 'Winding temperature calibration', frequency: 'yearly', lastDone: d(-320), nextDue: d(45) },
  { asset: 'HTP-0001', task: 'Contact resistance check', frequency: 'yearly', lastDone: d(-371), nextDue: d(-6) },
  { asset: 'AXT-0001', task: 'Insulation resistance (IR) test', frequency: 'half-yearly', lastDone: d(-179), nextDue: d(3) },
  { asset: 'RECT-0001', task: 'Diode-stack thermography', frequency: 'quarterly', lastDone: d(-70), nextDue: d(21) },
  { asset: 'HSCB-0001', task: 'Contact & tripping-time test', frequency: 'yearly', lastDone: d(-205), nextDue: d(160) },
  { asset: 'UPS-0001', task: 'Battery & backup verification', frequency: 'quarterly', lastDone: d(-93), nextDue: d(-2) },
  { asset: 'TVF-0001', task: 'Vibration analysis', frequency: 'monthly', lastDone: d(-25), nextDue: d(5) },
  { asset: 'ESC-0001', task: 'Step-chain & brake inspection', frequency: 'monthly', lastDone: d(-18), nextDue: d(11) },
  { asset: 'LFT-0001', task: 'Rope & door-interlock inspection', frequency: 'monthly', lastDone: d(-15), nextDue: d(14) },
  { asset: 'SPM-0001', task: 'Auto-start & float check', frequency: 'monthly', lastDone: d(-12), nextDue: d(16) },
  { asset: 'CRN-0001', task: 'Brake & limit-switch inspection', frequency: 'monthly', lastDone: d(-21), nextDue: d(9) },
]

export const JOB_CARDS = [
  { id: 'JC-104', asset: 'AXT-0001', type: 'inspection', status: 'open', title: 'IR test before re-energizing auxiliary transformer', openedAt: d(0), closedAt: null, issuedTo: 'Testing Wing (E&M)', findings: null,
    desc: 'Conduct insulation resistance (IR) test of the 500 kVA auxiliary transformer before re-energizing. Record HV–E, HV–LV and LV–E values with PI ratio and submit readings on the enclosed checksheet.' },
  { id: 'JC-103', asset: 'TVF-0001', type: 'breakdown', status: 'assigned', title: 'DE bearing seized — replacement', openedAt: d(-2), closedAt: null, issuedTo: 'M/s ElectroMech Services (AMC)', findings: null,
    desc: 'Dismantle drive-end bearing of the 45 kW tunnel ventilation fan (seized), replace with new 6312-C3, check shaft journal, align and give trial run. Return the acknowledged card with the replaced-part bill.' },
  { id: 'JC-102', asset: 'CRN-0001', type: 'preventive', status: 'done', title: 'Monthly brake & limit-switch inspection', openedAt: d(-6), closedAt: d(-5), issuedTo: 'M/s CraneCare Services (AMC)', findings: 'Brake pads within wear limit; LS2 limit switch adjusted.', ackBy: 'CraneCare site technician',
    desc: 'Carry out monthly brake and limit-switch inspection of the 10 T EOT crane hoist per OEM checklist. Adjust or replace as required; submit filled checksheet with the acknowledged card.', docs: [] },
  { id: 'JC-101', asset: 'TRT-0001', type: 'preventive', status: 'verified', title: 'Half-yearly oil BDV test', openedAt: d(-36), closedAt: d(-34), issuedTo: 'M/s PowerTest Labs', findings: 'BDV 62 kV — within limits.', ackBy: 'PowerTest field engineer',
    desc: 'Draw oil sample from the traction rectifier transformer bottom sampling valve and conduct BDV test per IS 6792. Submit test report and filled checksheet; top up oil if conservator level is low.',
    docs: ['BDV test report (agency format, as submitted)', 'Service bill'] },
]

export const SPECS = {
  'TRT-0001': [['Rating', '2.2 MVA'], ['Voltage ratio', '33 kV / 2×590 V'], ['Duty', 'Traction rectifier duty'], ['Cooling', 'ONAN'], ['% impedance', '7.1%'], ['Oil quantity', '1650 L']],
  'RECT-0001': [['Type', 'Silicon, 12-pulse'], ['DC output', '750 V / 3000 A'], ['Overload', '150% · 2 h / 300% · 1 min'], ['Cooling', 'Natural air']],
  'HTP-0001': [['Type', 'VCB, indoor'], ['Rated current', '1250 A'], ['Breaking capacity', '25 kA / 3 s'], ['O/C pickup', '110% In'], ['E/F pickup', '20% In'], ['Control supply', '110 V DC']],
  'HSCB-0001': [['Type', 'DC high-speed breaker'], ['Rated voltage', '900 V DC'], ['Rated current', '3000 A'], ['Trip setting', '6 kA + rate-of-rise'], ['Opening time', '< 20 ms']],
  'AXT-0001': [['Rating', '500 kVA'], ['Voltage ratio', '33 / 0.415 kV'], ['Vector group', 'Dyn11'], ['Cooling', 'ONAN']],
  'ESC-0001': [['Rise', '9.5 m'], ['Speed', '0.5 m/s'], ['Step width', '1000 mm'], ['Motor', '11 kW'], ['Inclination', '30°']],
  'LFT-0001': [['Capacity', '1000 kg / 13 passengers'], ['Speed', '1.0 m/s'], ['Drive', 'Gearless MRL'], ['Stops', '3']],
  'TVF-0001': [['Rating', '45 kW'], ['Airflow', '55 m³/s'], ['Type', 'Axial, reversible'], ['Bearings', 'DE 6312-C3 / NDE 6310-C3']],
  'SPM-0001': [['Rating', '15 kW'], ['Capacity', '120 m³/h @ 24 m'], ['Type', 'Submersible, duty + standby'], ['Control', 'Float + level relay']],
  'UPS-0001': [['Rating', '60 kVA'], ['Backup', '30 min at full load'], ['Battery bank', 'SMF 12 V × 40'], ['Transfer time', '< 4 ms']],
  'CRN-0001': [['SWL', '10 T'], ['Span', '18 m'], ['Hoist motor', '15 kW'], ['LT / CT speed', '20 / 15 m/min'], ['Brake', 'EM disc, 2×']],
}

const hrs = 3600000
const t = (dOff, h) => new Date(today.getTime() + dOff * day + (h - today.getHours()) * hrs)

export const LOG_ENTRIES = [
  { ts: t(0, 9), shift: 'A', author: 'S. Kumar', text: 'TSS City Centre: 33 kV incomer load 41 A, DC bus 748 V, all feeders normal. AXT-0001 kept isolated for IR test (JC-104).' },
  { ts: t(-1, 22), shift: 'C', author: 'A. Sen', text: 'Night block round normal. Third-rail voltage healthy end to end; battery charger float 122 V. Handover: nil pending.' },
  { ts: t(-1, 16), shift: 'B', author: 'R. Das', text: 'TVF-0001 replacement bearing followed up with stores — expected in 3 days (PR-2026-015). Tunnel ventilation running on standby fan.' },
  { ts: t(-1, 9), shift: 'A', author: 'S. Kumar', text: 'Station DG set test run 15 min — voltage/frequency OK. Diesel level 78%.' },
  { ts: t(-2, 21), shift: 'C', author: 'A. Sen', text: 'Platform lighting circuit MCB tripped once, reset, holding. To observe.' },
  { ts: t(-2, 14), shift: 'B', author: 'R. Das', text: 'TVF-0001 abnormal noise during evening peak → isolated, breakdown JC-103 raised, DE bearing found seized.' },
  { ts: t(-2, 9), shift: 'A', author: 'S. Kumar', text: 'Monthly brake inspection on CRN-0001 completed at depot (JC-102). Brake pads within limit, LS2 adjusted.' },
]

export const PROCUREMENTS = [
  { id: 'PR-2026-016', item: 'VCB spring-charge motor (spare)', qty: '1 no.', asset: 'HTP-0001', stage: 'draft', requested: d(-1), cost: '—', note: 'Recommended spare per OEM list; none in stock.' },
  { id: 'PR-2026-015', item: 'DE bearing 6312-C3 for 45 kW tunnel ventilation fan', qty: '2 nos.', asset: 'TVF-0001', stage: 'proposed', requested: d(-2), cost: '₹ 18,400 (est.)', note: 'Against breakdown JC-103; one for replacement, one for stock.', failure: 'F-02' },
  { id: 'PR-2026-014', item: 'Transformer oil, EHV grade — 200 L drums', qty: '2 drums', asset: 'TRT-0001', stage: 'ordered', requested: d(-18), cost: '₹ 52,000', note: 'Top-up + reserve ahead of half-yearly filtration.' },
  { id: 'PR-2026-013', item: 'SMF batteries 12 V / 26 Ah for station UPS', qty: '8 nos.', asset: 'UPS-0001', stage: 'received', requested: d(-32), cost: '₹ 29,600', note: 'Replaced after UPS battery failure (F-03).' },
  { id: 'PR-2026-012', item: 'Crane hoist brake pad set', qty: '2 sets', asset: 'CRN-0001', stage: 'approved', requested: d(-40), cost: '₹ 9,600', note: 'Preventive replacement stock for monthly inspections.' },
]

export const PROC_STAGES = ['draft', 'proposed', 'approved', 'ordered', 'received']

export const SPARES = [
  { code: 'SP-001', name: 'Fan DE bearing 6312-C3', cls: 'TVS Fan', bin: 'Store-1 / R2-B4', qty: 0, min: 2, unit: 'nos.', pr: 'PR-2026-015' },
  { code: 'SP-002', name: 'VCB spring-charge motor', cls: 'HT Panel', bin: 'Store-1 / R1-A2', qty: 0, min: 1, unit: 'nos.', pr: 'PR-2026-016' },
  { code: 'SP-003', name: 'Escalator comb plates', cls: 'Escalator', bin: 'Store-2 / R4-B1', qty: 2, min: 4, unit: 'nos.', pr: null },
  { code: 'SP-004', name: 'Lift door roller set', cls: 'Lift', bin: 'Store-2 / R4-B3', qty: 1, min: 2, unit: 'sets', pr: null },
  { code: 'SP-005', name: 'SMF battery 12 V / 26 Ah', cls: 'UPS', bin: 'Store-1 / R3-A1', qty: 8, min: 8, unit: 'nos.', pr: null },
  { code: 'SP-006', name: 'HT fuse link 33 kV', cls: 'HT Panel', bin: 'Store-1 / R1-A4', qty: 6, min: 4, unit: 'nos.', pr: null },
  { code: 'SP-007', name: 'Pump mechanical seal', cls: 'Pump', bin: 'Store-1 / R3-B2', qty: 2, min: 1, unit: 'nos.', pr: null },
  { code: 'SP-008', name: 'Transformer oil, EHV grade', cls: 'Traction Transformer', bin: 'Oil store', qty: 400, min: 600, unit: 'L', pr: 'PR-2026-014' },
  { code: 'SP-009', name: 'HSCB arc chute', cls: 'DC HSCB', bin: 'Store-1 / R1-C1', qty: 1, min: 1, unit: 'nos.', pr: null },
  { code: 'SP-010', name: 'Crane hoist brake pad set', cls: 'Crane Hoist', bin: 'Store-2 / R4-C1', qty: 2, min: 2, unit: 'sets', pr: 'PR-2026-012' },
]

export function spareStats() {
  const below = SPARES.filter((s) => s.qty < s.min)
  const covered = below.filter((s) => s.pr).length
  return { items: SPARES.length, below: below.length, uncovered: below.length - covered }
}

// Checksheet templates per PM task — items with acceptance limits.
// Filled readings live on the job card (RESULTS below); a task without a
// completed card renders as a blank sheet to print and fill in the field.
export const CHECKSHEET_TEMPLATES = {
  'Oil BDV test': [
    ['Oil sample drawn from bottom sampling valve', '—'],
    ['Visual check — colour & clarity', 'Clear, no turbidity'],
    ['Breakdown voltage (BDV)', '≥ 50 kV'],
    ['Moisture / crackle test', 'No crackle'],
    ['Sample bottle labelled & retained', '—'],
    ['Oil level in conservator', 'Between marks'],
  ],
  'Brake & limit-switch inspection': [
    ['Brake pad thickness', '≥ 5 mm'],
    ['Brake holding test at rated load', 'No drift'],
    ['LS1 — upper limit trip', 'Trips'],
    ['LS2 — over-hoist backup trip', 'Trips'],
    ['Pendant emergency stop', 'Opens main contactor'],
    ['Hook safety latch', 'Intact'],
  ],
  'Battery & backup verification': [
    ['Float voltage per battery', '13.5–13.8 V'],
    ['Backup duration on mains fail', '≥ 15 min'],
    ['Terminals cleaned & greased', '—'],
    ['Mains-fail alarm at SCADA/panel', 'Reports'],
  ],
  'Contact resistance check': [
    ['CRM — R phase', '≤ 50 µΩ'],
    ['CRM — Y phase', '≤ 50 µΩ'],
    ['CRM — B phase', '≤ 50 µΩ'],
    ['Deviation from last measurement', '≤ 20%'],
    ['Joint torque check', 'Per OEM chart'],
  ],
  'Insulation resistance (IR) test': [
    ['IR — HV to earth', '≥ 1000 MΩ'],
    ['IR — HV to LV', '≥ 1000 MΩ'],
    ['IR — LV to earth', '≥ 100 MΩ'],
    ['PI ratio (10 min / 1 min)', '≥ 1.5'],
  ],
}

const GENERIC_CHECKSHEET = [
  ['Visual inspection — no damage / hotspot / abnormal sound', '—'],
  ['Cleaning of equipment & surroundings', '—'],
  ['Fasteners & terminations checked', 'Torque per OEM'],
  ['Safety devices / interlocks functional', 'Operates'],
  ['Readings recorded in log book', '—'],
]

export const checksheetFor = (task) => CHECKSHEET_TEMPLATES[task] ?? GENERIC_CHECKSHEET

// Filled checksheets for completed job cards: readings per template row.
export const CHECKSHEET_RESULTS = {
  'JC-101': {
    task: 'Oil BDV test',
    readings: ['Done', 'Clear', '62 kV', 'No crackle', 'Bottle T-114', 'Normal'],
    doneBy: 'M/s PowerTest Labs', checkedBy: 'R. Das (Supervisor)', approvedBy: 'Sr. Engineer (E)',
  },
  'JC-102': {
    task: 'Brake & limit-switch inspection',
    readings: ['7.5 mm', 'No drift', 'Trips OK', 'Trips (adjusted)', 'OK', 'Intact'],
    doneBy: 'M/s CraneCare Services', checkedBy: 'R. Das (Supervisor)', approvedBy: 'Sr. Engineer (E)',
  },
}

export const FAILURES = [
  { id: 'F-02', asset: 'TVF-0001', started: t(-2, 14), restored: null, cause: 'DE bearing seized — abnormal noise during evening peak, fan isolated', remedy: 'Bearing replacement in progress (JC-103, PR-2026-015); standby fan in service' },
  { id: 'F-03', asset: 'UPS-0001', started: t(-20, 11), restored: t(-20, 12), cause: 'UPS battery failure — station UPS went to bypass on supply dip', remedy: 'Battery bank replaced (PR-2026-013); auto-transfer verified' },
  { id: 'F-01', asset: 'AXT-0001', started: t(-35, 15), restored: t(-35, 18), cause: 'Auxiliary feeder VCB tripped on over-current', remedy: 'Downstream cable fault isolated; relay reset after inspection' },
  { id: 'F-04', asset: 'CRN-0001', started: t(-48, 10), restored: t(-48, 12), cause: 'Hoist upper limit switch malfunction (depot)', remedy: 'LS replaced from stock; travel re-calibrated' },
  { id: 'F-05', asset: 'SPM-0001', started: t(-61, 9), restored: t(-61, 10), cause: 'Sump high-level alarm — duty pump failed to auto-start (float switch)', remedy: 'Float switch replaced; auto-start verified' },
  { id: 'F-06', asset: 'TRT-0001', started: t(-75, 8), restored: t(-75, 12), cause: 'Buchholz alarm — precautionary shutdown during night block', remedy: 'Gas sample tested inert; no internal fault; normalized' },
  { id: 'F-07', asset: 'HTP-0001', started: t(-82, 17), restored: t(-82, 18), cause: '33 kV incomer tripped on grid disturbance', remedy: 'Supply restored on grid normalization; relays checked' },
  { id: 'F-08', asset: 'LFT-0001', started: t(-95, 10), restored: t(-95, 12), cause: 'Lift held at concourse — door interlock fault', remedy: 'Interlock adjusted; door rollers checked' },
  { id: 'F-09', asset: 'ESC-0001', started: t(-110, 15), restored: t(-110, 16), cause: 'Escalator safety stop — handrail speed deviation', remedy: 'Handrail tension adjusted; test run OK' },
  { id: 'F-10', asset: 'RECT-0001', started: t(-128, 9), restored: t(-128, 10), cause: 'Thermography hotspot on diode-stack fuse link', remedy: 'Fuse link replaced during night block' },
  { id: 'F-11', asset: 'HTP-0001', started: t(-150, 11), restored: t(-150, 14), cause: 'VCB failed to close — spring-charge motor fault', remedy: 'Spring-charge motor serviced; spare recommended (SP-002)' },
  { id: 'F-12', asset: 'ESC-0001', started: t(-170, 13), restored: t(-170, 14), cause: 'Step-chain noise — bearing running dry', remedy: 'Re-greased; vibration normalized' },
]

export const completedChecksheets = (assetCode) =>
  Object.entries(CHECKSHEET_RESULTS)
    .filter(([jcId]) => JOB_CARDS.find((w) => w.id === jcId)?.asset === assetCode)
    .map(([jcId, r]) => ({ woId: jcId, task: r.task }))

// ---- derived helpers ----

export const fmtDate = (date) =>
  date ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export const daysUntil = (date) => Math.ceil((date - today) / day)

export function dueState(nextDue) {
  const n = daysUntil(nextDue)
  if (n < 0) return { key: 'overdue', label: `Overdue ${-n}d` }
  if (n <= 7) return { key: 'due_soon', label: `Due in ${n}d` }
  return { key: 'ok', label: 'On schedule' }
}

export const fmtTime = (date) =>
  date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export const durationHrs = (f) =>
  Math.round(((f.restored ?? today) - f.started) / hrs * 10) / 10

export function failureStats(windowDays = 90) {
  const win = FAILURES.filter((f) => f.started >= d(-windowDays))
  const restored = win.filter((f) => f.restored)
  const ongoing = win.length - restored.length
  const downtime = Math.round(win.reduce((s, f) => s + durationHrs(f), 0))
  const mttr = Math.round(restored.reduce((s, f) => s + durationHrs(f), 0) / restored.length * 10) / 10
  return { total: win.length, ongoing, downtime, mttr }
}

export function failuresByMonth(nMonths = 6) {
  const out = []
  for (let i = nMonths - 1; i >= 0; i--) {
    const m = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const next = new Date(today.getFullYear(), today.getMonth() - i + 1, 1)
    out.push({
      label: m.toLocaleDateString('en-GB', { month: 'short' }),
      count: FAILURES.filter((f) => f.started >= m && f.started < next).length,
    })
  }
  return out
}

// Rollup by system — Traction / PS vs Station E&M vs Depot
export function classCountsAll() {
  const bySys = {}
  FAILURES.forEach((f) => {
    const sys = ASSETS.find((a) => a.code === f.asset)?.sys ?? '?'
    bySys[sys] = (bySys[sys] ?? 0) + 1
  })
  return Object.entries(bySys).sort((a, b) => b[1] - a[1])
}

export function downtimeByAsset() {
  const byAsset = {}
  FAILURES.forEach((f) => { byAsset[f.asset] = Math.round(((byAsset[f.asset] ?? 0) + durationHrs(f)) * 10) / 10 })
  return Object.entries(byAsset).sort((a, b) => b[1] - a[1])
}

export function recoveryStatus() {
  const restored = FAILURES.filter((f) => f.restored).length
  return { restored, ongoing: FAILURES.length - restored }
}

// Project PM occurrences onto a month grid (frequency-stepped from nextDue).
const FREQ_DAYS = { monthly: 30, quarterly: 91, 'half-yearly': 182, yearly: 365 }
export function pmOccurrencesInMonth(year, month) {
  const out = {}
  for (const p of PM_SCHEDULES) {
    let due = new Date(p.nextDue)
    for (let i = 0; i < 24 && due <= new Date(year, month + 1, 1); i++) {
      if (due.getFullYear() === year && due.getMonth() === month) {
        const key = due.getDate()
        ;(out[key] ??= []).push({ ...p, due })
      }
      due = new Date(due.getTime() + FREQ_DAYS[p.frequency] * day)
    }
  }
  return out
}

export function kpis() {
  const overdue = PM_SCHEDULES.filter((p) => daysUntil(p.nextDue) < 0).length
  const dueSoon = PM_SCHEDULES.filter((p) => { const n = daysUntil(p.nextDue); return n >= 0 && n <= 7 }).length
  const compliance = Math.round(((PM_SCHEDULES.length - overdue) / PM_SCHEDULES.length) * 100)
  const openJC = JOB_CARDS.filter((w) => w.status === 'open' || w.status === 'assigned').length
  return { assets: ASSETS.length, compliance, dueSoon, overdue, openJC }
}
