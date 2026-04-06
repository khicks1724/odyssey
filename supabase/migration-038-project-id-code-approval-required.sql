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
end;
$$;

grant execute on function public.join_project_by_code(text) to authenticated;

create or replace function public.redeem_qr_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tok        public.qr_invite_tokens;
  v_proj       public.projects;
  v_is_mem     int;
  v_pending_req int;
begin
  select * into v_tok
  from public.qr_invite_tokens
  where token = p_token;

  if not found then
    return jsonb_build_object('error', 'Invalid or expired QR code.');
  end if;

  if v_tok.expires_at < now() then
    delete from public.qr_invite_tokens where id = v_tok.id;
    return jsonb_build_object('error', 'This QR code has expired. Ask the owner to generate a new one.');
  end if;

  select * into v_proj
  from public.projects
  where id = v_tok.project_id;

  select count(*) into v_is_mem
  from public.project_members
  where project_id = v_proj.id and user_id = auth.uid();

  if v_is_mem > 0 then
    return jsonb_build_object('result', 'already_member', 'project_id', v_proj.id, 'project_name', v_proj.name);
  end if;

  select count(*) into v_pending_req
  from public.join_requests
  where project_id = v_proj.id and user_id = auth.uid() and status = 'pending';

  if v_pending_req > 0 then
    return jsonb_build_object('result', 'request_already_pending', 'project_id', v_proj.id, 'project_name', v_proj.name);
  end if;

  insert into public.join_requests(project_id, user_id)
  values (v_proj.id, auth.uid())
  on conflict (project_id, user_id) do update
    set status = 'pending', updated_at = now();

  return jsonb_build_object('result', 'request_sent', 'project_id', v_proj.id, 'project_name', v_proj.name);
end;
$$;

grant execute on function public.redeem_qr_token(uuid) to authenticated;
