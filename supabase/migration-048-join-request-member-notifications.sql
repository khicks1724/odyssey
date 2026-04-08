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
begin
  select name into v_project_name
  from public.projects
  where id = p_project_id;

  select coalesce(display_name, 'A user') into v_actor_name
  from public.profiles
  where id = p_requester_id;

  insert into public.notifications(user_id, actor_id, project_id, kind, title, body, link, metadata)
  select
    recipients.user_id,
    p_requester_id,
    p_project_id,
    'join_request',
    'New join request',
    coalesce(v_actor_name, 'A user') || ' requested to join "' || coalesce(v_project_name, 'a project') || '".',
    '/projects/' || p_project_id,
    jsonb_build_object('request_id', p_request_id, 'requester_id', p_requester_id, 'status', 'pending')
  from (
    select p.owner_id as user_id
    from public.projects p
    where p.id = p_project_id

    union

    select pm.user_id
    from public.project_members pm
    where pm.project_id = p_project_id
  ) as recipients
  where recipients.user_id is not null
    and recipients.user_id <> p_requester_id;
end;
$$;
