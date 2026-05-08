import { useCallback, useRef } from 'react'

/**
 * Applies absolute height patches off the main thread (chunk hot path / large commits).
 */
export function useTerrainWorker() {
  const workerRef = useRef<Worker | null>(null)

  const applyPatches = useCallback((heights: Float32Array, patches: [number, number][]) => {
    const copy = new Float32Array(heights)
    return new Promise<Float32Array>((resolve, reject) => {
      try {
        const worker = new Worker(new URL('../workers/terrainPatch.worker.ts', import.meta.url), {
          type: 'module',
        })
        worker.onmessage = (ev: MessageEvent<{ out: Float32Array }>) => {
          resolve(ev.data.out)
          worker.terminate()
        }
        worker.onerror = (err) => {
          worker.terminate()
          reject(err)
        }
        worker.postMessage({ heights: copy, patches })
      } catch (e) {
        reject(e)
      }
    })
  }, [])

  const dispose = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  return { applyPatches, dispose }
}
