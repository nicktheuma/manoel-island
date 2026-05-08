import { create } from 'zustand'

export type BBox = { south: number; west: number; north: number; east: number }
export type XY = [number, number]
export type LatLng = [number, number]

export type OSMRoad = { points: XY[]; width: number }
export type OSMBuilding = { footprint: XY[]; height: number }
export type OSMVegetation = { points: XY[] }
export type OSMWater = { polygons: XY[][] }
export type TerrainHeightmap = {
  width: number
  height: number
  minElevation: number
  maxElevation: number
  heights: Float32Array
}

type MapImportState = {
  bbox: BBox | null
  loading: boolean
  error: string | null
  roads: OSMRoad[]
  buildings: OSMBuilding[]
  vegetation: OSMVegetation
  water: OSMWater
  outlineLatLng: LatLng[]
  outlineWorld: XY[]
  terrain: TerrainHeightmap | null
  setBBox: (bbox: BBox | null) => void
  setData: (
    data: Pick<MapImportState, 'roads' | 'buildings' | 'vegetation' | 'water' | 'outlineLatLng' | 'outlineWorld' | 'terrain'>,
  ) => void
  setLoading: (v: boolean) => void
  setError: (v: string | null) => void
  reset: () => void
}

export const useMapImportStore = create<MapImportState>((set) => ({
  bbox: null,
  loading: false,
  error: null,
  roads: [],
  buildings: [],
  vegetation: { points: [] },
  water: { polygons: [] },
  outlineLatLng: [],
  outlineWorld: [],
  terrain: null,
  setBBox: (bbox) => set({ bbox }),
  setData: (data) => set(data),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  reset: () =>
    set({
      bbox: null,
      loading: false,
      error: null,
      roads: [],
      buildings: [],
      vegetation: { points: [] },
      water: { polygons: [] },
      outlineLatLng: [],
      outlineWorld: [],
      terrain: null,
    }),
}))

