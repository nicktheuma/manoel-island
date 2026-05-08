-- Add a 'RESET_TERRAIN' world event so admins can wipe every sculpt
-- delta and return the LiDAR base mesh to its pristine 2018 capture.
--
-- The event flows through the existing realtime channel like SCULPT
-- and ADD_OBJECT, so connected tabs / browsers clear their local
-- height maps without a reload.

-- Extend the check constraint to allow the new event type.
alter table public.world_events
  drop constraint if exists world_events_event_type_check;
alter table public.world_events
  add constraint world_events_event_type_check
  check (event_type in ('SCULPT', 'ADD_OBJECT', 'UPDATE_OBJECT', 'REMOVE_OBJECT', 'RESET_TERRAIN'));

-- Re-create the commit RPC so it knows what to do when the new event
-- type is submitted: wipe every prior SCULPT delta for this world,
-- then insert a single fresh RESET_TERRAIN row that subscribers will
-- pick up. The token bypass for owner/editor from the previous
-- migration is preserved verbatim.
create or replace function public.consume_token_and_insert_event(
  p_world_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_client_version text default '1.0.0'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_interval int;
  v_points int;
  v_last timestamptz;
  v_now timestamptz := now();
  v_inserted_id uuid;
  v_role text;
  v_elapsed double precision;
  v_add int;
  v_unlimited boolean := false;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  v_role := public.world_role(p_world_id, v_user);
  if v_role is null then
    raise exception 'world not found or not visible';
  end if;
  if v_role not in ('owner', 'editor') then
    raise exception 'forbidden';
  end if;

  -- RESET_TERRAIN is intentionally restricted to the world owner.
  -- Editors can sculpt and place freely, but nuking every sculpt
  -- is owner-only to prevent griefing within a multi-editor world.
  if p_event_type = 'RESET_TERRAIN' and v_role <> 'owner' then
    raise exception 'forbidden: RESET_TERRAIN requires owner role';
  end if;

  select coalesce((w.settings->>'token_refill_interval_seconds')::int, 600)
    into v_interval
  from public.worlds w
  where w.id = p_world_id;

  -- Admin bypass: owners and editors skip the token machinery.
  if v_role in ('owner', 'editor') then
    v_unlimited := true;
    v_points := -1;
    v_last := null;
  else
    insert into public.user_tokens as ut (world_id, user_id, points, last_refill_at)
    values (p_world_id, v_user, 1, v_now)
    on conflict (world_id, user_id) do nothing;

    select ut.points, ut.last_refill_at into v_points, v_last
    from public.user_tokens ut
    where ut.world_id = p_world_id and ut.user_id = v_user
    for update;

    if not found then
      raise exception 'token row missing';
    end if;

    v_elapsed := extract(epoch from (v_now - v_last));
    if v_elapsed >= v_interval then
      v_add := floor(v_elapsed / v_interval)::int;
      v_points := least(v_points + v_add, 99);
      v_last := v_last + make_interval(secs => (v_add * v_interval));
    end if;

    if v_points < 1 then
      raise exception 'insufficient_tokens' using errcode = 'P0001';
    end if;

    v_points := v_points - 1;

    update public.user_tokens ut
    set points = v_points, last_refill_at = v_last
    where ut.world_id = p_world_id and ut.user_id = v_user;
  end if;

  -- For RESET_TERRAIN, drop every prior SCULPT event so the world
  -- replays cleanly on the next cold start. We do this before the
  -- INSERT so the new RESET_TERRAIN row is preserved.
  if p_event_type = 'RESET_TERRAIN' then
    delete from public.world_events
    where world_id = p_world_id and event_type = 'SCULPT';
    -- Snapshot table is also wiped if anyone has populated it.
    delete from public.terrain_chunks
    where world_id = p_world_id;
  end if;

  insert into public.world_events (world_id, user_id, event_type, payload, client_version)
  values (p_world_id, v_user, p_event_type, p_payload, coalesce(p_client_version, '1.0.0'))
  returning id into v_inserted_id;

  if p_event_type = 'ADD_OBJECT' then
    insert into public.placed_objects (id, world_id, asset_id, transform, created_by)
    values (
      coalesce((p_payload->>'object_id')::uuid, gen_random_uuid()),
      p_world_id,
      p_payload->>'asset_id',
      array(select jsonb_array_elements_text(p_payload->'transform'))::float8[],
      v_user
    );
  elsif p_event_type = 'UPDATE_OBJECT' then
    update public.placed_objects po
    set
      transform = array(select jsonb_array_elements_text(p_payload->'transform'))::float8[],
      updated_at = v_now
    where po.id = (p_payload->>'object_id')::uuid and po.world_id = p_world_id;
  elsif p_event_type = 'REMOVE_OBJECT' then
    delete from public.placed_objects po
    where po.id = (p_payload->>'object_id')::uuid and po.world_id = p_world_id;
  end if;

  return jsonb_build_object(
    'event_id', v_inserted_id,
    'new_points', v_points,
    'next_refill_at',
      case
        when v_unlimited then null
        else (v_last + make_interval(secs => v_interval))
      end,
    'unlimited', v_unlimited
  );
end;
$$;

grant execute on function public.consume_token_and_insert_event(uuid, text, jsonb, text) to authenticated;
