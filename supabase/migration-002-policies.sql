-- Run this in Supabase SQL Editor to add missing policies
-- (Only the NEW ones — won't conflict with existing ones)

-- Allow project owners to delete projects
create policy "Project owners can delete"
  on public.projects for delete
  using (auth.uid() = owner_id);

-- Allow project owners to add members
create policy "Project owners can manage members"
  on public.project_members for insert
  with check (
    project_id in (select id from public.projects where owner_id = auth.uid())
  );

-- Allow goal management (insert specifically) for project owners
create policy "Project owners can insert goals"
  on public.goals for insert
  with check (
    project_id in (select id from public.projects where owner_id = auth.uid())
  );

-- Allow goal deletion for project owners
create policy "Project owners can delete goals"
  on public.goals for delete
  using (
    project_id in (select id from public.projects where owner_id = auth.uid())
  );
