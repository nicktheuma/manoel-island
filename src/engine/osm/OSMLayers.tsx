import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useMapImportStore } from '../../state/useMapImportStore'
import { useUIStore } from '../../state/useUIStore'
import { useBaseMeshStore, makeBaseMeshSampler } from '../../state/useBaseMeshStore'
import {
  ELEVATION_EXAGGERATION,
  METERS_TO_WORLD,
  bboxCenterOffsetWorld,
  bboxWorldDimensions,
} from '../../services/osm/worldScale'

function pointInPolygon2D(px: number, py: number, polygon: Array<[number, number]>) {
  if (polygon.length < 3) return true
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0]
    const yi = polygon[i][1]
    const xj = polygon[j][0]
    const yj = polygon[j][1]
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi
    if (intersects) inside = !inside
  }
  return inside
}

/**
 * Bilinearly samples the imported heightmap at world (x, z) — used so OSM
 * features (roads, buildings, vegetation) can sit accurately on the terrain.
 */
function makeHeightSampler(
  width: number,
  height: number,
  heights: Float32Array,
  widthWorld: number,
  depthWorld: number,
  yMin: number,
) {
  return (x: number, z: number) => {
    const u = (x + widthWorld / 2) / widthWorld
    const v = (z + depthWorld / 2) / depthWorld
    if (u < 0 || u > 1 || v < 0 || v > 1) return yMin
    const fx = u * (width - 1)
    const fy = v * (height - 1)
    const ix = Math.min(width - 2, Math.max(0, Math.floor(fx)))
    const iy = Math.min(height - 2, Math.max(0, Math.floor(fy)))
    const tx = fx - ix
    const ty = fy - iy
    const h00 = heights[iy * width + ix]
    const h10 = heights[iy * width + (ix + 1)]
    const h01 = heights[(iy + 1) * width + ix]
    const h11 = heights[(iy + 1) * width + (ix + 1)]
    return (
      h00 * (1 - tx) * (1 - ty) +
      h10 * tx * (1 - ty) +
      h01 * (1 - tx) * ty +
      h11 * tx * ty
    )
  }
}

function WaterLayer({
  widthWorld,
  depthWorld,
  color,
}: {
  widthWorld: number
  depthWorld: number
  color: string
}) {
  const group = useRef<THREE.Group>(null)
  const polys = useMapImportStore((s) => s.water.polygons)
  useFrame(({ clock }) => {
    if (!group.current) return
    group.current.position.y = -0.2 + Math.sin(clock.getElapsedTime() * 1.3) * 0.03
  })

  // If no explicit OSM water, render an ambient sea plane sized to the bbox
  if (!polys.length) {
    return (
      <group ref={group}>
        <mesh
          rotation-x={-Math.PI / 2}
          position={[0, -0.05, 0]}
          receiveShadow
          renderOrder={-1}
        >
          <planeGeometry args={[Math.max(widthWorld, depthWorld) * 1.6, Math.max(widthWorld, depthWorld) * 1.6]} />
          <meshStandardMaterial color={color} roughness={0.85} metalness={0.05} />
        </mesh>
      </group>
    )
  }

  return (
    <group ref={group}>
      {polys.map((poly, i) => {
        // Pre-negate Z so that after `rotateX(-π/2)` (which flips Y→Z), the
        // shape lands at its real world Z instead of the mirror image.
        const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)))
        const geo = new THREE.ShapeGeometry(shape)
        return (
          <mesh key={`w-${i}`} geometry={geo} rotation-x={-Math.PI / 2} receiveShadow>
            <meshStandardMaterial color={color} roughness={0.85} metalness={0.05} side={THREE.DoubleSide} />
          </mesh>
        )
      })}
    </group>
  )
}

