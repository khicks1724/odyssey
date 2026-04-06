-- migration-044: chat unread state, per-user hidden DMs, and broader member permissions

create table if not exists public.chat_thread_user_state (
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz,
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists idx_chat_thread_user_state_user
  on public.chat_thread_user_state(user_id, updated_at desc);

alter table public.chat_thread_user_state enable row level security;

drop policy if exists "chat_thread_user_state_select_own" on public.chat_thread_user_state;
create policy "chat_thread_user_state_select_own"
  on public.chat_thread_user_state for select
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.chat_thread_members ctm
      where ctm.thread_id = chat_thread_user_state.thread_id
        and ctm.user_id = auth.uid()
    )
  );

drop policy if exists "chat_thread_user_state_insert_own" on public.chat_thread_user_state;
create policy "chat_thread_user_state_insert_own"
  on public.chat_thread_user_state for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.chat_thread_members ctm
      where ctm.thread_id = chat_thread_user_state.thread_id
        and ctm.user_id = auth.uid()
    )
  );

drop policy if exists "chat_thread_user_state_update_own" on public.chat_thread_user_state;
create policy "chat_thread_user_state_update_own"
  on public.chat_thread_user_state for update
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.chat_thread_members ctm
      where ctm.thread_id = chat_thread_user_state.thread_id
        and ctm.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.chat_thread_members ctm
      where ctm.thread_id = chat_thread_user_state.thread_id
        and ctm.user_id = auth.uid()
    )
  );

drop policy if exists "chat_thread_user_state_delete_own" on public.chat_thread_user_state;
create policy "chat_thread_user_state_delete_own"
  on public.chat_thread_user_state for delete
  using (user_id = auth.uid());

create or replace function public.touch_chat_thread_user_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_chat_thread_user_state_updated_at on public.chat_thread_user_state;
create trigger trg_touch_chat_thread_user_state_updated_at
  before update on public.chat_thread_user_state
  for each row
  execute function public.touch_chat_thread_user_state_updated_at();

