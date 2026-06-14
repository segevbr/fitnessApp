import { useState } from 'react'
import { ChevronRight, Moon, Sun } from 'lucide-react'
import { supabase } from './supabase'

export default function Auth({ dark, setDark }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  const fieldCls =
    'w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-medium text-[var(--text)] outline-none focus:border-[var(--accent)]'

  return (
    <div className="flex min-h-screen items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-extrabold tracking-[-0.025em] text-[var(--text)]">Workout Tracker</h1>
            <p className="mt-1.5 text-[13px] text-[var(--text-2)]">Private — sign in to continue.</p>
          </div>
          <button
            type="button"
            onClick={() => setDark(d => !d)}
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--accent)]"
            aria-label="toggle theme"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow)]"
        >
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[var(--text-2)]">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={fieldCls}
              placeholder="you@example.com"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[var(--text-2)]">Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={fieldCls}
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p className="text-[13px] font-medium" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-[var(--btn-radius)] px-4 py-3 text-sm font-bold shadow-[var(--shadow)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}
          >
            {loading ? 'Loading…' : 'Sign in'} {!loading && <ChevronRight size={16} />}
          </button>
        </form>
      </div>
    </div>
  )
}
