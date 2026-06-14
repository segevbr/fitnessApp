import { useEffect, useMemo, useRef, useState } from 'react'
import Auth from './Auth'
import { supabase } from './supabase'
import {
  Check,
  ChevronRight,
  Dumbbell,
  Flag,
  Footprints,
  HeartPulse,
  Lock,
  Minus,
  Moon,
  Plus,
  RotateCcw,
  SkipForward,
  Sun,
  Timer,
  TrendingUp,
  TriangleAlert,
  Trophy,
  Unlock,
  Waves,
  X,
} from 'lucide-react'
import {
  EXERCISES,
  QUOTA,
  REST_SECONDS,
  SETS,
  STATUS_SYMBOL,
  buildHeat,
  computeProgression,
  consecutiveParkWarning,
  dayName,
  defaultTargets,
  fmtDate,
  heatColumns,
  heatStats,
  heatStatus,
  quotaStatus,
  runDayWarning,
  todayStr,
  uid,
} from './engine'

const STORE_KEY = 'floating-quota-v2'
const LEGACY_KEY = 'floating-quota-v1'

const freshState = () => ({
  week: 1,
  targets: defaultTargets(),
  sessions: [],
  history: [],
  // Persistent daily workout log for the activity heatmap. Survives week
  // rollovers (sessions[] is cleared each week, this is not). date -> {n, struggled}.
  log: {},
  // Manual "missed" marks the user taps on the heatmap. date -> 'missed'.
  days: {},
})

const isV2Targets = t =>
  t && typeof t === 'object' && EXERCISES.every(e => Array.isArray(t[e.key]))

// Bring any persisted state — from localStorage OR Supabase — onto the V2 schema.
// A V1 save uses retired movements (rows/push-ups under the old reset model) that
// can't be replayed onto the new vertical-pull baseline, so we adopt the V2 targets
// while preserving the week counter and the display-only archive; stale sessions are
// dropped (they key on exercises that no longer exist). Already-V2 state passes through.
const migrate = raw => {
  if (!raw || typeof raw !== 'object') return freshState()
  if (isV2Targets(raw.targets)) return { ...freshState(), ...raw }
  return {
    ...freshState(),
    week: typeof raw.week === 'number' ? raw.week : 1,
    history: Array.isArray(raw.history) ? raw.history : [],
  }
}

const loadState = () => {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed?.targets && Array.isArray(parsed.sessions)) return migrate(parsed)
    }
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const migrated = migrate(JSON.parse(legacy))
      localStorage.setItem(STORE_KEY, JSON.stringify(migrated))
      return migrated
    }
  } catch {
    /* corrupted store falls through to fresh state */
  }
  return freshState()
}

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'square'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.06, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5)
    osc.start()
    osc.stop(ctx.currentTime + 0.5)
  } catch {
    /* audio is best-effort */
  }
  try {
    navigator.vibrate?.([150, 80, 150])
  } catch {
    /* vibration is best-effort */
  }
}

const clampInt = v => Math.max(0, Math.round(Number(v) || 0))

// ---------- shared atoms ----------

// Zinc scale is symmetric around 500: dark uses N, light uses (1000-N).
// BTN.primary inverts (light bg/dark text ↔ dark bg/light text).
const BTN = {
  primary:
    'border border-zinc-900 bg-zinc-900 text-zinc-50 hover:bg-transparent hover:text-zinc-900 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:text-zinc-100 transition-colors',
  ghost:
    'border border-zinc-300 text-zinc-600 hover:border-zinc-700 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-300 dark:hover:text-zinc-100 transition-colors',
  warn: 'border border-amber-400 bg-amber-400 text-zinc-950 hover:bg-transparent hover:text-amber-400 transition-colors',
}

function Btn({ kind = 'ghost', className = '', ...props }) {
  return (
    <button
      type="button"
      className={`flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold tracking-[0.2em] uppercase disabled:cursor-not-allowed disabled:opacity-30 ${BTN[kind]} ${className}`}
      {...props}
    />
  )
}

function Panel({ title, right, children }) {
  return (
    <section className="border border-zinc-200 bg-zinc-100/50 dark:border-zinc-800 dark:bg-zinc-900/30">
      <header className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <h2 className="text-[10px] tracking-[0.3em] text-zinc-500">{title}</h2>
        {right}
      </header>
      <div className="p-3">{children}</div>
    </section>
  )
}

function WarnBox({ children, tone = 'amber' }) {
  const cls =
    tone === 'red' ? 'border-red-500/70 bg-red-500/10 text-red-400' : 'border-amber-400/70 bg-amber-400/10 text-amber-400'
  return (
    <div className={`flex items-start gap-2 border px-3 py-2 text-[11px] leading-relaxed tracking-wide ${cls}`}>
      <TriangleAlert size={14} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

function NumInput({ value, onChange, step = 1, wide = false, grow = false }) {
  const bump = d => onChange(Math.max(0, (Number(value) || 0) + d))
  const btn =
    'px-3 py-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 active:bg-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:active:bg-zinc-700'
  return (
    <div
      className={`items-stretch border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950 ${
        grow ? 'flex flex-1' : 'inline-flex'
      }`}
    >
      <button type="button" onClick={() => bump(-step)} className={btn} aria-label="decrease">
        <Minus size={13} />
      </button>
      <input
        type="number"
        min="0"
        value={value}
        onChange={e => onChange(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
        className={`${
          wide ? 'w-20 py-2 text-2xl' : grow ? 'w-full min-w-0 py-1.5 text-base' : 'w-12 py-1 text-sm'
        } bg-transparent text-center font-bold text-zinc-900 tabular-nums outline-none dark:text-zinc-100`}
      />
      <button type="button" onClick={() => bump(step)} className={btn} aria-label="increase">
        <Plus size={13} />
      </button>
    </div>
  )
}

function DateField({ value, onChange }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] tracking-[0.25em] text-zinc-500">DATE</span>
      <div className="flex items-center gap-3">
        <input
          type="date"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-400"
        />
        <span className="text-xs tracking-widest text-zinc-500">{dayName(value)}</span>
      </div>
    </label>
  )
}

function Modal({ onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 p-3 backdrop-blur-sm">
      <div className="mx-auto my-6 w-full max-w-md border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950">{children}</div>
      <button type="button" className="hidden" onClick={onClose} aria-hidden />
    </div>
  )
}

function ModalHeader({ icon: Icon, title, onClose }) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
        <Icon size={14} className="text-emerald-400" />
        <h2 className="text-xs font-bold tracking-[0.25em]">{title}</h2>
      </div>
      <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-900 dark:text-zinc-600 dark:hover:text-zinc-100" aria-label="close">
        <X size={16} />
      </button>
    </header>
  )
}

