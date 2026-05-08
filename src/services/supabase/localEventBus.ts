import type { WorldEventRow } from './types'

type Listener = (row: WorldEventRow) => void

const listeners = new Map<string, Set<Listener>>()
const history: WorldEventRow[] = []
let localSeq = 1

export function subscribeLocalWorld(worldId: string, fn: Listener): () => void {
  let set = listeners.get(worldId)
  if (!set) {
    set = new Set()
    listeners.set(worldId, set)
  }
  set.add(fn)
  return () => {
    set!.delete(fn)
    if (set!.size === 0) listeners.delete(worldId)
  }
}

export function emitLocalWorldEvent(
  worldId: string,
  partial: Pick<WorldEventRow, 'id' | 'event_type' | 'payload'> & {
    client_version?: string | null
    user_id?: string
  },
): WorldEventRow {
  const row: WorldEventRow = {
    id: partial.id,
    world_id: worldId,
    user_id: partial.user_id ?? 'local-demo',
    event_type: partial.event_type,
    payload: partial.payload,
    seq: localSeq++,
    created_at: new Date().toISOString(),
    client_version: partial.client_version ?? '1.0.0',
  }
  history.push(row)
  if (history.length > 500) history.shift()
  const set = listeners.get(worldId)
  set?.forEach((l) => l(row))
  return row
}

export function replayLocalHistory(worldId: string): WorldEventRow[] {
  return history.filter((h) => h.world_id === worldId)
}
