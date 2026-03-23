-- Migration 026: platform notifications and shared chat foundations
-- Run this in the Supabase SQL Editor

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  actor_id   uuid references auth.users(id) on delete set null,
  project_id uuid references public.projects(id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  link       text,
  metadata   jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_created
  on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select
  using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own"
  on public.notifications for delete
  using (user_id = auth.uid());

create or replace function public.create_notification(
  p_user_id uuid,
  p_kind text,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_project_id uuid default null,
  p_actor_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.notifications(user_id, actor_id, project_id, kind, title, body, link, metadata)
  values (p_user_id, p_actor_id, p_project_id, p_kind, p_title, p_body, p_link, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_notification(uuid, text, text, text, text, uuid, uuid, jsonb) to authenticated;

create or replace function public.notify_join_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_name text;
  v_actor_name text;
  v_owner_id uuid;
begin
  select name, owner_id into v_project_name, v_owner_id
  from public.projects
  where id = new.project_id;

  select coalesce(display_name, 'A user') into v_actor_name
  from public.profiles
  where id = new.user_id;

  if v_owner_id is not null and v_owner_id <> new.user_id then
    perform public.create_notification(
      v_owner_id,
      'join_request',
      'New join request',
      coalesce(v_actor_name, 'A user') || ' requested to join "' || coalesce(v_project_name, 'a project') || '".',
      '/projects/' || new.project_id,
      new.project_id,
      new.user_id,
      jsonb_build_object('request_id', new.id, 'requester_id', new.user_id)
    );
  end if;

  insert into public.notifications(user_id, actor_id, project_id, kind, title, body, link, metadata)
  select
    pm.user_id,
    new.user_id,
    new.project_id,
    'join_request',
    'New join request',
    coalesce(v_actor_name, 'A user') || ' requested to join "' || coalesce(v_project_name, 'a project') || '".',
    '/projects/' || new.project_id,
    jsonb_build_object('request_id', new.id, 'requester_id', new.user_id)
  from public.project_members pm
  where pm.project_id = new.project_id
    and pm.role = 'owner'
    and pm.user_id <> new.user_id
    and (v_owner_id is null or pm.user_id <> v_owner_id)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_notify_join_request_created on public.join_requests;
create trigger trg_notify_join_request_created
  after insert on public.join_requests
  for each row execute function public.notify_join_request_created();

create or replace function public.notify_join_request_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_name text;
  v_actor_name text;
begin
  if old.status = new.status or new.status = 'pending' then
    return new;
  end if;

  select name into v_project_name
  from public.projects
  where id = new.project_id;

  select coalesce(display_name, 'Project owner') into v_actor_name
  from public.profiles
  where id = auth.uid();

  perform public.create_notification(
    new.user_id,
    case when new.status = 'approved' then 'join_request_approved' else 'join_request_denied' end,
    case when new.status = 'approved' then 'Join request approved' else 'Join request denied' end,
    case
      when new.status = 'approved' then '"' || coalesce(v_project_name, 'Your requested project') || '" accepted your join request.'
      else '"' || coalesce(v_project_name, 'Your requested project') || '" denied your join request.'
    end,
    '/projects/' || new.project_id,
    new.project_id,
    auth.uid(),
    jsonb_build_object('request_id', new.id, 'status', new.status, 'responder_name', v_actor_name)
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_join_request_updated on public.join_requests;
create trigger trg_notify_join_request_updated
  after update on public.join_requests
  for each row execute function public.notify_join_request_updated();

create table if not exists public.chat_threads (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('project', 'direct')),
  project_id         uuid references public.projects(id) on delete cascade,
  related_project_id uuid references public.projects(id) on delete set null,
  direct_key         text unique,
  title              text,
  ai_mode            boolean not null default false,
  ai_mode_by         uuid references auth.users(id) on delete set null,
  ai_mode_started_at timestamptz,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint chat_threads_project_check check (
    (kind = 'project' and project_id is not null)
    or (kind = 'direct' and project_id is null)
  )
);

create unique index if not exists idx_chat_threads_project_unique
  on public.chat_threads(project_id)
  where kind = 'project';

create index if not exists idx_chat_threads_kind_updated
  on public.chat_threads(kind, updated_at desc);

create table if not exists public.chat_thread_members (
  thread_id  uuid not null references public.chat_threads(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists idx_chat_thread_members_user
  on public.chat_thread_members(user_id, joined_at desc);

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.chat_threads(id) on delete cascade,
  sender_id   uuid references auth.users(id) on delete set null,
  role        text not null default 'user' check (role in ('user', 'assistant', 'system')),
  content     text not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_chat_messages_thread_created
  on public.chat_messages(thread_id, created_at asc);

alter table public.chat_threads enable row level security;
alter table public.chat_thread_members enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "chat_threads_select_member" on public.chat_threads;
create policy "chat_threads_select_member"
  on public.chat_threads for select
  using (
    exists (
      select 1
      from public.chat_thread_members ctm
      where ctm.thread_id = chat_threads.id
        and ctm.user_id = auth.uid()
    )
  );

drop policy if exists "chat_threads_insert_direct" on public.chat_threads;
create policy "chat_threads_insert_direct"
  on public.chat_threads for insert
  with check (
    created_by = auth.uid()
    and kind = 'direct'
  );

drop policy if exists "chat_threads_update_member" on public.chat_threads;
create policy "chat_threads_update_member"
  on public.chat_threads for update
  using (
    exists (
      select 1
      from public.chat_thread_members ctm
      where ctm.thread_id = chat_threads.id
        and ctm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.chat_thread_members ctm
      where ctm.thread_id = chat_threads.id
        and ctm.user_id = auth.uid()
    )
  );

drop policy if exists "chat_thread_members_select_member" on public.chat_thread_members;
create policy "chat_thread_members_select_member"
  on public.chat_thread_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.chat_thread_members ctm
      where ctm.thread_id = chat_thread_members.thread_id
        and ctm.user_id = auth.uid()
    )
  );

drop policy if exists "chat_thread_members_insert_self" on public.chat_thread_members;
create policy "chat_thread_members_insert_self"
  on public.chat_thread_members for insert
  with check (user_id = auth.uid());

drop policy if exists "chat_messages_select_member" on public.chat_messages;
create policy "chat_messages_select_member"
  on public.chat_messages for select
  using (
    exists (
      select 1
      from public.chat_thread_members ctm
      where ctm.thread_id = chat_messages.thread_id
        and ctm.user_id = auth.uid()
    )
  );

drop policy if exists "chat_messages_insert_member" on public.chat_messages;
create policy "chat_messages_insert_member"
  on public.chat_messages for insert
  with check (
    exists (
      select 1
      from public.chat_thread_members ctm
      where ctm.thread_id = chat_messages.thread_id
        and ctm.user_id = auth.uid()
    )
    and (
      sender_id is null
      or sender_id = auth.uid()
    )
  );

create or replace function public.touch_chat_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_threads
  set updated_at = now()
  where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists trg_touch_chat_thread on public.chat_messages;
create trigger trg_touch_chat_thread
  after insert on public.chat_messages
  for each row execute function public.touch_chat_thread();

create or replace function public.ensure_project_chat_thread(p_project_id uuid, p_project_name text, p_owner_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id uuid;
begin
  insert into public.chat_threads(kind, project_id, related_project_id, title, created_by)
  values ('project', p_project_id, p_project_id, coalesce(p_project_name, 'Project Chat'), p_owner_id)
  on conflict (project_id) where kind = 'project'
  do update set title = excluded.title, updated_at = now()
  returning id into v_thread_id;

  if p_owner_id is not null then
    insert into public.chat_thread_members(thread_id, user_id)
    values (v_thread_id, p_owner_id)
    on conflict (thread_id, user_id) do nothing;
  end if;

  return v_thread_id;
end;
$$;

grant execute on function public.ensure_project_chat_thread(uuid, text, uuid) to authenticated;

create or replace function public.sync_project_thread_from_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_project_chat_thread(new.id, new.name, new.owner_id);
  return new;
end;
$$;

drop trigger if exists trg_sync_project_thread_from_project on public.projects;
create trigger trg_sync_project_thread_from_project
  after insert or update of name on public.projects
  for each row execute function public.sync_project_thread_from_project();

create or replace function public.sync_project_thread_member_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id uuid;
begin
  select id into v_thread_id
  from public.chat_threads
  where kind = 'project'
    and project_id = new.project_id;

  perform public.ensure_project_chat_thread(
    new.project_id,
    (select name from public.projects where id = new.project_id),
    null
  );

  select id into v_thread_id
  from public.chat_threads
  where kind = 'project'
    and project_id = new.project_id;

  insert into public.chat_thread_members(thread_id, user_id)
  values (v_thread_id, new.user_id)
  on conflict (thread_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_sync_project_thread_member_insert on public.project_members;
create trigger trg_sync_project_thread_member_insert
  after insert on public.project_members
  for each row execute function public.sync_project_thread_member_insert();

create or replace function public.sync_project_thread_member_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id uuid;
begin
  select id into v_thread_id
  from public.chat_threads
  where kind = 'project'
    and project_id = old.project_id;

  if v_thread_id is not null then
    delete from public.chat_thread_members
    where thread_id = v_thread_id
      and user_id = old.user_id;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_sync_project_thread_member_delete on public.project_members;
create trigger trg_sync_project_thread_member_delete
  after delete on public.project_members
  for each row execute function public.sync_project_thread_member_delete();

create or replace function public.create_direct_chat_thread(p_other_user_id uuid, p_related_project_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self uuid := auth.uid();
  v_key text;
  v_thread_id uuid;
begin
  if v_self is null then
    raise exception 'Unauthorized';
  end if;

  if p_other_user_id is null or p_other_user_id = v_self then
    raise exception 'Invalid direct-message target';
  end if;

  if p_related_project_id is not null then
    if not exists (
      select 1
      from public.project_members pm1
      join public.project_members pm2 on pm2.project_id = pm1.project_id
      where pm1.project_id = p_related_project_id
        and pm1.user_id = v_self
        and pm2.user_id = p_other_user_id
    ) and not exists (
      select 1
      from public.projects p
      where p.id = p_related_project_id
        and (
          (p.owner_id = v_self and exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = p_other_user_id))
          or
          (p.owner_id = p_other_user_id and exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = v_self))
        )
    ) then
      raise exception 'Users do not share the selected project';
    end if;
  elsif not exists (
    select 1
    from public.project_members pm1
    join public.project_members pm2 on pm2.project_id = pm1.project_id
    where pm1.user_id = v_self
      and pm2.user_id = p_other_user_id
  ) then
    raise exception 'Users must share at least one project';
  end if;

  v_key := least(v_self::text, p_other_user_id::text) || ':' || greatest(v_self::text, p_other_user_id::text);

  insert into public.chat_threads(kind, related_project_id, direct_key, title, created_by)
  values ('direct', p_related_project_id, v_key, null, v_self)
  on conflict (direct_key) do update
    set related_project_id = coalesce(public.chat_threads.related_project_id, excluded.related_project_id),
        updated_at = now()
  returning id into v_thread_id;

  insert into public.chat_thread_members(thread_id, user_id)
  values (v_thread_id, v_self), (v_thread_id, p_other_user_id)
  on conflict (thread_id, user_id) do nothing;

  return v_thread_id;
end;
$$;

grant execute on function public.create_direct_chat_thread(uuid, uuid) to authenticated;

-- Backfill project chat threads for existing projects
insert into public.chat_threads(kind, project_id, related_project_id, title, created_by)
select 'project', p.id, p.id, p.name, p.owner_id
from public.projects p
where not exists (
  select 1 from public.chat_threads ct
  where ct.kind = 'project' and ct.project_id = p.id
);

insert into public.chat_thread_members(thread_id, user_id)
select ct.id, p.owner_id
from public.chat_threads ct
join public.projects p on p.id = ct.project_id
where ct.kind = 'project'
  and p.owner_id is not null
on conflict (thread_id, user_id) do nothing;

insert into public.chat_thread_members(thread_id, user_id)
select ct.id, pm.user_id
from public.chat_threads ct
join public.project_members pm on pm.project_id = ct.project_id
where ct.kind = 'project'
on conflict (thread_id, user_id) do nothing;