create or replace function public.ensure_chat_thread_user_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.chat_thread_user_state(thread_id, user_id, last_read_at, hidden_at)
  values (new.thread_id, new.user_id, now(), null)
  on conflict (thread_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_ensure_chat_thread_user_state on public.chat_thread_members;
create trigger trg_ensure_chat_thread_user_state
  after insert on public.chat_thread_members
  for each row
  execute function public.ensure_chat_thread_user_state();

insert into public.chat_thread_user_state(thread_id, user_id, last_read_at, hidden_at)
select ctm.thread_id, ctm.user_id, now(), null
from public.chat_thread_members ctm
on conflict (thread_id, user_id) do nothing;

create or replace function public.mark_chat_thread_read(p_thread_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self uuid := auth.uid();
begin
  if v_self is null then
    return jsonb_build_object('error', 'Unauthorized');
  end if;

  if not exists (
    select 1
    from public.chat_thread_members ctm
    where ctm.thread_id = p_thread_id
      and ctm.user_id = v_self
  ) then
    return jsonb_build_object('error', 'Not authorized');
  end if;

  insert into public.chat_thread_user_state(thread_id, user_id, last_read_at, hidden_at)
  values (p_thread_id, v_self, now(), null)
  on conflict (thread_id, user_id) do update
    set last_read_at = now(),
        hidden_at = null,
        updated_at = now();

  return jsonb_build_object('result', 'ok');
end;
$$;

grant execute on function public.mark_chat_thread_read(uuid) to authenticated;

create or replace function public.hide_direct_chat_thread(p_thread_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self uuid := auth.uid();
  v_kind text;
begin
  if v_self is null then
    return jsonb_build_object('error', 'Unauthorized');
  end if;

  select ct.kind
    into v_kind
  from public.chat_threads ct
  join public.chat_thread_members ctm on ctm.thread_id = ct.id
  where ct.id = p_thread_id
    and ctm.user_id = v_self;

  if v_kind is null then
    return jsonb_build_object('error', 'Not authorized');
  end if;

  if v_kind <> 'direct' then
    return jsonb_build_object('error', 'Only direct messages can be deleted');
  end if;

  insert into public.chat_thread_user_state(thread_id, user_id, last_read_at, hidden_at)
  values (p_thread_id, v_self, now(), now())
  on conflict (thread_id, user_id) do update
    set hidden_at = now(),
        updated_at = now();

  return jsonb_build_object('result', 'hidden');
end;
$$;

grant execute on function public.hide_direct_chat_thread(uuid) to authenticated;

create or replace function public.unhide_direct_threads_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_thread_user_state tus
  set hidden_at = null,
      updated_at = now()
  where tus.thread_id = new.thread_id
    and tus.user_id in (
      select ctm.user_id
      from public.chat_thread_members ctm
      join public.chat_threads ct on ct.id = ctm.thread_id
      where ctm.thread_id = new.thread_id
        and ct.kind = 'direct'
        and ctm.user_id <> coalesce(new.sender_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

  return new;
end;
$$;

drop trigger if exists trg_unhide_direct_threads_on_message on public.chat_messages;
create trigger trg_unhide_direct_threads_on_message
  after insert on public.chat_messages
  for each row
  execute function public.unhide_direct_threads_on_message();

create or replace function public.create_direct_chat_thread(p_other_user_id uuid, p_related_project_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self uuid := auth.uid();
  v_thread_id uuid;
  v_key text;
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

  insert into public.chat_thread_user_state(thread_id, user_id, last_read_at, hidden_at)
  values
    (v_thread_id, v_self, now(), null),
    (v_thread_id, p_other_user_id, now(), null)
  on conflict (thread_id, user_id) do update
    set hidden_at = null,
        updated_at = now();

  return v_thread_id;
end;
$$;

grant execute on function public.create_direct_chat_thread(uuid, uuid) to authenticated;

drop policy if exists "Project owners can update" on public.projects;
drop policy if exists "Project owners can delete" on public.projects;

create policy "Project members can update projects"
  on public.projects for update
  using (
    id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  )
  with check (
    id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

create policy "Project members can delete projects"
  on public.projects for delete
  using (
    id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

drop policy if exists "Project owners can manage members" on public.project_members;
drop policy if exists "Project owners can remove members" on public.project_members;
drop policy if exists "Project owners can update members" on public.project_members;

create policy "Project members can insert members"
  on public.project_members for insert
  with check (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

create policy "Project members can update members"
  on public.project_members for update
  using (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  )
  with check (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

create policy "Project members can delete members"
  on public.project_members for delete
  using (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

drop policy if exists "join_requests_select" on public.join_requests;
create policy "join_requests_select"
  on public.join_requests for select
  using (
    user_id = auth.uid()
    or project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

drop policy if exists "join_requests_update" on public.join_requests;
create policy "join_requests_update"
  on public.join_requests for update
  using (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  )
  with check (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

drop policy if exists "join_requests_delete" on public.join_requests;
create policy "join_requests_delete"
  on public.join_requests for delete
  using (
    user_id = auth.uid()
    or project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

create or replace function public.respond_join_request(p_request_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.join_requests;
  v_project_name text;
begin
  select * into v_req from public.join_requests where id = p_request_id;

  if not found then
    return jsonb_build_object('error', 'Request not found');
  end if;

  if v_req.status <> 'pending' then
    return jsonb_build_object('error', 'This join request has already been resolved.');
  end if;

  if not exists (
    select 1
    from public.projects p
    where p.id = v_req.project_id
      and (
        p.owner_id = auth.uid()
        or exists (
          select 1
          from public.project_members pm
          where pm.project_id = p.id
            and pm.user_id = auth.uid()
        )
      )
  ) then
    return jsonb_build_object('error', 'Not authorized');
  end if;

  if p_action = 'approve' then
    insert into public.project_members(project_id, user_id, role)
    values (v_req.project_id, v_req.user_id, 'member')
    on conflict (project_id, user_id) do update
      set role = case
        when public.project_members.role = 'owner' then 'owner'
        else 'member'
      end;

    update public.join_requests
    set status = 'approved', updated_at = now()
    where id = p_request_id;

    select name into v_project_name
    from public.projects
    where id = v_req.project_id;

    perform public.ensure_project_chat_thread(v_req.project_id, v_project_name, null);

    insert into public.chat_thread_members(thread_id, user_id)
    select ct.id, v_req.user_id
    from public.chat_threads ct
    where ct.kind = 'project'
      and ct.project_id = v_req.project_id
    on conflict (thread_id, user_id) do nothing;

    return jsonb_build_object('result', 'approved');

  elsif p_action = 'deny' then
    update public.join_requests
    set status = 'denied', updated_at = now()
    where id = p_request_id;

    return jsonb_build_object('result', 'denied');
  else
    return jsonb_build_object('error', 'Invalid action. Use ''approve'' or ''deny''.');
  end if;
end;
$$;

drop policy if exists "Project owners can insert events" on public.events;
create policy "Project members can insert events"
  on public.events for insert
  with check (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

drop policy if exists "Project owners can manage integrations" on public.integrations;
create policy "Project members can manage integrations"
  on public.integrations for all
  using (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  )
  with check (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

drop policy if exists "project_labels_insert_owner" on public.project_labels;
drop policy if exists "project_labels_update_owner" on public.project_labels;
drop policy if exists "project_labels_delete_owner" on public.project_labels;

create policy "project_labels_insert_member"
  on public.project_labels for insert
  with check (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

create policy "project_labels_update_member"
  on public.project_labels for update
  using (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  )
  with check (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

create policy "project_labels_delete_member"
  on public.project_labels for delete
  using (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

drop policy if exists "project_prompts_insert_owner" on public.project_prompts;
drop policy if exists "project_prompts_update_owner" on public.project_prompts;
drop policy if exists "project_prompts_delete_owner" on public.project_prompts;

create policy "project_prompts_insert_member"
  on public.project_prompts for insert
  with check (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

create policy "project_prompts_update_member"
  on public.project_prompts for update
  using (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  )
  with check (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

create policy "project_prompts_delete_member"
  on public.project_prompts for delete
  using (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_rel pr
      JOIN pg_class c ON c.oid = pr.prrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_publication p ON p.oid = pr.prpubid
      WHERE p.pubname = 'supabase_realtime'
        AND n.nspname = 'public'
        AND c.relname = 'chat_thread_user_state'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_thread_user_state;
    END IF;
  END IF;
END
$$;
