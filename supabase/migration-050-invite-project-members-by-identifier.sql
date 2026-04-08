-- migration-050: invite project members by Odyssey username or linked Microsoft email

drop function if exists public.invite_project_member_by_identifier(uuid, text, text, text);

create or replace function public.invite_project_member_by_identifier(
  p_project_id uuid,
  p_role text,
  p_method text,
  p_identifier text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := lower(trim(coalesce(p_role, 'member')));
  v_method text := lower(trim(coalesce(p_method, '')));
  v_identifier text := lower(btrim(coalesce(p_identifier, '')));
  v_target_user_id uuid;
  v_existing_role text;
  v_project_owner_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  if not exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and (
        p.owner_id = auth.uid()
        or exists (
          select 1
          from public.project_members pm
          where pm.project_id = p.id
            and pm.user_id = auth.uid()
            and pm.role = 'owner'
        )
      )
  ) then
    return jsonb_build_object('error', 'Not authorized');
  end if;

  if v_role not in ('member', 'owner') then
    return jsonb_build_object('error', 'Invalid role');
  end if;

  if v_method not in ('username', 'nps_email') then
    return jsonb_build_object('error', 'Invalid invite method');
  end if;

  if v_identifier = '' then
    return jsonb_build_object('error', 'Identifier is required');
  end if;

  if v_method = 'username' then
    select p.id
      into v_target_user_id
    from public.profiles p
    where lower(btrim(coalesce(p.username, ''))) = v_identifier
    limit 1;
  else
    select uc.user_id
      into v_target_user_id
    from public.user_connections uc
    where uc.provider = 'microsoft'
      and lower(btrim(coalesce(uc.ms_email, ''))) = v_identifier
    limit 1;
  end if;

  if v_target_user_id is null then
    if v_method = 'username' then
      return jsonb_build_object('error', 'No Odyssey account was found for that username.');
    end if;
    return jsonb_build_object('error', 'No linked Microsoft account was found for that NPS email.');
  end if;

  select owner_id
    into v_project_owner_id
  from public.projects
  where id = p_project_id;

  if v_project_owner_id = v_target_user_id then
    return jsonb_build_object('error', 'That user is already an owner of this project.');
  end if;

  select pm.role
    into v_existing_role
  from public.project_members pm
  where pm.project_id = p_project_id
    and pm.user_id = v_target_user_id;

  if v_existing_role is not null then
    return jsonb_build_object('error', format('That user is already a %s on this project.', v_existing_role));
  end if;

  insert into public.project_members(project_id, user_id, role)
  values (p_project_id, v_target_user_id, v_role);

  return jsonb_build_object(
    'result', 'invited',
    'user_id', v_target_user_id,
    'role', v_role
  );
end;
$$;

grant execute on function public.invite_project_member_by_identifier(uuid, text, text, text) to authenticated;
