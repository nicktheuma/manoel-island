import { useUIStore } from '../../state/useUIStore'

const ASSETS = [
  { id: 'building_A', label: 'Building A' },
  { id: 'building_B', label: 'Building B' },
  { id: 'bench_01', label: 'Bench' },
  { id: 'tree_01', label: 'Tree (prop)' },
] as const

export function AssetBrowser() {
  const selected = useUIStore((s) => s.selectedAssetId)
  const setSelected = useUIStore((s) => s.setSelectedAssetId)
  const mode = useUIStore((s) => s.interactionMode)
  const setMode = useUIStore((s) => s.setInteractionMode)
  const gizmoMode = useUIStore((s) => s.gizmoMode)
  const setGizmoMode = useUIStore((s) => s.setGizmoMode)

  return (
    <aside className="pointer-events-auto absolute left-4 top-4 z-10 w-64 rounded-2xl border border-stone-800/80 bg-stone-950/85 p-4 shadow-xl backdrop-blur-md">
      <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">Assets</p>
      <p className="mt-1 text-sm text-stone-300">Schematic placeholders — swap for GLB paths later.</p>
      <div className="mt-4 space-y-2">
        {ASSETS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              setSelected(a.id)
              setMode('place')
            }}
            className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${
              selected === a.id
                ? 'bg-amber-500/20 text-amber-100 ring-1 ring-amber-500/40'
                : 'bg-stone-900/60 text-stone-200 hover:bg-stone-800'
            }`}
          >
            <span>{a.label}</span>
            <span className="text-[10px] uppercase text-stone-500">{a.id}</span>
          </button>
        ))}
      </div>

      {mode === 'place' && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setGizmoMode('translate')}
            className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium ${
              gizmoMode === 'translate' ? 'bg-stone-100 text-stone-900' : 'bg-stone-800 text-stone-300'
            }`}
          >
            Move
          </button>
          <button
            type="button"
            onClick={() => setGizmoMode('rotate')}
            className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium ${
              gizmoMode === 'rotate' ? 'bg-stone-100 text-stone-900' : 'bg-stone-800 text-stone-300'
            }`}
          >
            Rotate
          </button>
        </div>
      )}
    </aside>
  )
}
