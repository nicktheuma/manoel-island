import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CHUNK_GRID, CHUNK_SIZE, useWorldStore } from '../../state/useWorldStore'
import { createPaperCraftMaterial } from '../materials/paperCraftMaterial'

const COUNT = 64

/** Instanced trees: cone proxies + stop-motion scale pulse (~0.5s feel). */
export function InstancedTrees() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const mat = useMemo(() => createPaperCraftMaterial(), [])
  const geo = useMemo(() => new THREE.ConeGeometry(0.42, 1.55, 5), [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const xz = useRef(new Float32Array(COUNT * 2))
  const baseScale = useRef(new Float32Array(COUNT))
  const rotY = useRef(new Float32Array(COUNT))

  const sampleHeight = useWorldStore((s) => s.sampleHeightBilinear)

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const gridWorld = CHUNK_GRID * CHUNK_SIZE
    const margin = gridWorld * 0.08
    const min = -gridWorld / 2 + margin
    const span = gridWorld - margin * 2
    for (let k = 0; k < COUNT; k++) {
      const x = min + Math.random() * span
      const z = min + Math.random() * span
      xz.current[k * 2] = x
      xz.current[k * 2 + 1] = z
      baseScale.current[k] = 0.85 + Math.random() * 0.35
      rotY.current[k] = Math.random() * Math.PI * 2
      const y = useWorldStore.getState().sampleHeightBilinear(x, z)
      dummy.position.set(x, y + 0.85, z)
      dummy.scale.setScalar(baseScale.current[k])
      dummy.rotation.set(0, rotY.current[k], 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(k, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [dummy])

  useFrame(({ clock }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const t = clock.getElapsedTime()
    const wobble = 1 + Math.sin(t * Math.PI * 4) * 0.035
    for (let k = 0; k < COUNT; k++) {
      const x = xz.current[k * 2]
      const z = xz.current[k * 2 + 1]
      const y = sampleHeight(x, z)
      dummy.position.set(x, y + 0.85, z)
      const s = baseScale.current[k] * wobble
      dummy.scale.set(s, s * 1.12, s)
      dummy.rotation.set(0, rotY.current[k], 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(k, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[geo, mat, COUNT]} castShadow receiveShadow frustumCulled />
  )
}
