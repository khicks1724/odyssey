-- Odyssey Database Schema v1
-- Run this in the Supabase SQL Editor

-- ── Users (extended from Supabase auth.users) ──────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url  text,
  created_at  timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── Projects ────────────────────────────────────────
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  owner_id    uuid references auth.users(id) on delete set null,
  created_at  timestamptz default now()
);

alter table public.projects enable row level security;

create policy "Project members can read projects"
  on public.projects for select
  using (
    owner_id = auth.uid() or
    id in (select project_id from public.project_members where user_id = auth.uid())
  );

create policy "Authenticated users can create projects"
  on public.projects for insert
  with check (auth.uid() = owner_id);

create policy "Project owners can update"
  on public.projects for update
  using (auth.uid() = owner_id);


-- ── Project Members ─────────────────────────────────
create table public.project_members (
  project_id  uuid references public.projects(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  role        text default 'member',
  joined_at   timestamptz default now(),
  primary key (project_id, user_id)
);

alter table public.project_members enable row level security;

create policy "Members can read membership"
  on public.project_members for select
  using (
    user_id = auth.uid() or
    project_id in (select id from public.projects where owner_id = auth.uid())
  );


-- ── Goals ───────────────────────────────────────────
create table public.goals (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id) on delete cascade,
  title       text not null,
  deadline    date,
  status      text default 'active' check (status in ('active', 'at_risk', 'complete', 'missed')),
  risk_score  float,
  progress    int default 0 check (progress >= 0 and progress <= 100),
  created_at  timestamptz default now()
);

alter table public.goals enable row level security;

create policy "Project members can read goals"
  on public.goals for select
  using (
    project_id in (
      select id from public.projects where owner_id = auth.uid()
      union
      select project_id from public.project_members where user_id = auth.uid()
    )
  );

create policy "Project owners can manage goals"
  on public.goals for all
  using (
    project_id in (select id from public.projects where owner_id = auth.uid())
  );


-- ── Events (unified event log) ─────────────────────
create table public.events (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id) on delete cascade,
  actor_id    uuid references auth.users(id),
  source      text not null check (source in ('github', 'teams', 'onedrive', 'onenote', 'manual')),
  event_type  text not null check (event_type in ('commit', 'message', 'file_edit', 'note', 'meeting')),
  title       text,
  summary     text,
  metadata    jsonb,
  occurred_at timestamptz not null,
  created_at  timestamptz default now()
);

alter table public.events enable row level security;

create policy "Project members can read events"
  on public.events for select
  using (
    project_id in (
      select id from public.projects where owner_id = auth.uid()
      union
      select project_id from public.project_members where user_id = auth.uid()
    )
  );

-- Index for fast timeline queries
create index idx_events_project_occurred
  on public.events (project_id, occurred_at desc);

create index idx_events_source
  on public.events (source);


-- ── Integrations ────────────────────────────────────
create table public.integrations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id) on delete cascade,
  type        text not null check (type in ('github', 'teams', 'onedrive')),
  config      jsonb,
  token_ref   text,  -- reference to encrypted token in Supabase Vault, NEVER the token itself
  created_at  timestamptz default now()
);

alter table public.integrations enable row level security;

create policy "Project owners can manage integrations"
  on public.integrations for all
  using (
    project_id in (select id from public.projects where owner_id = auth.uid())
  );


-- ── Realtime ────────────────────────────────────────
-- Enable realtime for the events table so the frontend gets live updates
alter publication supabase_realtime add table public.events;
