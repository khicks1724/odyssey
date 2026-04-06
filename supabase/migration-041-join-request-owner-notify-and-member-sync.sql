-- migration-041: ensure join requests notify every owner and approved members
-- immediately receive standard project/chat access

create or replace function public.notify_project_join_request(
  p_request_id uuid,
  p_project_id uuid,
  p_requester_id uuid
)
returns void
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
  where id = p_project_id;

  select coalesce(display_name, 'A user') into v_actor_name
  from public.profiles
  where id = p_requester_id;

  if v_owner_id is not null and v_owner_id <> p_requester_id then
    perform public.create_notification(
      v_owner_id,
      'join_request',
      'New join request',
      coalesce(v_actor_name, 'A user') || ' requested to join "' || coalesce(v_project_name, 'a project') || '".',
      '/projects/' || p_project_id,
      p_project_id,
      p_requester_id,
      jsonb_build_object('request_id', p_request_id, 'requester_id', p_requester_id, 'status', 'pending')
    );
  end if;

  insert into public.notifications(user_id, actor_id, project_id, kind, title, body, link, metadata)
  select
    pm.user_id,
    p_requester_id,
    p_project_id,
    'join_request',
    'New join request',
    coalesce(v_actor_name, 'A user') || ' requested to join "' || coalesce(v_project_name, 'a project') || '".',
    '/projects/' || p_project_id,
    jsonb_build_object('request_id', p_request_id, 'requester_id', p_requester_id, 'status', 'pending')
  from public.project_members pm
  where pm.project_id = p_project_id
    and pm.role = 'owner'
    and pm.user_id <> p_requester_id
    and (v_owner_id is null or pm.user_id <> v_owner_id);
end;
$$;

create or replace function public.notify_join_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_project_join_request(new.id, new.project_id, new.user_id);
  return new;
end;
$$;

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
  if old.status = new.status then
    return new;
  end if;

  if new.status = 'pending' then
    perform public.notify_project_join_request(new.id, new.project_id, new.user_id);
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

  if not exists (
    select 1 from public.projects p
    where p.id = v_req.project_id
      and (
        p.owner_id = auth.uid()
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = p.id and pm.user_id = auth.uid() and pm.role = 'owner'
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
