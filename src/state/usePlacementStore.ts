import { create } from 'zustand'

type Draft = {
  objectId: string
  assetId: string
  matrix: number[]
}

type PlacementState = {
  draft: Draft | null
  setDraft: (d: Draft | null) => void
  updateMatrix: (matrix: number[]) => void
}

export const usePlacementStore = create<PlacementState>((set, get) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  updateMatrix: (matrix) => {
    const d = get().draft
    if (!d) return
    set({ draft: { ...d, matrix } })
  },
}))
