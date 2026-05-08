-- Admin config persistence for custom island mesh/material controls

create table if not exists public.world_admin_configs (
  world_id uuid primary key references public.worlds (id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.world_admin_configs enable row level security;

drop policy if exists "world_admin_configs_select_member" on public.world_admin_configs;
create policy "world_admin_configs_select_member"
  on public.world_admin_configs for select
  using (
    exists (
      select 1
      from public.worlds w
      where w.id = world_admin_configs.world_id
        and (
          w.owner_id = auth.uid()
          or w.visibility = 'public'
          or exists (
            select 1
            from public.world_members wm
            where wm.world_id = w.id and wm.user_id = auth.uid()
          )
        )
    )
  );

drop policy if exists "world_admin_configs_write_editor" on public.world_admin_configs;
create policy "world_admin_configs_write_editor"
  on public.world_admin_configs for insert
  with check (
    exists (
      select 1
      from public.worlds w
      where w.id = world_admin_configs.world_id
        and (
          w.owner_id = auth.uid()
          or exists (
            select 1
            from public.world_members wm
            where wm.world_id = w.id
              and wm.user_id = auth.uid()
              and wm.role in ('owner', 'editor')
          )
        )
    )
  );

drop policy if exists "world_admin_configs_update_editor" on public.world_admin_configs;
create policy "world_admin_configs_update_editor"
  on public.world_admin_configs for update
  using (
    exists (
      select 1
      from public.worlds w
      where w.id = world_admin_configs.world_id
        and (
          w.owner_id = auth.uid()
          or exists (
            select 1
            from public.world_members wm
            where wm.world_id = w.id
              and wm.user_id = auth.uid()
              and wm.role in ('owner', 'editor')
          )
        )
    )
  );

