-- migration-029a: add user-owned encrypted AI provider credentials

CREATE TABLE IF NOT EXISTS public.user_ai_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  credential_type text NOT NULL DEFAULT 'api_key' CHECK (credential_type IN ('api_key', 'oauth')),
  encrypted_key text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_ai_keys_user_provider_key UNIQUE (user_id, provider),
  CONSTRAINT user_ai_keys_provider_check CHECK (provider IN ('anthropic', 'openai', 'google', 'google_ai'))
);

ALTER TABLE public.user_ai_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_ai_keys_select_own" ON public.user_ai_keys;
CREATE POLICY "user_ai_keys_select_own"
  ON public.user_ai_keys FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_ai_keys_insert_own" ON public.user_ai_keys;
CREATE POLICY "user_ai_keys_insert_own"
  ON public.user_ai_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_ai_keys_update_own" ON public.user_ai_keys;
CREATE POLICY "user_ai_keys_update_own"
  ON public.user_ai_keys FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_ai_keys_delete_own" ON public.user_ai_keys;
CREATE POLICY "user_ai_keys_delete_own"
  ON public.user_ai_keys FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_user_ai_keys_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_user_ai_keys_updated_at ON public.user_ai_keys;
CREATE TRIGGER trg_touch_user_ai_keys_updated_at
  BEFORE UPDATE ON public.user_ai_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_user_ai_keys_updated_at();
