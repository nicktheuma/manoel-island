import { getSupabase, isSupabaseConfigured } from './client'
import { replayLocalHistory, subscribeLocalWorld } from './localEventBus'
import type { WorldEventRow } from './types'

export async function fetchInitialWorldState(worldId: string) {
  const supabase = getSupabase()
  if (!supabase) {
    return {
      placed: [] as { id: string; asset_id: string; transform: number[] }[],
      events: replayLocalHistory(worldId) as WorldEventRow[],
    }
  }

  const [objectsRes, eventsRes] = await Promise.all([
    supabase.from('placed_objects').select('id, asset_id, transform').eq('world_id', worldId),
    supabase
      .from('world_events')
      .select('*')
      .eq('world_id', worldId)
      .order('seq', { ascending: true })
      .limit(200),
  ])

  if (objectsRes.error) throw objectsRes.error
  if (eventsRes.error) throw eventsRes.error

  return {
    placed: (objectsRes.data ?? []) as { id: string; asset_id: string; transform: number[] }[],
    events: (eventsRes.data ?? []) as WorldEventRow[],
  }
}

export function subscribeWorldEvents(worldId: string, onRow: (row: WorldEventRow) => void) {
  if (!isSupabaseConfigured()) {
    return subscribeLocalWorld(worldId, onRow)
  }

  const supabase = getSupabase()!
  const channel = supabase
    .channel(`world:${worldId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'world_events',
        filter: `world_id=eq.${worldId}`,
      },
      (payload) => {
        onRow(payload.new as WorldEventRow)
      },
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}
