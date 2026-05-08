import type { BBox, LatLng, OSMBuilding, OSMRoad, OSMVegetation, OSMWater, XY } from '../../state/useMapImportStore'
import { METERS_TO_WORLD, latLonToWorld } from './worldScale'

type Node = { id: number; lat: number; lon: number }
type Way = { id: number; nodes: number[]; tags?: Record<string, string> }
type Element = ({ type: 'node' } & Node) | ({ type: 'way' } & Way)

type OverpassResponse = { elements: Element[] }

// Always go through our own origin (`/api/overpass`) — never directly to
// the public Overpass endpoints. The proxy handles mirror failover and
// re-emits permissive CORS headers, and Vite's dev-server proxy stitches
// the same path through to upstream during `npm run dev`. Calling the
// upstream directly from the browser was blocked by CORS whenever a
// mirror was overloaded and replied without an `Access-Control-Allow-Origin`
// header.
const OVERPASS_PROXY = '/api/overpass'
const OVERPASS_TIMEOUT_MS = 30_000

async function postOverpass(query: string): Promise<Response> {
  const ctrl = new AbortController()
  const timeoutId = window.setTimeout(() => ctrl.abort(), OVERPASS_TIMEOUT_MS)
  try {
    const res = await fetch(OVERPASS_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: 'data=' + encodeURIComponent(query),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Overpass proxy responded ${res.status}: ${text.slice(0, 200)}`)
    }
    return res
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function isClosed(points: XY[]) {
  if (points.length < 3) return false
  const a = points[0]
  const b = points[points.length - 1]
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.00001
}

function roadWidth(tags?: Record<string, string>) {
  const hw = tags?.highway ?? ''
  if (hw === 'motorway' || hw === 'trunk') return 4
  if (hw === 'primary' || hw === 'secondary') return 3
  if (hw === 'tertiary' || hw === 'residential') return 2
  return 1.2
}

export async function fetchOSMLayers(bbox: BBox): Promise<{
  roads: OSMRoad[]
  buildings: OSMBuilding[]
  vegetation: OSMVegetation
  water: OSMWater
}> {
  const query = `
[out:json][timeout:30];
(
  way["highway"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["natural"="water"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["natural"="tree"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
(._;>;);
out body;
`
  const res = await postOverpass(query)
  const json = (await res.json()) as OverpassResponse

  const nodes = new Map<number, Node>()
  const ways: Way[] = []
  for (const e of json.elements) {
    if (e.type === 'node') nodes.set(e.id, e)
    if (e.type === 'way') ways.push(e)
  }

  const roads: OSMRoad[] = []
  const buildings: OSMBuilding[] = []
  const waterPolys: XY[][] = []
  const treePts: XY[] = []

  for (const way of ways) {
    const pts = way.nodes
      .map((id) => nodes.get(id))
      .filter((n): n is Node => Boolean(n))
      .map((n) => latLonToWorld(n.lon, n.lat, bbox))
    if (pts.length < 2) continue
    if (way.tags?.highway) {
      roads.push({ points: pts, width: roadWidth(way.tags) })
      continue
    }
    if (way.tags?.building && isClosed(pts)) {
      const levels = Number(way.tags['building:levels'] ?? '3')
      const height = Number.isFinite(levels) ? Math.max(4, levels * 2.8) : 9
      buildings.push({ footprint: pts, height: height * METERS_TO_WORLD })
      continue
    }
    if (way.tags?.natural === 'water' && isClosed(pts)) {
      waterPolys.push(pts)
    }
  }

  for (const n of nodes.values()) {
    if ((n as unknown as { tags?: Record<string, string> }).tags?.natural === 'tree') {
      treePts.push(latLonToWorld(n.lon, n.lat, bbox))
    }
  }

  return {
    roads,
    buildings,
    vegetation: { points: treePts },
    water: { polygons: waterPolys },
  }
}

export function outlineLatLngToWorld(outline: LatLng[], bbox: BBox): XY[] {
  return outline.map(([lat, lon]) => latLonToWorld(lon, lat, bbox))
}