function HeightmapTerrain() {
  const terrain = useMapImportStore((s) => s.terrain)
  const bbox = useMapImportStore((s) => s.bbox)
  const outlineWorld = useMapImportStore((s) => s.outlineWorld)

  const geo = useMemo(() => {
    if (!terrain || !bbox) return null
    const { widthWorld, depthWorld } = bboxWorldDimensions(bbox)
    const g = new THREE.PlaneGeometry(widthWorld, depthWorld, terrain.width - 1, terrain.height - 1)
    const pos = g.attributes.position as THREE.BufferAttribute

    const minE = terrain.minElevation
    const maxE = terrain.maxElevation
    const elevSpan = Math.max(0.001, maxE - minE)

    const useOutline = outlineWorld.length >= 3
    const seaFloor = (minE - elevSpan * 0.4) * METERS_TO_WORLD * ELEVATION_EXAGGERATION

    for (let iy = 0; iy < terrain.height; iy++) {
      for (let ix = 0; ix < terrain.width; ix++) {
        const i = iy * terrain.width + ix
        const xPlane = pos.getX(i)
        const yPlane = pos.getY(i)
        const worldX = xPlane
        const worldZ = -yPlane

        const inside = useOutline
          ? pointInPolygon2D(worldX, worldZ, outlineWorld as Array<[number, number]>)
          : true

        if (inside) {
          const h = terrain.heights[i]
          const yWorld = (h - minE) * METERS_TO_WORLD * ELEVATION_EXAGGERATION
          pos.setZ(i, yWorld)
        } else {
          pos.setZ(i, seaFloor)
        }
      }
    }
    pos.needsUpdate = true
    g.rotateX(-Math.PI / 2)
    g.computeVertexNormals()
    return g
  }, [terrain, bbox, outlineWorld])

  if (!geo) return null

  return (
    <mesh geometry={geo} position={[0, 0, 0]} receiveShadow castShadow>
      <meshStandardMaterial color="#f5efe6" roughness={1} metalness={0} side={THREE.DoubleSide} />
    </mesh>
  )
}

function RoadsLayer({ sample }: { sample: (x: number, z: number) => number }) {
  const roads = useMapImportStore((s) => s.roads)
  return (
    <group>
      {roads.map((r, i) => (
        <Line
          key={`r-${i}`}
          points={r.points.map(([x, z]) => [x, sample(x, z) + 0.06, z])}
          color="#cbb89a"
          lineWidth={Math.max(1, r.width)}
        />
      ))}
    </group>
  )
}

function BuildingsLayer({ sample }: { sample: (x: number, z: number) => number }) {
  const buildings = useMapImportStore((s) => s.buildings)
  return (
    <group>
      {buildings.map((b, i) => {
        // Pre-negate Z because `rotateX(-π/2)` maps Vector2.y → world -Z,
        // and we want the building's footprint to land at its real world Z
        // (matching where roads/trees sit).
        const shape = new THREE.Shape(b.footprint.map(([x, z]) => new THREE.Vector2(x, -z)))
        const geo = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false })
        geo.rotateX(-Math.PI / 2)
        const cx = b.footprint.reduce((s, p) => s + p[0], 0) / b.footprint.length
        const cz = b.footprint.reduce((s, p) => s + p[1], 0) / b.footprint.length
        const yBase = sample(cx, cz)
        return (
          <mesh key={`b-${i}`} geometry={geo} position={[0, yBase, 0]} castShadow receiveShadow>
            {/* DoubleSide because OSM way-winding is not guaranteed CCW
                — without it some building walls render inside-out. */}
            <meshStandardMaterial color="#ffffff" roughness={1} metalness={0} side={THREE.DoubleSide} />
          </mesh>
        )
      })}
    </group>
  )
}

