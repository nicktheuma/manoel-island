export type WorldEventType = 'SCULPT' | 'ADD_OBJECT' | 'UPDATE_OBJECT' | 'REMOVE_OBJECT'

/** patches: [vertexIndex, absoluteY] for idempotent apply (multiplayer + local echo) */
export type SculptPayload = {
  resolution: number
  chunks: { chunkX: number; chunkZ: number; patches: [number, number][] }[]
}

export type ObjectPayload = {
  object_id: string
  asset_id: string
  transform: number[]
  snap_meta?: { normalY?: number }
}

export type WorldEventRow = {
  id: string
  world_id: string
  user_id: string
  event_type: WorldEventType
  payload: SculptPayload | ObjectPayload | Record<string, unknown>
  seq: number
  created_at: string
  client_version?: string | null
}

export type PlacedObjectRow = {
  id: string
  world_id: string
  asset_id: string
  transform: number[]
  created_at: string
  updated_at: string
}
