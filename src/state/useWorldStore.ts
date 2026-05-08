import { create } from 'zustand'
import type { ObjectPayload, SculptPayload, WorldEventRow, WorldEventType } from '../services/supabase/types'

export const CHUNK_GRID = 4
export const CHUNK_SIZE = 32
export const TERRAIN_RESOLUTION = 32

export function chunkKey(cx: number, cz: number) {
  return `${cx},${cz}`
}

export function chunkCenterWorld(cx: number, cz: number, grid: number, S: number) {
  const min = -(grid * S) / 2
  return {
    x: min + cx * S + S / 2,
    z: min + cz * S + S / 2,
  }
}

export function worldXZToChunk(worldX: number, worldZ: number) {
  const grid = CHUNK_GRID
  const S = CHUNK_SIZE
  const min = -(grid * S) / 2
  const cx = Math.min(grid - 1, Math.max(0, Math.floor((worldX - min) / S)))
  const cz = Math.min(grid - 1, Math.max(0, Math.floor((worldZ - min) / S)))
  const center = chunkCenterWorld(cx, cz, grid, S)
  return {
    cx,
    cz,
    lx: worldX - center.x,
    lz: worldZ - center.z,
  }
}

export type PlacedEntity = {
  id: string
  assetId: string
  matrix: number[]
}

type WorldState = {
  worldId: string
  chunkGrid: number
  chunkSize: number
  resolution: number
  heights: Map<string, Float32Array>
  placed: Map<string, PlacedEntity>
  pendingSculpt: Map<string, [number, number][]>
  initEmptyWorld: (worldId?: string) => void
  getHeights: (cx: number, cz: number) => Float32Array
  /** Preview: additive delta while brushing */
  applySculptDeltas: (cx: number, cz: number, deltas: [number, number][]) => void
  /** Commit / network: absolute height per vertex index */
  applySculptPatches: (cx: number, cz: number, patches: [number, number][]) => void
  queuePendingSculpt: (cx: number, cz: number, patches: [number, number][]) => void
  clearPendingSculpt: (cx: number, cz: number) => void
  upsertPlaced: (id: string, assetId: string, matrix: number[]) => void
  removePlaced: (id: string) => void
  applyRemoteEvent: (row: Pick<WorldEventRow, 'event_type' | 'payload'>) => void
  sampleHeightBilinear: (worldX: number, worldZ: number) => number
}

function makeFlatHeights(res: number, base = 0): Float32Array {
  const n = res * res
  const h = new Float32Array(n)
  if (base !== 0) h.fill(base)
  return h
}

/**
 * The canonical Manoel Island base world. Use a stable UUID so anyone
 * deploying the site points at the same Supabase row by default. Override
 * with `VITE_WORLD_ID` in `.env` to host a private fork.
 */
const DEFAULT_WORLD_ID =
  (import.meta.env.VITE_WORLD_ID as string | undefined) || '11111111-1111-4111-8111-111111111111'

