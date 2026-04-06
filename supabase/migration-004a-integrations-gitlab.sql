-- migration-004a: allow GitLab integrations used by the live app

ALTER TABLE public.integrations
  DROP CONSTRAINT IF EXISTS integrations_type_check;

ALTER TABLE public.integrations
  ADD CONSTRAINT integrations_type_check
  CHECK (type IN ('github', 'gitlab', 'teams', 'onedrive'));
