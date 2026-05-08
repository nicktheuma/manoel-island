import { useEffect, useState } from 'react'
import { WorldCanvas } from '../engine/canvas/WorldCanvas'
import { useSculptBrush } from '../engine/terrain/useSculptBrush'
import { useWorldStore } from '../state/useWorldStore'
import { useTokenStore } from '../state/useTokenStore'
import { useUIStore } from '../state/useUIStore'
import { fetchInitialWorldState, subscribeWorldEvents } from '../services/supabase/realtime'
import type { WorldEventRow } from '../services/supabase/types'
import { isSupabaseConfigured, getSupabase } from '../services/supabase/client'
import { getWorldAdminAccess, loadWorldAdminConfig, saveWorldAdminConfig } from '../services/supabase/admin'
import { AssetBrowser } from '../ui/sidebar/AssetBrowser'
import { TokenHUD } from '../ui/overlay/TokenHUD'
import { CommitBar } from '../ui/overlay/CommitBar'
import { SculptToolbar } from '../ui/overlay/SculptToolbar'
import { AdminPanel } from '../ui/admin/AdminPanel'
import { SignInDialog } from '../ui/auth/SignInDialog'

function ModeToolbar() {
  const mode = useUIStore((s) => s.interactionMode)
  const setMode = useUIStore((s) => s.setInteractionMode)
  const adminEnabled = useUIStore((s) => s.adminEnabled)
  const canAdmin = useUIStore((s) => s.canAdmin)
  const setAdminEnabled = useUIStore((s) => s.setAdminEnabled)

  const btn = (m: typeof mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${
        mode === m ? 'bg-stone-100 text-stone-900' : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="pointer-events-auto absolute left-1/2 top-4 z-10 flex -translate-x-1/2 gap-2 rounded-2xl border border-stone-800/80 bg-stone-950/80 p-2 backdrop-blur-md">
      {btn('orbit', 'Orbit')}
      {btn('sculpt', 'Sculpt')}
      {btn('place', 'Place')}
      {canAdmin && (
        <button
          type="button"
          onClick={() => setAdminEnabled(!adminEnabled)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${
            adminEnabled ? 'bg-amber-300 text-stone-900' : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
          }`}
        >
          Admin
        </button>
      )}
    </div>
  )
}

function AuthBanner() {
  const configured = isSupabaseConfigured()
  const [email, setEmail] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    const sb = getSupabase()
    if (!sb) return
    void sb.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? null)
    })
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user.email ?? null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!configured) {
    return (
      <div className="pointer-events-none absolute bottom-4 right-4 z-10 max-w-sm rounded-xl border border-amber-500/30 bg-stone-950/70 px-3 py-2 text-[11px] text-stone-400">
        Demo mode (no Supabase env). Realtime + auth use in-memory bus. Add{' '}
        <code className="text-amber-200/90">VITE_SUPABASE_URL</code> /{' '}
        <code className="text-amber-200/90">VITE_SUPABASE_ANON_KEY</code>.
      </div>
    )
  }

  async function signOut() {
    const sb = getSupabase()
    if (!sb) return
    setSigningOut(true)
    try {
      await sb.auth.signOut()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <>
      <div className="pointer-events-auto absolute bottom-4 right-4 z-10 flex items-center gap-2 rounded-xl border border-stone-800/80 bg-stone-950/80 px-3 py-2 text-[11px] text-stone-400">
        {email ? (
          <>
            <span>
              Signed in as <span className="text-stone-200">{email}</span>
            </span>
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="rounded-md border border-stone-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-stone-300 hover:bg-stone-800 disabled:opacity-60"
            >
              {signingOut ? '…' : 'Sign out'}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded-md bg-amber-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-stone-900 hover:bg-amber-200"
          >
            Sign in
          </button>
        )}
      </div>
      <SignInDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  )
}

export function App() {
  const sculpt = useSculptBrush()
  const initEmptyWorld = useWorldStore((s) => s.initEmptyWorld)
  const worldId = useWorldStore((s) => s.worldId)
  const adminConfig = useUIStore((s) => s.adminConfig)
  const setCanAdmin = useUIStore((s) => s.setCanAdmin)
  const setAdminConfig = useUIStore((s) => s.setAdminConfig)
  const setAdminEnabled = useUIStore((s) => s.setAdminEnabled)
  const [adminConfigHydrated, setAdminConfigHydrated] = useState(false)
  // Bumped on every auth state change so the admin-access effect below
  // re-runs the moment the user signs in or out, without a page reload.
  const [authTick, setAuthTick] = useState(0)

  useEffect(() => {
    const sb = getSupabase()
    if (!sb) return
    const { data: sub } = sb.auth.onAuthStateChange(() => {
      setAuthTick((t) => t + 1)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    // worldId comes from `useWorldStore`'s default (env `VITE_WORLD_ID` or
    // the canonical Manoel Island UUID). Keep this call so heights/placed
    // are reset to fresh state on mount.
    initEmptyWorld()
  }, [initEmptyWorld])

  useEffect(() => {
    const id = window.setInterval(() => useTokenStore.getState().tickLocalRefill(), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    let unsub: (() => void) | undefined

    ;(async () => {
      try {
        const { placed, events } = await fetchInitialWorldState(worldId)
        for (const po of placed) {
          useWorldStore.getState().upsertPlaced(po.id, po.asset_id, po.transform as number[])
        }
        for (const ev of events) {
          // Replay both sculpts and terrain resets in chronological order
          // so a RESET_TERRAIN at seq=N wipes all prior SCULPTs on cold
          // start. Object events are handled separately above via
          // `placed_objects` snapshot reads.
          if (ev.event_type === 'SCULPT' || ev.event_type === 'RESET_TERRAIN') {
            useWorldStore.getState().applyRemoteEvent(ev as Pick<WorldEventRow, 'event_type' | 'payload'>)
          }
        }
      } catch (e) {
        console.warn('Initial world load skipped:', e)
      }
      unsub = subscribeWorldEvents(worldId, (row) => {
        const r = row as WorldEventRow
        useWorldStore.getState().applyRemoteEvent(r)
      })
    })()

    return () => unsub?.()
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      // Two independent concerns, run in parallel:
      //   (a) Can the current viewer write admin settings? Drives the
      //       toolbar Admin button visibility.
      //   (b) What are the saved admin settings for this world? Drives
      //       what every viewer (signed-in or not) sees on the canvas —
      //       sea colour, mesh URL, OSM toggles, etc. RLS already permits
      //       anon reads on `world_admin_configs` for public worlds via
      //       `world_role()`, so we don't need to be signed in.
      const accessP = getWorldAdminAccess(worldId).catch((e) => {
        console.warn('Admin access check failed:', e)
        return false
      })
      const configP = loadWorldAdminConfig(worldId).catch((e) => {
        console.warn('Admin config load failed (using defaults):', e)
        return null
      })

      const [allowed, cfg] = await Promise.all([accessP, configP])
      if (!mounted) return

      setCanAdmin(allowed)
      // Owners and editors bypass the action-point throttle entirely.
      // Flip the token store flag in lock-step with `canAdmin` so the
      // HUD shows ∞ the moment we know who's signed in.
      useTokenStore.getState().setUnlimited(allowed)
      if (!allowed) setAdminEnabled(false)

      // Always hydrate from the server when we got a row back, even when
      // anonymous — that way the saved sea colour shows up in private
      // windows / signed-out browsers, exactly like a public CMS.
      if (cfg) setAdminConfig(cfg)
      setAdminConfigHydrated(true)
    })()
    return () => {
      mounted = false
    }
  }, [worldId, authTick, setAdminConfig, setCanAdmin, setAdminEnabled])

  // Persist admin-panel changes after a short debounce. Gated on
  // `canAdmin` so anon viewers (who hydrate the same state via RLS) don't
  // spam the server with rejected writes when their local config drifts.
  const canAdmin = useUIStore((s) => s.canAdmin)
  useEffect(() => {
    if (!isSupabaseConfigured() || !adminConfigHydrated || !canAdmin) return
    let cancelled = false
    const t = window.setTimeout(() => {
      void saveWorldAdminConfig(worldId, adminConfig).catch((e) => {
        if (!cancelled) console.warn('Admin config save failed:', e)
      })
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [worldId, adminConfig, adminConfigHydrated, canAdmin])

  return (
    <div className="relative h-full w-full overflow-hidden bg-stone-950">
      <WorldCanvas sculpt={sculpt} />
      <AssetBrowser />
      <ModeToolbar />
      <SculptToolbar />
      <TokenHUD />
      <CommitBar sculpt={sculpt} />
      <AdminPanel />
      <AuthBanner />
    </div>
  )
}
