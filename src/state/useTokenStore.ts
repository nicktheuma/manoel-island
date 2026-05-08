import { create } from 'zustand'

const DEMO_REFILL_MS = Number(import.meta.env.VITE_DEMO_REFILL_MS ?? 600_000)

type TokenState = {
  points: number
  nextRefillAt: string | null
  refillIntervalMs: number
  setFromServer: (points: number, nextRefillAt: string, intervalMs?: number) => void
  /** Demo / optimistic local decrement */
  applyCommitResult: (newPoints: number, nextRefillAt: string) => void
  /** Returns false if no points (local-only path) */
  tryConsumeLocal: () => boolean
  tickLocalRefill: () => void
  resetDemo: () => void
}

export const useTokenStore = create<TokenState>((set, get) => ({
  points: 3,
  nextRefillAt: new Date(Date.now() + DEMO_REFILL_MS).toISOString(),
  refillIntervalMs: DEMO_REFILL_MS,

  setFromServer: (points, nextRefillAt, intervalMs) =>
    set({
      points,
      nextRefillAt,
      refillIntervalMs: intervalMs ?? get().refillIntervalMs,
    }),

  applyCommitResult: (newPoints, nextRefillAt) => set({ points: newPoints, nextRefillAt }),

  tryConsumeLocal: () => {
    const { points, nextRefillAt, refillIntervalMs } = get()
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
    const { points, nextRefillAt, refillIntervalMs } = get()
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
    }),
}))
