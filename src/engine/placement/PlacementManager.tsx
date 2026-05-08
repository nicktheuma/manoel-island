import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { TransformControls } from '@react-three/drei'
import { useUIStore } from '../../state/useUIStore'
import { usePlacementStore } from '../../state/usePlacementStore'
import { createPaperCraftMaterial } from '../materials/paperCraftMaterial'
import { GhostPreview } from './GhostPreview'

function scaleForAsset(assetId: string): [number, number, number] {
  if (assetId.startsWith('building')) return [3.2, 4.2, 3.2]
  if (assetId.startsWith('tree')) return [1.2, 2.4, 1.2]
  if (assetId.startsWith('bench')) return [2.2, 0.9, 0.9]
  return [1.2, 1.2, 1.2]
}

type Props = {
  active: boolean
  onTransformDragging: (dragging: boolean) => void
}

export function PlacementManager({ active, onTransformDragging }: Props) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const pointer = useMemo(() => new THREE.Vector2(), [])

  const selectedAssetId = useUIStore((s) => s.selectedAssetId)
  const setShowGizmo = useUIStore((s) => s.setShowTransformGizmo)
  const gizmoMode = useUIStore((s) => s.gizmoMode)
  const draft = usePlacementStore((s) => s.draft)

  const ghostRef = useRef<THREE.Group>(null)
  const [locked, setLocked] = useState(false)
  const [transformTarget, setTransformTarget] = useState<THREE.Object3D | null>(null)
  const tcRef = useRef<{ addEventListener: typeof EventTarget.prototype.addEventListener; removeEventListener: typeof EventTarget.prototype.removeEventListener } | null>(null)

  const ghostMat = useMemo(() => {
    const m = createPaperCraftMaterial()
    m.transparent = true
    m.opacity = 0.5
    m.depthWrite = false
    return m
  }, [])

  useEffect(() => {
    if (!active) {
      setLocked(false)
      setTransformTarget(null)
      usePlacementStore.getState().setDraft(null)
      setShowGizmo(false)
      if (ghostRef.current) ghostRef.current.visible = false
    }
  }, [active, setShowGizmo])

  useEffect(() => {
    setLocked(false)
    setTransformTarget(null)
    usePlacementStore.getState().setDraft(null)
  }, [selectedAssetId])

  useEffect(() => {
    if (!draft) {
      setLocked(false)
      setTransformTarget(null)
      setShowGizmo(false)
    }
  }, [draft, setShowGizmo])

  useEffect(() => {
    const ctrl = tcRef.current
    if (!ctrl) return
    const onDraggingChanged = (event: Event & { value?: boolean }) => {
      onTransformDragging(Boolean((event as { value?: boolean }).value))
    }
    ctrl.addEventListener('dragging-changed', onDraggingChanged)
    return () => ctrl.removeEventListener('dragging-changed', onDraggingChanged)
  }, [transformTarget, onTransformDragging])

  useEffect(() => {
    if (!active || !selectedAssetId || locked) return

    const el = gl.domElement
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const terrain = scene.getObjectByName('TerrainRoot')
      if (!terrain || !ghostRef.current) return
      const hits = raycaster.intersectObject(terrain, true)
      if (hits[0]) {
        ghostRef.current.visible = true
        ghostRef.current.position.copy(hits[0].point)
        ghostRef.current.updateMatrixWorld(true)
      }
    }

    el.addEventListener('pointermove', onMove)
    return () => el.removeEventListener('pointermove', onMove)
  }, [active, selectedAssetId, locked, gl, camera, scene, raycaster, pointer])

  useEffect(() => {
    if (!active || !selectedAssetId || locked) return
    const el = gl.domElement
    const onDown = () => {
      if (!ghostRef.current?.visible) return
      const id = crypto.randomUUID()
      ghostRef.current.updateMatrixWorld(true)
      const matrix = ghostRef.current.matrixWorld.toArray() as number[]
      usePlacementStore.getState().setDraft({
        objectId: id,
        assetId: selectedAssetId,
        matrix,
      })
      setLocked(true)
      setTransformTarget(ghostRef.current)
      setShowGizmo(true)
    }
    el.addEventListener('pointerdown', onDown)
    return () => el.removeEventListener('pointerdown', onDown)
  }, [active, selectedAssetId, locked, gl, setShowGizmo])

  const boxScale = (selectedAssetId ? scaleForAsset(selectedAssetId) : [1, 1, 1]) as [
    number,
    number,
    number,
  ]

  return (
    <group>
      <group ref={ghostRef} visible={false}>
        <GhostPreview material={ghostMat} scale={boxScale} castShadow receiveShadow />
      </group>

      {locked && transformTarget && (
        <TransformControls
          ref={tcRef as never}
          object={transformTarget}
          mode={gizmoMode}
          onObjectChange={() => {
            if (!ghostRef.current) return
            ghostRef.current.updateMatrixWorld(true)
            const matrix = ghostRef.current.matrixWorld.toArray() as number[]
            usePlacementStore.getState().updateMatrix(matrix)
          }}
        />
      )}
    </group>
  )
}
