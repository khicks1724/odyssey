-- Migration 071: Per-user encrypted GitHub PAT storage
-- Allows users to store their own GitHub token so the integrations panel
-- can make authenticated API requests without hitting rate limits.

CREATE TABLE IF NOT EXISTS user_github_tokens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  encrypted_key text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_github_tokens ENABLE ROW LEVEL SECURITY;
