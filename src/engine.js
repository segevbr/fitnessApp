// Pure rules engine for the Floating Quota system. No React in here —
// everything is testable with plain function calls.
//
// V2 calibration: vertical-pull node unlocked, volume rebalanced, and hard
// structural ceilings introduced (squats / plank) to protect the Saturday
// soccer leg budget. The V1 "hardware upgrade / reset to 3x5" mechanic is
// retired — caps are now ceilings the targets hold at, not reset triggers.

export const SETS = 3
export const REST_SECONDS = 120

export const EXERCISES = [
  { key: 'pull', label: 'NEGATIVE PULL-UPS', short: 'PULL-UPS', code: 'PUL', unit: 'REPS', start: 5,  inc: 1, cap: null, note: null },
  { key: 'push', label: 'INCLINE PUSH-UPS',  short: 'PUSH-UPS', code: 'PSH', unit: 'REPS', start: 12, inc: 1, cap: null, note: null },
  { key: 'legs', label: 'BODYWEIGHT SQUATS', short: 'SQUATS',   code: 'SQT', unit: 'REPS', start: 15, inc: 1, cap: 15,   note: 'Strictly capped at 15 to protect pitch budget.' },
  { key: 'core', label: 'PLANK',             short: 'PLANK',    code: 'PLK', unit: 'SEC',  start: 60, inc: 5, cap: 60,   note: null },
]

export const QUOTA = { park: 3, cardioMin: 1, cardioMax: 2, soccer: 1 }

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
    met: parks >= QUOTA.park && cardio >= QUOTA.cardioMin && soccer >= QUOTA.soccer,
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
