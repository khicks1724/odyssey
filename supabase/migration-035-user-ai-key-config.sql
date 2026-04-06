-- migration-035: store non-secret AI credential config alongside encrypted keys

ALTER TABLE public.user_ai_keys
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;
