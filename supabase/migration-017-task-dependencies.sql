-- Task-to-task dependencies
CREATE TABLE IF NOT EXISTS public.goal_dependencies (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id            UUID        NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  depends_on_goal_id UUID        NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  project_id         UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (goal_id, depends_on_goal_id),
  CHECK (goal_id != depends_on_goal_id)
);

ALTER TABLE public.goal_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "goal_dependencies_select" ON public.goal_dependencies
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = goal_dependencies.project_id
        AND (p.owner_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = goal_dependencies.project_id AND pm.user_id = auth.uid()
        ))
    )
  );

CREATE POLICY "goal_dependencies_insert" ON public.goal_dependencies
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = goal_dependencies.project_id
        AND (p.owner_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = goal_dependencies.project_id AND pm.user_id = auth.uid()
        ))
    )
  );

CREATE POLICY "goal_dependencies_delete" ON public.goal_dependencies
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = goal_dependencies.project_id
        AND (p.owner_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = goal_dependencies.project_id AND pm.user_id = auth.uid()
        ))
    )
  );

CREATE INDEX IF NOT EXISTS idx_goal_dependencies_goal ON public.goal_dependencies(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_dependencies_depends_on ON public.goal_dependencies(depends_on_goal_id);
