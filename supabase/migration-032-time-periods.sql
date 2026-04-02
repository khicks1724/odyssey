-- Migration 032: Time Periods (Sprints and Phases)
-- Stores sprint/phase date ranges per project for timeline visualization

CREATE TABLE IF NOT EXISTS time_periods (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'sprint' CHECK (type IN ('sprint', 'phase')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT time_periods_date_order CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS time_periods_project_id_idx ON time_periods(project_id);
CREATE INDEX IF NOT EXISTS time_periods_dates_idx ON time_periods(project_id, start_date, end_date);

ALTER TABLE time_periods ENABLE ROW LEVEL SECURITY;

-- Members can read time periods for their projects
CREATE POLICY "project members can read time_periods"
  ON time_periods FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
    OR project_id IN (
      SELECT id FROM projects WHERE created_by = auth.uid()
    )
  );

-- Members can create time periods for their projects
CREATE POLICY "project members can insert time_periods"
  ON time_periods FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
    OR project_id IN (
      SELECT id FROM projects WHERE created_by = auth.uid()
    )
  );

-- Members can update time periods for their projects
CREATE POLICY "project members can update time_periods"
  ON time_periods FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
    OR project_id IN (
      SELECT id FROM projects WHERE created_by = auth.uid()
    )
  );

-- Members can delete time periods for their projects
CREATE POLICY "project members can delete time_periods"
  ON time_periods FOR DELETE
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
    OR project_id IN (
      SELECT id FROM projects WHERE created_by = auth.uid()
    )
  );
