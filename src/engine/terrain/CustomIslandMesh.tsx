import { useEffect, useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { useUIStore } from '../../state/useUIStore'
import { decodeHeightsBase64, useBaseMeshStore } from '../../state/useBaseMeshStore'

function CustomIslandMeshInner({ url }: { url: string }) {
  const gltf = useLoader(GLTFLoader, url)
  const cfg = useUIStore((s) => s.adminConfig)

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

  useEffect(() => {
    sceneClone.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh
        mesh.material = material
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
  }, [material, sceneClone])

  useEffect(() => {
    return () => {
      material.dispose()
    }
  }, [material])

  return (
    <primitive
      object={sceneClone}
      position={[0, cfg.customMeshYOffset, 0]}
      scale={cfg.customMeshScale}
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

export function CustomIslandMesh() {
  const cfg = useUIStore((s) => s.adminConfig)
  const url = cfg.customMeshUrl.trim()
  const enabled = cfg.customMeshEnabled && !!url
  useBaseMeshMetadata(enabled ? url : null)
  if (!enabled) return null
  return <CustomIslandMeshInner url={url} />
}

