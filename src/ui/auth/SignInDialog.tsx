import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getSupabase } from '../../services/supabase/client'

type Mode = 'sign-in' | 'sign-up'

type Props = {
  open: boolean
  onClose: () => void
}

export function SignInDialog({ open, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setInfo(null)
    const t = window.setTimeout(() => emailRef.current?.focus(), 30)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const sb = getSupabase()
    if (!sb) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.')
      return
    }
    setError(null)
    setInfo(null)
    setSubmitting(true)
    try {
      if (mode === 'sign-in') {
        const { error } = await sb.auth.signInWithPassword({ email, password })
        if (error) throw error
        onClose()
      } else {
        const { data, error } = await sb.auth.signUp({ email, password })
        if (error) throw error
        if (data.session) {
          onClose()
        } else {
          setInfo('Check your inbox to confirm the email, then sign in.')
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication failed.'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const tabBtn = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(m)
        setError(null)
        setInfo(null)
      }}
      className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
        mode === m ? 'bg-stone-100 text-stone-900' : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
      }`}
    >
      {label}
    </button>
  )

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'sign-in' ? 'Sign in' : 'Sign up'}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-[min(92vw,360px)] rounded-2xl border border-stone-800 bg-stone-950/95 p-5 shadow-2xl"
      >
        <div className="mb-4 flex gap-2">
          {tabBtn('sign-in', 'Sign in')}
          {tabBtn('sign-up', 'Sign up')}
        </div>

        <label className="mb-3 block text-[11px] uppercase tracking-wide text-stone-400">
          Email
          <input
            ref={emailRef}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 outline-none focus:border-amber-300/60"
          />
        </label>

        <label className="mb-4 block text-[11px] uppercase tracking-wide text-stone-400">
          Password
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 outline-none focus:border-amber-300/60"
          />
        </label>

        {error && (
          <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </p>
        )}
        {info && (
          <p className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            {info}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-stone-700 bg-transparent px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-300 hover:bg-stone-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-lg bg-amber-300 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-900 transition-colors hover:bg-amber-200 disabled:opacity-60"
          >
            {submitting ? '…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>
        </div>
      </form>
    </div>
  )

  return createPortal(dialog, document.body)
}
