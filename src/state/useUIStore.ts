import { create } from 'zustand'

export type InteractionMode = 'orbit' | 'sculpt' | 'place'
export type BrushMode = 'excavate' | 'infill'
export type AdminConfig = {
  terrainVisible: boolean
  treesVisible: boolean
  osmLayersEnabled: boolean
  osmTerrainVisible: boolean
  osmRoadsVisible: boolean
  osmBuildingsVisible: boolean
  osmVegetationVisible: boolean
  osmSeaVisible: boolean
  osmSeaColor: string
  customMeshEnabled: boolean
  customMeshUrl: string
  customMeshColor: string
  customMeshRoughness: number
  customMeshMetalness: number
  customMeshScale: number
  customMeshYOffset: number
  customMeshFlipNormals: boolean
}

type UIState = {
  interactionMode: InteractionMode
  brushMode: BrushMode
  brushRadius: number
  brushStrength: number
  selectedAssetId: string | null
  showTransformGizmo: boolean
  /** TransformControls mode when placing */
  gizmoMode: 'translate' | 'rotate'
  adminEnabled: boolean
  canAdmin: boolean
  adminConfig: AdminConfig
  setInteractionMode: (m: InteractionMode) => void
  setBrushMode: (m: BrushMode) => void
  setBrushRadius: (r: number) => void
  setBrushStrength: (s: number) => void
  setSelectedAssetId: (id: string | null) => void
  setShowTransformGizmo: (v: boolean) => void
  setGizmoMode: (m: 'translate' | 'rotate') => void
  setAdminEnabled: (v: boolean) => void
  setCanAdmin: (v: boolean) => void
  setAdminConfig: (cfg: AdminConfig) => void
  patchAdminConfig: (patch: Partial<UIState['adminConfig']>) => void
}

export const useUIStore = create<UIState>((set) => ({
  interactionMode: 'orbit',
  brushMode: 'infill',
  brushRadius: 2.5,
  brushStrength: 0.12,
  selectedAssetId: null,
  showTransformGizmo: false,
  gizmoMode: 'translate',
  adminEnabled: false,
  canAdmin: true,
  adminConfig: {
    terrainVisible: true,
    treesVisible: true,
    osmLayersEnabled: true,
    osmTerrainVisible: false,
    osmRoadsVisible: true,
    osmBuildingsVisible: true,
    osmVegetationVisible: true,
    osmSeaVisible: true,
    osmSeaColor: '#bcd9ec',
    customMeshEnabled: true,
    customMeshUrl: '/models/manoel-island.glb',
    customMeshColor: '#f5f5f4',
    customMeshRoughness: 1,
    customMeshMetalness: 0,
    customMeshScale: 1,
    customMeshYOffset: 0,
    customMeshFlipNormals: false,
  },

  setInteractionMode: (interactionMode) => set({ interactionMode }),
  setBrushMode: (brushMode) => set({ brushMode }),
  setBrushRadius: (brushRadius) => set({ brushRadius }),
  setBrushStrength: (brushStrength) => set({ brushStrength }),
  setSelectedAssetId: (selectedAssetId) => set({ selectedAssetId }),
  setShowTransformGizmo: (showTransformGizmo) => set({ showTransformGizmo }),
  setGizmoMode: (gizmoMode) => set({ gizmoMode }),
  setAdminEnabled: (adminEnabled) => set({ adminEnabled }),
  setCanAdmin: (canAdmin) => set({ canAdmin }),
  setAdminConfig: (adminConfig) => set({ adminConfig }),
  patchAdminConfig: (patch) =>
    set((state) => ({
      adminConfig: { ...state.adminConfig, ...patch },
    })),
}))
