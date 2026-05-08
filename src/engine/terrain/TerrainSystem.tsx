import { useMemo } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { TerrainChunk } from './TerrainChunk'
import { CHUNK_GRID, useWorldStore } from '../../state/useWorldStore'
import type { SculptBrushApi } from './useSculptBrush'

type Props = {
  sculptActive: boolean
  sculpt: SculptBrushApi
}

export function TerrainSystem({ sculptActive, sculpt }: Props) {
  const heightsMap = useWorldStore((s) => s.heights)
  const { paintAtWorld, beginStroke, endStroke } = sculpt

  const chunks = useMemo(() => {
    const list: { cx: number; cz: number; h: Float32Array }[] = []
    for (let cz = 0; cz < CHUNK_GRID; cz++) {
      for (let cx = 0; cx < CHUNK_GRID; cx++) {
        const key = `${cx},${cz}`
        const h = heightsMap.get(key)
        if (h) list.push({ cx, cz, h })
      }
    }
    return list
  }, [heightsMap])

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (!sculptActive) return
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    beginStroke()
    paintAtWorld(e.point)
  }

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!sculptActive) return
    if (e.buttons !== 1) return
    e.stopPropagation()
    paintAtWorld(e.point)
  }

  const onUp = (e: ThreeEvent<PointerEvent>) => {
    if (!sculptActive) return
    e.stopPropagation()
    endStroke()
  }

  return (
    <group name="TerrainRoot">
      {chunks.map(({ cx, cz, h }) => (
        <TerrainChunk
          key={`${cx}-${cz}`}
          chunkX={cx}
          chunkZ={cz}
          heights={h}
          receivePointer={sculptActive}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        />
      ))}
    </group>
  )
}
