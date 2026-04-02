-- migration-033: add sheet_name column to project_financials
-- Allows multi-sheet XLSX imports to be segregated by sheet tab

ALTER TABLE project_financials
  ADD COLUMN IF NOT EXISTS sheet_name text DEFAULT NULL;
