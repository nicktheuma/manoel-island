import { useUIStore } from '../../state/useUIStore'

// Sculpt mode brush controls. Renders only when the user is actively
// sculpting so the canvas stays uncluttered the rest of the time.
//
// Lives top-left, far from the centred mode toolbar at top, the
// token HUD top-right, and the commit bar at the bottom — so all the
// sculpting affordances are visible at once without overlap.
export function SculptToolbar() {
  const interactionMode = useUIStore((s) => s.interactionMode)
  const brushMode = useUIStore((s) => s.brushMode)
  const brushRadius = useUIStore((s) => s.brushRadius)
  const brushStrength = useUIStore((s) => s.brushStrength)
  const setBrushMode = useUIStore((s) => s.setBrushMode)
  const setBrushRadius = useUIStore((s) => s.setBrushRadius)
  const setBrushStrength = useUIStore((s) => s.setBrushStrength)

  if (interactionMode !== 'sculpt') return null

  const tab = (m: 'infill' | 'excavate', label: string, hint: string) => (
    <button
      type="button"
      onClick={() => setBrushMode(m)}
      title={hint}
      className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
        brushMode === m
          ? 'bg-amber-300 text-stone-900'
          : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
      }`}
    >
      {label}
    </button>
  )

  return (
    <aside className="pointer-events-auto absolute left-4 top-4 z-10 w-60 rounded-2xl border border-stone-800/80 bg-stone-950/85 p-3 shadow-xl backdrop-blur-md">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">Brush</p>

      <div className="mt-2 flex gap-2">
        {tab('infill', 'Infill', 'Raise the LiDAR surface — pile up dirt, make mounds')}
        {tab('excavate', 'Excavate', 'Lower the LiDAR surface — dig pits, carve away')}
      </div>

      <label className="mt-3 block text-[11px] text-stone-400">
        Size
        <span className="ml-1 tabular-nums text-stone-200">{brushRadius.toFixed(1)}</span>
        <input
          type="range"
          min={0.5}
          max={8}
          step={0.1}
          value={brushRadius}
          onChange={(e) => setBrushRadius(Number(e.target.value))}
          className="mt-1 w-full accent-amber-300"
        />
      </label>

      <label className="mt-2 block text-[11px] text-stone-400">
        Strength
        <span className="ml-1 tabular-nums text-stone-200">{brushStrength.toFixed(2)}</span>
        <input
          type="range"
          min={0.01}
          max={0.5}
          step={0.01}
          value={brushStrength}
          onChange={(e) => setBrushStrength(Number(e.target.value))}
          className="mt-1 w-full accent-amber-300"
        />
      </label>

      <p className="mt-2 text-[10px] leading-snug text-stone-500">
        Hold left mouse and drag across the LiDAR surface. Click <em>Commit sculpt</em> below to
        broadcast and persist.
      </p>
    </aside>
  )
}
