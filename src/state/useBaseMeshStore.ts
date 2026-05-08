import { create } from 'zustand'
import type { BBox } from './useMapImportStore'

/**
 * Heightmap metadata sidecar emitted by `scripts/build-base-mesh.mjs` next
 * to the GLB. It lets the frontend sample the *exact same* terrain heights
 * that were baked into the LiDAR mesh, so OSM features (roads, buildings,
 * trees) snap onto real ground instead of the coarser Open-Meteo grid.
 */
export type BaseMeshHeightmap = {
  bbox: BBox
  grid: number
  zMin: number
  zMax: number
  scale: number
  exaggeration: number
  widthWorld: number
  depthWorld: number
  heights: Float32Array
}

type BaseMeshState = {
  /** URL the current heightmap was loaded from (for cache invalidation). */
  url: string | null
  loading: boolean
  error: string | null
  heightmap: BaseMeshHeightmap | null
  set: (state: Partial<BaseMeshState>) => void
  clear: () => void
}

export const useBaseMeshStore = create<BaseMeshState>((set) => ({
  url: null,
  loading: false,
  error: null,
  heightmap: null,
  set: (s) => set(s),
  clear: () => set({ url: null, loading: false, error: null, heightmap: null }),
}))

/**
 * Decodes the base64 heights blob in a metadata sidecar JSON into a
 * Float32Array. Returns `null` if the payload is malformed.
 */
export function decodeHeightsBase64(b64: string, expectedLength: number): Float32Array | null {
  try {
    const bin = atob(b64)
    const buf = new ArrayBuffer(bin.length)
    const u8 = new Uint8Array(buf)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    const f32 = new Float32Array(buf)
    if (f32.length !== expectedLength) return null
    return f32
  } catch {
    return null
  }
}

/**
 * Returns a function that bilinearly samples the LiDAR heightmap at world
 * (x, z) and returns the **world-space Y** that matches the baked GLB
 * surface — i.e. `(rawMetres - zMin) * scale * exaggeration`.
 *
 * World units, not lat/lon. Falls back to `0` outside the bbox.
 */
export function makeBaseMeshSampler(hm: BaseMeshHeightmap) {
  const { grid, widthWorld, depthWorld, heights, zMin, scale, exaggeration } = hm
  const k = scale * exaggeration
  return (x: number, z: number) => {
    const u = (x + widthWorld / 2) / widthWorld
    const v = (z + depthWorld / 2) / depthWorld
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0
    const fx = u * (grid - 1)
    const fy = v * (grid - 1)
    const ix = Math.min(grid - 2, Math.max(0, Math.floor(fx)))
    const iy = Math.min(grid - 2, Math.max(0, Math.floor(fy)))
    const tx = fx - ix
    const ty = fy - iy
    const h00 = heights[iy * grid + ix]
    const h10 = heights[iy * grid + (ix + 1)]
    const h01 = heights[(iy + 1) * grid + ix]
    const h11 = heights[(iy + 1) * grid + (ix + 1)]
    const hRaw =
      h00 * (1 - tx) * (1 - ty) +
      h10 * tx * (1 - ty) +
      h01 * (1 - tx) * ty +
      h11 * tx * ty
    return (hRaw - zMin) * k
  }
}
