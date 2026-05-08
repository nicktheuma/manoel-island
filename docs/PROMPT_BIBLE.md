# Prompt Bible v1 — Manuel Island Multiplayer Sandbox

## 1. Product intent

- **North star:** Real-time collaborative 3D sandbox of Manuel Island (Malta): schematic clay/paper-craft look, animated nature, terrain sculpt + object placement.
- **Collaboration:** Last-write-wins (server timestamp + monotonic sequence).
- **Economy:** Token-based interventions (default 1 point / 10 minutes, admin-configurable per world).
- **Identity:** Email/social auth; users own private worlds; optional sharing via `world_members`.

## 2. Non-goals (MVP)

- Deterministic replay from day one of all history (use snapshot + recent events instead).
- Voxel engine or full GIS accuracy.
- Server-side physics simulation.

## 3. Feature contracts

### 3.1 Terrain sculpt

| Input | Behavior |
|--------|----------|
| Brush mode `excavate` | Decrease vertex Y within brush radius (clamped to min height). |
| Brush mode `infill` | Increase vertex Y within brush radius (clamped to max height). |
| Brush radius / strength | Client preview unlimited; **commit** payload must respect server `max_brush_radius`, `max_strength`. |

**Commit:** Costs **1 token**. Payload references chunk id + compact vertex deltas (see §4).

**Edge cases:** Out-of-bounds brush → no-op on missing chunk; concurrent edits → last event wins for overlapping vertices.

### 3.2 Object placement

| Phase | Behavior |
|--------|----------|
| Select asset | Sidebar sets `selectedAssetId` in UI store. |
| Ghost | 50% opacity; raycast XZ to terrain; Y = sampled terrain height + optional offset. |
| Gizmo | After first click, `TransformControls` (translate + rotate). |
| Commit | **OK** sends `ADD_OBJECT` (or `UPDATE_OBJECT` if editing existing). Costs **1 token**. |

**Edge cases:** No terrain hit → ghost hidden or snapped to last valid point; transform must be serializable (Matrix4 elements array).

### 3.3 Tokens

- Per user **per world**: `points`, `last_refill_at`, `refill_interval_seconds` (from `worlds.settings` or `user_tokens` row).
- Refill: server-side in RPC; client shows countdown from `next_refill_at`.
- `points === 0` → Commit disabled + countdown visible.

### 3.4 Realtime

- On successful commit, row inserted into `world_events` → Supabase Realtime broadcasts to channel `world:{world_id}`.
- Clients apply event to local scene without full reload.
- Late join: `GET` latest `terrain_chunks` + `placed_objects` + replay `world_events` after `last_snapshot_seq` (optional optimization: skip replay if snapshot seq matches head).

## 4. Data contracts

### 4.1 Event envelope (DB + wire)

```json
{
  "event_id": "uuid",
  "world_id": "uuid",
  "user_id": "uuid",
  "type": "SCULPT | ADD_OBJECT | UPDATE_OBJECT | REMOVE_OBJECT",
  "payload": {},
  "seq": 0,
  "created_at": "iso8601",
  "client_version": "1.0.0"
}
```

### 4.2 `SCULPT` payload

```json
{
  "chunkX": 0,
  "chunkZ": 0,
  "resolution": 32,
  "patches": [[vertexIndex, absoluteY], [12, 1.42]]
}
```

Constraints: `patches.length <= 2000`, heights clamped server-side to world bounds, indices valid for chunk resolution. Patches are **absolute** Y for idempotent multiplayer apply.

### 4.3 `ADD_OBJECT` payload

```json
{
  "object_id": "uuid",
  "asset_id": "building_A",
  "transform": [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1],
  "snap_meta": { "normalY": 1 }
}
```

### 4.4 `UPDATE_OBJECT` / `REMOVE_OBJECT`

Same `object_id` + optional new `transform` or `{ "removed": true }`.

## 5. Module boundaries (codebase)

| Area | Responsibility |
|------|----------------|
| `src/engine/*` | Three.js / R3F only: terrain, placement, lights, materials. |
| `src/state/*` | Zustand: UI, tokens, world/scene mirrors. |
| `src/services/supabase/*` | Client, Realtime subscriptions, RPC commits. |
| `src/ui/*` | HTML overlays: sidebar, HUD, buttons. |

## 6. Performance budgets (targets)

- **Frame time:** 60 FPS on mid laptop with 4×4 chunks @ 32×32 verts each + ≤200 placed instances.
- **Commit round-trip:** median < 300 ms same region (network + DB).
- **Sculpt payload:** ≤ 50 KB per commit (batch aggressive strokes in UI before commit).

## 7. Testing matrix

| Test | Type |
|------|------|
| Token refill math | Unit (server RPC or mirrored client helper). |
| RLS: non-member cannot insert | Integration |
| Two clients: ADD_OBJECT appears | E2E manual / Playwright later |
| Chunk dirty flags | Unit |

## 8. Definition of done (MVP)

- [ ] Auth gate for app shell (Supabase session).
- [ ] Sculpt + place + token UI; commit calls RPC.
- [ ] Realtime applies remote events.
- [ ] World load: chunks + objects from DB (or demo seed without keys).

---

*Version: 1.0 — align implementation with `supabase/migrations` and `src/services/supabase/*`.*
