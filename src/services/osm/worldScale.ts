import type { BBox, XY } from '../../state/useMapImportStore'

/**
 * Conversion from real-world meters to world-space units used by the 3D scene.
 * Tuned so an island of a few hundred metres reads at a comfortable scale
 * for the paper-craft camera. Keep this constant centralised so that
 * the OSM layers, heightmap terrain, and base-mesh import all agree.
 */
export const METERS_TO_WORLD = 0.05

/**
 * Vertical exaggeration applied to real elevation so subtle relief is
 * still readable in the schematic visual style. 1.0 = true to scale, which
 * matches the LiDAR base mesh exactly so OSM features sit on real ground.
 */
export const ELEVATION_EXAGGERATION = 1.0

export function bboxWorldDimensions(bbox: BBox): { widthWorld: number; depthWorld: number; widthMeters: number; depthMeters: number } {
  const centerLat = (bbox.north + bbox.south) / 2
  const widthMeters = (bbox.east - bbox.west) * 111320 * Math.cos((centerLat * Math.PI) / 180)
  const depthMeters = (bbox.north - bbox.south) * 110540
  return {
    widthMeters,
    depthMeters,
    widthWorld: widthMeters * METERS_TO_WORLD,
    depthWorld: depthMeters * METERS_TO_WORLD,
  }
}

export function latLonToWorld(lon: number, lat: number, bbox: BBox): XY {
  const centerLat = (bbox.north + bbox.south) / 2
  const centerLon = (bbox.east + bbox.west) / 2
  const mx = (lon - centerLon) * 111320 * Math.cos((centerLat * Math.PI) / 180)
  const mz = (lat - centerLat) * 110540
  return [mx * METERS_TO_WORLD, mz * METERS_TO_WORLD]
}
