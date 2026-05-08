import { create } from 'zustand'

const DEMO_REFILL_MS = Number(import.meta.env.VITE_DEMO_REFILL_MS ?? 600_000)

type TokenState = {
  points: number
  nextRefillAt: string | null
  refillIntervalMs: number
  /** Set by App.tsx after the admin-access check; true ⇒ never throttle. */
  unlimited: boolean
  setUnlimited: (v: boolean) => void
  setFromServer: (points: number, nextRefillAt: string, intervalMs?: number) => void
  /** Server-authoritative apply after a successful commit. */
  applyCommitResult: (newPoints: number, nextRefillAt: string | null, unlimited?: boolean) => void
  /** Demo-only optimistic decrement; never gates admins. Returns false if blocked. */
  tryConsumeLocal: () => boolean
  tickLocalRefill: () => void
  resetDemo: () => void
}

export const useTokenStore = create<TokenState>((set, get) => ({
  points: 3,
  nextRefillAt: new Date(Date.now() + DEMO_REFILL_MS).toISOString(),
  refillIntervalMs: DEMO_REFILL_MS,
  unlimited: false,

  setUnlimited: (v) => set({ unlimited: v }),

  setFromServer: (points, nextRefillAt, intervalMs) =>
    set({
      points,
      nextRefillAt,
      refillIntervalMs: intervalMs ?? get().refillIntervalMs,
    }),

  applyCommitResult: (newPoints, nextRefillAt, unlimited) =>
    set({
      points: unlimited ? -1 : newPoints,
      nextRefillAt: unlimited ? null : nextRefillAt,
      unlimited: unlimited ?? get().unlimited,
    }),

  tryConsumeLocal: () => {
    const { unlimited, points, nextRefillAt, refillIntervalMs } = get()
    if (unlimited) return true
    if (points < 1) return false
    const np = points - 1
    set({
      points: np,
      nextRefillAt:
        np === 0 ? new Date(Date.now() + refillIntervalMs).toISOString() : nextRefillAt,
    })
    return true
  },

  tickLocalRefill: () => {
    const { unlimited, points, nextRefillAt, refillIntervalMs } = get()
    if (unlimited) return
    if (!nextRefillAt) return
    const next = new Date(nextRefillAt).getTime()
    if (Date.now() < next) return
    set({
      points: Math.min(points + 1, 99),
      nextRefillAt: new Date(Date.now() + refillIntervalMs).toISOString(),
    })
  },

  resetDemo: () =>
    set({
      points: 3,
      nextRefillAt: new Date(Date.now() + DEMO_REFILL_MS).toISOString(),
      refillIntervalMs: DEMO_REFILL_MS,
      unlimited: false,
    }),
}))
