-- Manuel Island Sandbox — schema, RLS, token RPC
-- Run via Supabase CLI or SQL editor

-- Extensions
create extension if not exists "pgcrypto";

-- Profiles (sync with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz default now() not null
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- Worlds
create table if not exists public.worlds (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null default 'Untitled Island',
  visibility text not null default 'private' check (visibility in ('private', 'unlisted', 'public')),
  settings jsonb not null default jsonb_build_object(
    'token_refill_interval_seconds', 600,
    'max_brush_radius', 8,
    'max_strength', 0.5,
    'chunk_size', 32,
    'chunk_grid', 4
  ),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists worlds_owner_idx on public.worlds (owner_id);

alter table public.worlds enable row level security;

-- World members — created BEFORE the `worlds` policies because
-- `worlds_select_member` cross-references this table.
create table if not exists public.world_members (
  world_id uuid not null references public.worlds (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  primary key (world_id, user_id)
);

alter table public.world_members enable row level security;

drop policy if exists "world_members_select" on public.world_members;
create policy "world_members_select"
  on public.world_members for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.worlds w where w.id = world_members.world_id and w.owner_id = auth.uid())
  );

drop policy if exists "world_members_insert_owner" on public.world_members;
create policy "world_members_insert_owner"
  on public.world_members for insert
  with check (
    exists (select 1 from public.worlds w where w.id = world_id and w.owner_id = auth.uid())
  );

drop policy if exists "world_members_delete_owner" on public.world_members;
create policy "world_members_delete_owner"
  on public.world_members for delete
  using (
    exists (select 1 from public.worlds w where w.id = world_id and w.owner_id = auth.uid())
  );

-- Worlds policies — now safe because `world_members` exists above.
drop policy if exists "worlds_select_member" on public.worlds;
create policy "worlds_select_member"
  on public.worlds for select
  using (
    auth.uid() = owner_id
    or exists (
      select 1 from public.world_members wm
      where wm.world_id = worlds.id and wm.user_id = auth.uid()
    )
    or visibility = 'public'
  );

drop policy if exists "worlds_insert_owner" on public.worlds;
create policy "worlds_insert_owner"
  on public.worlds for insert
  with check (auth.uid() = owner_id);

drop policy if exists "worlds_update_owner" on public.worlds;
create policy "worlds_update_owner"
  on public.worlds for update
  using (auth.uid() = owner_id);

drop policy if exists "worlds_delete_owner" on public.worlds;
create policy "worlds_delete_owner"
  on public.worlds for delete
  using (auth.uid() = owner_id);

-- Terrain chunks (heightmap snapshot per chunk)
create table if not exists public.terrain_chunks (
  world_id uuid not null references public.worlds (id) on delete cascade,
  chunk_x int not null,
  chunk_z int not null,
  resolution int not null default 32,
  -- float32 heights row-major, base64 or hex from client; store as bytea
  height_bytes bytea,
  updated_at timestamptz default now() not null,
  primary key (world_id, chunk_x, chunk_z)
);

alter table public.terrain_chunks enable row level security;

drop policy if exists "terrain_chunks_select" on public.terrain_chunks;
create policy "terrain_chunks_select"
  on public.terrain_chunks for select
  using (
    exists (
      select 1 from public.worlds w
      where w.id = terrain_chunks.world_id
        and (
          w.owner_id = auth.uid()
          or w.visibility = 'public'
          or exists (select 1 from public.world_members wm where wm.world_id = w.id and wm.user_id = auth.uid())
        )
    )
  );

drop policy if exists "terrain_chunks_write_editor" on public.terrain_chunks;
create policy "terrain_chunks_write_editor"
  on public.terrain_chunks for insert
  with check (
    exists (
      select 1 from public.worlds w
      where w.id = terrain_chunks.world_id
        and (
          w.owner_id = auth.uid()
          or exists (
            select 1 from public.world_members wm
            where wm.world_id = w.id and wm.user_id = auth.uid() and wm.role in ('owner', 'editor')
          )
        )
    )
  );

drop policy if exists "terrain_chunks_update_editor" on public.terrain_chunks;
create policy "terrain_chunks_update_editor"
  on public.terrain_chunks for update
  using (
    exists (
      select 1 from public.worlds w
      where w.id = terrain_chunks.world_id
        and (
          w.owner_id = auth.uid()
          or exists (
            select 1 from public.world_members wm
            where wm.world_id = w.id and wm.user_id = auth.uid() and wm.role in ('owner', 'editor')
          )
        )
    )
  );

-- Placed objects (canonical state)
create table if not exists public.placed_objects (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.worlds (id) on delete cascade,
  asset_id text not null,
  transform float8[] not null check (cardinality(transform) = 16),
  created_by uuid references public.profiles (id),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists placed_objects_world_idx on public.placed_objects (world_id);

alter table public.placed_objects enable row level security;

drop policy if exists "placed_objects_select" on public.placed_objects;
create policy "placed_objects_select"
  on public.placed_objects for select
  using (
    exists (
      select 1 from public.worlds w
      where w.id = placed_objects.world_id
        and (
          w.owner_id = auth.uid()
          or w.visibility = 'public'
          or exists (select 1 from public.world_members wm where wm.world_id = w.id and wm.user_id = auth.uid())
        )
    )
  );

drop policy if exists "placed_objects_insert_editor" on public.placed_objects;
create policy "placed_objects_insert_editor"
  on public.placed_objects for insert
  with check (
    exists (
      select 1 from public.worlds w
      where w.id = world_id
        and (
          w.owner_id = auth.uid()
          or exists (
            select 1 from public.world_members wm
            where wm.world_id = w.id and wm.user_id = auth.uid() and wm.role in ('owner', 'editor')
          )
        )
    )
  );

drop policy if exists "placed_objects_update_editor" on public.placed_objects;
create policy "placed_objects_update_editor"
  on public.placed_objects for update
  using (
    exists (
      select 1 from public.worlds w
      where w.id = placed_objects.world_id
        and (
          w.owner_id = auth.uid()
          or exists (
            select 1 from public.world_members wm
            where wm.world_id = w.id and wm.user_id = auth.uid() and wm.role in ('owner', 'editor')
          )
        )
    )
  );

drop policy if exists "placed_objects_delete_editor" on public.placed_objects;
create policy "placed_objects_delete_editor"
  on public.placed_objects for delete
  using (
    exists (
      select 1 from public.worlds w
      where w.id = placed_objects.world_id
        and (
          w.owner_id = auth.uid()
          or exists (
            select 1 from public.world_members wm
            where wm.world_id = w.id and wm.user_id = auth.uid() and wm.role in ('owner', 'editor')
          )
        )
    )
  );

-- Append-only world events (realtime + audit)
create table if not exists public.world_events (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.worlds (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_type text not null check (event_type in ('SCULPT', 'ADD_OBJECT', 'UPDATE_OBJECT', 'REMOVE_OBJECT')),
  payload jsonb not null default '{}',
  client_version text default '1.0.0',
  seq bigserial,
  created_at timestamptz default now() not null
);

create index if not exists world_events_world_seq on public.world_events (world_id, seq);

alter table public.world_events enable row level security;

drop policy if exists "world_events_select" on public.world_events;
create policy "world_events_select"
  on public.world_events for select
  using (
    exists (
      select 1 from public.worlds w
      where w.id = world_events.world_id
        and (
          w.owner_id = auth.uid()
          or w.visibility = 'public'
          or exists (select 1 from public.world_members wm where wm.world_id = w.id and wm.user_id = auth.uid())
        )
    )
  );

-- Inserts only via RPC (no direct insert policy for anon)

-- Per-user per-world tokens
create table if not exists public.user_tokens (
  world_id uuid not null references public.worlds (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  points int not null default 1 check (points >= 0 and points <= 999),
  last_refill_at timestamptz default now() not null,
  primary key (world_id, user_id)
);

alter table public.user_tokens enable row level security;

drop policy if exists "user_tokens_select_own" on public.user_tokens;
create policy "user_tokens_select_own"
  on public.user_tokens for select
  using (user_id = auth.uid());

-- Writes via RPC only

-- Ensure profile row on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Token refill + event insert (authoritative)
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
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select coalesce((w.settings->>'token_refill_interval_seconds')::int, 600)
  into v_interval
  from public.worlds w
  where w.id = p_world_id;

  if not found then
    raise exception 'world not found';
  end if;

  select wm.role into v_role
  from public.world_members wm
  where wm.world_id = p_world_id and wm.user_id = v_user;

  if not found then
    select case when w.owner_id = v_user then 'owner' else null end into v_role
    from public.worlds w where w.id = p_world_id;
  end if;

  if v_role is null or v_role = 'viewer' then
    raise exception 'forbidden';
  end if;

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
    'next_refill_at', (v_last + make_interval(secs => v_interval))
  );
end;
$$;

grant execute on function public.consume_token_and_insert_event(uuid, text, jsonb, text) to authenticated;

-- Realtime: replicate world_events (idempotent for local resets)
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'world_events'
  ) then
    alter publication supabase_realtime add table public.world_events;
  end if;
end $$;