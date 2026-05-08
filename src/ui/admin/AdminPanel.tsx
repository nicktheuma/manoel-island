import { ChangeEvent, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useUIStore } from '../../state/useUIStore'
import { useWorldStore } from '../../state/useWorldStore'
import { commitWorldEvent } from '../../services/supabase/commits'
import { MapImportPanel } from './MapImportPanel'

const rangeClass = 'w-full accent-amber-300'
const inputClass =
  'w-full rounded-lg border border-stone-700 bg-stone-900 px-2 py-1.5 text-xs text-stone-100'

export function AdminPanel() {
  const adminEnabled = useUIStore((s) => s.adminEnabled)
  const canAdmin = useUIStore((s) => s.canAdmin)
  const cfg = useUIStore((s) => s.adminConfig)
  const patch = useUIStore((s) => s.patchAdminConfig)
  const [importOpen, setImportOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [pos, setPos] = useState({ x: 16, y: 80 })
  const dragRef = useRef<{
    dragging: boolean
    startMouseX: number
    startMouseY: number
    startX: number
    startY: number
  }>({
    dragging: false,
    startMouseX: 0,
    startMouseY: 0,
    startX: 16,
    startY: 80,
  })

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.dragging) return
      const dx = e.clientX - dragRef.current.startMouseX
      const dy = e.clientY - dragRef.current.startMouseY
      const nextX = Math.max(8, dragRef.current.startX + dx)
      const nextY = Math.max(8, dragRef.current.startY + dy)
      setPos({ x: nextX, y: nextY })
    }
    const onUp = () => {
      dragRef.current.dragging = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const onDragStart = (e: ReactMouseEvent<HTMLDivElement>) => {
    dragRef.current.dragging = true
    dragRef.current.startMouseX = e.clientX
    dragRef.current.startMouseY = e.clientY
    dragRef.current.startX = pos.x
    dragRef.current.startY = pos.y
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const objUrl = URL.createObjectURL(file)
    patch({ customMeshUrl: objUrl, customMeshEnabled: true })
  }

  const onResetTerrain = async () => {
    const ok = window.confirm(
      'Reset the terrain to the original LiDAR mesh?\n\n' +
        'This wipes every sculpt across all users. The action is broadcast in real time and cannot be undone.',
    )
    if (!ok) return
    setResetting(true)
    try {
      const worldId = useWorldStore.getState().worldId
      await commitWorldEvent(worldId, 'RESET_TERRAIN', {})
      // The realtime subscription will also clear local state, but doing
      // it eagerly here keeps the admin's own canvas snappy without
      // waiting for the round-trip.
      useWorldStore.getState().resetHeights()
    } catch (e) {
      console.error('Reset terrain failed:', e)
      window.alert('Reset failed (see console).')
    } finally {
      setResetting(false)
    }
  }

  if (!adminEnabled || !canAdmin) return null

  return (
    <aside
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      className="pointer-events-auto absolute z-20 w-80 max-h-[80vh] overflow-y-auto rounded-2xl border border-stone-800/90 bg-stone-950/90 p-4 shadow-2xl backdrop-blur-md"
    >
      <div
        onMouseDown={onDragStart}
        className="-mx-2 -mt-2 mb-2 cursor-move rounded-xl px-2 py-2 select-none bg-stone-900/60"
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">Admin Mode</p>
        <p className="mt-1 text-xs text-stone-400">
          Drag this header to move. Panel scrolls when content is long.
        </p>
      </div>

      <div className="mt-3 border-t border-stone-800 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">Terrain</p>
        <button
          type="button"
          onClick={() => void onResetTerrain()}
          disabled={resetting}
          className="mt-2 w-full rounded bg-red-500/90 px-2 py-1.5 text-[11px] font-semibold text-stone-50 transition-colors enabled:hover:bg-red-500 disabled:opacity-60"
        >
          {resetting ? 'Resetting…' : 'Reset terrain to LiDAR'}
        </button>
        <p className="mt-1 text-[10px] leading-snug text-stone-500">
          Wipes every sculpt across all users and broadcasts the reset in real time.
        </p>
      </div>

      <div className="mt-4 space-y-2 text-xs">
        <label className="flex items-center justify-between">
          <span className="text-stone-300">Show sculpt fallback terrain</span>
          <input
            type="checkbox"
            checked={cfg.terrainVisible}
            onChange={(e) => patch({ terrainVisible: e.target.checked })}
          />
        </label>
        <p className="text-[10px] leading-snug text-stone-500">
          Only shown when the LiDAR mesh is disabled below — the chunked plane is the
          fallback canvas in worlds without a base mesh.
        </p>
        <label className="flex items-center justify-between">
          <span className="text-stone-300">Show trees</span>
          <input
            type="checkbox"
            checked={cfg.treesVisible}
            onChange={(e) => patch({ treesVisible: e.target.checked })}
          />
        </label>
      </div>

      <div className="mt-4 border-t border-stone-800 pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-stone-300">OSM Layer Import</span>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="rounded bg-amber-300 px-2 py-1 text-[11px] font-semibold text-stone-900"
          >
            Pick Extents
          </button>
        </div>
        <label className="flex items-center justify-between text-xs">
          <span className="text-stone-300">Enable OSM layers</span>
          <input
            type="checkbox"
            checked={cfg.osmLayersEnabled}
            onChange={(e) => patch({ osmLayersEnabled: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between text-xs">
          <span className="text-stone-300">OSM heightmap terrain</span>
          <input
            type="checkbox"
            checked={cfg.osmTerrainVisible}
            onChange={(e) => patch({ osmTerrainVisible: e.target.checked })}
          />
        </label>
        <p className="text-[10px] leading-snug text-stone-500">
          Off by default — the LiDAR base mesh is the source of truth. Turn on to overlay
          the (lower-resolution) Open-Meteo heightmap of the OSM area.
        </p>
        <label className="flex items-center justify-between text-xs">
          <span className="text-stone-300">Sea</span>
          <input type="checkbox" checked={cfg.osmSeaVisible} onChange={(e) => patch({ osmSeaVisible: e.target.checked })} />
        </label>
        <label className="block text-[11px] text-stone-400">
          Sea colour
          <input
            type="color"
            value={cfg.osmSeaColor}
            onChange={(e) => patch({ osmSeaColor: e.target.value })}
            className="mt-1 h-8 w-full rounded border border-stone-700 bg-transparent"
          />
        </label>
        <label className="flex items-center justify-between text-xs">
          <span className="text-stone-300">Roads</span>
          <input
            type="checkbox"
            checked={cfg.osmRoadsVisible}
            onChange={(e) => patch({ osmRoadsVisible: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between text-xs">
          <span className="text-stone-300">Buildings</span>
          <input
            type="checkbox"
            checked={cfg.osmBuildingsVisible}
            onChange={(e) => patch({ osmBuildingsVisible: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between text-xs">
          <span className="text-stone-300">Trees/Vegetation</span>
          <input
            type="checkbox"
            checked={cfg.osmVegetationVisible}
            onChange={(e) => patch({ osmVegetationVisible: e.target.checked })}
          />
        </label>

        <div className="mt-3 border-t border-stone-800 pt-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">
            OSM transform
          </p>
          <p className="text-[10px] leading-snug text-stone-500">
            Manual nudges on top of the auto-anchored OSM group. Reset to 0 to fall back to
            the geographic alignment.
          </p>

          <label className="block text-[11px] text-stone-400">
            Buildings vertical offset
            <span className="ml-1 tabular-nums text-stone-200">
              {cfg.osmBuildingsYOffset.toFixed(2)}
            </span>
            <input
              className={rangeClass}
              type="range"
              min={-10}
              max={20}
              step={0.05}
              value={cfg.osmBuildingsYOffset}
              onChange={(e) => patch({ osmBuildingsYOffset: Number(e.target.value) })}
            />
            <p className="mt-0.5 text-[10px] leading-snug text-stone-500">
              Lifts or sinks building footprints relative to the LiDAR ground without
              scaling them or affecting roads, trees, sea, or terrain.
            </p>
          </label>

          <label className="block text-[11px] text-stone-400">
            X position
            <span className="ml-1 tabular-nums text-stone-200">{cfg.osmOffsetX.toFixed(2)}</span>
            <input
              className={rangeClass}
              type="range"
              min={-100}
              max={100}
              step={0.1}
              value={cfg.osmOffsetX}
              onChange={(e) => patch({ osmOffsetX: Number(e.target.value) })}
            />
          </label>
          <label className="block text-[11px] text-stone-400">
            Y position
            <span className="ml-1 tabular-nums text-stone-200">{cfg.osmOffsetY.toFixed(2)}</span>
            <input
              className={rangeClass}
              type="range"
              min={-50}
              max={50}
              step={0.1}
              value={cfg.osmOffsetY}
              onChange={(e) => patch({ osmOffsetY: Number(e.target.value) })}
            />
          </label>
          <label className="block text-[11px] text-stone-400">
            Z position
            <span className="ml-1 tabular-nums text-stone-200">{cfg.osmOffsetZ.toFixed(2)}</span>
            <input
              className={rangeClass}
              type="range"
              min={-100}
              max={100}
              step={0.1}
              value={cfg.osmOffsetZ}
              onChange={(e) => patch({ osmOffsetZ: Number(e.target.value) })}
            />
          </label>

          <button
            type="button"
            onClick={() =>
              patch({ osmBuildingsYOffset: 0, osmOffsetX: 0, osmOffsetY: 0, osmOffsetZ: 0 })
            }
            className="w-full rounded bg-stone-800 px-2 py-1 text-[11px] text-stone-200 hover:bg-stone-700"
          >
            Reset OSM transform
          </button>
        </div>
      </div>

      <div className="mt-4 border-t border-stone-800 pt-3">
        <label className="flex items-center justify-between text-xs">
          <span className="text-stone-300">Enable custom mesh</span>
          <input
            type="checkbox"
            checked={cfg.customMeshEnabled}
            onChange={(e) => patch({ customMeshEnabled: e.target.checked })}
          />
        </label>
        <label className="mt-2 flex items-center justify-between text-xs">
          <span className="text-stone-300">Flip mesh normals</span>
          <input
            type="checkbox"
            checked={cfg.customMeshFlipNormals}
            onChange={(e) => patch({ customMeshFlipNormals: e.target.checked })}
          />
        </label>

        <div className="mt-3 space-y-2">
          <button
            type="button"
            onClick={() => patch({ customMeshUrl: '/models/manoel-island.glb', customMeshEnabled: true })}
            className="w-full rounded bg-amber-300 px-2 py-1 text-[11px] font-semibold text-stone-900"
          >
            Use Manoel base mesh
          </button>
          <p className="text-[10px] leading-snug text-stone-500">
            Loads the prebuilt CloudIsle LiDAR mesh from <code>/models/manoel-island.glb</code>.
            Run <code>npm run build-base-mesh</code> to generate it.
          </p>
          <label className="block text-[11px] text-stone-400">GLB/GLTF URL or public path</label>
          <input
            className={inputClass}
            placeholder="/models/manoel-island.glb"
            value={cfg.customMeshUrl}
            onChange={(e) => patch({ customMeshUrl: e.target.value })}
          />
          <label className="block text-[11px] text-stone-400">Or upload local GLB</label>
          <input className="block w-full text-xs text-stone-300" type="file" accept=".glb,.gltf" onChange={onFile} />
        </div>
      </div>

      <div className="mt-4 border-t border-stone-800 pt-3 space-y-3">
        <label className="block text-[11px] text-stone-400">
          Mesh color
          <input
            type="color"
            value={cfg.customMeshColor}
            onChange={(e) => patch({ customMeshColor: e.target.value })}
            className="mt-1 h-8 w-full rounded border border-stone-700 bg-transparent"
          />
        </label>

        <label className="block text-[11px] text-stone-400">
          Roughness: {cfg.customMeshRoughness.toFixed(2)}
          <input
            className={rangeClass}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={cfg.customMeshRoughness}
            onChange={(e) => patch({ customMeshRoughness: Number(e.target.value) })}
          />
        </label>

        <label className="block text-[11px] text-stone-400">
          Metalness: {cfg.customMeshMetalness.toFixed(2)}
          <input
            className={rangeClass}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={cfg.customMeshMetalness}
            onChange={(e) => patch({ customMeshMetalness: Number(e.target.value) })}
          />
        </label>

        <label className="block text-[11px] text-stone-400">
          Scale: {cfg.customMeshScale.toFixed(2)}
          <input
            className={rangeClass}
            type="range"
            min={0.1}
            max={10}
            step={0.05}
            value={cfg.customMeshScale}
            onChange={(e) => patch({ customMeshScale: Number(e.target.value) })}
          />
        </label>

        <label className="block text-[11px] text-stone-400">
          Y offset: {cfg.customMeshYOffset.toFixed(2)}
          <input
            className={rangeClass}
            type="range"
            min={-50}
            max={50}
            step={0.1}
            value={cfg.customMeshYOffset}
            onChange={(e) => patch({ customMeshYOffset: Number(e.target.value) })}
          />
        </label>
      </div>
      <MapImportPanel open={importOpen} onClose={() => setImportOpen(false)} />
    </aside>
  )
}

