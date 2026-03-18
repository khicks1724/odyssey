-- Migration 007: User-level OAuth connections
-- Stores per-user third-party OAuth tokens (e.g. Microsoft 365)
-- Tokens are AES-256-GCM encrypted by the backend before storage

CREATE TABLE IF NOT EXISTS public.user_connections (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider        TEXT        NOT NULL CHECK (provider IN ('microsoft')),
  access_token    TEXT        NOT NULL,   -- encrypted by backend
  refresh_token   TEXT,                   -- encrypted by backend
  expires_at      TIMESTAMPTZ NOT NULL,
  ms_user_id      TEXT,
  ms_email        TEXT,
  ms_display_name TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, provider)
);

ALTER TABLE public.user_connections ENABLE ROW LEVEL SECURITY;

-- Users can read their own connection metadata (no token columns exposed via RLS)
CREATE POLICY "Users read own connections"
  ON public.user_connections FOR SELECT
  USING (auth.uid() = user_id);

-- All writes (insert/update/delete) go through the backend service role only.
-- No insert/update/delete policies = only service role can write.

-- Fast lookup by user + provider
CREATE INDEX IF NOT EXISTS idx_user_connections_user_provider
  ON public.user_connections (user_id, provider);