// ---------- park session logger ----------

function ParkLogger({ targets, parkDates, parkCount, onSave, onClose }) {
  const steps = useMemo(() => EXERCISES.flatMap(ex => [0, 1, 2].map(set => ({ ex, set }))), [])
  const [phase, setPhase] = useState('date') // date -> live -> review
  const [date, setDate] = useState(todayStr())
  const [step, setStep] = useState(0)
  const [values, setValues] = useState(() =>
    Object.fromEntries(EXERCISES.map(e => [e.key, Array(SETS).fill(null)])),
  )
  const [input, setInput] = useState(targets[EXERCISES[0].key][0])
  const [restEnd, setRestEnd] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [skips, setSkips] = useState(0)
  const [struggled, setStruggled] = useState(false)

  const cur = steps[Math.min(step, steps.length - 1)]
  const next = steps[step + 1]
  const warning = consecutiveParkWarning(date, parkDates)
  const resting = restEnd != null
  const remaining = resting ? Math.max(0, Math.ceil((restEnd - now) / 1000)) : 0

  useEffect(() => {
    if (!resting) return undefined
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [resting])

  useEffect(() => {
    if (resting && now >= restEnd) {
      beep()
      advance()
    }
  })

  function advance() {
    setRestEnd(null)
    setNow(Date.now())
    const n = step + 1
    if (n >= steps.length) {
      setPhase('review')
      return
    }
    setStep(n)
    setInput(targets[steps[n].ex.key][steps[n].set])
  }

  function logSet() {
    const v = clampInt(input)
    setValues(prev => {
      const copy = { ...prev, [cur.ex.key]: [...prev[cur.ex.key]] }
      copy[cur.ex.key][cur.set] = v
      return copy
    })
    if (step === steps.length - 1) {
      setPhase('review')
    } else {
      const t = Date.now()
      setNow(t)
      setRestEnd(t + REST_SECONDS * 1000)
    }
  }

  function quickLog() {
    setValues(Object.fromEntries(EXERCISES.map(e => [e.key, [...targets[e.key]]])))
    setPhase('review')
  }

  function close() {
    const dirty = phase !== 'date' && Object.values(values).some(arr => arr.some(v => v != null))
    if (!dirty || window.confirm('Discard the park session in progress?')) onClose()
  }

  const dots = steps.map((s, i) => {
    const logged = values[s.ex.key][s.set] != null
    const active = i === (resting ? step + 1 : step) && phase === 'live'
    return { logged, active, group: s.set === 0 && i !== 0 }
  })

  return (
    <Modal onClose={close}>
      <ModalHeader icon={Dumbbell} title="PARK SESSION // STRENGTH" onClose={close} />
      <div className="space-y-3 p-3">
        {phase === 'date' && (
          <>
            <DateField value={date} onChange={setDate} />
            {warning && <WarnBox>{warning}</WarnBox>}
            {parkCount >= QUOTA.park && (
              <WarnBox>PARK QUOTA ALREADY MET {parkCount}/{QUOTA.park} — THIS LOGS AS EXTRA VOLUME</WarnBox>
            )}
            <div className="border border-zinc-200 px-3 py-2 text-[11px] leading-relaxed text-zinc-500 dark:border-zinc-800">
              CIRCUIT ▸{' '}
              {EXERCISES.map(e => `${e.label} ${SETS}×[${targets[e.key].join('·')}]${e.unit === 'SEC' ? 'S' : ''}`).join(
                ' ▸ ',
              )}
              <div className="mt-1 text-zinc-400 dark:text-zinc-600">MANDATORY {REST_SECONDS / 60}:00 REST BETWEEN SETS.</div>
            </div>
            <Btn kind={warning ? 'warn' : 'primary'} className="w-full" onClick={() => setPhase('live')}>
              {warning ? 'OVERRIDE & START' : 'START CIRCUIT'} <ChevronRight size={14} />
            </Btn>
            <Btn kind="ghost" className="w-full" onClick={quickLog}>
              QUICK LOG — ENTER REPS, SKIP TIMER
            </Btn>
          </>
        )}

        {phase === 'live' && (
          <>
            <div className="flex items-end gap-1">
              {dots.map((d, i) => (
                <span
                  key={i}
                  className={`h-3 w-3 border ${d.group ? 'ml-2' : ''} ${
                    d.logged
                      ? 'border-emerald-400 bg-emerald-400'
                      : d.active
                        ? 'animate-pulse border-zinc-900 bg-zinc-900/20 dark:border-zinc-100 dark:bg-zinc-100/20'
                        : 'border-zinc-200 dark:border-zinc-800'
                  }`}
                />
              ))}
              <span className="ml-auto text-[10px] tracking-widest text-zinc-400 dark:text-zinc-600">
                {fmtDate(date)} · SET {Math.min(step + 1, steps.length)}/{steps.length}
              </span>
            </div>

            {!resting && (
              <form
                onSubmit={e => {
                  e.preventDefault()
                  logSet()
                }}
                className="space-y-3 border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-[10px] tracking-[0.25em] text-zinc-500">
                      {cur.ex.label} · {EXERCISES.findIndex(e => e.key === cur.ex.key) + 1}/4
                    </div>
                    <div className="text-2xl font-bold tracking-widest text-zinc-900 dark:text-zinc-100">{cur.ex.short}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] tracking-[0.25em] text-zinc-500">TARGET</div>
                    <div className="text-2xl font-bold text-emerald-400 tabular-nums">
                      {targets[cur.ex.key][cur.set]}
                      <span className="ml-1 text-[10px] text-zinc-500">{cur.ex.unit}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <NumInput value={input} onChange={setInput} step={cur.ex.inc} wide />
                  <div className="text-[10px] leading-relaxed tracking-widest text-zinc-400 dark:text-zinc-600">
                    {[0, 1, 2]
                      .filter(s => values[cur.ex.key][s] != null)
                      .map(s => `S${s + 1}:${values[cur.ex.key][s]}✓`)
                      .join(' ') || 'NO SETS LOGGED'}
                  </div>
                </div>
                {cur.ex.note && (
                  <p className="border-l-2 border-zinc-300 pl-2 text-[10px] leading-relaxed tracking-wide text-zinc-500 dark:border-zinc-700">
                    {cur.ex.note}
                  </p>
                )}
                <Btn kind="primary" className="w-full" onClick={logSet}>
                  <Check size={14} /> LOG SET
                  {step < steps.length - 1 && <span className="text-[10px] opacity-70">▸ STARTS 2:00 REST</span>}
                </Btn>
              </form>
            )}

            {resting && (
              <div className="space-y-3 border border-emerald-400/40 bg-emerald-400/5 p-3 text-center">
                <div className="flex items-center justify-center gap-2 text-[10px] tracking-[0.3em] text-emerald-400">
                  <Timer size={12} /> REST PROTOCOL — MANDATORY
                </div>
                <div className="text-6xl font-bold text-zinc-900 tabular-nums dark:text-zinc-100">
                  {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
                </div>
                <div className="h-1 w-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className="h-1 bg-emerald-400 transition-all duration-200"
                    style={{ width: `${((REST_SECONDS - remaining) / REST_SECONDS) * 100}%` }}
                  />
                </div>
                {next && (
                  <div className="text-[11px] tracking-widest text-zinc-600 dark:text-zinc-400">
                    NEXT ▸ {next.ex.short} · SET {next.set + 1}/{SETS} · TARGET {targets[next.ex.key][next.set]}{' '}
                    {next.ex.unit}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSkips(s => s + 1)
                    advance()
                  }}
                  className="mx-auto flex items-center gap-1 text-[10px] tracking-[0.25em] text-zinc-400 hover:text-amber-400 dark:text-zinc-600"
                >
                  <SkipForward size={11} /> SKIP REST — LOGGED AS VIOLATION
                </button>
              </div>
            )}
          </>
        )}

        {phase === 'review' && (
          <>
            <div className="text-[10px] tracking-[0.25em] text-zinc-500">REVIEW ▸ {fmtDate(date)}</div>
            <div className="space-y-2.5">
              {EXERCISES.map(ex => (
                <div
                  key={ex.key}
                  className="space-y-1.5 border-b border-zinc-200/70 pb-2.5 last:border-b-0 last:pb-0 dark:border-zinc-800/70"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] tracking-widest text-zinc-700 dark:text-zinc-300">{ex.short}</span>
                    <span className="text-[10px] tracking-widest text-zinc-400 tabular-nums dark:text-zinc-600">
                      TARGET {targets[ex.key].join('·')}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map(s => (
                      <NumInput
                        key={s}
                        grow
                        step={ex.inc}
                        value={values[ex.key][s] ?? 0}
                        onChange={v =>
                          setValues(prev => {
                            const copy = { ...prev, [ex.key]: [...prev[ex.key]] }
                            copy[ex.key][s] = v
                            return copy
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {skips > 0 && <WarnBox>REST TIMER SKIPPED ×{skips} — RECOVERY PROTOCOL VIOLATED</WarnBox>}
            <Btn
              kind={struggled ? 'warn' : 'ghost'}
              className="w-full"
              onClick={() => setStruggled(s => !s)}
            >
              <Flag size={13} /> {struggled ? 'STRUGGLED — PROGRESSION WILL HOLD' : 'FLAG AS STRUGGLED'}
            </Btn>
            <Btn
              kind="primary"
              className="w-full"
              onClick={() =>
                onSave({
                  id: uid(),
                  type: 'park',
                  date,
                  sets: Object.fromEntries(
                    EXERCISES.map(ex => [ex.key, values[ex.key].map(clampInt)]),
                  ),
                  struggled,
                  restSkips: skips,
                })
              }
            >
              <Check size={14} /> SAVE SESSION
            </Btn>
          </>
        )}
      </div>
    </Modal>
  )
}

// ---------- cardio / soccer logger ----------

function CardioLogger({ kind, sessions, onSave, onClose }) {
  const soccer = kind === 'soccer'
  const [date, setDate] = useState(todayStr())
  const [shin, setShin] = useState('good')
  const [mode, setMode] = useState(soccer ? null : 'run')
  const [durMin, setDurMin] = useState('')
  const [durSec, setDurSec] = useState('')
  const [distance, setDistance] = useState('')
  const [avgHr, setAvgHr] = useState('')

  const tight = shin === 'tight'

  useEffect(() => {
    if (tight && mode === 'run') setMode('swim')
  }, [tight, mode])

  const q = quotaStatus(sessions)
  const warnings = []
  const runWarn = !soccer && mode === 'run' ? runDayWarning(date) : null
  if (runWarn) warnings.push(runWarn)
  if (!soccer && q.cardio >= QUOTA.cardioMax)
    warnings.push(`CARDIO QUOTA MAX REACHED ${q.cardio}/${QUOTA.cardioMax} — THIS LOGS AS EXTRA LOAD`)
  if (soccer && q.soccer >= QUOTA.soccer) warnings.push('SOCCER QUOTA ALREADY MET — EXTRA MATCH')
  if (soccer && dayName(date) !== 'SAT') warnings.push(`SOCCER IS SLOTTED SATURDAY — SELECTED ${dayName(date)}`)
  if (soccer && tight) warnings.push('TIGHT SHINS + MATCH IMPACT — MONITOR OR SIT OUT')

  const valid = Number(durMin) > 0 || Number(durSec) > 0
  const Icon = soccer ? Trophy : HeartPulse

  const segBtn = (active, disabled, cls) =>
    `flex flex-1 items-center justify-center gap-2 border px-3 py-2 text-xs font-bold tracking-[0.2em] transition-colors ${
      disabled
        ? 'cursor-not-allowed border-zinc-200 text-zinc-300 dark:border-zinc-800 dark:text-zinc-700'
        : active
          ? cls
          : 'border-zinc-300 text-zinc-500 hover:text-zinc-800 dark:border-zinc-700 dark:hover:text-zinc-200'
    }`

  return (
    <Modal onClose={onClose}>
      <ModalHeader icon={Icon} title={soccer ? 'SOCCER // MATCH DAY' : 'CARDIO // ENGINE WORK'} onClose={onClose} />
      <div className="space-y-3 p-3">
        <DateField value={date} onChange={setDate} />

        <div>
          <span className="mb-1 block text-[10px] tracking-[0.25em] text-zinc-500">SHIN STATUS</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setShin('good')}
              className={segBtn(!tight, false, 'border-emerald-400 bg-emerald-400 text-zinc-950')}
            >
              <Check size={13} /> GOOD
            </button>
            <button
              type="button"
              onClick={() => setShin('tight')}
              className={segBtn(tight, false, 'border-red-500 bg-red-500 text-zinc-950')}
            >
              <TriangleAlert size={13} /> TIGHT
            </button>
          </div>
        </div>

        {tight && (
          <WarnBox tone="red">
            SHIN SPLINT PROTOCOL ACTIVE — RUN LOCKED{!soccer && ', SWIM FORCED'}. NO IMPACT UNTIL CLEAR.
          </WarnBox>
        )}

        {!soccer && (
          <div>
            <span className="mb-1 block text-[10px] tracking-[0.25em] text-zinc-500">MODE</span>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={tight}
                onClick={() => setMode('run')}
                className={segBtn(mode === 'run', tight, 'border-zinc-900 bg-zinc-900 text-zinc-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950')}
              >
                {tight ? <Lock size={13} /> : <Footprints size={13} />} RUN
              </button>
              <button
                type="button"
                onClick={() => setMode('swim')}
                className={segBtn(mode === 'swim', false, 'border-sky-400 bg-sky-400 text-zinc-950')}
              >
                <Waves size={13} /> SWIM
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div>
            <span className="mb-1 block text-[9px] tracking-[0.2em] text-zinc-500">DURATION</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="0"
                placeholder="0"
                value={durMin}
                onChange={e => setDurMin(e.target.value)}
                className="w-16 border border-zinc-300 bg-white px-2 py-1.5 text-sm font-bold text-zinc-900 tabular-nums outline-none focus:border-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-400"
              />
              <span className="font-bold text-zinc-400 dark:text-zinc-600">:</span>
              <input
                type="number"
                min="0"
                max="59"
                placeholder="00"
                value={durSec}
                onChange={e => setDurSec(Math.min(59, Math.max(0, Number(e.target.value) || 0)) || '')}
                className="w-16 border border-zinc-300 bg-white px-2 py-1.5 text-sm font-bold text-zinc-900 tabular-nums outline-none focus:border-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-400"
              />
              <span className="text-[9px] tracking-widest text-zinc-400 dark:text-zinc-600">MIN : SEC</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['DISTANCE KM', distance, setDistance, '0.1'],
              ['AVG HR BPM', avgHr, setAvgHr, '1'],
            ].map(([label, value, set, step]) => (
              <label key={label} className="block">
                <span className="mb-1 block text-[9px] tracking-[0.2em] text-zinc-500">{label}</span>
                <input
                  type="number"
                  min="0"
                  step={step}
                  placeholder="0"
                  value={value}
                  onChange={e => set(e.target.value)}
                  className="w-full border border-zinc-300 bg-white px-2 py-1.5 text-sm font-bold text-zinc-900 tabular-nums outline-none focus:border-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-400"
                />
              </label>
            ))}
          </div>
        </div>

        {warnings.map(w => (
          <WarnBox key={w}>{w}</WarnBox>
        ))}

        <Btn
          kind={warnings.length ? 'warn' : 'primary'}
          className="w-full"
          disabled={!valid}
          onClick={() =>
            onSave({
              id: uid(),
              type: kind,
              date,
              mode: soccer ? null : mode,
              duration: (Number(durMin) || 0) * 60 + (Number(durSec) || 0),
              distance: Number(distance) || 0,
              avgHr: clampInt(avgHr),
              shin,
            })
          }
        >
          <Check size={14} /> {warnings.length ? 'OVERRIDE & LOG' : 'LOG SESSION'}
        </Btn>
        {!valid && <p className="text-center text-[10px] tracking-widest text-zinc-400 dark:text-zinc-600">DURATION REQUIRED</p>}
      </div>
    </Modal>
  )
}

// ---------- week review / progression ----------

function WeekReview({ data, onConfirm, onClose }) {
  const preview = useMemo(() => computeProgression(data.targets, data.sessions), [data])
  const q = quotaStatus(data.sessions)

  const statusCls = { progress: 'text-emerald-400', hold: 'text-zinc-500', cap: 'text-amber-400' }

  return (
    <Modal onClose={onClose}>
      <ModalHeader icon={TrendingUp} title={`WEEK ${String(data.week).padStart(2, '0')} // PROGRESSION ENGINE`} onClose={onClose} />
      <div className="space-y-3 p-3">
        <div className="flex items-center justify-between border border-zinc-200 px-3 py-2 text-[11px] tracking-widest dark:border-zinc-800">
          <span className="text-zinc-600 dark:text-zinc-400">
            PARK {q.parks}/{QUOTA.park} · CARDIO {q.cardio}/{QUOTA.cardioMin}–{QUOTA.cardioMax} · SOCCER {q.soccer}/
            {QUOTA.soccer}
          </span>
          <span className={q.met ? 'font-bold text-emerald-400' : 'font-bold text-amber-400'}>
            {q.met ? 'QUOTA MET' : 'INCOMPLETE'}
          </span>
        </div>

        {preview.struggled && (
          <WarnBox>STRUGGLED FLAG ON RECORD — ALL TARGETS HOLD THIS ROLLOVER</WarnBox>
        )}

        <div className="space-y-1">
          {EXERCISES.map(ex => {
            const p = preview.out[ex.key]
            return (
              <div key={ex.key} className="border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <div className="flex items-center justify-between text-sm">
                  <span className="w-16 text-[10px] tracking-widest text-zinc-700 dark:text-zinc-300">{ex.short}</span>
                  <span className="flex items-center gap-2 font-bold tabular-nums">
                    <span className="text-zinc-500">{data.targets[ex.key].join('·')}</span>
                    <ChevronRight size={12} className="text-zinc-400 dark:text-zinc-600" />
                    <span className={statusCls[p.status]}>{p.next.join('·')}</span>
                  </span>
                </div>
                <div className={`mt-0.5 text-right text-[10px] tracking-widest ${statusCls[p.status]}`}>
                  {p.status === 'hold' ? `HOLD — ${p.reason}` : p.reason}
                </div>
              </div>
            )
          })}
        </div>

        <div className="border border-zinc-200 px-3 py-2 text-[10px] leading-relaxed tracking-wide text-zinc-500 dark:border-zinc-800">
          V2 ENGINE ▸ STRICT HOLD IF ANY SET MISSED · +1 TO SET 1 ONLY · SQUATS CAP 15 · PLANK CAP 60S
        </div>

        <Btn kind="primary" className="w-full" onClick={() => onConfirm(preview)}>
          <Check size={14} /> ARCHIVE WEEK & APPLY TARGETS
        </Btn>
        <Btn className="w-full" onClick={onClose}>
          CANCEL — KEEP WEEK OPEN
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- dashboard pieces ----------

function QuotaRow({ icon: Icon, label, sub, blocks, count, onLog }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <Icon size={15} className="shrink-0 text-zinc-500" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-bold tracking-[0.2em] text-zinc-800 dark:text-zinc-200">{label}</div>
        <div className="truncate text-[10px] tracking-widest text-zinc-400 dark:text-zinc-600">{sub}</div>
      </div>
      <div className="flex shrink-0 gap-1">
        {blocks.map((b, i) => (
          <span
            key={i}
            className={`h-3.5 w-3.5 border ${
              b === 'done'
                ? 'border-emerald-400 bg-emerald-400'
                : b === 'over'
                  ? 'border-amber-400 bg-amber-400'
                  : b === 'optional'
                    ? 'border-dashed border-zinc-300 dark:border-zinc-700'
                    : 'border-zinc-300 dark:border-zinc-700'
            }`}
          />
        ))}
      </div>
      <span className="w-11 shrink-0 text-right text-xs font-bold text-zinc-700 tabular-nums dark:text-zinc-300">{count}</span>
      <button
        type="button"
        onClick={onLog}
        className="flex shrink-0 items-center gap-1 border border-zinc-300 px-2.5 py-1.5 text-[10px] font-bold tracking-widest text-zinc-700 hover:border-emerald-400 hover:text-emerald-400 active:bg-emerald-400/10 dark:border-zinc-700 dark:text-zinc-300"
      >
        <Plus size={11} /> LOG
      </button>
    </div>
  )
}

const blocksFor = (count, required, optional = 0) => {
  const total = required + optional
  return Array.from({ length: Math.max(total, count) }, (_, i) => {
    if (i < count) return i < total ? 'done' : 'over'
    return i < required ? 'todo' : 'optional'
  })
}

const fmtDuration = secs => {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function SessionLine({ s, onDelete }) {
  const detail =
    s.type === 'park'
      ? EXERCISES.map(ex => `${ex.code} ${(s.sets[ex.key] ?? []).join('/')}`).join(' · ')
      : `${fmtDuration(s.duration)} · ${s.distance}KM · ${s.avgHr || '—'}BPM`
  const tag =
    s.type === 'park' ? 'PARK' : s.type === 'soccer' ? 'SOCCER' : s.mode === 'swim' ? 'SWIM' : 'RUN'
  const tagCls =
    s.type === 'park'
      ? 'text-emerald-400 border-emerald-400/50'
      : s.type === 'soccer'
        ? 'text-amber-400 border-amber-400/50'
        : s.mode === 'swim'
          ? 'text-sky-400 border-sky-400/50'
          : 'text-zinc-800 border-zinc-500 dark:text-zinc-200'
  return (
    <div className="flex items-center gap-2 py-1 text-[11px]">
      <span className="w-14 shrink-0 text-zinc-500 tabular-nums">{fmtDate(s.date)}</span>
      <span className={`shrink-0 border px-1.5 py-0.5 text-[9px] font-bold tracking-widest ${tagCls}`}>{tag}</span>
      <span className="min-w-0 flex-1 truncate text-zinc-600 tabular-nums dark:text-zinc-400">{detail}</span>
      {s.type !== 'park' && s.shin === 'tight' && (
        <span className="shrink-0 text-[9px] font-bold tracking-widest text-red-400">SHIN:TIGHT</span>
      )}
      {s.struggled && <Flag size={11} className="shrink-0 text-amber-400" />}
      {s.restSkips > 0 && (
        <span className="shrink-0 text-[9px] tracking-widest text-amber-400">SKIP×{s.restSkips}</span>
      )}
      <button type="button" onClick={onDelete} className="shrink-0 text-zinc-300 hover:text-red-400 dark:text-zinc-700" aria-label="delete">
        <X size={12} />
      </button>
    </div>
  )
}

// ---------- activity heatmap (github-style) ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const HEAT_CELL = {
  future: 'bg-zinc-100 dark:bg-zinc-800/40',
  rest: 'bg-sky-100 dark:bg-sky-900',
  missed: 'bg-red-500 dark:bg-red-600',
  struggled: 'bg-amber-400 dark:bg-amber-500',
  w1: 'bg-emerald-400 dark:bg-emerald-700',
  w2: 'bg-emerald-500 dark:bg-emerald-500',
  w3: 'bg-emerald-600 dark:bg-emerald-400',
}

const HEAT_LABEL = {
  future: '',
  rest: 'rest day',
  missed: 'MISSED',
  struggled: 'worked out · struggled',
  w1: '1 workout',
  w2: '2 workouts',
  w3: '3+ workouts',
}

function HeatSwatch({ status, label }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-[10px] w-[10px] rounded-[2px] ${HEAT_CELL[status]}`} />
      {label}
    </span>
  )
}

function Heatmap({ heat, days, today, onToggle }) {
  const cols = useMemo(() => heatColumns(today), [today])
  const scroller = useRef(null)
  // open scrolled to the most recent week, like GitHub
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth
  }, [])

  return (
    <div>
      <div ref={scroller} className="overflow-x-auto pb-1">
        <div className="inline-block">
          <div className="mb-1 flex gap-[3px] pl-7">
            {cols.map((col, w) => {
              const m = Number(col[0].slice(5, 7)) - 1
              const prevM = w > 0 ? Number(cols[w - 1][0].slice(5, 7)) - 1 : -1
              return (
                <div key={col[0]} className="relative w-[11px]">
                  {m !== prevM && (
                    <span className="absolute left-0 whitespace-nowrap text-[9px] tracking-wide text-zinc-400 dark:text-zinc-500">
                      {MONTHS[m]}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex gap-[3px]">
            <div className="mr-1 flex w-6 flex-col gap-[3px] text-[8px] leading-[11px] text-zinc-400 dark:text-zinc-500">
              {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((d, r) => (
                <span key={r} className="h-[11px]">
                  {d}
                </span>
              ))}
            </div>
            {cols.map(col => (
              <div key={col[0]} className="flex flex-col gap-[3px]">
                {col.map(date => {
                  const status = heatStatus(date, heat, days, today)
                  const clickable = status === 'rest' || status === 'missed'
                  const isToday = date === today
                  return (
                    <button
                      key={date}
                      type="button"
                      disabled={!clickable}
                      onClick={() => clickable && onToggle(date)}
                      title={status === 'future' ? fmtDate(date) : `${fmtDate(date)} — ${HEAT_LABEL[status]}`}
                      className={`h-[11px] w-[11px] rounded-[2px] ${HEAT_CELL[status]} ${
                        isToday ? 'ring-1 ring-zinc-900 dark:ring-zinc-100' : ''
                      } ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[9px] tracking-widest text-zinc-400 dark:text-zinc-500">
        <div className="flex items-center gap-3">
          <HeatSwatch status="rest" label="REST" />
          <HeatSwatch status="missed" label="MISSED" />
          <HeatSwatch status="struggled" label="STRUGGLED" />
        </div>
        <div className="flex items-center gap-1">
          LESS
          <span className={`h-[11px] w-[11px] rounded-[2px] ${HEAT_CELL.w1}`} />
          <span className={`h-[11px] w-[11px] rounded-[2px] ${HEAT_CELL.w2}`} />
          <span className={`h-[11px] w-[11px] rounded-[2px] ${HEAT_CELL.w3}`} />
          MORE
        </div>
      </div>
      <p className="mt-1 text-[9px] tracking-widest text-zinc-300 dark:text-zinc-600">
        TAP A REST DAY TO FLAG IT MISSED
      </p>
    </div>
  )
}

// ---------- app ----------

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-mono dark:bg-zinc-950">
      <span className="animate-pulse text-[10px] tracking-[0.3em] text-zinc-500">LOADING...</span>
    </div>
  )
}

export default function App() {
  const [data, setData] = useState(loadState)
  const [panel, setPanel] = useState(null) // park | cardio | soccer | review
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('fq-theme')
    if (stored) return stored === 'dark'
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
  })
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [syncStatus, setSyncStatus] = useState('idle') // 'idle' | 'syncing' | 'error'

  // Theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.background = dark ? '#09090b' : '#fafafa'
    localStorage.setItem('fq-theme', dark ? 'dark' : 'light')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#09090b' : '#fafafa')
  }, [dark])

  // Auth state listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      if (event === 'SIGNED_OUT') setData(freshState())
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load state from Supabase after sign-in
  useEffect(() => {
    if (!user) return
    supabase
      .from('user_data')
      .select('state')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data: row }) => {
        if (row?.state) setData(migrate(row.state))
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // Sync: localStorage immediately, Supabase debounced 1.2 s
  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(data))
    if (!user) return
    setSyncStatus('syncing')
    const t = setTimeout(async () => {
      const { error } = await supabase.from('user_data').upsert({
        user_id: user.id,
        state: data,
        updated_at: new Date().toISOString(),
      })
      setSyncStatus(error ? 'error' : 'idle')
    }, 1200)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, user?.id])

  const q = quotaStatus(data.sessions)
  const parkDates = useMemo(
    () => [
      ...data.sessions.filter(s => s.type === 'park').map(s => s.date),
      ...data.history.flatMap(h => h.parkDates ?? []),
    ],
    [data],
  )
  const sorted = useMemo(() => [...data.sessions].sort((a, b) => a.date.localeCompare(b.date)), [data.sessions])

  const today = todayStr()
  const heat = useMemo(() => buildHeat(data), [data])
  const activity = useMemo(() => heatStats(heat, data.days || {}, today), [heat, data.days, today])
  const toggleMissed = date =>
    setData(d => {
      const days = { ...(d.days || {}) }
      if (days[date] === 'missed') delete days[date]
      else days[date] = 'missed'
      return { ...d, days }
    })

  const addSession = s => {
    setData(d => ({ ...d, sessions: [...d.sessions, s] }))
    setPanel(null)
  }

  const confirmWeek = preview => {
    setData(d => {
      // fold the finished week's sessions into the persistent daily log before
      // sessions[] is cleared, so the activity heatmap keeps them forever
      const log = { ...d.log }
      for (const s of d.sessions) {
        const e = log[s.date] || { n: 0, struggled: false }
        log[s.date] = { n: e.n + 1, struggled: e.struggled || !!s.struggled }
      }
      return {
      ...d,
      week: d.week + 1,
      targets: Object.fromEntries(EXERCISES.map(e => [e.key, preview.out[e.key].next])),
      sessions: [],
      log,
      history: [
        {
          week: d.week,
          q: quotaStatus(d.sessions),
          deltas: EXERCISES.map(e => `${e.code}${STATUS_SYMBOL[preview.out[e.key].status]}`).join(' '),
          struggled: preview.struggled,
          parkDates: d.sessions.filter(s => s.type === 'park').map(s => s.date),
        },
        ...d.history,
      ].slice(0, 24),
      }
    })
    setPanel(null)
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    localStorage.removeItem(STORE_KEY)
  }

  const reset = () => {
    if (window.confirm('Wipe all weeks, sessions and targets?')) {
      localStorage.removeItem(STORE_KEY)
      if (user) supabase.from('user_data').delete().eq('user_id', user.id).then(() => {})
      setData(freshState())
    }
  }

  if (!authReady) return <LoadingScreen />
  if (!user) return <Auth dark={dark} setDark={setDark} />

  return (
    <div className="min-h-screen bg-zinc-50 font-mono text-sm text-zinc-700 antialiased dark:bg-zinc-950 dark:text-zinc-300">
      <div className="mx-auto max-w-2xl space-y-3 p-3 pb-10 sm:p-4">
        <header className="space-y-2 pt-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-base font-bold tracking-[0.2em] text-zinc-900 dark:text-zinc-100 sm:text-lg sm:tracking-[0.3em]">
                WORKOUT <span className="text-emerald-400">TRACKER</span>
              </h1>
              <p className="mt-0.5 truncate text-[10px] tracking-[0.2em] text-zinc-400 dark:text-zinc-600">
                {fmtDate(todayStr())} · NO FIXED DAYS — HIT THE NUMBERS
              </p>
            </div>
            <div className="shrink-0 text-2xl font-bold leading-none text-zinc-900 tabular-nums dark:text-zinc-100">
              WK {String(data.week).padStart(2, '0')}
            </div>
          </div>
          <div className="flex items-center justify-end gap-5">
            <span
              className={`text-[9px] tracking-widest ${
                syncStatus === 'error'
                  ? 'text-red-400'
                  : syncStatus === 'syncing'
                    ? 'animate-pulse text-amber-400'
                    : 'text-emerald-400/50'
              }`}
            >
              {syncStatus === 'error' ? '● ERR' : syncStatus === 'syncing' ? '● SYNC' : '●'}
            </span>
            <button
              type="button"
              onClick={() => setDark(d => !d)}
              className="flex items-center gap-1 py-0.5 text-[9px] tracking-[0.25em] text-zinc-400 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-100"
              aria-label="toggle theme"
            >
              {dark ? <Sun size={11} /> : <Moon size={11} />}
              {dark ? 'LIGHT' : 'DARK'}
            </button>
            <button
              type="button"
              onClick={signOut}
              className="py-0.5 text-[9px] tracking-[0.25em] text-zinc-400 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-100"
            >
              SIGN OUT
            </button>
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1 py-0.5 text-[9px] tracking-[0.25em] text-zinc-300 hover:text-red-400 dark:text-zinc-700"
            >
              <RotateCcw size={10} /> RESET
            </button>
          </div>
        </header>

        <div className="flex items-center gap-2 border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-bold tracking-[0.25em] text-emerald-600 dark:bg-emerald-400/5 dark:text-emerald-400">
          <Unlock size={12} className="shrink-0" /> V2 · PULL-UP NODE UNLOCKED
          <span className="ml-auto hidden font-normal tracking-widest text-emerald-600/50 sm:inline dark:text-emerald-400/50">
            VERTICAL PULL ONLINE
          </span>
        </div>

        <Panel
          title="WEEKLY QUOTA — FLOATING"
          right={
            <span className={`text-[10px] font-bold tracking-[0.25em] ${q.met ? 'text-emerald-400' : 'text-zinc-400 dark:text-zinc-600'}`}>
              {q.met ? '■ QUOTA MET' : '□ OPEN'}
            </span>
          }
        >
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800/60">
            <QuotaRow
              icon={Dumbbell}
              label="PARK STRENGTH"
              sub="3×/WK · NEVER BACK-TO-BACK DAYS"
              blocks={blocksFor(q.parks, QUOTA.park)}
              count={`${q.parks}/${QUOTA.park}`}
              onLog={() => setPanel('park')}
            />
            <QuotaRow
              icon={HeartPulse}
              label="CARDIO RUN/SWIM"
              sub="1–2×/WK · SHIN PROTOCOL ENFORCED"
              blocks={blocksFor(q.cardio, QUOTA.cardioMin, QUOTA.cardioMax - QUOTA.cardioMin)}
              count={`${q.cardio}/${QUOTA.cardioMin}–${QUOTA.cardioMax}`}
              onLog={() => setPanel('cardio')}
            />
            <QuotaRow
              icon={Trophy}
              label="SOCCER"
              sub="1×/WK · SATURDAY SLOT"
              blocks={blocksFor(q.soccer, QUOTA.soccer)}
              count={`${q.soccer}/${QUOTA.soccer}`}
              onLog={() => setPanel('soccer')}
            />
          </div>
        </Panel>

        <Panel title={`STRENGTH TARGETS — WK ${String(data.week).padStart(2, '0')}`}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {EXERCISES.map(ex => (
              <div key={ex.key} className="border border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
                <div className="text-[9px] leading-tight tracking-[0.15em] text-zinc-500">
                  {ex.label} <span className="text-zinc-300 dark:text-zinc-700">{ex.unit}</span>
                </div>
                <div className="mt-0.5 text-lg font-bold text-zinc-900 tabular-nums dark:text-zinc-100">
                  {data.targets[ex.key].join('·')}
                </div>
                {ex.cap != null ? (
                  <div className="text-[9px] tracking-widest text-amber-500/80 dark:text-amber-500/70">
                    CEILING {ex.cap}
                    {ex.unit === 'SEC' ? 'S' : ''}
                  </div>
                ) : (
                  <div className="text-[9px] tracking-widest text-zinc-300 dark:text-zinc-700">UNCAPPED</div>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="ACTIVITY — LAST YEAR"
          right={
            <span className="text-[10px] tracking-widest text-zinc-400 dark:text-zinc-600">
              {activity.worked} WORKOUTS{activity.missed > 0 ? ` · ${activity.missed} MISSED` : ''}
            </span>
          }
        >
          <Heatmap heat={heat} days={data.days || {}} today={today} onToggle={toggleMissed} />
        </Panel>

        <Panel
          title="WEEK LOG"
          right={<span className="text-[10px] tracking-widest text-zinc-400 dark:text-zinc-600">{sorted.length} SESSIONS</span>}
        >
          {sorted.length === 0 ? (
            <p className="py-2 text-center text-[11px] tracking-[0.2em] text-zinc-400 dark:text-zinc-700">
              NO SESSIONS — WEEK FLOATS UNTIL YOU MOVE
            </p>
          ) : (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800/60">
              {sorted.map(s => (
                <SessionLine
                  key={s.id}
                  s={s}
                  onDelete={() => setData(d => ({ ...d, sessions: d.sessions.filter(x => x.id !== s.id) }))}
                />
              ))}
            </div>
          )}
        </Panel>

        <Btn kind="primary" className="w-full py-3" onClick={() => setPanel('review')}>
          COMPLETE WEEK <ChevronRight size={14} /> RUN PROGRESSION ENGINE
        </Btn>

        {data.history.length > 0 && (
          <Panel
            title="ARCHIVE"
            right={<span className="text-[10px] tracking-widest text-zinc-400 dark:text-zinc-600">+ PROGRESS · = HOLD · ■ CAP</span>}
          >
            <div className="space-y-1 text-[11px] tabular-nums">
              {data.history.map(h => (
                <div key={h.week} className="flex items-center justify-between text-zinc-500">
                  <span>
                    WK {String(h.week).padStart(2, '0')} ▸ P{h.q.parks}/{QUOTA.park} C{h.q.cardio} S{h.q.soccer}
                  </span>
                  <span className={h.q.met ? 'text-emerald-400/80' : 'text-amber-400/80'}>
                    {h.q.met ? 'MET' : 'MISSED'}
                  </span>
                  <span className="tracking-widest">
                    {h.deltas}
                    {h.struggled ? ' ⚑' : ''}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        <footer className="pt-1 text-center text-[9px] leading-relaxed tracking-[0.2em] text-zinc-300 dark:text-zinc-700">
          48H BETWEEN PARK SESSIONS · SQUATS/PLANK CAPPED · TIGHT SHIN ⇒ SWIM ONLY · NO RUNS FRI/SUN · REST 2:00
        </footer>
      </div>

      {panel === 'park' && (
        <ParkLogger
          targets={data.targets}
          parkDates={parkDates}
          parkCount={q.parks}
          onSave={addSession}
          onClose={() => setPanel(null)}
        />
      )}
      {(panel === 'cardio' || panel === 'soccer') && (
        <CardioLogger kind={panel} sessions={data.sessions} onSave={addSession} onClose={() => setPanel(null)} />
      )}
      {panel === 'review' && <WeekReview data={data} onConfirm={confirmWeek} onClose={() => setPanel(null)} />}
    </div>
  )
}
