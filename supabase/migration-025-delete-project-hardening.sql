-- Migration 025: Harden project deletion so the database is the source of truth
-- Run this in the Supabase SQL Editor

drop function if exists public.delete_project_cascade(uuid);

create or replace function public.delete_project_cascade(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.projects
    where id = p_project_id
      and owner_id = auth.uid()
  ) then
    raise exception 'Not authorised to delete project %', p_project_id;
  end if;

  delete from storage.objects
  where bucket_id = 'project-documents'
    and split_part(name, '/', 1) = p_project_id::text;

  delete from storage.objects
  where bucket_id = 'goal-attachments'
    and split_part(name, '/', 1) = p_project_id::text;

  if to_regclass('public.goal_comments') is not null then
    execute 'delete from public.goal_comments where goal_id in (select id from public.goals where project_id = $1)'
    using p_project_id;
  end if;

  if to_regclass('public.goal_reports') is not null then
    execute 'delete from public.goal_reports where project_id = $1 or goal_id in (select id from public.goals where project_id = $1)'
    using p_project_id;
  end if;

  if to_regclass('public.goal_attachments') is not null then
    execute 'delete from public.goal_attachments where project_id = $1 or goal_id in (select id from public.goals where project_id = $1)'
    using p_project_id;
  end if;

  if to_regclass('public.goal_ai_guidance') is not null then
    execute 'delete from public.goal_ai_guidance where goal_id in (select id from public.goals where project_id = $1)'
    using p_project_id;
  end if;

  if to_regclass('public.time_logs') is not null then
    execute 'delete from public.time_logs where project_id = $1 or goal_id in (select id from public.goals where project_id = $1)'
    using p_project_id;
  end if;

  if to_regclass('public.goal_assignees') is not null then
    execute 'delete from public.goal_assignees where goal_id in (select id from public.goals where project_id = $1)'
    using p_project_id;
  end if;

  if to_regclass('public.goal_dependencies') is not null then
    execute 'delete from public.goal_dependencies where project_id = $1'
    using p_project_id;
  end if;

  if to_regclass('public.join_requests') is not null then
    execute 'delete from public.join_requests where project_id = $1'
    using p_project_id;
  end if;

  if to_regclass('public.qr_invite_tokens') is not null then
    execute 'delete from public.qr_invite_tokens where project_id = $1'
    using p_project_id;
  end if;

  if to_regclass('public.standup_reports') is not null then
    execute 'delete from public.standup_reports where project_id = $1'
    using p_project_id;
  end if;

  if to_regclass('public.saved_reports') is not null then
    execute 'delete from public.saved_reports where project_id = $1'
    using p_project_id;
  end if;

  if to_regclass('public.project_insights') is not null then
    execute 'delete from public.project_insights where project_id = $1'
    using p_project_id;
  end if;

  if to_regclass('public.integrations') is not null then
    execute 'delete from public.integrations where project_id = $1'
    using p_project_id;
  end if;

  if to_regclass('public.events') is not null then
    execute 'delete from public.events where project_id = $1'
    using p_project_id;
  end if;

  if to_regclass('public.goals') is not null then
    execute 'delete from public.goals where project_id = $1'
    using p_project_id;
  end if;

  if to_regclass('public.project_members') is not null then
    execute 'delete from public.project_members where project_id = $1'
    using p_project_id;
  end if;

  delete from public.projects where id = p_project_id;
end;
$$;

grant execute on function public.delete_project_cascade(uuid) to authenticated;
