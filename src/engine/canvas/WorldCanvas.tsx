import { Canvas } from '@react-three/fiber'
import { OrbitControls, SoftShadows } from '@react-three/drei'
import { Suspense, useState } from 'react'
import { TerrainSystem } from '../terrain/TerrainSystem'
import { CustomIslandMesh } from '../terrain/CustomIslandMesh'
import { PlacementManager } from '../placement/PlacementManager'
import { PlacedInstances } from '../placement/PlacedInstances'
import { InstancedTrees } from '../nature/InstancedTrees'
import { OSMLayers } from '../osm/OSMLayers'
import { useUIStore } from '../../state/useUIStore'
import type { SculptBrushApi } from '../terrain/useSculptBrush'

type Props = {
  sculpt: SculptBrushApi
}

function Scene({ sculpt }: Props) {
  const interactionMode = useUIStore((s) => s.interactionMode)
  const [orbitLocked, setOrbitLocked] = useState(false)
  const sculptActive = interactionMode === 'sculpt'
  const placeActive = interactionMode === 'place'
  const adminConfig = useUIStore((s) => s.adminConfig)

  return (
    <>
      <color attach="background" args={['#e8e4df']} />
      <fog attach="fog" args={['#e8e4df', 120, 280]} />
      <ambientLight intensity={0.58} />
      <directionalLight
        castShadow
        position={[38, 56, 28]}
        intensity={1.08}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={2}
        shadow-camera-far={240}
        shadow-camera-left={-96}
        shadow-camera-right={96}
        shadow-camera-top={96}
        shadow-camera-bottom={-96}
      />
      <SoftShadows size={28} samples={14} focus={0.35} />
      {adminConfig.terrainVisible && <TerrainSystem sculptActive={sculptActive} sculpt={sculpt} />}
      {adminConfig.treesVisible && <InstancedTrees />}
      <OSMLayers />
      <CustomIslandMesh />
      <PlacedInstances />
      <PlacementManager active={placeActive} onTransformDragging={setOrbitLocked} />
      <OrbitControls
        makeDefault
        enabled={interactionMode === 'orbit' && !orbitLocked}
        enableDamping
        maxPolarAngle={Math.PI / 2 - 0.06}
        minDistance={18}
        maxDistance={220}
      />
    </>
  )
}

export function WorldCanvas({ sculpt }: Props) {
  return (
    <div className="h-full w-full min-h-0 touch-none">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: [62, 48, 62], fov: 42, near: 0.4, far: 420 }}
      >
        <Suspense fallback={null}>
          <Scene sculpt={sculpt} />
        </Suspense>
      </Canvas>
    </div>
  )
}
