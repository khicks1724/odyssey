-- Ensure users can recover project chat membership rows for projects they can access.

drop function if exists public.sync_my_project_chat_memberships();

create or replace function public.sync_my_project_chat_memberships()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self uuid := auth.uid();
  v_inserted int := 0;
begin
  if v_self is null then
    raise exception 'Unauthorized';
  end if;

  insert into public.chat_threads(kind, project_id, related_project_id, title, created_by)
  select 'project', p.id, p.id, p.name, p.owner_id
  from public.projects p
  where (
    p.owner_id = v_self
    or exists (
      select 1
      from public.project_members pm
      where pm.project_id = p.id
        and pm.user_id = v_self
    )
  )
    and not exists (
      select 1
      from public.chat_threads ct
      where ct.kind = 'project'
        and ct.project_id = p.id
    );

  insert into public.chat_thread_members(thread_id, user_id)
  select ct.id, v_self
  from public.chat_threads ct
  join public.projects p on p.id = ct.project_id
  where ct.kind = 'project'
    and (
      p.owner_id = v_self
      or exists (
        select 1
        from public.project_members pm
        where pm.project_id = p.id
          and pm.user_id = v_self
      )
    )
    and not exists (
      select 1
      from public.chat_thread_members ctm
      where ctm.thread_id = ct.id
        and ctm.user_id = v_self
    );

  get diagnostics v_inserted = row_count;
  return coalesce(v_inserted, 0);
end;
$$;

grant execute on function public.sync_my_project_chat_memberships() to authenticated;
