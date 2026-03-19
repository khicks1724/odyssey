-- migration-013: Add updated_at and updated_by columns to goals table
-- Applied 2026-03-19

ALTER TABLE goals
  ADD COLUMN updated_at timestamptz DEFAULT now(),
  ADD COLUMN updated_by uuid REFERENCES auth.users(id);

CREATE OR REPLACE FUNCTION update_goals_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER goals_updated_at_trigger
  BEFORE UPDATE ON goals
  FOR EACH ROW
  EXECUTE FUNCTION update_goals_updated_at();
