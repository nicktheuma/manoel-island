import { useCallback, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { useUIStore } from '../../state/useUIStore'
import {
  CHUNK_SIZE,
  TERRAIN_RESOLUTION,
  chunkKey,
  useWorldStore,
  worldXZToChunk,
} from '../../state/useWorldStore'

export type SculptBrushApi = {
  isDragging: MutableRefObject<boolean>
  paintAtWorld: (worldPoint: THREE.Vector3) => void
  beginStroke: () => void
  endStroke: () => void
  collectPatchesForCommit: () => { chunkX: number; chunkZ: number; patches: [number, number][] }[]
}

export function useSculptBrush(): SculptBrushApi {
  const isDragging = useRef(false)
  const touched = useRef(new Map<string, Set<number>>())

  const ensureTouched = (cx: number, cz: number) => {
    const key = chunkKey(cx, cz)
    let set = touched.current.get(key)
    if (!set) {
      set = new Set()
      touched.current.set(key, set)
    }
    return set
  }

  const paintAtWorld = useCallback((worldPoint: THREE.Vector3) => {
    const brushRadius = useUIStore.getState().brushRadius
    const brushStrength = useUIStore.getState().brushStrength
    const brushMode = useUIStore.getState().brushMode
    const res = TERRAIN_RESOLUTION
    const half = CHUNK_SIZE / 2
    const { cx, cz, lx, lz } = worldXZToChunk(worldPoint.x, worldPoint.z)
    const u = ((lx + half) / CHUNK_SIZE) * (res - 1)
    const v = ((lz + half) / CHUNK_SIZE) * (res - 1)
    const ix = Math.round(u)
    const iz = Math.round(v)
    const radiusVerts = Math.ceil((brushRadius / CHUNK_SIZE) * (res - 1)) + 1
    const deltas: [number, number][] = []
    const set = ensureTouched(cx, cz)

    for (let dz = -radiusVerts; dz <= radiusVerts; dz++) {
      for (let dx = -radiusVerts; dx <= radiusVerts; dx++) {
        const x = ix + dx
        const z = iz + dz
        if (x < 0 || z < 0 || x >= res || z >= res) continue
        const wx = (x / (res - 1)) * CHUNK_SIZE - half
        const wz = (z / (res - 1)) * CHUNK_SIZE - half
        const dist = Math.hypot(wx - lx, wz - lz)
        if (dist > brushRadius) continue
        const falloff = 1 - dist / brushRadius
        const idx = z * res + x
        const dy =
          brushMode === 'infill'
            ? brushStrength * falloff
            : -brushStrength * falloff
        deltas.push([idx, dy])
        set.add(idx)
      }
    }
    if (deltas.length) {
      useWorldStore.getState().applySculptDeltas(cx, cz, deltas)
    }
  }, [])

  const beginStroke = useCallback(() => {
    isDragging.current = true
  }, [])

  const endStroke = useCallback(() => {
    isDragging.current = false
  }, [])

  /** Build absolute patches for all touched verts in this stroke (per chunk). */
  const collectPatchesForCommit = useCallback(() => {
    const out: { chunkX: number; chunkZ: number; patches: [number, number][] }[] = []
    for (const key of touched.current.keys()) {
      const [sx, sz] = key.split(',').map(Number)
      const set = touched.current.get(key)!
      const heights = useWorldStore.getState().getHeights(sx, sz)
      const patches: [number, number][] = []
      set.forEach((idx) => {
        patches.push([idx, heights[idx]])
      })
      if (patches.length) out.push({ chunkX: sx, chunkZ: sz, patches })
    }
    touched.current.clear()
    return out
  }, [])

  return {
    isDragging,
    paintAtWorld,
    beginStroke,
    endStroke,
    collectPatchesForCommit,
  }
}
