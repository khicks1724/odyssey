-- Migration 021: Safe cascade project deletion via RPC
-- Run this in Supabase SQL Editor

-- Drop if exists so this is idempotent
drop function if exists public.delete_project_cascade(uuid);

-- Function: deletes a project and ALL related data in dependency order.
-- SECURITY DEFINER runs as the postgres role (bypasses RLS for child tables)
-- but validates the caller owns the project first.
create or replace function public.delete_project_cascade(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Verify the calling user owns this project
  if not exists (
    select 1 from public.projects
    where id = p_project_id
    and owner_id = auth.uid()
  ) then
    raise exception 'Not authorised to delete project %', p_project_id;
  end if;

  -- Delete in FK dependency order (leaves first, root last)
  delete from public.goal_comments      where goal_id in (select id from public.goals where project_id = p_project_id);
  delete from public.goal_reports       where goal_id in (select id from public.goals where project_id = p_project_id);
  delete from public.goal_ai_guidance   where goal_id in (select id from public.goals where project_id = p_project_id);
  delete from public.goal_dependencies  where project_id = p_project_id;
  delete from public.time_logs          where goal_id in (select id from public.goals where project_id = p_project_id);
  delete from public.goal_assignees     where goal_id in (select id from public.goals where project_id = p_project_id);
  delete from public.goals              where project_id = p_project_id;
  delete from public.events             where project_id = p_project_id;
  delete from public.project_members    where project_id = p_project_id;
  delete from public.project_insights   where project_id = p_project_id;
  delete from public.saved_reports      where project_id = p_project_id;
  delete from public.integrations       where project_id = p_project_id;
  delete from public.standup_reports    where project_id = p_project_id;

  -- Finally delete the project itself
  delete from public.projects where id = p_project_id;
end;
$$;

-- Grant execute to authenticated users
grant execute on function public.delete_project_cascade(uuid) to authenticated;
