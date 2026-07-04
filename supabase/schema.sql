create table if not exists public.dg_tracker_user_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.dg_tracker_user_snapshots enable row level security;

drop policy if exists "dg_user_snapshots_select_own" on public.dg_tracker_user_snapshots;
drop policy if exists "dg_user_snapshots_insert_own" on public.dg_tracker_user_snapshots;
drop policy if exists "dg_user_snapshots_update_own" on public.dg_tracker_user_snapshots;
drop policy if exists "dg_user_snapshots_delete_own" on public.dg_tracker_user_snapshots;

create policy "dg_user_snapshots_select_own"
on public.dg_tracker_user_snapshots
for select
to authenticated
using (auth.uid() = user_id);

create policy "dg_user_snapshots_insert_own"
on public.dg_tracker_user_snapshots
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "dg_user_snapshots_update_own"
on public.dg_tracker_user_snapshots
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "dg_user_snapshots_delete_own"
on public.dg_tracker_user_snapshots
for delete
to authenticated
using (auth.uid() = user_id);

do $$
begin
  if to_regclass('public.dg_tracker_snapshots') is not null then
    execute 'drop policy if exists "dg_tracker_snapshots_anon_all" on public.dg_tracker_snapshots';
  end if;
end $$;

select pg_notify('pgrst', 'reload schema');
