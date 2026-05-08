import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { createPaperCraftMaterial } from '../materials/paperCraftMaterial'
import { buildTerrainGeometry } from './buildTerrainGeometry'
import { CHUNK_GRID, CHUNK_SIZE, TERRAIN_RESOLUTION, chunkCenterWorld } from '../../state/useWorldStore'

type Props = {
  chunkX: number
  chunkZ: number
  heights: Float32Array
  receivePointer?: boolean
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void
  onPointerUp?: (e: ThreeEvent<PointerEvent>) => void
}

export function TerrainChunk({
  chunkX,
  chunkZ,
  heights,
  receivePointer,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: Props) {
  const meshRef = useRef<THREE.Mesh>(null)
  const mat = useMemo(() => createPaperCraftMaterial(), [])

  const geom = useMemo(
    () => buildTerrainGeometry(CHUNK_SIZE, TERRAIN_RESOLUTION, heights),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild when buffer identity changes
    [heights],
  )

  useLayoutEffect(() => {
    const pos = geom.attributes.position as THREE.BufferAttribute
    const res = TERRAIN_RESOLUTION
    const half = CHUNK_SIZE / 2
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const i = z * res + x
        pos.setXYZ(i, (x / (res - 1)) * CHUNK_SIZE - half, heights[i] ?? 0, (z / (res - 1)) * CHUNK_SIZE - half)
      }
    }
    pos.needsUpdate = true
    geom.computeVertexNormals()
  }, [geom, heights])

  useEffect(() => {
    return () => {
      geom.dispose()
    }
  }, [geom])

  const { x, z } = chunkCenterWorld(chunkX, chunkZ, CHUNK_GRID, CHUNK_SIZE)

  return (
    <mesh
      ref={meshRef}
      geometry={geom}
      material={mat}
      position={[x, 0, z]}
      castShadow
      receiveShadow
      onPointerDown={receivePointer ? onPointerDown : undefined}
      onPointerMove={receivePointer ? onPointerMove : undefined}
      onPointerUp={receivePointer ? onPointerUp : undefined}
    />
  )
}
