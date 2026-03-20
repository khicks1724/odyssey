-- migration-014: persist 2-week standup reports per project

CREATE TABLE IF NOT EXISTS public.standup_reports (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  highlights    TEXT        NOT NULL DEFAULT '',
  accomplished  JSONB       NOT NULL DEFAULT '[]',
  in_progress   JSONB       NOT NULL DEFAULT '[]',
  blockers      JSONB       NOT NULL DEFAULT '[]',
  period        JSONB       NOT NULL DEFAULT '{}',
  commit_summary JSONB      NOT NULL DEFAULT '[]',
  total_commits INT         NOT NULL DEFAULT 0,
  provider      TEXT        NOT NULL DEFAULT '',
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

ALTER TABLE public.standup_reports ENABLE ROW LEVEL SECURITY;

-- Project owners and members can read
CREATE POLICY "standup_select" ON public.standup_reports
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = standup_reports.project_id
        AND (p.owner_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = standup_reports.project_id AND pm.user_id = auth.uid()
        ))
    )
  );

-- Project owners and members can insert/upsert
CREATE POLICY "standup_insert" ON public.standup_reports
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = standup_reports.project_id
        AND (p.owner_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = standup_reports.project_id AND pm.user_id = auth.uid()
        ))
    )
  );

-- Project owners and members can update
CREATE POLICY "standup_update" ON public.standup_reports
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = standup_reports.project_id
        AND (p.owner_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = standup_reports.project_id AND pm.user_id = auth.uid()
        ))
    )
  );

CREATE INDEX IF NOT EXISTS idx_standup_reports_project
  ON public.standup_reports (project_id);
