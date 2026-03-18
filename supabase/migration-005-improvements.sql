-- Migration 005: Performance indexes, missing policies, webhook event inserts
-- Run this in Supabase SQL Editor

-- 1. Index for deadline queries (used by upcoming deadlines dashboard panel)
create index if not exists idx_goals_deadline
  on public.goals (deadline asc)
  where deadline is not null;

-- 2. Index for activity graph queries (events by date range across projects)
create index if not exists idx_events_occurred_at
  on public.events (occurred_at desc);

-- 3. Allow project owners to remove members
create policy "Project owners can remove members"
  on public.project_members for delete
  using (
    project_id in (select id from public.projects where owner_id = auth.uid())
    or user_id = auth.uid()  -- members can remove themselves
  );

-- 4. Allow project owners to update member roles
create policy "Project owners can update members"
  on public.project_members for update
  using (
    project_id in (select id from public.projects where owner_id = auth.uid())
  );

-- 5. Allow service role (webhook handler) to insert events
--    Service role bypasses RLS automatically, but we explicitly allow
--    authenticated users who own the project to insert events too (for future use)
create policy "Project owners can insert events"
  on public.events for insert
  with check (
    project_id in (select id from public.projects where owner_id = auth.uid())
  );

-- 6. Index for looking up projects by github_repo (used by webhook handler)
create index if not exists idx_projects_github_repo
  on public.projects (github_repo)
  where github_repo is not null;
