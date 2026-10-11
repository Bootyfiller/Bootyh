-- Run this once in the Supabase SQL Editor for project kuniwiidqjtcqucaohuw.
-- Every business row is scoped to auth.uid() and protected by row-level security.

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_name text not null default '',
  service_name text not null default '',
  appointment_date timestamptz not null,
  price numeric(12,2) not null default 0,
  status text not null default 'scheduled',
  notes text not null default '',
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.appointments add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.appointments add column if not exists client_name text not null default '';
alter table public.appointments add column if not exists service_name text not null default '';
alter table public.appointments add column if not exists appointment_date timestamptz;
alter table public.appointments add column if not exists price numeric(12,2) not null default 0;
alter table public.appointments add column if not exists status text not null default 'scheduled';
alter table public.appointments add column if not exists notes text not null default '';
alter table public.appointments add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.appointments add column if not exists updated_at timestamptz not null default now();

create table if not exists public.useables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_name text not null,
  measurement_unit text not null check (measurement_unit in ('pcs', 'ml', 'fl oz', 'g')),
  units_in_stock numeric(14,4) not null default 0,
  cost_per_unit numeric(12,6) not null default 0,
  low_stock_threshold numeric(14,4) not null default 2,
  purchase_link text,
  notes text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.useables add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.useables add column if not exists item_name text not null default '';
alter table public.useables add column if not exists measurement_unit text not null default 'pcs';
alter table public.useables add column if not exists units_in_stock numeric(14,4) not null default 0;
alter table public.useables add column if not exists cost_per_unit numeric(12,6) not null default 0;
alter table public.useables add column if not exists low_stock_threshold numeric(14,4) not null default 2;
alter table public.useables add column if not exists purchase_link text;
alter table public.useables add column if not exists notes text not null default '';
alter table public.useables add column if not exists updated_at timestamptz not null default now();

do $
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.useables'::regclass and conname='useables_measurement_unit_allowed'
  ) then
    alter table public.useables add constraint useables_measurement_unit_allowed
      check (measurement_unit in ('pcs','ml','fl oz','g')) not valid;
  end if;
end $;

create table if not exists public.appointment_useables (
  user_id uuid not null references auth.users(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  useable_id uuid not null references public.useables(id) on delete cascade,
  quantity_used numeric(14,4) not null check (quantity_used >= 0),
  cost_at_time numeric(12,6) not null default 0,
  primary key (appointment_id, useable_id)
);
alter table public.appointment_useables add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.appointment_useables add column if not exists quantity_used numeric(14,4) not null default 0;
alter table public.appointment_useables add column if not exists cost_at_time numeric(12,6) not null default 0;

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profit_goal numeric(12,2) not null default 0,
  setup_complete boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.user_settings add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.user_settings add column if not exists profit_goal numeric(12,2) not null default 0;
alter table public.user_settings add column if not exists setup_complete boolean not null default false;
alter table public.user_settings add column if not exists updated_at timestamptz not null default now();
create unique index if not exists appointment_useables_pair_idx on public.appointment_useables(appointment_id, useable_id);
create unique index if not exists user_settings_user_id_idx on public.user_settings(user_id);
create index if not exists appointments_user_id_idx on public.appointments(user_id);
create index if not exists useables_user_id_idx on public.useables(user_id);
create index if not exists appointment_useables_user_id_idx on public.appointment_useables(user_id);

alter table public.appointments enable row level security;
alter table public.useables enable row level security;
alter table public.appointment_useables enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "appointments own rows" on public.appointments;
create policy "appointments own rows" on public.appointments for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "useables own rows" on public.useables;
create policy "useables own rows" on public.useables for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "appointment useables own rows" on public.appointment_useables;
create policy "appointment useables own rows" on public.appointment_useables for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.appointments a where a.id = appointment_id and a.user_id = (select auth.uid()))
    and exists (select 1 from public.useables u where u.id = useable_id and u.user_id = (select auth.uid()))
  ) with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.appointments a where a.id = appointment_id and a.user_id = (select auth.uid()))
    and exists (select 1 from public.useables u where u.id = useable_id and u.user_id = (select auth.uid()))
  );
drop policy if exists "user settings own row" on public.user_settings;
create policy "user settings own row" on public.user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));


-- Enable cross-session updates for the app's live sync channel.
do $
declare table_to_add text;
begin
  foreach table_to_add in array array['appointments','useables','appointment_useables','user_settings'] loop
    if not exists (
      select 1 from pg_publication_tables p
      where p.pubname='supabase_realtime' and p.schemaname='public' and p.tablename=table_to_add
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_to_add);
    end if;
  end loop;
exception when undefined_object then
  raise notice 'Realtime publication is unavailable; enable it for the four app tables in Supabase.';
end $;
