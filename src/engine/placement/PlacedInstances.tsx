import { useMemo } from 'react'
import * as THREE from 'three'
import { useWorldStore } from '../../state/useWorldStore'

function scaleForAsset(assetId: string): [number, number, number] {
  if (assetId.startsWith('building')) return [3.2, 4.2, 3.2]
  if (assetId.startsWith('tree')) return [1.2, 2.4, 1.2]
  if (assetId.startsWith('bench')) return [2.2, 0.9, 0.9]
  return [1.2, 1.2, 1.2]
}

export function PlacedInstances() {
  const placed = useWorldStore((s) => s.placed)
  const items = useMemo(() => [...placed.values()], [placed])

  return (
    <group name="PlacedObjects">
      {items.map((p) => {
        const m = new THREE.Matrix4().fromArray(p.matrix)
        const pos = new THREE.Vector3()
        const quat = new THREE.Quaternion()
        const scl = new THREE.Vector3()
        m.decompose(pos, quat, scl)
        const box = scaleForAsset(p.assetId)
        return (
          <mesh
            key={p.id}
            position={pos}
            quaternion={quat}
            scale={[box[0] * scl.x, box[1] * scl.y, box[2] * scl.z]}
            castShadow
            receiveShadow
            userData={{ placedId: p.id, assetId: p.assetId }}
          >
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#ffffff" roughness={1} metalness={0} />
          </mesh>
        )
      })}
    </group>
  )
}
