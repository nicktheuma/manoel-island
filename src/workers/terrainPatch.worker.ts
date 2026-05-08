export type TerrainPatchMessage = {
  heights: Float32Array
  patches: [number, number][]
}

const w = self as unknown as DedicatedWorkerGlobalScope

w.onmessage = (e: MessageEvent<TerrainPatchMessage>) => {
  const { heights, patches } = e.data
  const out = new Float32Array(heights)
  const minY = -8
  const maxY = 24
  for (const [i, y] of patches) {
    if (i < 0 || i >= out.length) continue
    out[i] = Math.min(maxY, Math.max(minY, y))
  }
  w.postMessage({ out }, [out.buffer])
}

export {}
