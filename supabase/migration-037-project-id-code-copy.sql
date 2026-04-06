create or replace function public.join_project_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project     public.projects;
  v_is_member   int;
  v_pending_req int;
begin
  select * into v_project
  from public.projects
  where upper(invite_code) = upper(p_code);

  if not found then
    return jsonb_build_object('error', 'Project not found. Check the project ID code and try again.');
  end if;

  select count(*) into v_is_member
  from public.project_members
  where project_id = v_project.id and user_id = auth.uid();

  if v_is_member > 0 then
    return jsonb_build_object(
      'result', 'already_member',
      'project_id', v_project.id,
      'project_name', v_project.name
    );
  end if;

  if v_project.is_private then
    select count(*) into v_pending_req
    from public.join_requests
    where project_id = v_project.id and user_id = auth.uid() and status = 'pending';

    if v_pending_req > 0 then
      return jsonb_build_object(
        'result', 'request_already_pending',
        'project_id', v_project.id,
        'project_name', v_project.name
      );
    end if;

    insert into public.join_requests(project_id, user_id)
    values (v_project.id, auth.uid())
    on conflict (project_id, user_id)
      do update set status = 'pending', updated_at = now();

    return jsonb_build_object(
      'result', 'request_sent',
      'project_id', v_project.id,
      'project_name', v_project.name
    );
  else
    insert into public.project_members(project_id, user_id, role)
    values (v_project.id, auth.uid(), 'member')
    on conflict (project_id, user_id) do nothing;

    return jsonb_build_object(
      'result', 'joined',
      'project_id', v_project.id,
      'project_name', v_project.name
    );
  end if;
end;
$$;

grant execute on function public.join_project_by_code(text) to authenticated;
