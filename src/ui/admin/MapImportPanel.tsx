import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import { fetchOSMLayers, outlineLatLngToWorld } from '../../services/osm/overpass'
import { fetchTerrainHeightmap } from '../../services/osm/elevation'
import { saveWorldOsmImport } from '../../services/supabase/osmImports'
import { useMapImportStore } from '../../state/useMapImportStore'
import { useUIStore } from '../../state/useUIStore'
import { useWorldStore } from '../../state/useWorldStore'
import type { LatLng } from '../../state/useMapImportStore'

type PickState = { a: [number, number] | null; b: [number, number] | null }
type Mode = 'bbox' | 'outline'

function MapInteractionToggle({ mode }: { mode: Mode }) {
  const map = useMap()
  useEffect(() => {
    const sketch = mode === 'outline'
    if (sketch) {
      map.dragging.disable()
      map.boxZoom.disable()
      map.doubleClickZoom.disable()
      map.scrollWheelZoom.enable()
      map.getContainer().style.cursor = 'crosshair'
    } else {
      map.dragging.enable()
      map.boxZoom.enable()
      map.doubleClickZoom.enable()
      map.scrollWheelZoom.enable()
      map.getContainer().style.cursor = ''
    }
    return () => {
      map.getContainer().style.cursor = ''
    }
  }, [map, mode])
  return null
}

function MapInvalidateOnMount() {
  const map = useMap()
  useEffect(() => {
    const ids: number[] = []
    ids.push(window.setTimeout(() => map.invalidateSize(), 0))
    ids.push(window.setTimeout(() => map.invalidateSize(), 150))
    ids.push(window.setTimeout(() => map.invalidateSize(), 400))
    return () => ids.forEach((i) => window.clearTimeout(i))
  }, [map])
  return null
}

function Picker({
  mode,
  value,
  outline,
  onChange,
  onOutlineChange,
}: {
  mode: Mode
  value: PickState
  outline: LatLng[]
  onChange: (v: PickState) => void
  onOutlineChange: (pts: LatLng[]) => void
}) {
  useMapEvents({
    click(e) {
      const p: LatLng = [e.latlng.lat, e.latlng.lng]
      if (mode === 'outline') {
        onOutlineChange([...outline, p])
        return
      }
      if (!value.a) onChange({ ...value, a: p })
      else if (!value.b) onChange({ ...value, b: p })
      else onChange({ a: p, b: null })
    },
  })
  return (
    <>
      {value.a && <Marker position={value.a as LatLngExpression} />}
      {value.b && <Marker position={value.b as LatLngExpression} />}
      {outline.length >= 2 && <Polyline positions={outline as LatLngExpression[]} />}
      {outline.length >= 3 && <Polygon positions={outline as LatLngExpression[]} />}
    </>
  )
}

