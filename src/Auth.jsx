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
    'w-full border border-zinc-300 bg-white px-3 py-2 text-sm font-bold text-zinc-900 outline-none focus:border-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-400'

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4 font-mono dark:bg-zinc-950">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-[0.3em] text-zinc-900 dark:text-zinc-100">
              FLOATING<span className="text-emerald-400">//</span>QUOTA
            </h1>
            <p className="mt-0.5 text-[10px] tracking-[0.2em] text-zinc-400 dark:text-zinc-600">
              PRIVATE — SIGN IN TO CONTINUE
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDark(d => !d)}
            className="flex items-center gap-1 text-[9px] tracking-[0.25em] text-zinc-400 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-100"
            aria-label="toggle theme"
          >
            {dark ? <Sun size={10} /> : <Moon size={10} />}
            {dark ? 'LIGHT' : 'DARK'}
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3 border border-zinc-200 p-4 dark:border-zinc-800">
          <label className="block">
            <span className="mb-1 block text-[10px] tracking-[0.25em] text-zinc-500">EMAIL</span>
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
            <span className="mb-1 block text-[10px] tracking-[0.25em] text-zinc-500">PASSWORD</span>
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
            <p className="text-[11px] tracking-wide text-red-400">{error.toUpperCase()}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 border border-zinc-900 bg-zinc-900 px-3 py-2.5 text-xs font-bold tracking-[0.2em] text-zinc-50 transition-colors hover:bg-transparent hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:text-zinc-100"
          >
            {loading ? 'LOADING...' : 'SIGN IN'} {!loading && <ChevronRight size={14} />}
          </button>
        </form>
      </div>
    </div>
  )
}
