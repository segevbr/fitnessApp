// Pure rules engine for the Floating Quota system. No React in here —
// everything is testable with plain function calls.
//
// V2 calibration: vertical-pull node unlocked, volume rebalanced, and hard
// structural ceilings introduced (squats / plank) to protect the Saturday
// soccer leg budget. The V1 "hardware upgrade / reset to 3x5" mechanic is
// retired — caps are now ceilings the targets hold at, not reset triggers.

export const SETS = 3
export const REST_SECONDS = 120   // between rounds (full 2-min recovery)
export const REST_EX_SECONDS = 30 // between exercises within a round

// Every exercise that can hold a target. The leg slot has two variants
// (pistol / bodyweight) that the weekly hybrid schedule swaps between — both
// start at their cap, so they never progress (they protect the soccer leg budget).
export const EXERCISES = [
  { key: 'pull',   label: 'NEGATIVE PULL-UPS', short: 'PULL-UPS', code: 'PUL', unit: 'REPS', start: 5,  inc: 1, cap: null, note: null },
  { key: 'push',   label: 'FLAT PUSH-UPS',     short: 'PUSH-UPS', code: 'PSH', unit: 'REPS', start: 12, inc: 1, cap: null, note: null },
  { key: 'pistol', label: 'PISTOL SQUATS',     short: 'PISTOLS',  code: 'PST', unit: 'REPS', start: 3,  inc: 1, cap: 3,    note: 'Neural skill work. 3 per leg max.' },
  { key: 'legs',   label: 'BODYWEIGHT SQUATS', short: 'SQUATS',   code: 'SQT', unit: 'REPS', start: 15, inc: 1, cap: 15,   note: 'Active recovery. Hard cap at 15.' },
  { key: 'core',   label: 'PLANK',             short: 'PLANK',    code: 'PLK', unit: 'SEC',  start: 60, inc: 5, cap: 60,   note: null },
]

const byKey = k => EXERCISES.find(e => e.key === k)

// Dynamic hybrid leg schedule: strength session 1 of the week is skill work
// (pistol squats), sessions 2-3 are active recovery (bodyweight squats).
export const legExerciseForSession = session => (session <= 1 ? byKey('pistol') : byKey('legs'))

// The four exercises in a given session's circuit (1-indexed session), in
// circuit order: pull, push, the session's leg variant, core.
export const exercisesForSession = session => [byKey('pull'), byKey('push'), legExerciseForSession(session), byKey('core')]

export const QUOTA = { park: 3, cardio: 2, soccer: 1 }

export const capLabel = ex => (ex.cap == null ? null : `${ex.cap}${ex.unit === 'SEC' ? 'S' : ''}`)

export const defaultTargets = () =>
  Object.fromEntries(EXERCISES.map(e => [e.key, Array(SETS).fill(e.start)]))

// ---------- dates ----------

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const atNoon = d => new Date(`${d}T12:00:00`) // noon dodges DST/UTC edge cases

export const todayStr = () => {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const weekdayOf = d => atNoon(d).getDay()
export const dayName = d => DAYS[weekdayOf(d)]
export const fmtDate = d => `${dayName(d)} ${d.slice(5)}`
export const dayDiff = (a, b) => Math.round((atNoon(a) - atNoon(b)) / 86400000)

export const uid = () =>
  globalThis.crypto?.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())

// ---------- validation ----------

export function consecutiveParkWarning(date, parkDates) {
  if (parkDates.includes(date)) {
    return `PARK ALREADY LOGGED ON ${fmtDate(date)} — NO SAME-DAY DOUBLES`
  }
  const adjacent = parkDates.find(d => Math.abs(dayDiff(date, d)) === 1)
  if (adjacent) {
    return `CONSECUTIVE PARK DAYS — SESSION ON ${fmtDate(adjacent)}. 48H RECOVERY RULE.`
  }
  return null
}

export function runDayWarning(date) {
  const wd = weekdayOf(date)
  if (wd === 5) return 'FRIDAY RUN — PRE-SOCCER. SAVE THE LEGS, SAVE THE SHINS.'
  if (wd === 0) return 'SUNDAY RUN — POST-SOCCER. IMPACT RECOVERY VIOLATION.'
  return null
}

export function quotaStatus(sessions) {
  const count = t => sessions.filter(s => s.type === t).length
  const parks = count('park')
  const cardio = count('cardio')
  const soccer = count('soccer')
  return {
    parks,
    cardio,
    soccer,
    met: parks >= QUOTA.park && cardio >= QUOTA.cardio && soccer >= QUOTA.soccer,
  }
}

// ---------- progression engine (V2) ----------

