-- Fix: infinite recursion between projects and project_members policies
-- Run this in Supabase SQL Editor

-- Helper function to get project IDs a user is a member of (bypasses RLS)
create or replace function public.get_user_project_ids(uid uuid)
returns setof uuid
language sql
security definer
stable
as $$
  select project_id from public.project_members where user_id = uid;
$$;

-- Helper function to get project IDs a user owns (bypasses RLS)  
create or replace function public.get_owned_project_ids(uid uuid)
returns setof uuid
language sql
security definer
stable
as $$
  select id from public.projects where owner_id = uid;
$$;

-- Drop the circular policies
drop policy if exists "Members can read membership" on public.project_members;
drop policy if exists "Project owners can manage members" on public.project_members;
drop policy if exists "Project members can read projects" on public.projects;

-- Recreate projects SELECT using the helper function (no recursion)
create policy "Project members can read projects"
  on public.projects for select
  using (
    owner_id = auth.uid() or
    id in (select public.get_user_project_ids(auth.uid()))
  );

-- Recreate project_members SELECT using the helper function (no recursion)
create policy "Members can read membership"
  on public.project_members for select
  using (
    user_id = auth.uid() or
    project_id in (select public.get_owned_project_ids(auth.uid()))
  );

-- Recreate project_members INSERT
create policy "Project owners can manage members"
  on public.project_members for insert
  with check (
    project_id in (select public.get_owned_project_ids(auth.uid()))
  );
