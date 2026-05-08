import type { BBox, LatLng, TerrainHeightmap } from '../../state/useMapImportStore'

const OPEN_METEO = 'https://api.open-meteo.com/v1/elevation'
const OPEN_ELEVATION = 'https://api.open-elevation.com/api/v1/lookup'
const BATCH_SIZE = 100
const REQUEST_TIMEOUT_MS = 8000

function pointInPolygon(x: number, y: number, polygon: Array<[number, number]>) {
  if (polygon.length < 3) return true
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0]
    const yi = polygon[i][1]
    const xj = polygon[j][0]
    const yj = polygon[j][1]
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi
    if (intersects) inside = !inside
  }
  return inside
}

async function fetchWithTimeout(input: RequestInfo, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const id = window.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: ctrl.signal })
  } finally {
    window.clearTimeout(id)
  }
}

async function fetchOpenMeteoBatch(batch: { lat: number; lon: number }[]): Promise<number[] | null> {
  if (batch.length === 0) return []
  const lats = batch.map((p) => p.lat.toFixed(6)).join(',')
  const lons = batch.map((p) => p.lon.toFixed(6)).join(',')
  const url = `${OPEN_METEO}?latitude=${lats}&longitude=${lons}`
  try {
    const res = await fetchWithTimeout(url)
    if (!res.ok) return null
    const json = (await res.json()) as { elevation?: number[] }
    if (!Array.isArray(json.elevation)) return null
    return json.elevation
  } catch {
    return null
  }
}

async function fetchOpenElevationBatch(batch: { lat: number; lon: number }[]): Promise<number[] | null> {
  if (batch.length === 0) return []
  try {
    const res = await fetchWithTimeout(OPEN_ELEVATION, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: batch.map((p) => ({ latitude: p.lat, longitude: p.lon })),
      }),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { results?: Array<{ elevation: number }> }
    if (!Array.isArray(json.results)) return null
    return json.results.map((r) => Number(r.elevation))
  } catch {
    return null
  }
}

function syntheticElevations(points: { lat: number; lon: number }[]): number[] {
  // Subtle synthetic terrain so we still get a usable heightmap on full failure.
  return points.map((p) => {
    const a = Math.sin(p.lat * 110) * 4
    const b = Math.cos(p.lon * 95) * 4
    const c = Math.sin((p.lat + p.lon) * 50) * 2
    return 5 + a + b + c
  })
}

export async function fetchTerrainHeightmap(
  bbox: BBox,
  outlineLatLng: LatLng[],
  width = 32,
  height = 32,
): Promise<TerrainHeightmap> {
  const points: Array<{ lat: number; lon: number; use: boolean; idx: number }> = []
  const polyLonLat: Array<[number, number]> = outlineLatLng.map(([lat, lon]) => [lon, lat])

  let idx = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const fx = x / (width - 1)
      const fy = y / (height - 1)
      const lon = bbox.west + (bbox.east - bbox.west) * fx
      const lat = bbox.south + (bbox.north - bbox.south) * fy
      const use = pointInPolygon(lon, lat, polyLonLat)
      points.push({ lat, lon, use, idx })
      idx++
    }
  }

  // Only fetch elevations for points inside the polygon (huge speed-up
  // for narrow shapes like an island that fits in a small fraction of bbox).
  const inside = points.filter((p) => p.use)
  const heights = new Float32Array(width * height)
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let anyReal = false

  for (let i = 0; i < inside.length; i += BATCH_SIZE) {
    const chunk = inside.slice(i, i + BATCH_SIZE)
    let elevations = await fetchOpenMeteoBatch(chunk)
    if (!elevations) elevations = await fetchOpenElevationBatch(chunk)
    if (!elevations) elevations = syntheticElevations(chunk)
    else anyReal = true

    elevations.forEach((e, k) => {
      const v = Number.isFinite(e) ? e : 0
      const target = chunk[k].idx
      heights[target] = v
      if (v < min) min = v
      if (v > max) max = v
    })
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 0.1) {
    min = 0
    max = anyReal ? 1 : 8
  }

  // Smooth low-resolution data by a single 3x3 box blur over inside points.
  const smoothed = new Float32Array(heights.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!points[i].use) continue
      let sum = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xi = x + dx
          const yi = y + dy
          if (xi < 0 || xi >= width || yi < 0 || yi >= height) continue
          const j = yi * width + xi
          if (!points[j].use) continue
          sum += heights[j]
          n++
        }
      }
      smoothed[i] = n > 0 ? sum / n : heights[i]
    }
  }

  // Outside-of-outline points get a value below min so they read as sea floor.
  const outsideElevation = min - (max - min) * 0.4
  for (let i = 0; i < heights.length; i++) {
    if (!points[i].use) smoothed[i] = outsideElevation
  }

  return {
    width,
    height,
    minElevation: min,
    maxElevation: max,
    heights: smoothed,
  }
}
