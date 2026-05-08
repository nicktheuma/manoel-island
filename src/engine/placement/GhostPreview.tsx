import type { ThreeElements } from '@react-three/fiber'
import type { MeshStandardMaterial } from 'three'

type Props = ThreeElements['mesh'] & {
  material: MeshStandardMaterial
  scale: [number, number, number]
}

/** Semi-transparent placeholder until GLB assets are wired (see `public/models`). */
export function GhostPreview({ material, scale, ...rest }: Props) {
  return (
    <mesh castShadow receiveShadow scale={scale} {...rest}>
      <boxGeometry args={[1, 1, 1]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}