export const useWorldStore = create<WorldState>((set, get) => ({
  worldId: DEFAULT_WORLD_ID,
  chunkGrid: CHUNK_GRID,
  chunkSize: CHUNK_SIZE,
  resolution: TERRAIN_RESOLUTION,
  heights: new Map(),
  placed: new Map(),
  pendingSculpt: new Map(),

  initEmptyWorld: (worldId) => {
    // Heights are interpreted as **deltas from the LiDAR base mesh**: zero
    // means "match the LiDAR exactly", positive means "raise this vertex
    // above the LiDAR" (infill), negative means "push it below" (excavate).
    // Starting flat at zero means a fresh world looks identical to the
    // pristine LiDAR; sculpting then visibly deforms it.
    const { chunkGrid, resolution } = get()
    const heights = new Map<string, Float32Array>()
    for (let cz = 0; cz < chunkGrid; cz++) {
      for (let cx = 0; cx < chunkGrid; cx++) {
        heights.set(chunkKey(cx, cz), makeFlatHeights(resolution, 0))
      }
    }
    set({ worldId: worldId ?? get().worldId, heights, placed: new Map(), pendingSculpt: new Map() })
  },

  getHeights: (cx, cz) => {
    const key = chunkKey(cx, cz)
    const { heights, resolution } = get()
    let arr = heights.get(key)
    if (!arr) {
      arr = makeFlatHeights(resolution)
      heights.set(key, arr)
    }
    return arr
  },

  applySculptDeltas: (cx, cz, deltas) => {
    // Clamp values are *delta* extremes (units = world). Keep them generous
    // enough for a useful 3D crater/mound but tight enough that a runaway
    // brush stroke can't hide the LiDAR baseline entirely.
    const key = chunkKey(cx, cz)
    const { heights, resolution } = get()
    const arr = heights.get(key) ?? makeFlatHeights(resolution)
    const next = new Float32Array(arr)
    const minY = -8
    const maxY = 24
    for (const [idx, dy] of deltas) {
      if (idx < 0 || idx >= next.length) continue
      next[idx] = Math.min(maxY, Math.max(minY, next[idx] + dy))
    }
    const nh = new Map(heights)
    nh.set(key, next)
    set({ heights: nh })
  },

  applySculptPatches: (cx, cz, patches) => {
    const key = chunkKey(cx, cz)
    const { heights, resolution } = get()
    const arr = heights.get(key) ?? makeFlatHeights(resolution)
    const next = new Float32Array(arr)
    const minY = -8
    const maxY = 24
    for (const [idx, y] of patches) {
      if (idx < 0 || idx >= next.length) continue
      next[idx] = Math.min(maxY, Math.max(minY, y))
    }
    const nh = new Map(heights)
    nh.set(key, next)
    set({ heights: nh })
  },

  queuePendingSculpt: (cx, cz, patches) => {
    const key = chunkKey(cx, cz)
    const { pendingSculpt } = get()
    const next = new Map(pendingSculpt)
    const cur = next.get(key) ?? []
    next.set(key, cur.concat(patches))
    set({ pendingSculpt: next })
  },

  clearPendingSculpt: (cx, cz) => {
    const key = chunkKey(cx, cz)
    const next = new Map(get().pendingSculpt)
    next.delete(key)
    set({ pendingSculpt: next })
  },

  upsertPlaced: (id, assetId, matrix) => {
    const next = new Map(get().placed)
    next.set(id, { id, assetId, matrix })
    set({ placed: next })
  },

  removePlaced: (id) => {
    const next = new Map(get().placed)
    next.delete(id)
    set({ placed: next })
  },

  applyRemoteEvent: (row) => {
    const { event_type, payload } = row
    if (event_type === 'SCULPT') {
      const p = payload as SculptPayload
      for (const c of p.chunks) {
        get().applySculptPatches(c.chunkX, c.chunkZ, c.patches)
      }
    } else if (event_type === 'ADD_OBJECT') {
      const p = payload as ObjectPayload
      const m = p.transform
      get().upsertPlaced(p.object_id, p.asset_id, m)
    } else if (event_type === 'UPDATE_OBJECT') {
      const p = payload as ObjectPayload
      get().upsertPlaced(p.object_id, p.asset_id, p.transform)
    } else if (event_type === 'REMOVE_OBJECT') {
      const p = payload as { object_id: string }
      get().removePlaced(p.object_id)
    }
  },

  sampleHeightBilinear: (worldX, worldZ) => {
    // Bilinearly samples the chunked delta-from-LiDAR heightmap at any
    // world XZ. Returns 0 outside the chunk grid so vertices beyond the
    // sculpt zone aren't displaced — gives the LiDAR shore/sea its
    // pristine shape regardless of how aggressively the centre is sculpted.
    const { chunkGrid, chunkSize } = get()
    const half = (chunkGrid * chunkSize) / 2
    if (worldX < -half || worldX > half || worldZ < -half || worldZ > half) return 0
    const { cx, cz, lx, lz } = worldXZToChunk(worldX, worldZ)
    const { resolution } = get()
    const arr = get().getHeights(cx, cz)
    const halfC = chunkSize / 2
    const u = ((lx + halfC) / chunkSize) * (resolution - 1)
    const v = ((lz + halfC) / chunkSize) * (resolution - 1)
    const x0 = Math.floor(u)
    const z0 = Math.floor(v)
    const x1 = Math.min(resolution - 1, x0 + 1)
    const z1 = Math.min(resolution - 1, z0 + 1)
    const tx = u - x0
    const tz = v - z0
    const h00 = arr[z0 * resolution + x0]
    const h10 = arr[z0 * resolution + x1]
    const h01 = arr[z1 * resolution + x0]
    const h11 = arr[z1 * resolution + x1]
    const a = h00 * (1 - tx) + h10 * tx
    const b = h01 * (1 - tx) + h11 * tx
    return a * (1 - tz) + b * tz
  },
}))

export function eventTypeGuard(t: string): t is WorldEventType {
  return ['SCULPT', 'ADD_OBJECT', 'UPDATE_OBJECT', 'REMOVE_OBJECT'].includes(t)
}
