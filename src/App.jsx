import { useEffect, useMemo, useRef, useState } from 'react'
import Auth from './Auth'
import { supabase } from './supabase'
import {
  Activity,
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
  exercisesForSession,
  fmtDate,
  heatColumns,
  heatStats,
  heatStatus,
  quotaStatus,
  runDayWarning,
  todayStr,
  uid,
  weekRange,
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

// The stable target keys present since V2. New keys (e.g. the V2.1 pistol slot)
// are merged in from defaults during migration rather than triggering a reset.
const V2_KEYS = ['pull', 'push', 'legs', 'core']
const isV2Targets = t => t && typeof t === 'object' && V2_KEYS.every(k => Array.isArray(t[k]))

// Bring any persisted state — from localStorage OR Supabase — onto the current
// schema. A V1 save uses retired movements (rows/push-ups under the old reset
// model) that can't be replayed onto the V2 baseline, so we adopt the V2 targets
// while preserving the week counter and the display-only archive; stale sessions
// are dropped. A V2/V2.1 save passes through, with any newly-added exercise keys
// (e.g. pistol) filled from defaults so the dashboard never reads undefined.
const migrate = raw => {
  if (!raw || typeof raw !== 'object') return freshState()
  if (isV2Targets(raw.targets)) {
    return { ...freshState(), ...raw, targets: { ...defaultTargets(), ...raw.targets } }
  }
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

const BTN = {
  primary: 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] shadow-[var(--shadow)] hover:brightness-110',
  accent: 'bg-[var(--accent)] text-[var(--on-accent)] hover:brightness-105',
  ghost:
    'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent-strong)]',
  warn: 'text-white hover:brightness-105',
}

function Btn({ kind = 'ghost', className = '', style, ...props }) {
  const warnStyle = kind === 'warn' ? { background: 'var(--warn)', ...style } : style
  return (
    <button
      type="button"
      style={warnStyle}
      className={`flex items-center justify-center gap-2 rounded-[var(--btn-radius)] px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${BTN[kind]} ${className}`}
      {...props}
    />
  )
}

function Panel({ title, sub, right, children, flush = false }) {
  return (
    <section className="mb-4 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]">
      <header className="flex items-center justify-between gap-3 px-[var(--pad)] py-3.5">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <h2 className="truncate text-sm font-bold text-[var(--text)]">{title}</h2>
          {sub && <span className="shrink-0 text-xs font-medium text-[var(--text-3)]">· {sub}</span>}
        </div>
        {right}
      </header>
      {flush ? children : <div className="px-[var(--pad)] pb-[var(--pad)]">{children}</div>}
    </section>
  )
}

function WarnBox({ children, tone = 'amber' }) {
  const c = tone === 'red' ? 'var(--danger)' : 'var(--warn)'
  return (
    <div
      className="flex items-start gap-2 rounded-[var(--radius-sm)] border px-3 py-2.5 text-[13px] leading-relaxed"
      style={{
        color: c,
        borderColor: `color-mix(in srgb, ${c} 35%, transparent)`,
        background: `color-mix(in srgb, ${c} 12%, transparent)`,
      }}
    >
      <TriangleAlert size={15} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

function NumInput({ value, onChange, step = 1, wide = false, grow = false }) {
  const bump = d => onChange(Math.max(0, (Number(value) || 0) + d))
  const btn = 'px-3 py-2 text-[var(--text-2)] hover:text-[var(--accent-strong)] active:bg-[var(--surface-2)]'
  return (
    <div
      className={`items-stretch overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] ${
        grow ? 'flex flex-1' : 'inline-flex'
      }`}
    >
      <button type="button" onClick={() => bump(-step)} className={btn} aria-label="decrease">
        <Minus size={14} />
      </button>
      <input
        type="number"
        min="0"
        value={value}
        onChange={e => onChange(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
        className={`mono ${
          wide ? 'w-20 py-2 text-2xl' : grow ? 'w-full min-w-0 py-2 text-base' : 'w-12 py-1.5 text-sm'
        } bg-transparent text-center font-semibold text-[var(--text)] tabular-nums outline-none`}
      />
      <button type="button" onClick={() => bump(step)} className={btn} aria-label="increase">
        <Plus size={14} />
      </button>
    </div>
  )
}

function DateField({ value, onChange }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-[var(--text-2)]">Date</span>
      <div className="flex items-center gap-3">
        <input
          type="date"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
        <span className="text-sm text-[var(--text-3)]">{dayName(value)}</span>
      </div>
    </label>
  )
}

function Modal({ onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-3 backdrop-blur-sm">
      <div className="mx-auto my-6 w-full max-w-md overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]">
        {children}
      </div>
      <button type="button" className="hidden" onClick={onClose} aria-hidden />
    </div>
  )
}

function ModalHeader({ icon: Icon, title, onClose }) {
  return (
    <header className="flex items-center justify-between border-b border-[var(--border)] px-[var(--pad)] py-3.5">
      <div className="flex items-center gap-2.5 text-[var(--text)]">
        <span className="flex h-8 w-8 items-center justify-center rounded-[11px] bg-[var(--surface-2)] text-[var(--accent-strong)]">
          <Icon size={16} />
        </span>
        <h2 className="text-sm font-bold">{title}</h2>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
        aria-label="close"
      >
        <X size={18} />
      </button>
    </header>
  )
}

// ---------- park session logger ----------

function ParkLogger({ targets, parkDates, parkCount, onSave, onClose }) {
  // Which strength session of the week this is (1-indexed) decides the leg
  // variant: session 1 = pistol squats (skill), sessions 2-3 = bodyweight squats.
  const session = parkCount + 1
  const circuit = useMemo(() => exercisesForSession(session), [session])
  const steps = useMemo(() => circuit.flatMap(ex => [0, 1, 2].map(set => ({ ex, set }))), [circuit])
  const [phase, setPhase] = useState('date') // date -> live -> review
  const [date, setDate] = useState(todayStr())
  const [step, setStep] = useState(0)
  const [values, setValues] = useState(() =>
    Object.fromEntries(circuit.map(e => [e.key, Array(SETS).fill(null)])),
  )
  const [input, setInput] = useState(targets[circuit[0].key][0])
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
    setValues(Object.fromEntries(circuit.map(e => [e.key, [...targets[e.key]]])))
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
      <ModalHeader icon={Dumbbell} title="Park session" onClose={close} />
      <div className="space-y-3.5 p-4">
        {phase === 'date' && (
          <>
            <DateField value={date} onChange={setDate} />
            {warning && <WarnBox>{warning}</WarnBox>}
            {parkCount >= QUOTA.park && (
              <WarnBox>Park quota already met {parkCount}/{QUOTA.park} — this logs as extra volume.</WarnBox>
            )}
            <div className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-3.5 py-3 text-[12px] leading-relaxed text-[var(--text-2)]">
              <span className="font-semibold text-[var(--text)]">Circuit ▸ </span>
              {circuit.map(e => `${e.label} ${SETS}×[${targets[e.key].join('·')}]${e.unit === 'SEC' ? 's' : ''}`).join(
                ' ▸ ',
              )}
              <div className="mt-1 text-[var(--text-3)]">Mandatory {REST_SECONDS / 60}:00 rest between sets.</div>
            </div>
            <Btn kind={warning ? 'warn' : 'primary'} className="w-full" onClick={() => setPhase('live')}>
              {warning ? 'Override & start' : 'Start circuit'} <ChevronRight size={16} />
            </Btn>
            <Btn kind="ghost" className="w-full" onClick={quickLog}>
              Quick log — enter reps, skip timer
            </Btn>
          </>
        )}

        {phase === 'live' && (
          <>
            <div className="flex items-center gap-1.5">
              {dots.map((d, i) => (
                <span
                  key={i}
                  className={`h-2.5 w-2.5 rounded-full ${d.group ? 'ml-2' : ''} ${d.active ? 'animate-pulse' : ''}`}
                  style={{
                    background: d.logged ? 'var(--accent)' : d.active ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'var(--surface-2)',
                  }}
                />
              ))}
              <span className="mono ml-auto text-[11px] text-[var(--text-3)]">
                Set {Math.min(step + 1, steps.length)}/{steps.length}
              </span>
            </div>

            {!resting && (
              <form
                onSubmit={e => {
                  e.preventDefault()
                  logSet()
                }}
                className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3.5"
              >
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-[11px] font-medium text-[var(--text-3)]">
                      {cur.ex.label} · {circuit.findIndex(e => e.key === cur.ex.key) + 1}/4
                    </div>
                    <div className="text-2xl font-extrabold text-[var(--text)]">{cur.ex.short}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] font-medium text-[var(--text-3)]">Target</div>
                    <div className="mono text-2xl font-bold text-[var(--accent-strong)]">
                      {targets[cur.ex.key][cur.set]}
                      <span className="ml-1 text-[11px] text-[var(--text-3)]">{cur.ex.unit === 'SEC' ? 's' : ''}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <NumInput value={input} onChange={setInput} step={cur.ex.inc} wide />
                  <div className="mono text-[11px] leading-relaxed text-[var(--text-3)]">
                    {[0, 1, 2]
                      .filter(s => values[cur.ex.key][s] != null)
                      .map(s => `S${s + 1}:${values[cur.ex.key][s]}✓`)
                      .join(' ') || 'no sets logged'}
                  </div>
                </div>
                {cur.ex.note && (
                  <p
                    className="mono border-l-2 pl-2.5 text-[11.5px] leading-relaxed text-[var(--text-3)]"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {cur.ex.note}
                  </p>
                )}
                <Btn kind="primary" className="w-full" onClick={logSet}>
                  <Check size={16} /> Log set
                  {step < steps.length - 1 && <span className="text-[11px] opacity-70">▸ starts 2:00 rest</span>}
                </Btn>
              </form>
            )}

            {resting && (
              <div
                className="space-y-3 rounded-[var(--radius-sm)] p-4 text-center"
                style={{ background: 'var(--accent-weak)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}
              >
                <div className="flex items-center justify-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--accent-strong)' }}>
                  <Timer size={14} /> Rest protocol — mandatory
                </div>
                <div className="mono text-6xl font-bold text-[var(--text)]">
                  {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div
                    className="h-full rounded-full transition-all duration-200"
                    style={{ width: `${((REST_SECONDS - remaining) / REST_SECONDS) * 100}%`, background: 'var(--accent)' }}
                  />
                </div>
                {next && (
                  <div className="text-[12px] text-[var(--text-2)]">
                    Next ▸ {next.ex.short} · set {next.set + 1}/{SETS} · target {targets[next.ex.key][next.set]}
                    {next.ex.unit === 'SEC' ? 's' : ''}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSkips(s => s + 1)
                    advance()
                  }}
                  className="mx-auto flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-3)] hover:text-[var(--warn)]"
                >
                  <SkipForward size={13} /> Skip rest — logged as violation
                </button>
              </div>
            )}
          </>
        )}

        {phase === 'review' && (
          <>
            <div className="text-[12px] font-medium text-[var(--text-3)]">Review ▸ {fmtDate(date)}</div>
            <div className="space-y-3">
              {circuit.map(ex => (
                <div key={ex.key} className="space-y-1.5 border-b border-[var(--border)] pb-3 last:border-b-0 last:pb-0">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[13px] font-semibold text-[var(--text)]">{ex.short}</span>
                    <span className="mono text-[11px] text-[var(--text-3)]">target {targets[ex.key].join('·')}</span>
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
            {skips > 0 && <WarnBox>Rest timer skipped ×{skips} — recovery protocol violated.</WarnBox>}
            <Btn kind={struggled ? 'warn' : 'ghost'} className="w-full" onClick={() => setStruggled(s => !s)}>
              <Flag size={15} /> {struggled ? 'Struggled — progression will hold' : 'Flag as struggled'}
            </Btn>
            <Btn
              kind="primary"
              className="w-full"
              onClick={() =>
                onSave({
                  id: uid(),
                  type: 'park',
                  date,
                  sets: Object.fromEntries(circuit.map(ex => [ex.key, values[ex.key].map(clampInt)])),
                  struggled,
                  restSkips: skips,
                })
              }
            >
              <Check size={16} /> Save session
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
  if (!soccer && q.cardio >= QUOTA.cardio)
    warnings.push(`CARDIO QUOTA MET ${q.cardio}/${QUOTA.cardio} — THIS LOGS AS EXTRA LOAD`)
  if (soccer && q.soccer >= QUOTA.soccer) warnings.push('SOCCER QUOTA ALREADY MET — EXTRA MATCH')
  if (soccer && dayName(date) !== 'SAT') warnings.push(`SOCCER IS SLOTTED SATURDAY — SELECTED ${dayName(date)}`)
  if (soccer && tight) warnings.push('TIGHT SHINS + MATCH IMPACT — MONITOR OR SIT OUT')

  const valid = Number(durMin) > 0 || Number(durSec) > 0
  const Icon = soccer ? Trophy : HeartPulse

  const segBtn = (active, disabled) =>
    `flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-sm)] border px-3 py-2.5 text-[13px] font-semibold transition ${
      disabled
        ? 'cursor-not-allowed border-[var(--border)] text-[var(--text-3)] opacity-60'
        : active
          ? 'border-transparent'
          : 'border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text)]'
    }`
  const inputCls =
    'rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--text)] tabular-nums outline-none focus:border-[var(--accent)]'
  const fieldLabel = 'mb-1.5 block text-xs font-semibold text-[var(--text-2)]'

  return (
    <Modal onClose={onClose}>
      <ModalHeader icon={Icon} title={soccer ? 'Soccer · match day' : 'Cardio · engine work'} onClose={onClose} />
      <div className="space-y-3.5 p-4">
        <DateField value={date} onChange={setDate} />

        <div>
          <span className={fieldLabel}>Shin status</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShin('good')}
              className={segBtn(!tight, false)}
              style={!tight ? { background: 'var(--done)', color: '#fff' } : undefined}
            >
              <Check size={15} /> Good
            </button>
            <button
              type="button"
              onClick={() => setShin('tight')}
              className={segBtn(tight, false)}
              style={tight ? { background: 'var(--danger)', color: '#fff' } : undefined}
            >
              <TriangleAlert size={15} /> Tight
            </button>
          </div>
        </div>

        {tight && (
          <WarnBox tone="red">
            Shin splint protocol active — run locked{!soccer && ', swim forced'}. No impact until clear.
          </WarnBox>
        )}

        {!soccer && (
          <div>
            <span className={fieldLabel}>Mode</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={tight}
                onClick={() => setMode('run')}
                className={segBtn(mode === 'run', tight)}
                style={mode === 'run' && !tight ? { background: 'var(--accent)', color: 'var(--on-accent)' } : undefined}
              >
                {tight ? <Lock size={15} /> : <Footprints size={15} />} Run
              </button>
              <button
                type="button"
                onClick={() => setMode('swim')}
                className={segBtn(mode === 'swim', false)}
                style={mode === 'swim' ? { background: '#38bdf8', color: '#06222e' } : undefined}
              >
                <Waves size={15} /> Swim
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <span className={fieldLabel}>Duration</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                placeholder="0"
                value={durMin}
                onChange={e => setDurMin(e.target.value)}
                className={`mono w-16 text-center ${inputCls}`}
              />
              <span className="font-bold text-[var(--text-3)]">:</span>
              <input
                type="number"
                min="0"
                max="59"
                placeholder="00"
                value={durSec}
                onChange={e => setDurSec(Math.min(59, Math.max(0, Number(e.target.value) || 0)) || '')}
                className={`mono w-16 text-center ${inputCls}`}
              />
              <span className="text-[11px] font-medium text-[var(--text-3)]">min : sec</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Distance (km)', distance, setDistance, '0.1'],
              ['Avg HR (bpm)', avgHr, setAvgHr, '1'],
            ].map(([label, value, set, step]) => (
              <label key={label} className="block">
                <span className={fieldLabel}>{label}</span>
                <input
                  type="number"
                  min="0"
                  step={step}
                  placeholder="0"
                  value={value}
                  onChange={e => set(e.target.value)}
                  className={`mono w-full ${inputCls}`}
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
          <Check size={16} /> {warnings.length ? 'Override & log' : 'Log session'}
        </Btn>
        {!valid && <p className="text-center text-[12px] text-[var(--text-3)]">Duration required</p>}
      </div>
    </Modal>
  )
}

// ---------- week review / progression ----------

function WeekReview({ data, onConfirm, onClose }) {
  const preview = useMemo(() => computeProgression(data.targets, data.sessions), [data])
  const q = quotaStatus(data.sessions)

  const statusColor = { progress: 'var(--accent-strong)', hold: 'var(--text-3)', cap: 'var(--warn)' }

  return (
    <Modal onClose={onClose}>
      <ModalHeader icon={TrendingUp} title={`Week ${String(data.week).padStart(2, '0')} · progression`} onClose={onClose} />
      <div className="space-y-3.5 p-4">
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-3.5 py-2.5 text-[12px]">
          <span className="mono text-[var(--text-2)]">
            Park {q.parks}/{QUOTA.park} · Cardio {q.cardio}/{QUOTA.cardio} · Soccer {q.soccer}/{QUOTA.soccer}
          </span>
          <span className="font-bold" style={{ color: q.met ? 'var(--accent-strong)' : 'var(--warn)' }}>
            {q.met ? 'Met' : 'Incomplete'}
          </span>
        </div>

        {preview.struggled && <WarnBox>Struggled flag on record — all targets hold this rollover.</WarnBox>}

        <div className="space-y-2">
          {EXERCISES.map(ex => {
            const p = preview.out[ex.key]
            return (
              <div key={ex.key} className="rounded-[var(--radius-sm)] border border-[var(--border)] px-3.5 py-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[13px] font-semibold text-[var(--text)]">{ex.short}</span>
                  <span className="mono flex items-center gap-2 font-bold">
                    <span className="text-[var(--text-3)]">{data.targets[ex.key].join('·')}</span>
                    <ChevronRight size={13} className="text-[var(--text-3)]" />
                    <span style={{ color: statusColor[p.status] }}>{p.next.join('·')}</span>
                  </span>
                </div>
                <div className="mt-0.5 text-right text-[11px] font-medium" style={{ color: statusColor[p.status] }}>
                  {p.status === 'hold' ? `Hold — ${p.reason}` : p.reason}
                </div>
              </div>
            )
          })}
        </div>

        <div className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-3.5 py-2.5 text-[11.5px] leading-relaxed text-[var(--text-2)]">
          V2.1 engine ▸ strict hold if any set missed · +1 to set 1 only · pistols cap 3 · squats cap 15 · plank cap 60s
        </div>

        <Btn kind="primary" className="w-full" onClick={() => onConfirm(preview)}>
          <Check size={16} /> Archive week & apply targets
        </Btn>
        <Btn className="w-full" onClick={onClose}>
          Cancel — keep week open
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- dashboard pieces ----------

function QuotaRow({ icon: Icon, label, sub, blocks, count, onLog }) {
  const required = blocks.filter(b => b !== 'optional').length || blocks.length
  const doneCount = blocks.filter(b => b === 'done' || b === 'over').length
  const full = !blocks.includes('todo')
  const pct = required ? Math.min(100, (doneCount / required) * 100) : 0
  return (
    <div className="flex items-center gap-3.5 border-t border-[var(--border)] px-[var(--pad)] py-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[var(--surface-2)] text-[var(--accent-strong)]">
        <Icon size={19} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-bold text-[var(--text)]">{label}</div>
        <div className="truncate text-xs text-[var(--text-2)]">{sub}</div>
        <div className="mt-2 h-1 max-w-[200px] overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
        {blocks.map((b, i) => (
          <span
            key={i}
            className="h-[22px] w-[22px] rounded-[7px] border-[1.5px]"
            style={{
              borderColor: b === 'done' || b === 'over' ? 'var(--accent)' : 'var(--border)',
              borderStyle: b === 'optional' ? 'dashed' : 'solid',
              background: b === 'done' ? 'var(--accent)' : b === 'over' ? 'var(--warn)' : 'transparent',
            }}
          />
        ))}
      </div>
      <span className="mono w-9 shrink-0 text-right text-[13px] font-semibold text-[var(--text-2)]">{count}</span>
      {full ? (
        <span
          className="flex shrink-0 items-center gap-1.5 rounded-[var(--btn-radius)] px-3.5 py-2 text-[12.5px] font-bold"
          style={{ background: 'var(--accent-weak)', color: 'var(--accent-strong)' }}
        >
          <Check size={15} /> Done
        </span>
      ) : (
        <button
          type="button"
          onClick={onLog}
          className="flex shrink-0 items-center gap-1.5 rounded-[var(--btn-radius)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent-strong)]"
        >
          <Plus size={15} /> Log
        </button>
      )}
    </div>
  )
}

// Plain binary boxes: exactly `target` of them, each done (green) or not.
// Extra sessions beyond target show only in the count (e.g. 3/2), not as boxes.
const blocksFor = (count, target) => Array.from({ length: target }, (_, i) => (i < count ? 'done' : 'todo'))

const fmtDuration = secs => {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function SessionLine({ s, onDelete }) {
  const detail =
    s.type === 'park'
      ? EXERCISES.filter(ex => s.sets[ex.key]).map(ex => `${ex.code} ${s.sets[ex.key].join('/')}`).join(' · ')
      : `${fmtDuration(s.duration)} · ${s.distance}km · ${s.avgHr || '—'}bpm`
  const tag =
    s.type === 'park' ? 'Park' : s.type === 'soccer' ? 'Soccer' : s.mode === 'swim' ? 'Swim' : 'Run'
  const dot =
    s.type === 'park'
      ? 'var(--accent)'
      : s.type === 'soccer'
        ? 'var(--struggle)'
        : s.mode === 'swim'
          ? '#38bdf8'
          : 'var(--text-2)'
  return (
    <div className="flex items-center gap-2.5 border-t border-[var(--border)] px-[var(--pad)] py-3 text-sm">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
      <span className="shrink-0 font-semibold text-[var(--text)]">{tag}</span>
      <span className="mono min-w-0 flex-1 truncate text-[12px] text-[var(--text-3)]">{detail}</span>
      {s.type !== 'park' && s.shin === 'tight' && (
        <span className="shrink-0 text-[11px] font-semibold" style={{ color: 'var(--danger)' }}>
          shin: tight
        </span>
      )}
      {s.struggled && <Flag size={13} className="shrink-0" style={{ color: 'var(--struggle)' }} />}
      {s.restSkips > 0 && (
        <span className="shrink-0 text-[11px]" style={{ color: 'var(--warn)' }}>
          skip×{s.restSkips}
        </span>
      )}
      <span className="mono shrink-0 text-[12px] text-[var(--text-3)]">{fmtDate(s.date)}</span>
      <button
        type="button"
        onClick={onDelete}
        className="shrink-0 text-[var(--text-3)] hover:text-[var(--danger)]"
        aria-label="delete"
      >
        <X size={14} />
      </button>
    </div>
  )
}

// ---------- activity heatmap (github-style) ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const fmtMonthDay = date => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`

const HEAT_CELL = {
  future: 'var(--surface-2)',
  rest: 'var(--rest)',
  missed: 'var(--danger)',
  struggled: 'var(--struggle)',
  worked: 'var(--done)',
  // a cardio-only day: lighter green, blended toward the empty-cell surface
  cardio: 'color-mix(in srgb, var(--done) 48%, var(--surface-2))',
}

const HEAT_LABEL = {
  future: '',
  rest: 'rest day',
  missed: 'missed',
  struggled: 'worked out · struggled',
  worked: 'worked out',
  cardio: 'cardio',
}

function HeatSwatch({ color, label }) {
  return (
    <span className="flex items-center gap-1.5 text-[var(--text-2)]">
      <span className="h-[11px] w-[11px] rounded-[3px]" style={{ background: color }} />
      {label}
    </span>
  )
}

// Detail window for a tapped heatmap day. Current-week sessions carry full
// set-by-set detail; folded past days only retain a type/struggled summary.
function DayDetail({ date, sessions, heat, onClose }) {
  const daySessions = sessions.filter(s => s.date === date)
  const h = heat[date]
  return (
    <Modal onClose={onClose}>
      <ModalHeader icon={Activity} title={fmtDate(date)} onClose={onClose} />
      <div className="space-y-3 p-4">
        {daySessions.length > 0 ? (
          daySessions.map(s => (
            <div key={s.id} className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-bold text-[var(--text)]">
                  {s.type === 'park' ? 'Park strength' : s.type === 'soccer' ? 'Soccer' : s.mode === 'swim' ? 'Swim' : 'Run'}
                </span>
                {s.struggled && (
                  <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--struggle)' }}>
                    <Flag size={12} /> struggled
                  </span>
                )}
              </div>
              {s.type === 'park' ? (
                <div className="mt-2.5 space-y-1.5">
                  {EXERCISES.filter(ex => s.sets[ex.key]).map(ex => (
                    <div key={ex.key} className="flex items-center justify-between text-[12px]">
                      <span className="text-[var(--text-2)]">{ex.short}</span>
                      <span className="mono font-semibold text-[var(--text)]">
                        {s.sets[ex.key].join(' · ')}
                        {ex.unit === 'SEC' ? 's' : ''}
                      </span>
                    </div>
                  ))}
                  {s.restSkips > 0 && (
                    <div className="text-[11px]" style={{ color: 'var(--warn)' }}>
                      Rest skipped ×{s.restSkips}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mono mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--text-2)]">
                  <span>{fmtDuration(s.duration)}</span>
                  {s.distance > 0 && <span>{s.distance} km</span>}
                  {s.avgHr > 0 && <span>{s.avgHr} bpm</span>}
                  <span style={{ color: s.shin === 'tight' ? 'var(--danger)' : 'var(--text-3)' }}>shin {s.shin}</span>
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text)]">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: HEAT_CELL[h?.struggled ? 'struggled' : h?.full ? 'worked' : 'cardio'] }}
              />
              {h?.struggled ? 'Worked out · struggled' : h?.full ? 'Worked out' : 'Cardio session'}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-3)]">
              {h?.n || 0} session{(h?.n || 0) === 1 ? '' : 's'} logged. Set-by-set detail is kept for the current week only.
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Heatmap({ heat, days, today, onToggle, sessions }) {
  const cols = useMemo(() => heatColumns(today), [today])
  const scroller = useRef(null)
  const [hoverCol, setHoverCol] = useState(null) // week column highlighted on hover
  const [openDate, setOpenDate] = useState(null) // day whose detail window is open
  // open scrolled to the most recent week, like GitHub
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth
  }, [])
  const cell = { width: 'var(--cell)', height: 'var(--cell)' }

  return (
    <div>
      <div ref={scroller} className="overflow-x-auto pb-1">
        <div className="inline-flex flex-col gap-1.5">
          <div className="flex gap-[var(--cell-gap)] pl-8">
            {cols.map((col, w) => {
              const m = Number(col[0].slice(5, 7)) - 1
              const prevM = w > 0 ? Number(cols[w - 1][0].slice(5, 7)) - 1 : -1
              return (
                <div key={col[0]} className="relative h-[14px]" style={{ width: 'var(--cell)' }}>
                  {m !== prevM && (
                    <span className="absolute left-0 top-0 whitespace-nowrap text-[10px] leading-none text-[var(--text-3)]">
                      {MONTHS[m]}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex gap-[var(--cell-gap)]">
            <div className="flex w-8 flex-col gap-[var(--cell-gap)] pr-1 text-[9px] text-[var(--text-3)]">
              {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((d, r) => (
                <span key={r} style={{ height: 'var(--cell)', lineHeight: 'var(--cell)' }}>
                  {d}
                </span>
              ))}
            </div>
            {cols.map((col, w) => (
              <div
                key={col[0]}
                className="flex flex-col gap-[var(--cell-gap)]"
                onMouseEnter={() => setHoverCol(w)}
                onMouseLeave={() => setHoverCol(c => (c === w ? null : c))}
              >
                {col.map(date => {
                  const status = heatStatus(date, heat, days, today)
                  const isWorkout = status === 'worked' || status === 'cardio' || status === 'struggled'
                  const clickable = status !== 'future'
                  const isToday = date === today
                  const dim = hoverCol != null && hoverCol !== w // other weeks fade so this one lights up
                  const rings = []
                  if (isToday) rings.push('0 0 0 1.5px var(--accent)')
                  else if (hoverCol === w) rings.push('0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent)')
                  return (
                    <button
                      key={date}
                      type="button"
                      disabled={!clickable}
                      onClick={() => {
                        if (status === 'rest' || status === 'missed') onToggle(date)
                        else if (isWorkout) setOpenDate(date)
                      }}
                      title={status === 'future' ? fmtDate(date) : `${fmtDate(date)} — ${HEAT_LABEL[status]}`}
                      style={{
                        ...cell,
                        borderRadius: 'var(--cell-radius)',
                        background: HEAT_CELL[status],
                        opacity: status === 'future' ? 0.5 : dim ? 0.4 : 1,
                        boxShadow: rings.length ? rings.join(', ') : undefined,
                        cursor: clickable ? 'pointer' : 'default',
                        transition: 'opacity 120ms, box-shadow 120ms',
                      }}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11.5px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <HeatSwatch color={HEAT_CELL.worked} label="Worked out" />
          <HeatSwatch color={HEAT_CELL.cardio} label="Cardio" />
          <HeatSwatch color={HEAT_CELL.struggled} label="Struggled" />
          <HeatSwatch color={HEAT_CELL.missed} label="Missed" />
          <HeatSwatch color={HEAT_CELL.rest} label="Rest" />
        </div>
        <span className="text-[var(--text-3)]">Tap a workout for details · a rest day to flag it missed</span>
      </div>
      {openDate && <DayDetail date={openDate} sessions={sessions} heat={heat} onClose={() => setOpenDate(null)} />}
    </div>
  )
}

// ---------- app ----------

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
      <span className="animate-pulse text-sm font-medium text-[var(--text-3)]">Loading…</span>
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
    document.documentElement.style.background = dark ? '#0c0f13' : '#f4f6f8'
    localStorage.setItem('fq-theme', dark ? 'dark' : 'light')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0c0f13' : '#f4f6f8')
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
        const e = log[s.date] || { n: 0, struggled: false, full: false, cardio: false }
        log[s.date] = {
          n: e.n + 1,
          struggled: e.struggled || !!s.struggled,
          full: e.full || s.type !== 'cardio',
          cardio: e.cardio || s.type === 'cardio',
        }
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

  if (!authReady) return <LoadingScreen />
  if (!user) return <Auth dark={dark} setDark={setDark} />

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="mx-auto w-full max-w-[760px] px-4 pb-16 pt-7 sm:px-5">
        <header className="mb-[18px] flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[24px] font-extrabold tracking-[-0.025em] text-[var(--text)]">Workout Tracker</h1>
              <span
                className="mono rounded-full px-2.5 py-1 text-[12px] font-semibold"
                style={{ background: 'var(--accent-weak)', color: 'var(--accent-strong)' }}
              >
                Week {String(data.week).padStart(2, '0')}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] text-[var(--text-2)]">
              {fmtMonthDay(weekRange(today).start)} – {fmtMonthDay(weekRange(today).end)} · No fixed days · Hit the numbers
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className="mono flex items-center gap-1.5 text-[11px] font-medium"
              style={{
                color: syncStatus === 'error' ? 'var(--danger)' : syncStatus === 'syncing' ? 'var(--warn)' : 'var(--text-3)',
              }}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${syncStatus === 'syncing' ? 'animate-pulse' : ''}`}
                style={{
                  background:
                    syncStatus === 'error' ? 'var(--danger)' : syncStatus === 'syncing' ? 'var(--warn)' : 'var(--accent)',
                }}
              />
              {syncStatus === 'error' ? 'Error' : syncStatus === 'syncing' ? 'Sync' : 'Synced'}
            </span>
            <button
              type="button"
              onClick={() => setDark(d => !d)}
              aria-label="toggle theme"
              className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--accent)]"
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              type="button"
              onClick={signOut}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[12px] font-semibold text-[var(--text-2)] hover:text-[var(--text)]"
            >
              Sign out
            </button>
            <button
              type="button"
              disabled
              aria-label="reset disabled"
              title="Reset is disabled to protect your progress"
              className="flex h-[38px] w-[38px] cursor-not-allowed items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-3)] opacity-40"
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </header>

        <div
          className="mb-4 flex items-center justify-between gap-3 rounded-[var(--radius)] px-[var(--pad)] py-3.5"
          style={{ background: 'var(--accent-weak)', border: '1px solid color-mix(in srgb, var(--accent) 26%, transparent)' }}
        >
          <div className="flex items-center gap-2.5" style={{ color: 'var(--accent-strong)' }}>
            <Unlock size={16} className="shrink-0" />
            <span className="text-[13.5px] font-bold">v2.1 · Flat Push &amp; Hybrid Legs Online</span>
          </div>
          <span
            className="hidden items-center gap-2 text-[12px] font-semibold sm:flex"
            style={{ color: 'var(--accent-strong)' }}
          >
            <span
              className="h-[7px] w-[7px] rounded-full"
              style={{ background: 'var(--accent)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent)' }}
            />
            Hybrid legs active
          </span>
        </div>

        <Panel
          title="Weekly quota"
          sub="Floating"
          flush
          right={
            <span
              className="rounded-full px-2.5 py-1 text-[12px] font-bold"
              style={q.met ? { background: 'var(--accent-weak)', color: 'var(--accent-strong)' } : { color: 'var(--text-3)' }}
            >
              {q.met ? 'Met' : 'Open'}
            </span>
          }
        >
          <QuotaRow
            icon={Dumbbell}
            label="Park strength"
            sub="3×/wk · Never back-to-back days"
            blocks={blocksFor(q.parks, QUOTA.park)}
            count={`${q.parks}/${QUOTA.park}`}
            onLog={() => setPanel('park')}
          />
          <QuotaRow
            icon={HeartPulse}
            label="Cardio run/swim"
            sub="2×/wk · Shin protocol enforced"
            blocks={blocksFor(q.cardio, QUOTA.cardio)}
            count={`${q.cardio}/${QUOTA.cardio}`}
            onLog={() => setPanel('cardio')}
          />
          <QuotaRow
            icon={Trophy}
            label="Soccer"
            sub="1×/wk · Saturday slot"
            blocks={blocksFor(q.soccer, QUOTA.soccer)}
            count={`${q.soccer}/${QUOTA.soccer}`}
            onLog={() => setPanel('soccer')}
          />
        </Panel>

        <Panel
          title="Strength targets"
          sub={`Week ${String(data.week).padStart(2, '0')} · next: session ${q.parks + 1}`}
        >
          <div className="grid grid-cols-2 gap-[var(--gap)] sm:grid-cols-4">
            {exercisesForSession(q.parks + 1).map(ex => (
              <div key={ex.key} className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
                <div className="text-[10.5px] font-bold uppercase leading-tight tracking-[0.05em] text-[var(--text-3)]">
                  {ex.label}
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-[0.05em] text-[var(--text-3)]">
                  {ex.unit === 'SEC' ? 'sec' : 'reps'}
                </div>
                <div className="mono mt-3 text-[19px] font-semibold tracking-[-0.01em] text-[var(--text)]">
                  {data.targets[ex.key].join('·')}
                </div>
                {ex.note ? (
                  <div className="mono mt-2 text-[11px] leading-relaxed text-[var(--text-3)]">{ex.note}</div>
                ) : (
                  <div
                    className="mt-2 text-[11px] font-semibold"
                    style={{ color: ex.cap != null ? 'var(--warn)' : 'var(--text-3)' }}
                  >
                    {ex.cap != null ? `Ceiling ${ex.cap}${ex.unit === 'SEC' ? 's' : ''}` : 'Uncapped'}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Activity"
          sub="Last year"
          right={
            <span className="mono text-[12px] font-medium text-[var(--text-2)]">
              {activity.worked} workouts{activity.missed > 0 ? ` · ${activity.missed} missed` : ''}
            </span>
          }
        >
          <Heatmap heat={heat} days={data.days || {}} today={today} onToggle={toggleMissed} sessions={data.sessions} />
        </Panel>

        <Panel
          title="Week log"
          flush
          right={<span className="mono text-[12px] text-[var(--text-2)]">{sorted.length} sessions</span>}
        >
          {sorted.length === 0 ? (
            <div className="border-t border-[var(--border)] px-[var(--pad)] py-7 text-center text-[13.5px] text-[var(--text-3)]">
              No sessions yet — the week floats until you move.
            </div>
          ) : (
            sorted.map(s => (
              <SessionLine
                key={s.id}
                s={s}
                onDelete={() => setData(d => ({ ...d, sessions: d.sessions.filter(x => x.id !== s.id) }))}
              />
            ))
          )}
        </Panel>

        <Btn kind="primary" className="mb-4 w-full py-4 text-[15px]" onClick={() => setPanel('review')}>
          Complete week <ChevronRight size={16} className="opacity-60" /> Run progression engine
        </Btn>

        {data.history.length > 0 && (
          <Panel
            title="Archive"
            flush
            right={<span className="mono text-[11.5px] text-[var(--text-3)]">+ progress · = hold · ■ cap</span>}
          >
            {data.history.map(h => (
              <div key={h.week} className="flex items-center gap-3 border-t border-[var(--border)] px-[var(--pad)] py-3 text-[13px]">
                <span className="min-w-[52px] font-bold text-[var(--text)]">Wk {String(h.week).padStart(2, '0')}</span>
                <span className="mono min-w-0 flex-1 truncate text-[12px] text-[var(--text-2)]">
                  P{h.q.parks}/{QUOTA.park} · C{h.q.cardio} · S{h.q.soccer}
                </span>
                <span className="text-[12px] font-bold" style={{ color: h.q.met ? 'var(--accent-strong)' : 'var(--warn)' }}>
                  {h.q.met ? 'Met' : 'Missed'}
                </span>
                <span className="mono min-w-[92px] text-right text-[12px] text-[var(--text-3)]">
                  {h.deltas}
                  {h.struggled ? ' ⚑' : ''}
                </span>
              </div>
            ))}
          </Panel>
        )}

        <footer className="mt-5 text-center text-[11.5px] leading-[1.8] text-[var(--text-3)]">
          48h between park sessions · Squats / plank capped · Tight shin ⇒ swim only · No runs Fri / Sun · Rest 2:00
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
