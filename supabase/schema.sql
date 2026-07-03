create table if not exists public.dg_tracker_snapshots (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.dg_tracker_snapshots enable row level security;

drop policy if exists "dg_tracker_snapshots_anon_all" on public.dg_tracker_snapshots;
create policy "dg_tracker_snapshots_anon_all"
on public.dg_tracker_snapshots
for all
to anon
using (true)
with check (true);
