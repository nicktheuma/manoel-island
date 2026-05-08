import { getSupabase } from './client'
import { emitLocalWorldEvent } from './localEventBus'
import type { ObjectPayload, SculptPayload, WorldEventType } from './types'
import { useTokenStore } from '../../state/useTokenStore'

const CLIENT_VERSION = '1.0.0'

export type CommitResult = {
  eventId: string
  newPoints: number
  nextRefillAt: string
}

export async function commitWorldEvent(
  worldId: string,
  eventType: WorldEventType,
  payload: SculptPayload | ObjectPayload | Record<string, unknown>,
): Promise<CommitResult> {
  const supabase = getSupabase()

  if (!supabase) {
    const ok = useTokenStore.getState().tryConsumeLocal()
    if (!ok) {
      throw new Error('insufficient_tokens')
    }
    const eventId = crypto.randomUUID()
    const t = useTokenStore.getState()
    emitLocalWorldEvent(worldId, {
      id: eventId,
      event_type: eventType,
      payload,
      client_version: CLIENT_VERSION,
    })
    return {
      eventId,
      newPoints: t.points,
      nextRefillAt: t.nextRefillAt ?? new Date().toISOString(),
    }
  }

  const { data, error } = await supabase.rpc('consume_token_and_insert_event', {
    p_world_id: worldId,
    p_event_type: eventType,
    p_payload: payload as Record<string, unknown>,
    p_client_version: CLIENT_VERSION,
  })

  if (error) {
    if (error.message?.includes('insufficient_tokens') || error.code === 'P0001') {
      throw new Error('insufficient_tokens')
    }
    throw error
  }

  const row = data as { event_id?: string; new_points?: number; next_refill_at?: string }
  return {
    eventId: row.event_id ?? '',
    newPoints: row.new_points ?? 0,
    nextRefillAt: row.next_refill_at ?? new Date().toISOString(),
  }
}
