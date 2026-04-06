-- migration-029b: align project metadata, labels, and prompts with the live app

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS image_url text;

CREATE TABLE IF NOT EXISTS public.project_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('category', 'loe')),
  name text NOT NULL,
  color text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_labels_project_id_idx
  ON public.project_labels(project_id, created_at);

ALTER TABLE public.project_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_labels_select_member" ON public.project_labels;
CREATE POLICY "project_labels_select_member"
  ON public.project_labels FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_labels.project_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.project_members pm
            WHERE pm.project_id = project_labels.project_id
              AND pm.user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "project_labels_insert_owner" ON public.project_labels;
CREATE POLICY "project_labels_insert_owner"
  ON public.project_labels FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_labels.project_id
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "project_labels_update_owner" ON public.project_labels;
CREATE POLICY "project_labels_update_owner"
  ON public.project_labels FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_labels.project_id
        AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_labels.project_id
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "project_labels_delete_owner" ON public.project_labels;
CREATE POLICY "project_labels_delete_owner"
  ON public.project_labels FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_labels.project_id
        AND p.owner_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.project_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  feature text NOT NULL CHECK (feature IN ('insights', 'standup', 'report', 'guidance', 'risk', 'intelligent_update')),
  prompt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_prompts_project_feature_key UNIQUE (project_id, feature)
);

CREATE INDEX IF NOT EXISTS project_prompts_project_id_idx
  ON public.project_prompts(project_id);

ALTER TABLE public.project_prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_prompts_select_member" ON public.project_prompts;
CREATE POLICY "project_prompts_select_member"
  ON public.project_prompts FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_prompts.project_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.project_members pm
            WHERE pm.project_id = project_prompts.project_id
              AND pm.user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "project_prompts_insert_owner" ON public.project_prompts;
CREATE POLICY "project_prompts_insert_owner"
  ON public.project_prompts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_prompts.project_id
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "project_prompts_update_owner" ON public.project_prompts;
CREATE POLICY "project_prompts_update_owner"
  ON public.project_prompts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_prompts.project_id
        AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_prompts.project_id
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "project_prompts_delete_owner" ON public.project_prompts;
CREATE POLICY "project_prompts_delete_owner"
  ON public.project_prompts FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_prompts.project_id
        AND p.owner_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.touch_project_prompts_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_project_prompts_updated_at ON public.project_prompts;
CREATE TRIGGER trg_touch_project_prompts_updated_at
  BEFORE UPDATE ON public.project_prompts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_project_prompts_updated_at();
