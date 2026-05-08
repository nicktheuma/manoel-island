-- Fix infinite recursion between `worlds` and `world_members` RLS policies.
--
-- Symptom (in the browser console):
--   { code: '42P17', message: 'infinite recursion detected in policy for relation "worlds"' }
--
-- Cause:
--   `worlds_select_member` did `EXISTS (SELECT 1 FROM world_members …)` and
--   `world_members_select` did `EXISTS (SELECT 1 FROM worlds …)`. PG fires
--   RLS on the inner table, which fires RLS back on the outer, ad infinitum.
--
-- Fix:
--   Add a `SECURITY DEFINER` helper that returns the caller's effective
--   role for a world (`owner` | `editor` | `viewer` | NULL). The function
--   runs as its owner so its internal SELECTs bypass RLS, breaking the
--   loop. All cross-table policies are rewritten to call the helper
--   instead of doing nested EXISTS subqueries against `worlds` /
--   `world_members`.
--
-- This migration is idempotent — running it twice is a no-op.

-- ── Helper ──────────────────────────────────────────────────────────────

create or replace function public.world_role(p_world_id uuid, p_user_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select case
    when p_user_id is null then
      case when w.visibility = 'public' then 'viewer' else null end
    when w.owner_id = p_user_id then 'owner'
    when wm.role is not null then wm.role
    when w.visibility = 'public' then 'viewer'
    else null
  end
  from public.worlds w
  left join public.world_members wm
    on wm.world_id = w.id and wm.user_id = p_user_id
  where w.id = p_world_id
  limit 1;
$$;

revoke all on function public.world_role(uuid, uuid) from public;
grant execute on function public.world_role(uuid, uuid) to authenticated, anon;

comment on function public.world_role(uuid, uuid) is
  'Returns the calling user''s effective role in a world (owner | editor | viewer | NULL). '
  'SECURITY DEFINER so it bypasses RLS — the only safe way to cross-reference '
  'worlds and world_members from within a policy without triggering 42P17.';

-- ── Worlds ──────────────────────────────────────────────────────────────

drop policy if exists "worlds_select_member" on public.worlds;
create policy "worlds_select_member"
  on public.worlds for select
  using (public.world_role(id, auth.uid()) is not null);

-- ── World members ───────────────────────────────────────────────────────
-- A user can see their own membership row, plus all rows for any world
-- they own (handy for an "Editors" admin view later).

drop policy if exists "world_members_select" on public.world_members;
create policy "world_members_select"
  on public.world_members for select
  using (
    user_id = auth.uid()
    or public.world_role(world_id, auth.uid()) = 'owner'
  );

drop policy if exists "world_members_insert_owner" on public.world_members;
create policy "world_members_insert_owner"
  on public.world_members for insert
  with check (public.world_role(world_id, auth.uid()) = 'owner');

drop policy if exists "world_members_delete_owner" on public.world_members;
create policy "world_members_delete_owner"
  on public.world_members for delete
  using (public.world_role(world_id, auth.uid()) = 'owner');

-- ── Terrain chunks ──────────────────────────────────────────────────────

drop policy if exists "terrain_chunks_select" on public.terrain_chunks;
create policy "terrain_chunks_select"
  on public.terrain_chunks for select
  using (public.world_role(world_id, auth.uid()) is not null);

drop policy if exists "terrain_chunks_write_editor" on public.terrain_chunks;
create policy "terrain_chunks_write_editor"
  on public.terrain_chunks for insert
  with check (public.world_role(world_id, auth.uid()) in ('owner', 'editor'));

drop policy if exists "terrain_chunks_update_editor" on public.terrain_chunks;
create policy "terrain_chunks_update_editor"
  on public.terrain_chunks for update
  using (public.world_role(world_id, auth.uid()) in ('owner', 'editor'));

-- ── Placed objects ──────────────────────────────────────────────────────

drop policy if exists "placed_objects_select" on public.placed_objects;
create policy "placed_objects_select"
  on public.placed_objects for select
  using (public.world_role(world_id, auth.uid()) is not null);

drop policy if exists "placed_objects_insert_editor" on public.placed_objects;
create policy "placed_objects_insert_editor"
  on public.placed_objects for insert
  with check (public.world_role(world_id, auth.uid()) in ('owner', 'editor'));

drop policy if exists "placed_objects_update_editor" on public.placed_objects;
create policy "placed_objects_update_editor"
  on public.placed_objects for update
  using (public.world_role(world_id, auth.uid()) in ('owner', 'editor'));

drop policy if exists "placed_objects_delete_editor" on public.placed_objects;
create policy "placed_objects_delete_editor"
  on public.placed_objects for delete
  using (public.world_role(world_id, auth.uid()) in ('owner', 'editor'));

-- ── World events ────────────────────────────────────────────────────────

drop policy if exists "world_events_select" on public.world_events;
create policy "world_events_select"
  on public.world_events for select
  using (public.world_role(world_id, auth.uid()) is not null);

-- ── World admin configs ─────────────────────────────────────────────────

drop policy if exists "world_admin_configs_select_member" on public.world_admin_configs;
create policy "world_admin_configs_select_member"
  on public.world_admin_configs for select
  using (public.world_role(world_id, auth.uid()) is not null);

drop policy if exists "world_admin_configs_write_editor" on public.world_admin_configs;
create policy "world_admin_configs_write_editor"
  on public.world_admin_configs for insert
  with check (public.world_role(world_id, auth.uid()) in ('owner', 'editor'));

drop policy if exists "world_admin_configs_update_editor" on public.world_admin_configs;
create policy "world_admin_configs_update_editor"
  on public.world_admin_configs for update
  using (public.world_role(world_id, auth.uid()) in ('owner', 'editor'));
