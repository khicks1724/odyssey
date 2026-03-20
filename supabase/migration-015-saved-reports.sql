-- migration-015: persist generated reports per project

CREATE TABLE IF NOT EXISTS public.saved_reports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  content         JSONB       NOT NULL DEFAULT '{}',
  format          TEXT        NOT NULL DEFAULT 'docx',
  date_range_from DATE,
  date_range_to   DATE,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider        TEXT
);

ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_reports_select" ON public.saved_reports
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = saved_reports.project_id
        AND (p.owner_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = saved_reports.project_id AND pm.user_id = auth.uid()
        ))
    )
  );

CREATE POLICY "saved_reports_insert" ON public.saved_reports
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = saved_reports.project_id
        AND (p.owner_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = saved_reports.project_id AND pm.user_id = auth.uid()
        ))
    )
  );

CREATE POLICY "saved_reports_delete" ON public.saved_reports
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = saved_reports.project_id
        AND (p.owner_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = saved_reports.project_id AND pm.user_id = auth.uid()
        ))
    )
  );

CREATE INDEX IF NOT EXISTS idx_saved_reports_project
  ON public.saved_reports (project_id, generated_at DESC);
