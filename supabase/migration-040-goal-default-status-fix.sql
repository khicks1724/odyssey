-- migration-040: ensure new goals default to a valid status

ALTER TABLE public.goals
  ALTER COLUMN status SET DEFAULT 'not_started';
