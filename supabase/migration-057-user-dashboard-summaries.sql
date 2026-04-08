-- migration-057: persist generated dashboard summaries per user

create table if not exists public.user_dashboard_summaries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  summary text not null,
  provider text,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_dashboard_summaries_generated_at
  on public.user_dashboard_summaries (generated_at desc);

alter table public.user_dashboard_summaries enable row level security;

drop policy if exists "user_dashboard_summaries_select_own" on public.user_dashboard_summaries;
create policy "user_dashboard_summaries_select_own"
  on public.user_dashboard_summaries for select
  using (auth.uid() = user_id);

drop policy if exists "user_dashboard_summaries_insert_own" on public.user_dashboard_summaries;
create policy "user_dashboard_summaries_insert_own"
  on public.user_dashboard_summaries for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_dashboard_summaries_update_own" on public.user_dashboard_summaries;
create policy "user_dashboard_summaries_update_own"
  on public.user_dashboard_summaries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_dashboard_summaries_delete_own" on public.user_dashboard_summaries;
create policy "user_dashboard_summaries_delete_own"
  on public.user_dashboard_summaries for delete
  using (auth.uid() = user_id);

create or replace function public.touch_user_dashboard_summaries_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_user_dashboard_summaries_updated_at on public.user_dashboard_summaries;
create trigger trg_touch_user_dashboard_summaries_updated_at
  before update on public.user_dashboard_summaries
  for each row
  execute function public.touch_user_dashboard_summaries_updated_at();
