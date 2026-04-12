-- Odyssey Database Schema v1
-- Run this in the Supabase SQL Editor
-- Tables created first, then RLS policies, to avoid forward-reference errors.


-- ════════════════════════════════════════════════════
-- 1. CREATE ALL TABLES
-- ════════════════════════════════════════════════════

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text check (username is null or username ~ '^[a-z0-9_]{3,32}$'),
  display_name text,
  avatar_url  text,
  email       text,
  thesis_page_snapshot jsonb not null default '{}'::jsonb,
  created_at  timestamptz default now()
);

create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  owner_id    uuid references auth.users(id) on delete set null,
  created_at  timestamptz default now()
);

create table public.project_members (
  project_id  uuid references public.projects(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  role        text default 'member',
  joined_at   timestamptz default now(),
  primary key (project_id, user_id)
);

create table public.goals (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id) on delete cascade,
  title       text not null,
  deadline    date,
  status      text default 'not_started' check (status in ('not_started', 'in_progress', 'in_review', 'complete')),
  risk_score  float,
  progress    int default 0 check (progress >= 0 and progress <= 100),
  created_at  timestamptz default now()
);

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

create table public.integrations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id) on delete cascade,
  type        text not null check (type in ('github', 'teams', 'onedrive')),
  config      jsonb,
  token_ref   text,  -- reference to encrypted token in Supabase Vault, NEVER the token itself
  created_at  timestamptz default now()
);


-- ════════════════════════════════════════════════════
-- 2. INDEXES
-- ════════════════════════════════════════════════════

create index idx_events_project_occurred
  on public.events (project_id, occurred_at desc);

create index idx_events_source
  on public.events (source);

create unique index profiles_username_lower_unique_idx
  on public.profiles (lower(username))
  where username is not null;


-- ════════════════════════════════════════════════════
-- 3. ENABLE RLS ON ALL TABLES
-- ════════════════════════════════════════════════════

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.goals enable row level security;
alter table public.events enable row level security;
alter table public.integrations enable row level security;


-- ════════════════════════════════════════════════════
-- 4. RLS POLICIES
-- ════════════════════════════════════════════════════

-- Profiles
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can search profiles"
  on public.profiles for select
  using (auth.uid() is not null);

-- Projects
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

create policy "Project owners can delete"
  on public.projects for delete
  using (auth.uid() = owner_id);

-- Project Members
create policy "Members can read membership"
  on public.project_members for select
  using (
    user_id = auth.uid() or
    project_id in (select id from public.projects where owner_id = auth.uid())
  );

create policy "Project owners can manage members"
  on public.project_members for insert
  with check (
    project_id in (select id from public.projects where owner_id = auth.uid())
  );

-- Goals
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

-- Events
create policy "Project members can read events"
  on public.events for select
  using (
    project_id in (
      select id from public.projects where owner_id = auth.uid()
      union
      select project_id from public.project_members where user_id = auth.uid()
    )
  );

-- Integrations
create policy "Project owners can manage integrations"
  on public.integrations for all
  using (
    project_id in (select id from public.projects where owner_id = auth.uid())
  );


-- ════════════════════════════════════════════════════
-- 5. FUNCTIONS & TRIGGERS
-- ════════════════════════════════════════════════════

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
declare
  metadata_username text;
  email_local_part text;
  initial_display_name text;
begin
  metadata_username := lower(trim(new.raw_user_meta_data ->> 'username'));
  email_local_part := nullif(split_part(coalesce(new.email, ''), '@', 1), '');

  if metadata_username is not null and metadata_username !~ '^[a-z0-9_]{3,32}$' then
    metadata_username := null;
  end if;

  initial_display_name := coalesce(
    metadata_username,
    email_local_part,
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'user_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), '')
  );

  insert into public.profiles (id, username, display_name, avatar_url, email)
  values (
    new.id,
    metadata_username,
    initial_display_name,
    new.raw_user_meta_data ->> 'avatar_url',
    new.email
  )
  on conflict (id) do update set
    email = excluded.email,
    avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url),
    username = coalesce(profiles.username, excluded.username),
    display_name = coalesce(profiles.display_name, excluded.display_name);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.goal_assignment_ids(
  p_assigned_to uuid,
  p_assignees text[]
)
returns uuid[]
language sql
immutable
as $$
  select coalesce(
    array_agg(distinct parsed.user_id),
    '{}'::uuid[]
  )
  from (
    select p_assigned_to as user_id
    where p_assigned_to is not null

    union

    select value::uuid as user_id
    from unnest(coalesce(p_assignees, '{}'::text[])) as value
    where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) as parsed;
$$;

create or replace function public.notify_goal_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_assignees uuid[] := case
    when tg_op = 'UPDATE' then public.goal_assignment_ids(old.assigned_to, old.assignees)
    else '{}'::uuid[]
  end;
  v_new_assignees uuid[] := public.goal_assignment_ids(new.assigned_to, new.assignees);
  v_newly_assigned uuid[];
  v_project_name text;
  v_actor_id uuid;
  v_actor_name text;
  v_deadline_text text;
  v_category_text text;
  v_user_id uuid;
begin
  v_newly_assigned := array(
    select assignee_id
    from unnest(v_new_assignees) as assignee_id
    where not (assignee_id = any(v_old_assignees))
  );

  if coalesce(array_length(v_newly_assigned, 1), 0) = 0 then
    return new;
  end if;

  select name into v_project_name
  from public.projects
  where id = new.project_id;

  v_actor_id := coalesce(new.updated_by, new.created_by, auth.uid());

  if v_actor_id is not null then
    select coalesce(nullif(trim(display_name), ''), nullif(trim(username), ''), nullif(trim(email), ''), 'A project member')
      into v_actor_name
    from public.profiles
    where id = v_actor_id;
  end if;

  v_actor_name := coalesce(v_actor_name, 'Project AI');
  v_deadline_text := case when new.deadline is not null then to_char(new.deadline, 'YYYY-MM-DD') else null end;
  v_category_text := nullif(trim(coalesce(new.category, '')), '');

  foreach v_user_id in array v_newly_assigned loop
    perform public.create_notification(
      v_user_id,
      'task_assigned',
      'Task assigned',
      v_actor_name || ' assigned you to "' || coalesce(new.title, 'Untitled task') || '"'
        || case when v_project_name is not null then ' in "' || v_project_name || '"' else '' end
        || '.'
        || case when v_deadline_text is not null then ' Deadline: ' || v_deadline_text || '.' else '' end
        || case when v_category_text is not null then ' Category: ' || v_category_text || '.' else '' end,
      '/projects/' || new.project_id,
      new.project_id,
      v_actor_id,
      jsonb_build_object(
        'goal_id', new.id,
        'goal_title', new.title,
        'assigned_by', v_actor_name,
        'assigned_by_user_id', v_actor_id,
        'deadline', new.deadline,
        'category', new.category,
        'status', new.status,
        'progress', new.progress
      )
    );
  end loop;

  return new;
end;
$$;

create trigger trg_notify_goal_assignment
  after insert or update on public.goals
  for each row
  execute function public.notify_goal_assignment();


-- ════════════════════════════════════════════════════
-- 6. REALTIME
-- ════════════════════════════════════════════════════

alter publication supabase_realtime add table public.events;
