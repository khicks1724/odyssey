-- migration-004b: align goal statuses with the live application

ALTER TABLE public.goals
  DROP CONSTRAINT IF EXISTS goals_status_check;

ALTER TABLE public.goals
  ADD CONSTRAINT goals_status_check
  CHECK (status IN ('not_started', 'in_progress', 'in_review', 'complete'));