function VegetationLayer({ sample }: { sample: (x: number, z: number) => number }) {
  const points = useMapImportStore((s) => s.vegetation.points)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const ref = useRef<THREE.InstancedMesh>(null)
  // Cone is created with its origin at its centre. We translate the geometry
  // so its base is at local Y=0 — then setting position.y = sample(x, z)
  // makes the trunk sit *exactly* on the ground.
  const coneGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(0.4, 1, 5)
    g.translate(0, 0.5, 0)
    return g
  }, [])
  useFrame(({ clock }) => {
    if (!ref.current) return
    const pulse = 1 + Math.sin(clock.getElapsedTime() * 5) * 0.03
    points.forEach(([x, z], i) => {
      dummy.position.set(x, sample(x, z), z)
      dummy.scale.set(0.5 * pulse, 0.8 * pulse, 0.5 * pulse)
      dummy.updateMatrix()
      ref.current!.setMatrixAt(i, dummy.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
  })
  if (!points.length) return null
  return (
    <instancedMesh ref={ref} args={[coneGeo, undefined, points.length]} castShadow receiveShadow>
      <meshStandardMaterial color="#ffffff" roughness={1} metalness={0} />
    </instancedMesh>
  )
}

export function OSMLayers() {
  const cfg = useUIStore((s) => s.adminConfig)
  const terrain = useMapImportStore((s) => s.terrain)
  const bbox = useMapImportStore((s) => s.bbox)
  const baseHeightmap = useBaseMeshStore((s) => s.heightmap)

  // World origin is now anchored to the *picked* OSM bbox centre. The
  // LiDAR mesh translates itself to its true geographic position inside
  // that frame (see CustomIslandMesh.tsx), so the OSM group can stay at
  // origin and every feature lands at its real lat/lon.
  //
  // We still compute the LiDAR→world offset here so the height sampler
  // can ask the (origin-centred) LiDAR heightmap the right question —
  // a world-space (x, z) hits the LiDAR at LOCAL (x − dx, z − dz).
  const lidarGeoOffset = useMemo(() => {
    if (!baseHeightmap || !bbox) return { dx: 0, dz: 0 }
    return bboxCenterOffsetWorld(baseHeightmap.bbox, bbox)
  }, [baseHeightmap, bbox])

  // Prefer the high-resolution LiDAR heightmap (baked alongside the GLB)
  // whenever it is loaded — that way OSM features sit on the *exact* same
  // ground that the user sees, with realistic 1:1 elevation. Fall back to
  // the coarser Open-Meteo grid only when no LiDAR sidecar is available.
  const sample = useMemo(() => {
    if (baseHeightmap) {
      const inner = makeBaseMeshSampler(baseHeightmap)
      // The GLB primitive is rendered with `scale={customMeshScale}` and
      // `position={[lidarGeoOffset.dx, customMeshYOffset, lidarGeoOffset.dz]}`,
      // so a world-space point (x, z) maps to mesh-local
      //   ((x − dx) / scale, (z − dz) / scale)
      // and the mesh-local height must be re-scaled and offset to land
      // in world Y.
      const s = cfg.customMeshScale || 1
      const yOff = cfg.customMeshYOffset || 0
      const { dx, dz } = lidarGeoOffset
      return (x: number, z: number) => inner((x - dx) / s, (z - dz) / s) * s + yOff
    }
    if (terrain && bbox) {
      const { widthWorld, depthWorld } = bboxWorldDimensions(bbox)
      const yMin =
        (terrain.minElevation - 0.4 * (terrain.maxElevation - terrain.minElevation)) *
        METERS_TO_WORLD *
        ELEVATION_EXAGGERATION
      return makeHeightSampler(terrain.width, terrain.height, terrain.heights, widthWorld, depthWorld, yMin)
    }
    return (_x: number, _z: number) => 0
  }, [baseHeightmap, terrain, bbox, cfg.customMeshScale, cfg.customMeshYOffset, lidarGeoOffset])

  const dims = useMemo(() => {
    if (bbox) return bboxWorldDimensions(bbox)
    if (baseHeightmap) {
      return {
        widthWorld: baseHeightmap.widthWorld,
        depthWorld: baseHeightmap.depthWorld,
        widthMeters: baseHeightmap.widthWorld / METERS_TO_WORLD,
        depthMeters: baseHeightmap.depthWorld / METERS_TO_WORLD,
      }
    }
    return { widthWorld: 200, depthWorld: 200, widthMeters: 4000, depthMeters: 4000 }
  }, [bbox, baseHeightmap])

  if (!cfg.osmLayersEnabled) return null
  // Manual admin overrides on top of the (auto) world-anchored OSM frame.
  // Position is applied additively in world units; scaleY multiplies the
  // vertical axis only — horizontal scaling would break the lat/lon ↔ XZ
  // correspondence with the LiDAR mesh, which we want to preserve.
  return (
    <group
      name="OSMLayers"
      position={[cfg.osmOffsetX, cfg.osmOffsetY, cfg.osmOffsetZ]}
      scale={[1, cfg.osmScaleY, 1]}
    >
      {cfg.osmTerrainVisible && <HeightmapTerrain />}
      {cfg.osmSeaVisible && (
        <WaterLayer widthWorld={dims.widthWorld} depthWorld={dims.depthWorld} color={cfg.osmSeaColor} />
      )}
      {cfg.osmRoadsVisible && <RoadsLayer sample={sample} />}
      {cfg.osmBuildingsVisible && <BuildingsLayer sample={sample} />}
      {cfg.osmVegetationVisible && <VegetationLayer sample={sample} />}
    </group>
  )
}
