// Pure rules engine for the Floating Quota system. No React in here —
// everything is testable with plain function calls.

export const SETS = 3
export const REST_SECONDS = 120

export const EXERCISES = [
  { key: 'rows',    label: 'ROWS',     unit: 'REPS', start: 5,  inc: 1, cap: 10,   hw: 'LOWER THE BAR' },
  { key: 'pushups', label: 'PUSH-UPS', unit: 'REPS', start: 5,  inc: 1, cap: 15,   hw: 'LOWER THE BAR/BENCH' },
  { key: 'squats',  label: 'SQUATS',   unit: 'REPS', start: 5,  inc: 1, cap: 15,   hw: 'LOWER THE BAR/BENCH' },
  { key: 'core',    label: 'CORE',     unit: 'SEC',  start: 30, inc: 5, cap: null, hw: null },
]

export const QUOTA = { park: 3, cardioMin: 1, cardioMax: 2, soccer: 1 }

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

// ---------- progression engine ----------

// Micro-loading ladder: each successful week adds one increment to the first
// (leftmost) set still sitting at the lowest target, so 3x5 climbs
// [6,5,5] -> [6,6,5] -> [6,6,6] -> [7,6,6] ... until every set reaches the
// hardware cap (3x10 rows, 3x15 push-ups/squats) and the reset fires.
export const nextSlot = targets => targets.indexOf(Math.min(...targets))

export function computeProgression(targets, sessions) {
  const parks = sessions.filter(s => s.type === 'park')
  const struggled = parks.some(s => s.struggled)
  const out = {}

  for (const ex of EXERCISES) {
    const t = targets[ex.key]
    const mk = (status, reason, next = [...t]) => ({ status, reason, next })

    if (struggled) {
      out[ex.key] = mk('hold', 'STRUGGLED FLAG SET — HOLD')
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
      out[ex.key] = mk('hold', 'TARGET REPS MISSED')
      continue
    }

    const next = [...t]
    const slot = nextSlot(next)
    next[slot] += ex.inc
    if (ex.cap && next.every(v => v >= ex.cap)) {
      out[ex.key] = mk(
        'upgrade',
        `HIT ${SETS}×${ex.cap} — ${ex.hw}. RESET TO ${SETS}×${ex.start}.`,
        Array(SETS).fill(ex.start),
      )
    } else {
      out[ex.key] = mk('progress', `+${ex.inc} ${ex.unit} → SET ${slot + 1}`, next)
    }
  }

  return { out, struggled, parkCount: parks.length }
}

export const STATUS_SYMBOL = { progress: '+', hold: '=', upgrade: '⟲' }
