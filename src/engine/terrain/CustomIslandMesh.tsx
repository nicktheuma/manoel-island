import { useEffect, useMemo, useRef } from 'react'
import { useLoader, type ThreeEvent } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { useUIStore } from '../../state/useUIStore'
import { decodeHeightsBase64, useBaseMeshStore } from '../../state/useBaseMeshStore'
import { useWorldStore } from '../../state/useWorldStore'
import type { SculptBrushApi } from './useSculptBrush'

type InnerProps = {
  url: string
  sculptActive: boolean
  sculpt: SculptBrushApi
}

function CustomIslandMeshInner({ url, sculptActive, sculpt }: InnerProps) {
  const gltf = useLoader(GLTFLoader, url)
  const cfg = useUIStore((s) => s.adminConfig)
  const heights = useWorldStore((s) => s.heights)
  const sampleDelta = useWorldStore((s) => s.sampleHeightBilinear)

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: cfg.customMeshColor,
        roughness: cfg.customMeshRoughness,
        metalness: cfg.customMeshMetalness,
        // BackSide effectively renders the mesh with its face winding/normals
        // inverted — Three.js negates the shading normal automatically, so
        // back faces light up correctly with the same lights as front faces.
        side: cfg.customMeshFlipNormals ? THREE.BackSide : THREE.FrontSide,
        shadowSide: cfg.customMeshFlipNormals ? THREE.BackSide : THREE.FrontSide,
      }),
    [
      cfg.customMeshColor,
      cfg.customMeshMetalness,
      cfg.customMeshRoughness,
      cfg.customMeshFlipNormals,
    ],
  )

  const sceneClone = useMemo(() => gltf.scene.clone(true), [gltf.scene])

  // Cache the *pristine* LiDAR vertex Ys once at load. Every subsequent
  // re-displacement starts from this baseline so deltas don't accumulate
  // and so the mesh can be reset cleanly when the heightmap clears.
  const baselines = useRef<
    Array<{ mesh: THREE.Mesh; originalY: Float32Array; positionAttr: THREE.BufferAttribute }>
  >([])

  useEffect(() => {
    const list: typeof baselines.current = []
    sceneClone.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return
      const mesh = obj as THREE.Mesh
      mesh.material = material
      mesh.castShadow = true
      mesh.receiveShadow = true
      const geom = mesh.geometry
      const pos = geom.attributes.position as THREE.BufferAttribute
      const originalY = new Float32Array(pos.count)
      for (let i = 0; i < pos.count; i++) originalY[i] = pos.getY(i)
      list.push({ mesh, originalY, positionAttr: pos })
    })
    baselines.current = list
  }, [sceneClone, material])

  // Re-displace all LiDAR vertices whenever the chunked delta heightmap
  // changes. We coalesce into a single rAF tick so a flurry of sculpt
  // strokes doesn't trigger one full mesh rebuild per pointer-move event.
  const scaleRef = useRef(cfg.customMeshScale)
  const yOffsetRef = useRef(cfg.customMeshYOffset)
  scaleRef.current = cfg.customMeshScale || 1
  yOffsetRef.current = cfg.customMeshYOffset || 0

  useEffect(() => {
    let frame = 0
    const apply = () => {
      frame = 0
      const scale = scaleRef.current
      // The mesh sits at world position (0, yOffset, 0) and is uniformly
      // scaled by `scale`. A vertex at LOCAL (lx, ly, lz) lands at WORLD
      //   (lx*scale, ly*scale + yOffset, lz*scale)
      // We sample the chunked heightmap by world XZ, scale the delta
      // back into local Y, then write to the buffer.
      for (const { mesh, originalY, positionAttr } of baselines.current) {
        const arr = positionAttr.array as Float32Array
        for (let i = 0; i < positionAttr.count; i++) {
          const lx = arr[i * 3 + 0]
          const lz = arr[i * 3 + 2]
          const wx = lx * scale
          const wz = lz * scale
          const deltaWorld = sampleDelta(wx, wz)
          arr[i * 3 + 1] = originalY[i] + deltaWorld / scale
        }
        positionAttr.needsUpdate = true
        mesh.geometry.computeVertexNormals()
        // Bounding sphere widens as terrain rises; refresh so frustum
        // culling and orbit-controls auto-fit stay accurate.
        mesh.geometry.computeBoundingSphere()
      }
    }
    frame = requestAnimationFrame(apply)
    return () => {
      if (frame) cancelAnimationFrame(frame)
    }
  }, [heights, sampleDelta])

  useEffect(() => {
    return () => {
      material.dispose()
    }
  }, [material])

  // Pointer handlers — only attach when sculpt mode is active so they
  // don't intercept orbit / placement clicks. The intersection point we
  // get is in *world* space, exactly what `paintAtWorld` expects.
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (!sculptActive) return
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    sculpt.beginStroke()
    sculpt.paintAtWorld(e.point)
  }
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!sculptActive) return
    if (e.buttons !== 1) return
    e.stopPropagation()
    sculpt.paintAtWorld(e.point)
  }
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    if (!sculptActive) return
    e.stopPropagation()
    sculpt.endStroke()
  }

  return (
    <primitive
      object={sceneClone}
      position={[0, cfg.customMeshYOffset, 0]}
      scale={cfg.customMeshScale}
      onPointerDown={sculptActive ? onDown : undefined}
      onPointerMove={sculptActive ? onMove : undefined}
      onPointerUp={sculptActive ? onUp : undefined}
    />
  )
}

