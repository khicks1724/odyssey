-- Goal comment threads with realtime support
CREATE TABLE IF NOT EXISTS public.goal_comments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id     UUID        NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  project_id  UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  author_id   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  content     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.goal_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "goal_comments_select" ON public.goal_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = goal_comments.project_id
        AND (p.owner_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = goal_comments.project_id AND pm.user_id = auth.uid()
        ))
    )
  );

CREATE POLICY "goal_comments_insert" ON public.goal_comments
  FOR INSERT WITH CHECK (
    auth.uid() = author_id
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = goal_comments.project_id
        AND (p.owner_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = goal_comments.project_id AND pm.user_id = auth.uid()
        ))
    )
  );

CREATE POLICY "goal_comments_delete" ON public.goal_comments
  FOR DELETE USING (auth.uid() = author_id);

CREATE INDEX IF NOT EXISTS idx_goal_comments_goal ON public.goal_comments(goal_id, created_at ASC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.goal_comments;
