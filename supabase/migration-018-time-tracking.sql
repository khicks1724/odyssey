-- Time tracking: estimated_hours on goals + time_logs table
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS estimated_hours FLOAT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS public.time_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id       UUID        NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  project_id    UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  logged_hours  FLOAT       NOT NULL CHECK (logged_hours > 0),
  description   TEXT,
  logged_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.time_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "time_logs_select" ON public.time_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = time_logs.project_id
        AND (p.owner_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = time_logs.project_id AND pm.user_id = auth.uid()
        ))
    )
  );

CREATE POLICY "time_logs_insert" ON public.time_logs
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = time_logs.project_id
        AND (p.owner_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = time_logs.project_id AND pm.user_id = auth.uid()
        ))
    )
  );

CREATE POLICY "time_logs_delete" ON public.time_logs
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_time_logs_goal ON public.time_logs(goal_id);
CREATE INDEX IF NOT EXISTS idx_time_logs_project ON public.time_logs(project_id, logged_at DESC);
