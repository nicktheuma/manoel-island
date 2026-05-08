-- ─────────────────────────────────────────────────────────────────────
-- Bootstrap the public "Manoel Island" base world.
--
-- Run this in the Supabase SQL Editor *after*:
--   1. The two migrations under supabase/migrations/ have been applied.
--   2. You have signed up your admin user via Supabase Auth (email/pwd).
--
-- Set v_admin_email below to your admin account's email, then click Run.
-- The script is idempotent — running it multiple times is safe.
-- ─────────────────────────────────────────────────────────────────────

do $$
declare
  v_admin_email text := 'CHANGE_ME@example.com';
  v_world_id uuid := '11111111-1111-4111-8111-111111111111'::uuid;
  v_admin_uid uuid;
begin
  -- 1. Resolve the admin's auth.users id from the email
  select id into v_admin_uid
  from auth.users
  where lower(email) = lower(v_admin_email);

  if v_admin_uid is null then
    raise exception
      'No auth.users row for email "%". Sign up first via Supabase Auth, then re-run.',
      v_admin_email;
  end if;

  -- 2. Make sure they have a profile row (the trigger usually does this,
  --    but seed defensively for accounts created before the trigger).
  insert into public.profiles (id, display_name)
  values (v_admin_uid, 'Manoel Admin')
  on conflict (id) do nothing;

  -- 3. Create the canonical Manoel Island base world (public visibility
  --    so anonymous visitors can READ admin config + placed objects).
  insert into public.worlds (id, owner_id, name, visibility)
  values (
    v_world_id,
    v_admin_uid,
    'Manoel Island (Public Base)',
    'public'
  )
  on conflict (id) do update
    set owner_id  = excluded.owner_id,
        visibility = excluded.visibility,
        name       = excluded.name;

  -- 4. Initialise an empty admin-config row so the first save can UPSERT.
  insert into public.world_admin_configs (world_id, config, updated_by)
  values (v_world_id, '{}'::jsonb, v_admin_uid)
  on conflict (world_id) do nothing;

  raise notice 'Seeded Manoel Island base world % owned by %', v_world_id, v_admin_email;
end$$;
