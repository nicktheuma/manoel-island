-- Persist the admin-imported OSM payload (roads, buildings, vegetation,
-- water polygons, optional Open-Meteo heightmap, picked bbox & outline)
-- per world. Only one row per world; admins overwrite on every import.
--
-- Storing the entire payload as JSONB keeps the schema simple and lets
-- the client hydrate the map import store on cold start with a single
-- network read. Heightmap floats are stored base64-encoded inside the
-- JSON so we don't need a separate bytea column.

create table if not exists public.world_osm_imports (
  world_id uuid primary key references public.worlds(id) on delete cascade,
  bbox jsonb,
  outline_lat_lng jsonb,
  payload jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.world_osm_imports enable row level security;

-- Anyone who can see the world can read the OSM import — public worlds
-- mean signed-out viewers get the persisted layers too.
drop policy if exists "world_osm_imports_select" on public.world_osm_imports;
create policy "world_osm_imports_select"
  on public.world_osm_imports for select
  using (public.world_role(world_id, auth.uid()) is not null);

-- Only owners and editors can write. Insert and update share a single
-- predicate via `with check`; delete is owner-only.
drop policy if exists "world_osm_imports_write" on public.world_osm_imports;
create policy "world_osm_imports_write"
  on public.world_osm_imports for insert
  with check (public.world_role(world_id, auth.uid()) in ('owner', 'editor'));

drop policy if exists "world_osm_imports_update" on public.world_osm_imports;
create policy "world_osm_imports_update"
  on public.world_osm_imports for update
  using (public.world_role(world_id, auth.uid()) in ('owner', 'editor'))
  with check (public.world_role(world_id, auth.uid()) in ('owner', 'editor'));

drop policy if exists "world_osm_imports_delete" on public.world_osm_imports;
create policy "world_osm_imports_delete"
  on public.world_osm_imports for delete
  using (public.world_role(world_id, auth.uid()) = 'owner');

-- Auto-touch updated_at on row writes for cache-busting.
create or replace function public.touch_world_osm_imports_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_world_osm_imports_touch on public.world_osm_imports;
create trigger trg_world_osm_imports_touch
  before update on public.world_osm_imports
  for each row execute function public.touch_world_osm_imports_updated_at();
