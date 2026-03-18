-- Migration 008: Persistent AI project insights
-- Stores the most recent AI-generated insight per project.
-- Generating a new insight overwrites the previous one (one row per project).

CREATE TABLE IF NOT EXISTS public.project_insights (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT '',
  next_steps      JSONB       NOT NULL DEFAULT '[]',
  future_features JSONB       NOT NULL DEFAULT '[]',
  provider        TEXT        NOT NULL DEFAULT '',
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

ALTER TABLE public.project_insights ENABLE ROW LEVEL SECURITY;

-- Project owners and members can read insights
CREATE POLICY "Project members can read insights"
  ON public.project_insights FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_insights.project_id AND pm.user_id = auth.uid()
    )
  );

-- Project owners and members can upsert insights
CREATE POLICY "Project members can upsert insights"
  ON public.project_insights FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_insights.project_id AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can update insights"
  ON public.project_insights FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_insights.project_id AND pm.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_project_insights_project
  ON public.project_insights (project_id);
