-- Migration 031: Project Financials table
-- Stores budget, expense, and revenue line items per project

CREATE TABLE IF NOT EXISTS project_financials (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  label text NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'expense',  -- 'budget' | 'expense' | 'revenue'
  note text,
  date date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_financials_project_id_idx ON project_financials(project_id);

ALTER TABLE project_financials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_read_financials" ON project_financials
  FOR SELECT USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
      UNION SELECT id FROM projects WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "members_insert_financials" ON project_financials
  FOR INSERT WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
      UNION SELECT id FROM projects WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "creator_update_financials" ON project_financials
  FOR UPDATE USING (
    created_by = auth.uid() OR
    project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
  );

CREATE POLICY "creator_delete_financials" ON project_financials
  FOR DELETE USING (
    created_by = auth.uid() OR
    project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
  );
