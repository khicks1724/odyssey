-- migration-049: let existing project owners promote members to owner via RPC

drop function if exists public.promote_project_member_to_owner(uuid, uuid);

create or replace function public.promote_project_member_to_owner(p_project_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_is_owner boolean := false;
begin
  if auth.uid() is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  select exists (
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
  )
  into v_actor_is_owner;

  if not v_actor_is_owner then
    return jsonb_build_object('error', 'Not authorized');
  end if;

  if not exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = p_user_id
  ) then
    return jsonb_build_object('error', 'Member not found');
  end if;

  update public.project_members
  set role = 'owner'
  where project_id = p_project_id
    and user_id = p_user_id;

  return jsonb_build_object('result', 'ok');
end;
$$;

grant execute on function public.promote_project_member_to_owner(uuid, uuid) to authenticated;