export function MapImportPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pick, setPick] = useState<PickState>({ a: null, b: null })
  const [mode, setMode] = useState<Mode>('outline')
  const [outline, setOutline] = useState<LatLng[]>([])
  const setBBox = useMapImportStore((s) => s.setBBox)
  const setData = useMapImportStore((s) => s.setData)
  const setLoading = useMapImportStore((s) => s.setLoading)
  const loading = useMapImportStore((s) => s.loading)
  const error = useMapImportStore((s) => s.error)
  const setError = useMapImportStore((s) => s.setError)
  const patchAdmin = useUIStore((s) => s.patchAdminConfig)

  const bbox = useMemo(() => {
    if (mode === 'outline' && outline.length >= 3) {
      const lats = outline.map((p) => p[0])
      const lons = outline.map((p) => p[1])
      return {
        south: Math.min(...lats),
        north: Math.max(...lats),
        west: Math.min(...lons),
        east: Math.max(...lons),
      }
    }
    if (!pick.a || !pick.b) return null
    const south = Math.min(pick.a[0], pick.b[0])
    const north = Math.max(pick.a[0], pick.b[0])
    const west = Math.min(pick.a[1], pick.b[1])
    const east = Math.max(pick.a[1], pick.b[1])
    return { south, west, north, east }
  }, [pick, mode, outline])

  if (!open) return null

  const runImport = async () => {
    if (!bbox) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchOSMLayers(bbox)
      const effectiveOutline: LatLng[] =
        mode === 'outline'
          ? outline
          : [
              [bbox.south, bbox.west],
              [bbox.south, bbox.east],
              [bbox.north, bbox.east],
              [bbox.north, bbox.west],
            ]
      const outlineWorld = outlineLatLngToWorld(effectiveOutline, bbox)
      const terrain = await fetchTerrainHeightmap(bbox, effectiveOutline)
      setBBox(bbox)
      setData({ ...data, outlineLatLng: effectiveOutline, outlineWorld, terrain })
      patchAdmin({ osmLayersEnabled: true })

      // Persist so signed-in admins on other devices, signed-out viewers,
      // and a fresh tab all hydrate the same OSM overlay on next load.
      // Failures are logged but don't block the local import — the
      // payload is already in `useMapImportStore`.
      try {
        const worldId = useWorldStore.getState().worldId
        await saveWorldOsmImport(worldId, {
          bbox,
          outlineLatLng: effectiveOutline,
          outlineWorld,
          roads: data.roads,
          buildings: data.buildings,
          vegetation: data.vegetation,
          water: data.water,
          terrain,
        })
      } catch (saveErr) {
        console.warn('[MapImport] persist failed (RLS / network):', saveErr)
      }

      setLoading(false)
      setPick({ a: null, b: null })
      setOutline([])
      onClose()
    } catch (e) {
      console.error('[MapImport] Failed:', e)
      setError(e instanceof Error ? e.message : 'Failed to import map')
      setLoading(false)
    }
  }

  const undoLastPoint = () => {
    if (mode === 'outline') {
      setOutline((pts) => pts.slice(0, -1))
    } else {
      setPick((p) => (p.b ? { ...p, b: null } : { ...p, a: null }))
    }
  }

  const modal = (
    <div className="pointer-events-auto fixed inset-0 z-[1000] flex items-center justify-center bg-black/70">
      <div className="flex h-[94vh] w-[96vw] max-w-[1500px] flex-col rounded-2xl border border-stone-700 bg-stone-950 p-3 shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-stone-200">Import OSM Extents</p>
          <button
            type="button"
            className="rounded bg-stone-800 px-2 py-1 text-xs text-stone-200 hover:bg-stone-700"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <p className="mb-2 text-xs text-stone-400">
          {mode === 'outline'
            ? 'Sketch mode: left-click adds polygon points (map pan disabled). Use mouse wheel to zoom.'
            : '2-point extents: click two opposite corners on the map.'}
        </p>
        <div className="mb-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setMode('outline')
              setPick({ a: null, b: null })
            }}
            className={`rounded px-2 py-1 text-xs ${mode === 'outline' ? 'bg-amber-300 text-stone-900' : 'bg-stone-800 text-stone-200 hover:bg-stone-700'}`}
          >
            Sketch Outline
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('bbox')
              setOutline([])
            }}
            className={`rounded px-2 py-1 text-xs ${mode === 'bbox' ? 'bg-amber-300 text-stone-900' : 'bg-stone-800 text-stone-200 hover:bg-stone-700'}`}
          >
            2-Point Extents
          </button>
          <button
            type="button"
            onClick={undoLastPoint}
            className="rounded bg-stone-800 px-2 py-1 text-xs text-stone-200 hover:bg-stone-700"
          >
            Undo Last Point
          </button>
          <button
            type="button"
            onClick={() => {
              setOutline([])
              setPick({ a: null, b: null })
            }}
            className="rounded bg-stone-800 px-2 py-1 text-xs text-stone-200 hover:bg-stone-700"
          >
            Clear
          </button>
          <span className="ml-auto self-center text-[11px] text-stone-400">
            {mode === 'outline' ? `${outline.length} pts` : `${[pick.a, pick.b].filter(Boolean).length}/2 pts`}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-stone-700">
          <MapContainer
            center={[35.9, 14.5]}
            zoom={13}
            style={{ width: '100%', height: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapInteractionToggle mode={mode} />
            <MapInvalidateOnMount />
            <Picker
              mode={mode}
              value={pick}
              outline={outline}
              onChange={setPick}
              onOutlineChange={setOutline}
            />
          </MapContainer>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="truncate text-[11px] text-stone-400">
            {bbox
              ? `S:${bbox.south.toFixed(4)}  W:${bbox.west.toFixed(4)}  N:${bbox.north.toFixed(4)}  E:${bbox.east.toFixed(4)}`
              : mode === 'outline'
                ? 'Sketch at least 3 points to define an area.'
                : 'Pick two opposite corners on the map.'}
          </div>
          <button
            type="button"
            onClick={() => void runImport()}
            disabled={!bbox || loading}
            className="rounded bg-amber-400 px-3 py-1.5 text-xs font-semibold text-stone-900 disabled:opacity-40"
          >
            {loading ? 'Importing…' : 'Import Layers'}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
