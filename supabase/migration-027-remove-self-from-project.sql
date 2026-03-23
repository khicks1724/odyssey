-- Allow a user to remove a project from their own workspace without deleting it
-- If the user is the sole member, the function returns delete_required instead.

drop function if exists public.remove_self_from_project(uuid);

create or replace function public.remove_self_from_project(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self uuid := auth.uid();
  v_owner_id uuid;
  v_project_name text;
  v_member_count int;
  v_new_owner_id uuid;
begin
  if v_self is null then
    raise exception 'Not authenticated';
  end if;

  select p.owner_id, p.name
    into v_owner_id, v_project_name
  from public.projects p
  where p.id = p_project_id
    and (
      p.owner_id = v_self
      or exists (
        select 1
        from public.project_members pm
        where pm.project_id = p_project_id
          and pm.user_id = v_self
      )
    );

  if not found then
    raise exception 'Project not found or not accessible';
  end if;

  select count(*)
    into v_member_count
  from (
    select p.owner_id as user_id
    from public.projects p
    where p.id = p_project_id
      and p.owner_id is not null
    union
    select pm.user_id
    from public.project_members pm
    where pm.project_id = p_project_id
  ) members;

  if coalesce(v_member_count, 0) <= 1 then
    return jsonb_build_object(
      'result', 'delete_required',
      'project_id', p_project_id,
      'project_name', v_project_name
    );
  end if;

  if v_owner_id = v_self then
    select candidate.user_id
      into v_new_owner_id
    from (
      select distinct pm.user_id, case when pm.role = 'owner' then 0 else 1 end as sort_rank, pm.joined_at
      from public.project_members pm
      where pm.project_id = p_project_id
        and pm.user_id <> v_self
    ) candidate
    order by candidate.sort_rank asc, candidate.joined_at asc
    limit 1;

    if v_new_owner_id is null then
      return jsonb_build_object(
        'result', 'delete_required',
        'project_id', p_project_id,
        'project_name', v_project_name
      );
    end if;

    update public.projects
      set owner_id = v_new_owner_id
    where id = p_project_id;

    insert into public.project_members(project_id, user_id, role)
    values (p_project_id, v_new_owner_id, 'owner')
    on conflict (project_id, user_id)
    do update set role = 'owner';
  else
    v_new_owner_id := null;
  end if;

  delete from public.project_members
  where project_id = p_project_id
    and user_id = v_self;

  return jsonb_build_object(
    'result', 'removed',
    'project_id', p_project_id,
    'project_name', v_project_name,
    'new_owner_id', v_new_owner_id,
    'ownership_transferred', (v_new_owner_id is not null)
  );
end;
$$;

grant execute on function public.remove_self_from_project(uuid) to authenticated;
