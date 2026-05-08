import { getSupabase } from './client'
import type {
  BBox,
  LatLng,
  OSMBuilding,
  OSMRoad,
  OSMVegetation,
  OSMWater,
  TerrainHeightmap,
  XY,
} from '../../state/useMapImportStore'

/**
 * Persisted OSM payload. Mirrors `useMapImportStore` minus its UI flags.
 * Heightmap floats survive the JSONB round-trip via base64 (`heightsBase64`);
 * the `Float32Array` field is reconstructed on load.
 */
export type StoredOsmImport = {
  bbox: BBox | null
  outlineLatLng: LatLng[]
  outlineWorld: XY[]
  roads: OSMRoad[]
  buildings: OSMBuilding[]
  vegetation: OSMVegetation
  water: OSMWater
  terrain: TerrainHeightmap | null
}

type SerializedHeightmap = {
  width: number
  height: number
  minElevation: number
  maxElevation: number
  /** Base64-encoded Float32 buffer of length `width * height`. */
  heightsBase64: string
}

type SerializedPayload = Omit<StoredOsmImport, 'terrain'> & {
  terrain: SerializedHeightmap | null
}

function encodeHeights(heights: Float32Array): string {
  let bin = ''
  const u8 = new Uint8Array(heights.buffer, heights.byteOffset, heights.byteLength)
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i])
  return btoa(bin)
}

function decodeHeights(b64: string, expectedLen: number): Float32Array | null {
  try {
    const bin = atob(b64)
    const buf = new ArrayBuffer(bin.length)
    const u8 = new Uint8Array(buf)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    const f = new Float32Array(buf)
    if (f.length !== expectedLen) return null
    return f
  } catch {
    return null
  }
}

function serialize(payload: StoredOsmImport): SerializedPayload {
  return {
    ...payload,
    terrain: payload.terrain
      ? {
          width: payload.terrain.width,
          height: payload.terrain.height,
          minElevation: payload.terrain.minElevation,
          maxElevation: payload.terrain.maxElevation,
          heightsBase64: encodeHeights(payload.terrain.heights),
        }
      : null,
  }
}

function deserialize(raw: unknown): StoredOsmImport | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<SerializedPayload>
  const terrain: TerrainHeightmap | null = r.terrain
    ? (() => {
        const expected = r.terrain!.width * r.terrain!.height
        const heights = decodeHeights(r.terrain!.heightsBase64, expected)
        if (!heights) return null
        return {
          width: r.terrain!.width,
          height: r.terrain!.height,
          minElevation: r.terrain!.minElevation,
          maxElevation: r.terrain!.maxElevation,
          heights,
        }
      })()
    : null
  return {
    bbox: (r.bbox as BBox | null) ?? null,
    outlineLatLng: Array.isArray(r.outlineLatLng) ? (r.outlineLatLng as LatLng[]) : [],
    outlineWorld: Array.isArray(r.outlineWorld) ? (r.outlineWorld as XY[]) : [],
    roads: Array.isArray(r.roads) ? (r.roads as OSMRoad[]) : [],
    buildings: Array.isArray(r.buildings) ? (r.buildings as OSMBuilding[]) : [],
    vegetation:
      r.vegetation && typeof r.vegetation === 'object'
        ? (r.vegetation as OSMVegetation)
        : { points: [] },
    water:
      r.water && typeof r.water === 'object' ? (r.water as OSMWater) : { polygons: [] },
    terrain,
  }
}

/**
 * Loads the persisted OSM import for a world. Returns `null` when the
 * project hasn't been configured with Supabase, when no row exists yet,
 * or when the stored payload is malformed.
 */
export async function loadWorldOsmImport(worldId: string): Promise<StoredOsmImport | null> {
  const supabase = getSupabase()
  if (!supabase) return null
  const res = await supabase
    .from('world_osm_imports')
    .select('payload')
    .eq('world_id', worldId)
    .maybeSingle()
  if (res.error) {
    // RLS denial or transient network errors shouldn't block the rest of
    // the world from hydrating. Caller logs and falls back to empty.
    throw res.error
  }
  if (!res.data) return null
  return deserialize((res.data as { payload?: unknown }).payload)
}

/** Upserts the OSM payload for a world. Owner/editor only (RLS enforced). */
export async function saveWorldOsmImport(
  worldId: string,
  payload: StoredOsmImport,
): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  const authRes = await supabase.auth.getUser()
  const uid = authRes.data.user?.id ?? null
  const serialized = serialize(payload)
  const res = await supabase.from('world_osm_imports').upsert(
    {
      world_id: worldId,
      bbox: payload.bbox,
      outline_lat_lng: payload.outlineLatLng,
      payload: serialized,
      updated_by: uid,
    },
    { onConflict: 'world_id' },
  )
  if (res.error) throw res.error
}
