-- migration-043: let project members see the full roster, manage goals,
-- and receive realtime membership updates

drop policy if exists "Members can read membership" on public.project_members;
create policy "Members can read membership"
  on public.project_members for select
  using (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

drop policy if exists "Project owners can manage goals" on public.goals;
drop policy if exists "Project owners can insert goals" on public.goals;
drop policy if exists "Project owners can delete goals" on public.goals;
drop policy if exists "Project members can insert goals" on public.goals;
drop policy if exists "Project members can update goals" on public.goals;
drop policy if exists "Project members can delete goals" on public.goals;

create policy "Project members can insert goals"
  on public.goals for insert
  with check (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

create policy "Project members can update goals"
  on public.goals for update
  using (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  )
  with check (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

create policy "Project members can delete goals"
  on public.goals for delete
  using (
    project_id in (
      select public.get_owned_project_ids(auth.uid())
      union
      select public.get_user_project_ids(auth.uid())
    )
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_rel pr
    JOIN pg_class c ON c.oid = pr.prrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_publication p ON p.oid = pr.prpubid
    WHERE p.pubname = 'supabase_realtime'
      AND n.nspname = 'public'
      AND c.relname = 'project_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_members;
  END IF;
END
$$;