/**
 * Fetches the heightmap sidecar JSON emitted by `scripts/build-base-mesh.mjs`
 * (e.g. `manoel-island.json` next to `manoel-island.glb`) and stores the
 * decoded Float32 heights so OSM features can snap to the LiDAR terrain.
 *
 * The sidecar is optional — if it 404s or the URL is not a `.glb`, OSM
 * features fall back to the (coarser) Open-Meteo heightmap.
 */
function useBaseMeshMetadata(url: string | null) {
  const setBaseMesh = useBaseMeshStore((s) => s.set)
  const clearBaseMesh = useBaseMeshStore((s) => s.clear)
  const currentUrl = useBaseMeshStore((s) => s.url)

  useEffect(() => {
    if (!url) {
      clearBaseMesh()
      return
    }
    if (currentUrl === url) return
    const metaUrl = url.replace(/\.glb($|\?)/i, '.json$1')
    if (metaUrl === url) {
      clearBaseMesh()
      return
    }
    let cancelled = false
    setBaseMesh({ url, loading: true, error: null, heightmap: null })
    fetch(metaUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`metadata ${res.status}`)
        return res.json()
      })
      .then((meta: {
        bbox: { south: number; west: number; north: number; east: number }
        grid: number
        zMin: number
        zMax: number
        scale: number
        exaggeration: number
        widthWorld: number
        depthWorld: number
        heightsBase64: string
      }) => {
        if (cancelled) return
        const heights = decodeHeightsBase64(meta.heightsBase64, meta.grid * meta.grid)
        if (!heights) throw new Error('malformed heights payload')
        setBaseMesh({
          url,
          loading: false,
          error: null,
          heightmap: {
            bbox: meta.bbox,
            grid: meta.grid,
            zMin: meta.zMin,
            zMax: meta.zMax,
            scale: meta.scale,
            exaggeration: meta.exaggeration,
            widthWorld: meta.widthWorld,
            depthWorld: meta.depthWorld,
            heights,
          },
        })
      })
      .catch((err) => {
        if (cancelled) return
        // Sidecar is optional, so a missing file is fine — OSM falls back
        // to the Open-Meteo heightmap.
        setBaseMesh({ url, loading: false, error: String(err), heightmap: null })
      })
    return () => {
      cancelled = true
    }
  }, [url, currentUrl, setBaseMesh, clearBaseMesh])
}

type Props = {
  sculptActive: boolean
  sculpt: SculptBrushApi
}

export function CustomIslandMesh({ sculptActive, sculpt }: Props) {
  const cfg = useUIStore((s) => s.adminConfig)
  const url = cfg.customMeshUrl.trim()
  const enabled = cfg.customMeshEnabled && !!url
  useBaseMeshMetadata(enabled ? url : null)
  if (!enabled) return null
  return <CustomIslandMeshInner url={url} sculptActive={sculptActive} sculpt={sculpt} />
}

