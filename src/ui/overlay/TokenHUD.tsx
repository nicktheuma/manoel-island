import { useEffect, useMemo, useState } from 'react'
import { useTokenStore } from '../../state/useTokenStore'
import { isSupabaseConfigured } from '../../services/supabase/client'

function formatRemaining(iso: string | null) {
  if (!iso) return '—'
  const t = new Date(iso).getTime() - Date.now()
  if (t <= 0) return '0:00'
  const s = Math.floor(t / 1000)
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${m}:${rs.toString().padStart(2, '0')}`
}

export function TokenHUD() {
  const points = useTokenStore((s) => s.points)
  const nextRefillAt = useTokenStore((s) => s.nextRefillAt)
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [])

  const countdown = useMemo(() => formatRemaining(nextRefillAt), [nextRefillAt, points])

  return (
    <div className="pointer-events-auto absolute right-4 top-4 z-10 rounded-2xl border border-stone-800/80 bg-stone-950/85 px-4 py-3 shadow-xl backdrop-blur-md">
      <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">Action points</p>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-3xl font-bold tabular-nums text-stone-50">{points}</span>
        <span className="text-sm text-stone-400">
          Next <span className="tabular-nums text-stone-200">{countdown}</span>
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-stone-500">
        {isSupabaseConfigured()
          ? 'Tokens are enforced server-side via RPC + RLS.'
          : 'Demo mode: local refill timer (set VITE_DEMO_REFILL_MS).'}
      </p>
    </div>
  )
}
