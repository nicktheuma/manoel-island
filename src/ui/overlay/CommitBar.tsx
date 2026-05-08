import { useUIStore } from '../../state/useUIStore'
import { useWorldStore, TERRAIN_RESOLUTION } from '../../state/useWorldStore'
import { usePlacementStore } from '../../state/usePlacementStore'
import { useTokenStore } from '../../state/useTokenStore'
import { commitWorldEvent } from '../../services/supabase/commits'
import type { SculptBrushApi } from '../../engine/terrain/useSculptBrush'

type Props = {
  sculpt: SculptBrushApi
}

export function CommitBar({ sculpt }: Props) {
  const mode = useUIStore((s) => s.interactionMode)
  const worldId = useWorldStore((s) => s.worldId)
  const points = useTokenStore((s) => s.points)
  const unlimited = useTokenStore((s) => s.unlimited)
  const draft = usePlacementStore((s) => s.draft)

  // Admins (owner/editor) bypass the rate limit entirely; everyone else
  // needs at least one action point queued up.
  const canAct = unlimited || points >= 1

  const onCommitSculpt = async () => {
    const chunks = sculpt.collectPatchesForCommit()
    if (!chunks.length) {
      window.alert('Paint terrain first, then commit your stroke.')
      return
    }
    try {
      const res = await commitWorldEvent(worldId, 'SCULPT', {
        resolution: TERRAIN_RESOLUTION,
        chunks,
      })
      useTokenStore.getState().applyCommitResult(res.newPoints, res.nextRefillAt, res.unlimited)
    } catch (e) {
      if (String(e).includes('insufficient')) {
        window.alert('No action points left — wait for refill.')
      } else {
        console.error(e)
        window.alert('Commit failed (see console).')
      }
    }
  }

  const onCommitPlace = async () => {
    if (!draft) {
      window.alert('Click the terrain to lock a ghost, adjust gizmo, then OK.')
      return
    }
    try {
      const res = await commitWorldEvent(worldId, 'ADD_OBJECT', {
        object_id: draft.objectId,
        asset_id: draft.assetId,
        transform: draft.matrix,
      })
      useWorldStore.getState().upsertPlaced(draft.objectId, draft.assetId, draft.matrix)
      usePlacementStore.getState().setDraft(null)
      useUIStore.getState().setShowTransformGizmo(false)
      useTokenStore.getState().applyCommitResult(res.newPoints, res.nextRefillAt, res.unlimited)
    } catch (e) {
      if (String(e).includes('insufficient')) {
        window.alert('No action points left — wait for refill.')
      } else {
        console.error(e)
        window.alert('Commit failed (see console).')
      }
    }
  }

  return (
    <div className="pointer-events-auto absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 gap-3 rounded-2xl border border-stone-800/80 bg-stone-950/90 px-4 py-3 shadow-2xl backdrop-blur-md">
      {mode === 'sculpt' && (
        <button
          type="button"
          disabled={!canAct}
          onClick={() => void onCommitSculpt()}
          className="rounded-xl bg-amber-500 px-5 py-2 text-sm font-semibold text-stone-950 shadow-lg transition enabled:hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Commit sculpt{unlimited ? '' : ' (1 pt)'}
        </button>
      )}
      {mode === 'place' && (
        <button
          type="button"
          disabled={!canAct || !draft}
          onClick={() => void onCommitPlace()}
          className="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-semibold text-stone-950 shadow-lg transition enabled:hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          OK — place object{unlimited ? '' : ' (1 pt)'}
        </button>
      )}
      {!canAct && !unlimited && (
        <span className="self-center text-xs text-stone-500">Wait for next action point…</span>
      )}
    </div>
  )
}