// Per exercise, looking at every logged park set this week:
//   - struggled flag / no parks / park quota not met  -> HOLD (targets unchanged)
//   - STRICT HOLD: if ANY logged set is below its positional target, the whole
//     exercise holds — no micro-progression
//   - otherwise MICRO-LOAD: +inc to the FIRST SET ONLY, unless a hard ceiling
//     blocks it (squats cap 15, plank cap 60s), in which case it holds at cap.
export function computeProgression(targets, sessions) {
  const parks = sessions.filter(s => s.type === 'park')
  const struggled = parks.some(s => s.struggled)
  const out = {}

  for (const ex of EXERCISES) {
    const t = targets[ex.key]
    const mk = (status, reason, next = [...t]) => ({ status, reason, next })

    if (struggled) {
      out[ex.key] = mk('hold', 'STRUGGLED FLAG — HOLD')
      continue
    }
    if (parks.length === 0) {
      out[ex.key] = mk('hold', 'NO PARK SESSIONS LOGGED')
      continue
    }
    if (parks.length < QUOTA.park) {
      out[ex.key] = mk('hold', `PARK QUOTA ${parks.length}/${QUOTA.park} — INCOMPLETE`)
      continue
    }
    const missed = parks.some(s => (s.sets?.[ex.key] ?? []).some((v, i) => v < t[i]))
    if (missed) {
      out[ex.key] = mk('hold', 'SET BELOW TARGET — STRICT HOLD')
      continue
    }
    // All logged sets met or exceeded target.
    if (ex.cap != null && t[0] + ex.inc > ex.cap) {
      out[ex.key] = mk('cap', `CEILING ${capLabel(ex)} — BUDGET LOCK`)
      continue
    }
    const next = [...t]
    next[0] += ex.inc
    out[ex.key] = mk('progress', `+${ex.inc} ${ex.unit} → SET 1`, next)
  }

  return { out, struggled, parkCount: parks.length }
}

export const STATUS_SYMBOL = { progress: '+', hold: '=', cap: '■' }

// ---------- activity heatmap (github-style) ----------

export const HEAT_WEEKS = 53

export const addDays = (date, n) => {
  const d = atNoon(date)
  d.setDate(d.getDate() + n)
  const p = x => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// The Monday→Sunday calendar week containing `date`. Derived live from the real
// date so the dashboard's week range advances on its own as the days pass.
export function weekRange(date) {
  const offsetToMon = (weekdayOf(date) + 6) % 7
  const start = addDays(date, -offsetToMon)
  return { start, end: addDays(start, 6) }
}

// Merge every "I worked out" source into one date -> {n, struggled, full, cardio}
// map: the persistent daily log (past weeks, already folded), legacy park dates
// from history (older saves predating the log), and the current week's live
// sessions. `full` flags a strength/soccer day (full green); `cardio` flags a
// run/swim. A cardio-only day renders light green, distinct from full workouts.
export function buildHeat(data) {
  const heat = {}
  // Every date the archive remembers as a park (strength) session — used to
  // recover the activity type of legacy folded log entries that predate the flags.
  const parkDates = new Set((data.history || []).flatMap(h => h.parkDates || []))
  const bump = (date, { n = 1, struggled = false, full = false, cardio = false }) => {
    const e = heat[date] || { n: 0, struggled: false, full: false, cardio: false }
    heat[date] = {
      n: e.n + n,
      struggled: e.struggled || struggled,
      full: e.full || full,
      cardio: e.cardio || cardio,
    }
  }
  for (const [date, e] of Object.entries(data.log || {})) {
    // Legacy entries predate the type flags. Recover the type so old cardio days
    // still read light green: a park day (or a struggled day, which only strength
    // sets) is full green; a Saturday is almost certainly soccer (full green);
    // any other folded day was cardio.
    const full = e.full ?? (parkDates.has(date) || !!e.struggled || weekdayOf(date) === 6)
    bump(date, { n: e.n || 0, struggled: !!e.struggled, full, cardio: e.cardio ?? !full })
  }
  for (const h of data.history || [])
    for (const date of h.parkDates || []) if (!data.log?.[date]) bump(date, { n: 1, full: true })
  for (const s of data.sessions || [])
    bump(s.date, { struggled: !!s.struggled, full: s.type !== 'cardio', cardio: s.type === 'cardio' })
  return heat
}

// 53 columns (weeks) × 7 rows (Sun..Sat) ending with the current week.
export function heatColumns(today) {
  const start = addDays(today, -weekdayOf(today) - (HEAT_WEEKS - 1) * 7)
  const cols = []
  for (let w = 0; w < HEAT_WEEKS; w++) {
    const days = []
    for (let r = 0; r < 7; r++) days.push(addDays(start, w * 7 + r))
    cols.push(days)
  }
  return cols
}

// Day status: actual logged sessions win; then manual day marks (cardio/missed)
// applied by the user to days with no logged session; else rest; future = empty.
export function heatStatus(date, heat, days, today) {
  if (date > today) return 'future'
  const h = heat[date]
  if (h?.n > 0) {
    if (h.struggled) return 'struggled'
    return h.full ? 'worked' : 'cardio'
  }
  if (days[date] === 'cardio') return 'cardio'
  if (days[date] === 'missed') return 'missed'
  return 'rest'
}

export function heatStats(heat, days, today) {
  const start = addDays(today, -weekdayOf(today) - (HEAT_WEEKS - 1) * 7)
  let worked = 0
  let missed = 0
  for (let i = 0; i < HEAT_WEEKS * 7; i++) {
    const date = addDays(start, i)
    if (date > today) break
    if (heat[date]?.n > 0) worked++
    else if (days[date] === 'missed') missed++
  }
  return { worked, missed }
}
